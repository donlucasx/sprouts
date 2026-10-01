// One forced tool call to the Messages API with a trivial tool, to read the API's own verdict on the key and the account.
// Prints the HTTP status and, on an error, only the error type and message (never the key, never a prompt).
// Run from api/: pnpm tsx --env-file=.env.local spikes/model-ping.ts
import { MODEL } from "../src/lib/anthropic";

const key = process.env.ANTHROPIC_API_KEY ?? "";
if (!key) { console.log("ANTHROPIC_API_KEY is not set in the env file"); process.exit(1); }
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 50,
    system: "Answer with the tool.",
    messages: [{ role: "user", content: "Say ok." }],
    tools: [{ name: "say", description: "Says one word.", input_schema: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } }],
    tool_choice: { type: "tool", name: "say" },
  }),
});
console.log(`status ${res.status}`);
const body = (await res.json().catch(() => null)) as { error?: { type?: string; message?: string }; content?: unknown[]; usage?: unknown } | null;
if (!res.ok) console.log(`error type: ${body?.error?.type ?? "?"}\nerror message: ${String(body?.error?.message ?? "?").slice(0, 300)}`);
else console.log(`ok: ${JSON.stringify(body?.content).slice(0, 200)} usage ${JSON.stringify(body?.usage)}`);
