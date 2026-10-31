"use client";
import { useState } from "react";

export const RULES: [string, (p: string) => boolean][] = [
  ["10+ characters", (p) => p.length >= 10],
  ["Uppercase letter", (p) => /[A-Z]/.test(p)],
  ["Lowercase letter", (p) => /[a-z]/.test(p)],
  ["Number", (p) => /\d/.test(p)],
  ["Symbol (!@#…)", (p) => /[^A-Za-z0-9]/.test(p)],
  ["No common words", (p) => !!p && !/password|12345|qwerty|admin|reminder/i.test(p)],
];
export const strongEnough = (p: string) => RULES.every(([, ok]) => ok(p));

export function PasswordField({ label, value, onChange, autoComplete, autoFocus, showRules }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; showRules?: boolean;
}) {
  const [show, setShow] = useState(false);
  const passed = RULES.filter(([, ok]) => ok(value)).length;
  const pct = Math.round((passed / RULES.length) * 100);
  const tone = pct === 100 ? "strong" : pct >= 67 ? "ok" : "weak";
  return (
    <div className="pwfield">
      <label>{label}</label>
      <div className="pw-wrap">
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
          autoFocus={autoFocus} required maxLength={128} spellCheck={false} autoCapitalize="off" />
        <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
      </div>
      {showRules && (
        <>
          <div className={`meter ${tone}`}><span style={{ width: `${value ? Math.max(pct, 8) : 0}%` }} /></div>
          <ul className="rules">
            {RULES.map(([t, ok]) => <li key={t} className={ok(value) ? "met" : ""}>{ok(value) ? "✓" : "○"} {t}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
