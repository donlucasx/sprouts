import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/config", () => ({ config: () => ({ anthropicApiKey: "k" }) }));
import { callTool } from "@/lib/anthropic";

const req = { system: "s", user: "u", tool: { name: "t", description: "d", input_schema: { type: "object" } }, maxTokens: 10 };
const reply = (status: number, body: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

// The log line must say WHY the API refused (the 2026-10-01 production run showed only "Anthropic answered 400").
describe("callTool errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("carries the API's error type and message, trimmed", async () => {
    reply(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API.  Please add credits." } });
    await expect(callTool(req)).rejects.toThrow("Anthropic answered 400 (invalid_request_error: Your credit balance is too low to access the Anthropic API. Please add credits.).");
  });

  it("falls back to the status alone when the body is not the API's error shape", async () => {
    reply(502, "<html>bad gateway</html>");
    await expect(callTool(req)).rejects.toThrow("Anthropic answered 502.");
  });

  it("returns the tool input and the usage on success", async () => {
    reply(200, { content: [{ type: "tool_use", name: "t", input: { a: 1 } }], usage: { input_tokens: 5, output_tokens: 2 } });
    await expect(callTool(req)).resolves.toEqual({ input: { a: 1 }, usage: { inputTokens: 5, outputTokens: 2 } });
  });
});

import { runToolLoop, callConversation, type ConversationCall } from "@/lib/anthropic";
describe("runToolLoop", () => {
  it("runs tools until the final tool, records what each returned, sums usage, and feeds errors back as tool results", async () => {
    const seen: unknown[] = [];
    const call: ConversationCall = async (req) => {
      seen.push(req.messages.at(-1));
      if (req.messages.length === 1) return { toolUses: [{ id: "1", name: "boom", input: {} }, { id: "2", name: "echo", input: { n: 7 } }], usage: { inputTokens: 10, outputTokens: 2 } };
      return { toolUses: [{ id: "3", name: "done", input: { ok: true } }], usage: { inputTokens: 20, outputTokens: 3 } };
    };
    const r = await runToolLoop({ call, system: "s", user: "u", tools: [], finalTool: "done", maxTurns: 4, maxTokens: 100, run: async (name, input) => { if (name === "boom") throw new Error("no"); return input; } });
    expect(r.final).toEqual({ ok: true });
    expect(r.served).toEqual([{ name: "boom", input: {}, output: { error: "no" } }, { name: "echo", input: { n: 7 }, output: { n: 7 } }]);
    expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 5 });
    expect(seen[1]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: '{"error":"no"}' }, { type: "tool_result", tool_use_id: "2", content: '{"n":7}' }] });
  });
});

describe("callConversation (review I5, M6)", () => {
  afterEach(() => vi.restoreAllMocks());
  const conv = { system: "s", messages: [{ role: "user" as const, content: "u" }], tools: [], maxTokens: 10 };
  const ok = { content: [{ type: "tool_use", id: "1", name: "t", input: { a: 1 } }], usage: { input_tokens: 5, output_tokens: 2 } };
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends a timeout signal and retries a 529 exactly once", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(res(529, { error: { type: "overloaded_error", message: "Overloaded" } })).mockResolvedValueOnce(res(200, ok));
    await expect(callConversation(conv)).resolves.toEqual({ toolUses: [{ id: "1", name: "t", input: { a: 1 } }], usage: { inputTokens: 5, outputTokens: 2 } });
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("a second 529 throws; any other error is not retried", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => res(529, { error: { type: "overloaded_error", message: "Overloaded" } }));
    await expect(callConversation(conv)).rejects.toThrow("Anthropic answered 529 (overloaded_error: Overloaded).");
    expect(f).toHaveBeenCalledTimes(2);
    f.mockReset();
    f.mockImplementation(async () => res(500, {}));
    await expect(callConversation(conv)).rejects.toThrow("Anthropic answered 500.");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("runToolLoop starts no turn past its deadline", async () => {
    let calls = 0;
    const r = await runToolLoop({ call: async () => { calls++; return { toolUses: [], usage: { inputTokens: 1, outputTokens: 1 } }; }, system: "s", user: "u", tools: [], finalTool: "done", maxTurns: 4, maxTokens: 10, run: async () => null, deadlineMs: Date.now() - 1 });
    expect(calls).toBe(0);
    expect(r.final).toBeNull();
  });
});
