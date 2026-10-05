import { config } from "./config";

// The one model client (design notes section 5): Claude Haiku 4.5 from the server only, keys and prompts server-side, every call
// a forced tool call so the answer is JSON the caller validates. No SDK: one fetch, nothing else to install.
export const MODEL = "claude-haiku-4-5-20251001";

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type ModelRequest = { system: string; user: string; tool: ToolSpec; maxTokens: number };
export type Usage = { inputTokens: number; outputTokens: number };
export type ModelResult = { input: unknown; usage: Usage };
export type ModelCall = (req: ModelRequest) => Promise<ModelResult>;

type MessagesResponse = {
  content: { type: string; name?: string; input?: unknown }[];
  usage: { input_tokens: number; output_tokens: number };
};

/**
 * One Messages call that must answer with the tool. On an error the message carries the API's error type and its own message
 * (never the body as a whole, which could echo our prompt): "credit balance is too low" and "invalid x-api-key" are then readable in the log.
 */
export const callTool: ModelCall = async (req) => {
  // K-M5: the same per-call timeout and single 529 retry as callConversation (the watcher's compile holds a budget row meanwhile).
  const res = await postMessages(JSON.stringify({
    model: MODEL,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    tools: [req.tool],
    tool_choice: { type: "tool", name: req.tool.name },
  }));
  if (!res.ok) throw new Error(`Anthropic answered ${res.status}${await errorDetail(res)}.`);
  const body = (await res.json()) as MessagesResponse;
  const block = body.content.find((c) => c.type === "tool_use" && c.name === req.tool.name);
  if (!block) throw new Error("The model did not call the tool.");
  return { input: block.input, usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } };
};

/** The API's error type and message, trimmed, for the log line; nothing else from the body. */
async function errorDetail(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { type?: unknown; message?: unknown } } | null;
  const type = typeof body?.error?.type === "string" ? body.error.type : null;
  const message = typeof body?.error?.message === "string" ? body.error.message.replace(/\s+/g, " ").slice(0, 200) : null;
  return type || message ? ` (${[type, message].filter(Boolean).join(": ")})` : "";
}


export type ToolUse = { id: string; name: string; input: unknown };
export type ChatMessage = { role: "user" | "assistant"; content: unknown };
export type ConversationCall = (req: { system: string; messages: ChatMessage[]; tools: ToolSpec[]; maxTokens: number }) => Promise<{ toolUses: ToolUse[]; usage: Usage }>;

/** Review I5: one call never waits longer than this; the decide step has its own total budget on top (split-run). */
export const CALL_TIMEOUT_MS = 20_000;
/** Review M6: an overloaded API (529) gets exactly one more try after this pause, logged as such. */
export const OVERLOADED_RETRY_MS = 250;

/** One Messages call that must use a tool (any of them): the tool loop's single step. */
/** One POST to the Messages API: CALL_TIMEOUT_MS per try, and a 529 (overloaded) tried exactly once more. */
async function postMessages(body: string): Promise<Response> {
  const send = () => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config().anthropicApiKey, "anthropic-version": "2023-06-01" },
    body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  let res = await send();
  if (res.status === 529) {
    console.error("Anthropic answered 529 (overloaded); trying once more");
    await new Promise((r) => setTimeout(r, OVERLOADED_RETRY_MS));
    res = await send();
  }
  return res;
}

export const callConversation: ConversationCall = async (req) => {
  const res = await postMessages(JSON.stringify({ model: MODEL, max_tokens: req.maxTokens, system: req.system, messages: req.messages, tools: req.tools, tool_choice: { type: "any" } }));
  if (!res.ok) throw new Error(`Anthropic answered ${res.status}${await errorDetail(res)}.`);
  const out = (await res.json()) as { content: { type: string; id?: string; name?: string; input?: unknown }[]; usage: { input_tokens: number; output_tokens: number } };
  return { toolUses: out.content.filter((c) => c.type === "tool_use").map((c) => ({ id: String(c.id), name: String(c.name), input: c.input })), usage: { inputTokens: out.usage.input_tokens, outputTokens: out.usage.output_tokens } };
};

/** R276/R278: the model reads the venues itself through tools; every tool output is recorded (served) so the why line stays checkable. */
export async function runToolLoop(a: { call: ConversationCall; system: string; user: string; tools: ToolSpec[]; finalTool: string; maxTurns: number; maxTokens: number; run: (name: string, input: unknown) => Promise<unknown>; deadlineMs?: number }): Promise<{ final: unknown | null; served: { name: string; input: unknown; output: unknown }[]; usage: Usage }> {
  const messages: ChatMessage[] = [{ role: "user", content: a.user }];
  const served: { name: string; input: unknown; output: unknown }[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (let turn = 0; turn < a.maxTurns; turn++) {
    if (a.deadlineMs !== undefined && Date.now() >= a.deadlineMs) break;   // review I5: no new turn past the decide step's budget
    const t = await a.call({ system: a.system, messages, tools: a.tools, maxTokens: a.maxTokens });
    usage.inputTokens += t.usage.inputTokens;
    usage.outputTokens += t.usage.outputTokens;
    const final = t.toolUses.find((u) => u.name === a.finalTool);
    if (final) return { final: final.input, served, usage };
    if (!t.toolUses.length) break;
    messages.push({ role: "assistant", content: t.toolUses.map((u) => ({ type: "tool_use", id: u.id, name: u.name, input: u.input })) });
    const results: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
    for (const u of t.toolUses) {
      let output: unknown;
      try {
        output = await a.run(u.name, u.input);
      } catch (e) {
        output = { error: e instanceof Error ? e.message : String(e) };
      }
      served.push({ name: u.name, input: u.input, output });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: results });
  }
  return { final: null, served, usage };
}
