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
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config().anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      tools: [req.tool],
      tool_choice: { type: "tool", name: req.tool.name },
    }),
  });
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

