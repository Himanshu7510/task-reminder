import { NextResponse } from "next/server";
import { authState, newResetToken, RESET_MINUTES, sameOrigin, sleep } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { appUrl, emailProvider, layout, sendMail } from "@/lib/email";

const GENERIC = "If password reset is set up, a reset link has been sent to the admin email address. It expires in 30 minutes.";

/** Emails a one-time reset link to ADMIN_EMAIL. No email is accepted from the client, so nobody can redirect the link elsewhere. */
export async function POST() {
  if (!(await sameOrigin())) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const admin = process.env.ADMIN_EMAIL;
  if (!admin || !emailProvider()) {
    return NextResponse.json({ error: "Password reset by email isn't available: ADMIN_EMAIL and email sending must be configured. Change ADMIN_PASSWORD in Vercel instead." }, { status: 400 });
  }

  const r = await updateDB((db) => {
    const a = authState(db);
    if (a.lastForgotAt && Date.now() - a.lastForgotAt < 2 * 60000) return { wait: true as const };
    const t = newResetToken();
    a.reset = { hash: t.hash, exp: Date.now() + RESET_MINUTES * 60000 };
    a.lastForgotAt = Date.now();
    return { token: t.token };
  });
  if ("wait" in r) {
    await sleep(400);
    return NextResponse.json({ message: "A reset link was sent recently. Please wait 2 minutes before requesting another, and check your spam folder." });
  }

  const link = `${appUrl()}/?reset=${r.token}`;
  try {
    await sendMail({
      to: [admin],
      subject: "Reset your Reminder Desk admin password",
      html: layout(
        "Reset your admin password",
        "#111827",
        [["Link expires", `${RESET_MINUTES} minutes`], ["Requested", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"]],
        `Someone asked to reset the admin password. If this was you, use the button below to choose a new password. The link works once.<br><br>If you didn't ask for this, ignore this email — your password stays the same.`,
        "Choose a new password"
      ).replace(`href="${appUrl()}"`, `href="${link}"`),
      text: `Reset your admin password (expires in ${RESET_MINUTES} minutes, works once):\n${link}\n\nIf you didn't request this, ignore this email.`,
    });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't send the reset email: ${(e as Error).message}` }, { status: 500 });
  }
  return NextResponse.json({ message: GENERIC });
}
