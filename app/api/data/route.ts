import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readDB } from "@/lib/db";
import { today, TZ, upcoming } from "@/lib/dates";
import { emailProvider } from "@/lib/email";
import { nextPending } from "@/lib/reminders";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await requireAuth();
  if (deny) return deny;
  const db = await readDB();
  const ref = today();
  const tasks = db.tasks.map((t) => ({ ...t, next: nextPending(t, ref), upcoming: upcoming(t, 3, ref) }));
  return NextResponse.json({
    tasks,
    people: db.people,
    log: db.log.slice(-150).reverse(),
    lastRun: db.lastRun ?? null,
    today: ref,
    tz: TZ,
    email: { provider: emailProvider(), from: process.env.EMAIL_FROM || process.env.SMTP_USER || null, admin: process.env.ADMIN_EMAIL || null },
    storage: process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? "blob" : "local",
    cron: !!process.env.CRON_SECRET,
  });
}
