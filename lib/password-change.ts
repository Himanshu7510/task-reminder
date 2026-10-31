import { authState, hashPassword } from "./auth";
import { layout, sendMail } from "./email";
import type { DB } from "./types";

/** Store a new password hash, sign out every existing session, and clear pending resets / lockouts. Returns the new session version. */
export async function applyNewPassword(db: DB, password: string, how: "reset" | "change"): Promise<number> {
  const a = authState(db);
  a.hash = await hashPassword(password);
  a.version = (a.version || 1) + 1;
  a.changedAt = new Date().toISOString();
  delete a.reset;
  a.failures = {};
  db.log.push({ at: a.changedAt, title: how === "reset" ? "Admin password reset via email link" : "Admin password changed", to: [], kind: "security", ok: true });
  return a.version;
}

/** Security notice to the admin after a change (best effort). */
export async function notifyPasswordChanged(how: "reset" | "change") {
  const admin = process.env.ADMIN_EMAIL;
  if (!admin) return;
  await sendMail({
    to: [admin],
    subject: "Your Reminder Desk admin password was changed",
    html: layout(
      "Admin password changed",
      "#dc2626",
      [["How", how === "reset" ? "Reset with an email link" : "Changed in Settings"], ["When", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"]],
      "All other signed-in sessions were signed out. If this wasn't you, use “Forgot password” on the sign-in page right away."
    ),
    text: "Your Reminder Desk admin password was changed. All other sessions were signed out. If this wasn't you, use Forgot password immediately.",
  }).catch(() => {});
}
