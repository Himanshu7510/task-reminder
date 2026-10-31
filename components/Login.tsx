"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (r.ok) location.reload();
    else setErr("Wrong password");
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <div className="brand"><span className="logo">◷</span> Reminder Desk</div>
        <h1>Tasks &amp; certificates, on time.</h1>
        <p className="muted">Sign in to manage assignments, renewal dates and email reminders.</p>
        <label>Admin password
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
