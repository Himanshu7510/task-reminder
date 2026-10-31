import type { DB, Task } from "./types";

/** Mark one occurrence of a task complete and remember who did it. Returns false if it was already complete. */
export function completeOccurrence(db: DB, t: Task, occ: string, email: string, via: "email" | "dashboard"): boolean {
  if (t.doneFor.includes(occ)) return false;
  const at = new Date().toISOString();
  t.doneFor = [...t.doneFor, occ].slice(-100);
  t.completions = [...(t.completions || []), { occ, email, at, via }].slice(-100);
  t.updatedAt = at;
  db.log.push({ at, taskId: t.id, title: t.title, to: [email], kind: "completed", ok: true, error: via === "email" ? "via email link" : "on dashboard" });
  return true;
}

/** Record that an assignee opened the reminder email (first open per person per occurrence). */
export function recordSeen(db: DB, t: Task, occ: string, email: string): boolean {
  t.seen ||= [];
  if (t.seen.some((s) => s.occ === occ && s.email === email)) return false;
  const at = new Date().toISOString();
  t.seen = [...t.seen, { occ, email, at }].slice(-200);
  db.log.push({ at, taskId: t.id, title: t.title, to: [email], kind: "seen", ok: true });
  return true;
}
