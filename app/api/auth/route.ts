import { NextResponse } from "next/server";
import { authState, checkPassword, clientKey, COOKIE, lockedFor, recordFailure, sameOrigin, setSessionCookie, sleep, MAX_FAILS } from "@/lib/auth";
import { updateDB } from "@/lib/db";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const { password } = await req.json().catch(() => ({ password: "" }));
  const pw = String(password || "").slice(0, 200);
  const key = await clientKey();

  const out = await updateDB(async (db) => {
    const a = authState(db);
    const locked = lockedFor(a, key);
    if (locked) return { status: 429 as const, error: `Too many failed attempts. Try again in ${locked} minute${locked === 1 ? "" : "s"}, or use “Forgot password”.` };
    if (pw && (await checkPassword(db, pw))) {
      delete a.failures[key];
      return { status: 200 as const, version: a.version };
    }
    recordFailure(a, key);
    const left = MAX_FAILS - (a.failures[key]?.n ?? 0);
    db.log.push({ at: new Date().toISOString(), title: "Failed admin login", to: [], kind: "security", ok: false, error: "Wrong password" });
    return {
      status: 401 as const,
      error: left > 0 ? `Wrong password. ${left} attempt${left === 1 ? "" : "s"} left before a 15-minute lock.` : "Too many failed attempts. Locked for 15 minutes.",
    };
  });

  if (out.status !== 200) {
    await sleep(500 + Math.random() * 500); // slow down guessing
    return NextResponse.json({ error: out.error }, { status: out.status });
  }
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, out.version!);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
