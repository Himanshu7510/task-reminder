import { NextResponse } from "next/server";
import { authState, checkPassword, clientKey, COOKIE, lockedFor, recordFailure, sameOrigin, setSessionCookie, sleep, MAX_FAILS } from "@/lib/auth";
import { readDB, updateDB } from "@/lib/db";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const { password } = await req.json().catch(() => ({ password: "" }));
  const pw = String(password || "").slice(0, 200);
  const key = await clientKey();

  // Check the password from a plain read: a correct password must never depend on a save succeeding.
  const db = await readDB();
  const a = authState(db);
  const locked = lockedFor(a, key);
  if (locked) {
    await sleep(500);
    return NextResponse.json({ error: `Too many failed attempts. Try again in ${locked} minute${locked === 1 ? "" : "s"}, or use “Forgot password”.` }, { status: 429 });
  }

  if (pw && (await checkPassword(db, pw))) {
    if (a.failures[key]) {
      await updateDB((d) => { delete authState(d).failures[key]; }).catch((e) => console.error("login: couldn't clear failures", e));
    }
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, a.version);
    return res;
  }

  // Wrong password: record the attempt (best effort) and slow the caller down.
  let left = MAX_FAILS - 1 - (a.failures[key]?.n ?? 0);
  try {
    left = await updateDB((d) => {
      const s = authState(d);
      recordFailure(s, key);
      d.log.push({ at: new Date().toISOString(), title: "Failed admin login", to: [], kind: "security", ok: false, error: "Wrong password" });
      return MAX_FAILS - (s.failures[key]?.n ?? 0);
    });
  } catch (e) {
    console.error("login: couldn't record failed attempt", e);
  }
  await sleep(500 + Math.random() * 500);
  return NextResponse.json(
    { error: left > 0 ? `Wrong password. ${left} attempt${left === 1 ? "" : "s"} left before a 15-minute lock.` : "Too many failed attempts. Locked for 15 minutes." },
    { status: left > 0 ? 401 : 429 }
  );
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
