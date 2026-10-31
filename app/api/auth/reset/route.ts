import { NextResponse } from "next/server";
import { authState, clientKey, lockedFor, passwordProblems, recordFailure, resetTokenMatches, sameOrigin, setSessionCookie, sleep } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { applyNewPassword, notifyPasswordChanged } from "@/lib/password-change";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const { token, password } = await req.json().catch(() => ({}));
  const pw = String(password || "");
  const problems = passwordProblems(pw);
  if (problems.length) return NextResponse.json({ error: `Password needs ${problems.join(", ")}.` }, { status: 400 });
  const key = await clientKey();

  const out = await updateDB(async (db) => {
    const a = authState(db);
    if (lockedFor(a, key)) return { status: 429, error: "Too many attempts. Try again later." };
    if (!resetTokenMatches(a, String(token || ""))) {
      recordFailure(a, key);
      return { status: 400, error: "This reset link is invalid, already used, or expired. Request a new one." };
    }
    return { status: 200, version: await applyNewPassword(db, pw, "reset") };
  });

  if (out.status !== 200) {
    await sleep(400);
    return NextResponse.json({ error: out.error }, { status: out.status });
  }
  await notifyPasswordChanged("reset");
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, out.version!);
  return res;
}
