import { addDays, currentOccurrence, diffDays, prettyDate, today } from "./dates";
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

function whenText(days: number, type: Task["type"]) {
  const verb = type === "certificate" ? "expires" : "is due";
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow`;
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
    kind === "assigned" ? `New ${label.toLowerCase()} assigned: ${esc(t.title)}` : `${esc(t.title)} ${whenText(days, t.type)}`;
  const subject =
    kind === "assigned"
      ? `[Assigned] ${t.title} — ${isCert ? "expires" : "due"} ${prettyDate(occurrence)}`
      : `${days < 0 ? "[OVERDUE] " : "[Reminder] "}${t.title} ${whenText(days, t.type)} (${prettyDate(occurrence)})`;
  const rows: [string, string][] = [
    ["Type", label],
    [isCert ? "Expiry date" : "Due date", esc(prettyDate(occurrence))],
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
  sent: number;
  failed: number;
  details: { title: string; to: string[]; kind: string; ok: boolean; error?: string }[];
  emailConfigured: boolean;
}

/** Core daily job: send every reminder that falls on `ref`. Mutates db. */
export async function runReminders(db: DB, ref = today()): Promise<RunResult> {
  const res: RunResult = { date: ref, sent: 0, failed: 0, details: [], emailConfigured: !!emailProvider() };
  const log = (e: Omit<LogEntry, "at">) => {
    db.log.push({ at: new Date().toISOString(), ...e });
    res.details.push({ title: e.title, to: e.to, kind: e.kind, ok: e.ok, error: e.error });
    e.ok ? res.sent++ : res.failed++;
  };
  const overdueList: { t: Task; date: string }[] = [];

  for (const t of db.tasks) {
    if (!t.active || !t.assignees.length) continue;
    const offsets = [...new Set(t.reminders)].sort((a, b) => b - a);

    for (const o of offsets) {
      const occ = addDays(ref, o);
      if (!isOccurrence(t, occ) || t.doneFor.includes(occ)) continue;
      const key = `${occ}:${o}`;
      if (t.sent.includes(key)) continue; // legacy whole-task key
      const r = await sendToAssignees(t, occ, ref, "reminder", key);
      if (r.sentTo.length) log({ taskId: t.id, title: t.title, to: r.sentTo, kind: "reminder", ok: true });
      for (const f of r.failed) log({ taskId: t.id, title: t.title, to: [f.email], kind: "reminder", ok: false, error: f.error });
    }

    if (t.recurrence === "none" && t.startDate < ref && !t.doneFor.includes(t.startDate)) {
      overdueList.push({ t, date: t.startDate });
      const key = `${t.startDate}:overdue:${ref}`;
      if (t.overdueDaily && !t.sent.includes(key)) {
        const r = await sendToAssignees(t, t.startDate, ref, "overdue", key);
        if (r.sentTo.length) log({ taskId: t.id, title: t.title, to: r.sentTo, kind: "overdue", ok: true });
        for (const f of r.failed) log({ taskId: t.id, title: t.title, to: [f.email], kind: "overdue", ok: false, error: f.error });
      }
    }
    t.sent = t.sent.slice(-400);
  }

  // Daily digest to the admin
  const admin = process.env.ADMIN_EMAIL;
  if (admin && (res.details.length || overdueList.length)) {
    const rows: [string, string][] = [
      ["Date", esc(prettyDate(ref))],
      ["Reminders sent", String(res.sent)],
      ["Failed", String(res.failed)],
      ["Overdue items", String(overdueList.length)],
    ];
    const list = (items: string[]) => (items.length ? `<ul style="padding-left:18px;margin:6px 0">${items.join("")}</ul>` : "<p>None</p>");
    const body =
      `<b>Sent today</b>` +
      list(res.details.map((d) => `<li>${esc(d.title)} → ${esc(d.to.join(", "))} ${d.ok ? "" : `<span style="color:#dc2626">(failed: ${esc(d.error || "")})</span>`}</li>`)) +
      `<b>Overdue</b>` +
      list(overdueList.map(({ t, date }) => `<li>${esc(t.title)} — ${esc(prettyDate(date))} (${esc(t.assignees.join(", "))})</li>`));
    try {
      await sendMail({ to: [admin], subject: `Daily reminder digest — ${prettyDate(ref)}`, html: layout("Daily digest", "#111827", rows, body), text: `Sent ${res.sent}, failed ${res.failed}, overdue ${overdueList.length}` });
      db.log.push({ at: new Date().toISOString(), title: "Daily digest", to: [admin], kind: "digest", ok: true });
    } catch (e) {
      db.log.push({ at: new Date().toISOString(), title: "Daily digest", to: [admin], kind: "digest", ok: false, error: String((e as Error).message) });
    }
  }

  db.lastRun = new Date().toISOString();
  return res;
}
