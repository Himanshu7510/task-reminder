import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { layout, sendMail } from "@/lib/email";
import { updateDB } from "@/lib/db";

export async function POST(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { to } = await req.json();
  const email = String(to || process.env.ADMIN_EMAIL || "").trim();
  if (!email) return NextResponse.json({ error: "Enter an email address" }, { status: 400 });
  try {
    await sendMail({
      to: [email],
      subject: "Test email — Task & Certificate Reminder",
      html: layout("Email notifications are working ✅", "#16a34a", [["Sent to", email]], "Your reminder app can send emails. Assignees will receive reminders on the days you configure."),
      text: "Email notifications are working.",
    });
    await updateDB((db) => { db.log.push({ at: new Date().toISOString(), title: "Test email", to: [email], kind: "test", ok: true }); });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
