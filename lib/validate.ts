import { randomUUID } from "crypto";
import { isValidDate } from "./dates";
import type { Recurrence, Task } from "./types";

const RECS: Recurrence[] = ["none", "daily", "weekly", "monthly", "quarterly", "yearly"];
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function parseEmails(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/);
  return [...new Set(arr.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

/** Every task gets 3 reminders by default: 2 days before, 1 day before and on the due date. */
export const DEFAULT_REMINDERS = [2, 1, 0];

export function parseOffsets(v: unknown, rec: Recurrence): number[] {
  const arr = Array.isArray(v) ? v : String(v ?? "").split(/[,;\s|]+/);
  const nums = arr.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 366);
  const list = [...new Set(nums)].sort((a, b) => b - a);
  if (list.length) return list;
  return rec === "daily" ? [0] : [...DEFAULT_REMINDERS];
}

/** Normalise a free-form date: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY */
export function normalizeDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (isValidDate(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (isValidDate(d)) return d;
  }
  return "";
}

export function buildTask(input: Record<string, unknown>, existing?: Task): { task?: Task; error?: string } {
  const title = String(input.title ?? existing?.title ?? "").trim();
  if (!title) return { error: "Title is required" };
  const type = (input.type ?? existing?.type ?? "task") === "certificate" ? "certificate" : "task";
  const recRaw = String(input.recurrence ?? existing?.recurrence ?? "none").toLowerCase().trim();
  const recurrence = (RECS.includes(recRaw as Recurrence) ? recRaw : recRaw === "once" || recRaw === "" ? "none" : "") as Recurrence;
  if (!recurrence) return { error: `Unknown repeat "${recRaw}" (use none, daily, weekly, monthly, quarterly, yearly)` };
  const startDate = normalizeDate(input.startDate ?? existing?.startDate);
  if (!startDate) return { error: "A valid date is required (YYYY-MM-DD or DD/MM/YYYY)" };
  const assignees = parseEmails(input.assignees ?? existing?.assignees);
  const bad = assignees.filter((e) => !EMAIL.test(e));
  if (bad.length) return { error: `Invalid email: ${bad.join(", ")}` };
  if (!assignees.length) return { error: "Add at least one assignee email" };
  const now = new Date().toISOString();
  const dateChanged = existing && (existing.startDate !== startDate || existing.recurrence !== recurrence);
  return {
    task: {
      id: existing?.id ?? randomUUID(),
      type,
      title,
      description: String(input.description ?? existing?.description ?? "").slice(0, 5000),
      reference: String(input.reference ?? existing?.reference ?? "").slice(0, 300),
      assignees,
      startDate,
      recurrence,
      reminders: parseOffsets(input.reminders ?? existing?.reminders, recurrence),
      overdueDaily: input.overdueDaily !== undefined ? !!input.overdueDaily : existing?.overdueDaily ?? true,
      active: input.active !== undefined ? !!input.active : existing?.active ?? true,
      doneFor: dateChanged ? [] : existing?.doneFor ?? [],
      sent: dateChanged ? [] : existing?.sent ?? [],
      attachments: existing?.attachments ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  };
}
