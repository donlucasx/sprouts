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
