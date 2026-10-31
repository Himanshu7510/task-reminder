import { NextResponse } from "next/server";
import { authState, checkPassword, clientKey, lockedFor, passwordProblems, recordFailure, requireAuth, setSessionCookie, sleep } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { applyNewPassword, notifyPasswordChanged } from "@/lib/password-change";

export async function POST(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { current, password } = await req.json().catch(() => ({}));
  const pw = String(password || "");
  if (pw === String(current || "")) return NextResponse.json({ error: "The new password must be different from the current one." }, { status: 400 });
  const problems = passwordProblems(pw);
  if (problems.length) return NextResponse.json({ error: `Password needs ${problems.join(", ")}.` }, { status: 400 });
  const key = await clientKey();

  const out = await updateDB(async (db) => {
    const a = authState(db);
    if (lockedFor(a, key)) return { status: 429, error: "Too many attempts. Try again later." };
    if (!(await checkPassword(db, String(current || "").slice(0, 200)))) {
      recordFailure(a, key);
      return { status: 401, error: "Current password is wrong." };
    }
    return { status: 200, version: await applyNewPassword(db, pw, "change") };
  });

  if (out.status !== 200) {
    await sleep(400);
    return NextResponse.json({ error: out.error }, { status: out.status });
  }
  await notifyPasswordChanged("change");
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, out.version!);
  return res;
}
