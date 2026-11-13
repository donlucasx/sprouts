"use client";
import { useState } from "react";

export function LoginForm() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/ops/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
      if (r.status === 204) { window.location.reload(); return; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? "Could not sign in.");
    } catch {
      setErr("Could not reach the server.");
    }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="ops-form">
      <label htmlFor="ops-pw">Password</label>
      <input id="ops-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <button type="submit" disabled={busy || !pw}>{busy ? "Checking..." : "Open"}</button>
      {err ? <p role="alert" className="ops-err">{err}</p> : null}
    </form>
  );
}
