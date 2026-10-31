import { NextResponse } from "next/server";
import { readDB, updateDB } from "@/lib/db";
import { nowTime, today } from "@/lib/dates";
import { collectDue, runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called every ~10 minutes by GitHub Actions (.github/workflows/reminders.yml) so reminders go out at each task's due time.
 * Safe to be public: it only sends reminders that are due right now, each one at most once (de-duplicated per person),
 * and does nothing at all when nothing is due. Returns only counts.
 */
export async function GET() {
  const ref = today(), now = nowTime();
  const due = collectDue(await readDB(), ref, now);
  if (!due.length) return NextResponse.json({ ok: true, date: ref, time: now, due: 0 });
  const r = await updateDB((db) => runReminders(db, { ref, now }));
  return NextResponse.json({ ok: true, date: ref, time: now, due: due.length, sent: r.sent, failed: r.failed });
}

export const POST = GET;
