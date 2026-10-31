import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const COOKIE = "tr_session";

function secret() {
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";
}

export function passwordOk(pw: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "admin";
  const a = Buffer.from(pw), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionToken(): string {
  const exp = Date.now() + 30 * 86400000;
  const sig = createHmac("sha256", secret()).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}

function valid(tok?: string): boolean {
  if (!tok) return false;
  const [exp, sig] = tok.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = createHmac("sha256", secret()).update(exp).digest("hex");
  return sig.length === good.length && timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return valid(c.get(COOKIE)?.value);
}

export async function requireAuth(): Promise<NextResponse | null> {
  return (await isAuthed()) ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
