import { today } from "./dates";
import { nextPending, sendToAssignees } from "./reminders";
import type { DB, LogEntry, Task } from "./types";

async function send(db: DB, task: Task, kind: LogEntry["kind"]): Promise<{ ok: boolean; error?: string }> {
  const next = nextPending(task) ?? { date: task.startDate };
  const r = await sendToAssignees(task, next.date, today(), kind);
  const at = new Date().toISOString();
  if (r.sentTo.length) db.log.push({ at, taskId: task.id, title: task.title, to: r.sentTo, kind, ok: true });
  for (const f of r.failed) db.log.push({ at, taskId: task.id, title: task.title, to: [f.email], kind, ok: false, error: f.error });
  return r.failed.length ? { ok: r.sentTo.length > 0, error: r.failed.map((f) => `${f.email}: ${f.error}`).join("; ") } : { ok: true };
}

export const notifyAssigned = (db: DB, task: Task) => send(db, task, "assigned");
export const notifyNow = (db: DB, task: Task) => send(db, task, "manual");
