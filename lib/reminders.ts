import { addDays, currentOccurrence, DEFAULT_TIME, diffDays, nowTime, prettyDate, prettyTime, today } from "./dates";
import { appUrl, esc, layout, sendMail, emailProvider } from "./email";
import { signLink } from "./tokens";
import type { DB, LogEntry, Task } from "./types";

const REC_LABEL: Record<Task["recurrence"], string> = {
  none: "One-time", daily: "Every day", weekly: "Every week", monthly: "Every month", quarterly: "Every 3 months", yearly: "Every year",
};
export const recurrenceLabel = (r: Task["recurrence"]) => REC_LABEL[r];

/** Is `date` an occurrence of the task? */
function isOccurrence(t: Task, date: string) {
  return currentOccurrence(t, date) === date && date >= t.startDate;
}

/** Next occurrence that is not yet done (or overdue one-off). */
export function nextPending(t: Task, ref = today()): { date: string; overdue: boolean } | null {
  if (t.recurrence === "none") {
    if (t.doneFor.includes(t.startDate)) return null;
    return { date: t.startDate, overdue: t.startDate < ref };
  }
  let d = currentOccurrence(t, ref);
  for (let i = 0; i < 400 && t.doneFor.includes(d); i++) d = currentOccurrence(t, addDays(d, 1));
  return { date: d, overdue: false };
}

export const timeOf = (t: Task) => t.dueTime || DEFAULT_TIME;

function whenText(days: number, type: Task["type"], time?: string) {
  const verb = type === "certificate" ? "expires" : "is due";
  const at = time ? ` at ${prettyTime(time)}` : "";
  if (days === 0) return `${verb} today${at}`;
  if (days === 1) return `${verb} tomorrow${at}`;
  if (days > 1) return `${verb} in ${days} days`;
  return `${type === "certificate" ? "expired" : "was due"} ${-days} day${days === -1 ? "" : "s"} ago`;
}

/** Personal links for one assignee: "Mark as complete" page and the open-tracking pixel. */
export function personalLinks(t: Task, occurrence: string, email: string) {
  const token = signLink(t.id, email, occurrence);
  return { done: `${appUrl()}/done?k=${token}`, pixel: `${appUrl()}/api/t/open?k=${token}` };
}

export function buildReminder(t: Task, occurrence: string, ref = today(), kind: LogEntry["kind"] = "reminder", recipient?: string) {
  const days = diffDays(occurrence, ref);
  const isCert = t.type === "certificate";
  const accent = days < 0 ? "#dc2626" : days <= 1 ? "#ea580c" : days <= 7 ? "#d97706" : "#2563eb";
  const label = isCert ? "Certificate" : "Task";
  const heading =
    kind === "assigned" ? `New ${label.toLowerCase()} assigned: ${esc(t.title)}` : `${esc(t.title)} ${whenText(days, t.type, timeOf(t))}`;
  const dueAt = `${prettyDate(occurrence)} at ${prettyTime(timeOf(t))}`;
  const left = days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "Due today" : days === 1 ? "1 day (tomorrow)" : `${days} days`;
  const subject =
    kind === "assigned"
      ? `[Assigned] ${t.title} — ${isCert ? "expires" : "due"} ${dueAt}`
      : `${days < 0 ? "[OVERDUE] " : "[Reminder] "}${t.title} ${whenText(days, t.type)} — ${dueAt}`;
  const rows: [string, string][] = [
    ["Type", label],
    [isCert ? "Expiry" : "Due", esc(dueAt) + " IST"],
    [days < 0 ? "Status" : "Time left", left],
    ["Repeats", REC_LABEL[t.recurrence]],
    ["Assigned to", esc(t.assignees.join(", "))],
  ];
  if (t.reference) rows.push([isCert ? "Certificate no." : "Reference", esc(t.reference)]);
  if (t.attachments?.length) rows.push(["Attachments", esc(t.attachments.map((a) => a.name).join(", "))]);
  const body = t.description ? esc(t.description).replace(/\n/g, "<br>") : "";
  if (!recipient) {
    const html = layout(heading, accent, rows, body);
    const text = `${heading.replace(/&amp;/g, "&")}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${t.description || ""}`;
    return { subject, html, text };
  }
  const links = personalLinks(t, occurrence, recipient);
  const verb = isCert ? "renewed" : "complete";
  const html = layout(heading, accent, rows, body, isCert ? "✓ Mark as renewed" : "✓ Mark as complete", {
    ctaHref: links.done,
    ctaColor: "#16a34a",
    ctaNote: `Done already? Click the button and confirm — it updates the team dashboard and stops further reminders for this ${isCert ? "renewal" : "due date"}.`,
    pixel: links.pixel,
  });
  const text =
    `${heading.replace(/&amp;/g, "&")}\n\n${rows.map(([k, v]) => `${k}: ${v.replace(/&amp;/g, "&")}`).join("\n")}\n\n${t.description || ""}\n\n` +
    `Mark as ${verb}: ${links.done}`;
  return { subject, html, text };
}

/**
 * Email every assignee separately (each gets their own "Mark as complete" link and open tracking).
 * `dedupKey` (optional) skips people who already got this exact reminder.
 */
export async function sendToAssignees(t: Task, occurrence: string, ref: string, kind: LogEntry["kind"], dedupKey?: string) {
  const sentTo: string[] = [], failed: { email: string; error: string }[] = [];
  for (const email of t.assignees) {
    const key = dedupKey ? `${dedupKey}:${email}` : "";
    if (key && t.sent.includes(key)) continue;
    try {
      await sendMail({ to: [email], ...buildReminder(t, occurrence, ref, kind, email) });
      if (key) t.sent.push(key);
      sentTo.push(email);
    } catch (e) {
      failed.push({ email, error: String((e as Error).message) });
    }
  }
  return { sentTo, failed };
}

export interface RunResult {
  date: string;
  time: string;
  sent: number;
  failed: number;
  details: { title: string; to: string[]; kind: string; ok: boolean; error?: string }[];
  emailConfigured: boolean;
}

export interface DueItem {
  t: Task;
  occ: string;
  kind: "reminder" | "overdue";
  key: string;
}

/**
 * Everything that should be emailed now. A reminder "o days before" is due on (occurrence − o) at the task's time.
 * Also catches up yesterday's reminders if a scheduled run was missed (only for tasks that existed then).
 */
export function collectDue(db: DB, ref = today(), now = nowTime()): DueItem[] {
  const out: DueItem[] = [];
  const yesterday = addDays(ref, -1);
  const unsent = (t: Task, key: string) => t.assignees.some((e) => !t.sent.includes(`${key}:${e}`)) && !t.sent.includes(key);
  for (const t of db.tasks) {
    if (!t.active || !t.assignees.length) continue;
    const time = timeOf(t);
    const offsets = [...new Set(t.reminders)].sort((a, b) => b - a);
    const created = (t.createdAt || "").slice(0, 10);
    for (const sendDay of [yesterday, ref]) {
      if (sendDay === ref && now < time) continue; // not time yet today
      if (sendDay === yesterday && created > yesterday) continue; // task didn't exist yet
      for (const o of offsets) {
        const occ = addDays(sendDay, o);
        if (occ < ref || !isOccurrence(t, occ) || t.doneFor.includes(occ)) continue;
        const key = `${occ}:${o}`;
        if (unsent(t, key)) out.push({ t, occ, kind: "reminder", key });
      }
    }
    if (t.recurrence === "none" && t.overdueDaily && t.startDate < ref && !t.doneFor.includes(t.startDate) && now >= time) {
      const key = `${t.startDate}:overdue:${ref}`;
      if (unsent(t, key)) out.push({ t, occ: t.startDate, kind: "overdue", key });
    }
  }
  return out;
}

/** Send everything that's due now. Mutates db. `digest` adds the admin's daily summary (once-a-day run only). */
export async function runReminders(db: DB, opts: { ref?: string; now?: string; digest?: boolean } = {}): Promise<RunResult> {
  const ref = opts.ref ?? today(), now = opts.now ?? nowTime();
  const res: RunResult = { date: ref, time: now, sent: 0, failed: 0, details: [], emailConfigured: !!emailProvider() };
  const log = (e: Omit<LogEntry, "at">) => {
    db.log.push({ at: new Date().toISOString(), ...e });
    res.details.push({ title: e.title, to: e.to, kind: e.kind, ok: e.ok, error: e.error });
    e.ok ? res.sent++ : res.failed++;
  };

  for (const d of collectDue(db, ref, now)) {
    const r = await sendToAssignees(d.t, d.occ, ref, d.kind, d.key);
    if (r.sentTo.length) log({ taskId: d.t.id, title: d.t.title, to: r.sentTo, kind: d.kind, ok: true });
    for (const f of r.failed) log({ taskId: d.t.id, title: d.t.title, to: [f.email], kind: d.kind, ok: false, error: f.error });
  }
  for (const t of db.tasks) t.sent = t.sent.slice(-400);

  if (opts.digest) await sendDigest(db, ref);
  db.lastRun = new Date().toISOString();
  return res;
}

/** Admin summary of the last 24 hours + everything overdue. */
async function sendDigest(db: DB, ref: string) {
  const admin = process.env.ADMIN_EMAIL;
  if (!admin) return;
  const since = Date.now() - 86400000;
  const recent = db.log.filter((l) => Date.parse(l.at) >= since && ["reminder", "overdue", "completed"].includes(l.kind));
  const overdue = db.tasks
    .filter((t) => t.active)
    .map((t) => ({ t, n: nextPending(t, ref) }))
    .filter((x) => x.n?.overdue);
  if (!recent.length && !overdue.length) return;
  const sent = recent.filter((l) => l.kind !== "completed");
  const done = recent.filter((l) => l.kind === "completed");
  const rows: [string, string][] = [
    ["Date", esc(prettyDate(ref))],
    ["Reminders sent (24h)", String(sent.filter((l) => l.ok).length)],
    ["Failed", String(sent.filter((l) => !l.ok).length)],
    ["Completed (24h)", String(done.length)],
    ["Overdue items", String(overdue.length)],
  ];
  const list = (items: string[]) => (items.length ? `<ul style="padding-left:18px;margin:6px 0">${items.join("")}</ul>` : "<p>None</p>");
  const body =
    `<b>Completed</b>` + list(done.map((l) => `<li>${esc(l.title)} — ${esc(l.to.join(", "))} ${esc(l.error || "")}</li>`)) +
    `<b>Reminders sent</b>` +
    list(sent.map((d) => `<li>${esc(d.title)} → ${esc(d.to.join(", "))} ${d.ok ? "" : `<span style="color:#dc2626">(failed: ${esc(d.error || "")})</span>`}</li>`)) +
    `<b>Overdue</b>` +
    list(overdue.map(({ t, n }) => `<li>${esc(t.title)} — ${esc(prettyDate(n!.date))} at ${prettyTime(timeOf(t))} (${esc(t.assignees.join(", "))})</li>`));
  try {
    await sendMail({ to: [admin], subject: `Daily reminder digest — ${prettyDate(ref)}`, html: layout("Daily digest", "#111827", rows, body), text: `Sent ${sent.length}, completed ${done.length}, overdue ${overdue.length}` });
    db.log.push({ at: new Date().toISOString(), title: "Daily digest", to: [admin], kind: "digest", ok: true });
  } catch (e) {
    db.log.push({ at: new Date().toISOString(), title: "Daily digest", to: [admin], kind: "digest", ok: false, error: String((e as Error).message) });
  }
}
