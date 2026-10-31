"use client";
import { useEffect, useState } from "react";
import { PasswordField, strongEnough } from "./PasswordField";

type Mode = "login" | "forgot" | "reset" | "done";

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j } as { ok: boolean; error?: string; message?: string };
}

export default function Login({ resetToken }: { resetToken?: string }) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [token] = useState(resetToken || "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Remove the one-time token from the address bar and browser history straight away
  useEffect(() => {
    if (resetToken) window.history.replaceState(null, "", "/");
  }, [resetToken]);

  function go(m: Mode) { setMode(m); setErr(""); setMsg(""); setPw(""); setPw2(""); }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await post("/api/auth", { password: pw });
    setBusy(false);
    if (r.ok) location.replace("/");
    else { setErr(r.error || "Something went wrong on the server. Please try again in a moment."); setPw(""); }
  }

  async function forgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    const r = await post("/api/auth/forgot");
    setBusy(false);
    if (r.ok) setMsg(r.message || "Check the admin inbox for a reset link.");
    else setErr(r.error || "Couldn't send the reset link");
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!strongEnough(pw)) return setErr("Please meet every password rule.");
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    const r = await post("/api/auth/reset", { token, password: pw });
    setBusy(false);
    if (r.ok) { setMode("done"); setTimeout(() => location.replace("/"), 1800); }
    else setErr(r.error || "Reset failed");
  }

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand"><span className="logo">◷</span> Reminder Desk</div>

        {mode === "login" && (
          <form onSubmit={login}>
            <h1>Tasks &amp; certificates, on time.</h1>
            <p className="muted">Sign in to manage assignments, renewal dates and email reminders.</p>
            <PasswordField label="Admin password" value={pw} onChange={setPw} autoComplete="current-password" autoFocus />
            {err && <div className="error">{err}</div>}
            <button className="btn primary block" disabled={busy || !pw}>{busy ? "Signing in…" : "Sign in"}</button>
            <button type="button" className="linkbtn" onClick={() => go("forgot")}>Forgot password?</button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={forgot}>
            <h1>Reset your password</h1>
            <p className="muted">We&apos;ll email a one-time reset link to the admin email address on file. The link expires in 30 minutes and works only once.</p>
            {msg && <div className="notice">{msg}</div>}
            {err && <div className="error">{err}</div>}
            {!msg && <button className="btn primary block" disabled={busy}>{busy ? "Sending…" : "Email me a reset link"}</button>}
            <button type="button" className="linkbtn" onClick={() => go("login")}>← Back to sign in</button>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={reset}>
            <h1>Choose a new password</h1>
            <p className="muted">This signs out every other device that&apos;s currently signed in.</p>
            <PasswordField label="New password" value={pw} onChange={setPw} autoComplete="new-password" autoFocus showRules />
            <PasswordField label="Confirm new password" value={pw2} onChange={setPw2} autoComplete="new-password" />
            {pw2 && pw !== pw2 && <div className="hint-bad">Passwords don&apos;t match</div>}
            {err && <div className="error">{err}</div>}
            <button className="btn primary block" disabled={busy || !strongEnough(pw) || pw !== pw2}>{busy ? "Saving…" : "Set new password"}</button>
            <button type="button" className="linkbtn" onClick={() => go("forgot")}>Link expired? Send a new one</button>
          </form>
        )}

        {mode === "done" && (
          <div>
            <h1>Password updated ✓</h1>
            <p className="muted">You&apos;re signed in. Taking you to the dashboard…</p>
          </div>
        )}
      </div>
    </main>
  );
}
