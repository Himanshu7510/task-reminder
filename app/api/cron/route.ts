import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called once a day by Vercel Cron (see vercel.json), or manually from the dashboard ("Run reminders now"). */
async function handle(req: Request) {
  const auth = req.headers.get("authorization");
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk && !(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await updateDB((db) => runReminders(db));
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
