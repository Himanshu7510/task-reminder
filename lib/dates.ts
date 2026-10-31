import type { Recurrence, Task } from "./types";

export const TZ = process.env.APP_TZ || "Asia/Kolkata";

/** Today's date in the app time zone as YYYY-MM-DD */
export function today(tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(parse(d).getTime()) && fmt(parse(d)) === d;
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

/** Add months keeping the original day, clamped to month end (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(d: string, n: number): string {
  const x = parse(d);
  const day = x.getUTCDate();
  const target = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fmt(target);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000);
}

function nth(start: string, r: Recurrence, k: number): string {
  switch (r) {
    case "daily": return addDays(start, k);
    case "weekly": return addDays(start, 7 * k);
    case "monthly": return addMonths(start, k);
    case "quarterly": return addMonths(start, 3 * k);
    case "yearly": return addMonths(start, 12 * k);
    default: return start;
  }
}

/** The occurrence that is current for `ref`: the first occurrence on/after ref (for one-off tasks: the start date). */
export function currentOccurrence(task: Pick<Task, "startDate" | "recurrence">, ref = today()): string {
  const { startDate: s, recurrence: r } = task;
  if (r === "none" || ref <= s) return s;
  // estimate k then step forward
  const days = diffDays(ref, s);
  let k =
    r === "daily" ? days :
    r === "weekly" ? Math.floor(days / 7) :
    r === "monthly" ? Math.max(0, Math.floor(days / 31) - 1) :
    r === "quarterly" ? Math.max(0, Math.floor(days / 92) - 1) :
    Math.max(0, Math.floor(days / 366) - 1);
  while (nth(s, r, k) < ref) k++;
  return nth(s, r, k);
}

/** Next N occurrences from ref (for preview) */
export function upcoming(task: Pick<Task, "startDate" | "recurrence">, n = 3, ref = today()): string[] {
  const first = currentOccurrence(task, ref);
  if (task.recurrence === "none") return [first];
  const out = [first];
  let cur = first;
  while (out.length < n) {
    cur = currentOccurrence(task, addDays(cur, 1));
    out.push(cur);
  }
  return out;
}

export function prettyDate(d: string): string {
  return parse(d).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", weekday: "short" });
}
