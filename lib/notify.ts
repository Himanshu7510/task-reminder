import { sendMail } from "./email";
import { buildReminder, nextPending } from "./reminders";
import type { DB, LogEntry, Task } from "./types";

async function send(db: DB, task: Task, kind: LogEntry["kind"]): Promise<{ ok: boolean; error?: string }> {
  const next = nextPending(task) ?? { date: task.startDate };
  const mail = buildReminder(task, next.date, undefined, kind);
  try {
    await sendMail({ to: task.assignees, ...mail });
    db.log.push({ at: new Date().toISOString(), taskId: task.id, title: task.title, to: task.assignees, kind, ok: true });
    return { ok: true };
  } catch (e) {
    const error = String((e as Error).message);
    db.log.push({ at: new Date().toISOString(), taskId: task.id, title: task.title, to: task.assignees, kind, ok: false, error });
    return { ok: false, error };
  }
}

export const notifyAssigned = (db: DB, task: Task) => send(db, task, "assigned");
export const notifyNow = (db: DB, task: Task) => send(db, task, "manual");
