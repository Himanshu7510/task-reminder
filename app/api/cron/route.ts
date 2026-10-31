import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily Vercel Cron (vercel.json, 9:00 AM IST): sends anything due + the admin's daily digest.
 * Also used by "Run reminders now" on the dashboard (no digest).
 * Time-of-day reminders are handled by /api/tick, which runs every 10 minutes.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization");
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk && !(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await updateDB((db) => runReminders(db, { digest: cronOk }));
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
