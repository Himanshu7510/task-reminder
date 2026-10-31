import { cookies, headers } from "next/headers";
import { createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { readDB } from "./db";
import type { AuthState, DB } from "./types";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const COOKIE = "tr_session";
const SESSION_DAYS = 7;
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 15;
export const RESET_MINUTES = 30;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return s || "dev-only-secret";
}

export function authState(db: DB): AuthState {
  if (!db.auth) db.auth = { version: 1, failures: {} };
  db.auth.failures ||= {};
  return db.auth;
}

/* ---------- password hashing (scrypt) ---------- */
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyHash(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, expected);
}

function safeEqualStr(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest(), hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Check a password against the stored hash, or the ADMIN_PASSWORD env var if no hash has been set yet. */
export async function checkPassword(db: DB, pw: string): Promise<boolean> {
  const a = authState(db);
  if (a.hash) return verifyHash(pw, a.hash);
  const envPw = process.env.ADMIN_PASSWORD;
  if (!envPw) return false;
  return safeEqualStr(pw, envPw);
}

/** Strength rules: 10+ chars, upper, lower, number, symbol; not obviously weak. Returns problems (empty = ok). */
export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 10) p.push("at least 10 characters");
  if (pw.length > 128) p.push("at most 128 characters");
  if (!/[a-z]/.test(pw)) p.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) p.push("an uppercase letter");
  if (!/\d/.test(pw)) p.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) p.push("a symbol");
  if (/^(.)\1+$/.test(pw) || /password|12345|qwerty|admin|reminder/i.test(pw)) p.push("no common words or patterns");
  return p;
}

/* ---------- sessions ---------- */
export function sessionToken(version: number): string {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const nonce = randomBytes(8).toString("hex");
  const body = `${exp}.${version}.${nonce}`;
  const sig = createHmac("sha256", secret()).update(body).digest("hex");
  return `${body}.${sig}`;
}

function parseToken(tok?: string): { exp: number; version: number } | null {
  if (!tok) return null;
  const parts = tok.split(".");
  if (parts.length !== 4) return null;
  const [exp, version, nonce, sig] = parts;
  const good = createHmac("sha256", secret()).update(`${exp}.${version}.${nonce}`).digest("hex");
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (Number(exp) < Date.now()) return null;
  return { exp: Number(exp), version: Number(version) };
}

export function setSessionCookie(res: NextResponse, version: number) {
  res.cookies.set(COOKIE, sessionToken(version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function isAuthed(db?: DB): Promise<boolean> {
  const c = await cookies();
  const t = parseToken(c.get(COOKIE)?.value);
  if (!t) return false;
  const d = db ?? (await readDB());
  return t.version === (d.auth?.version ?? 1);
}

/** Blocks cross-site state-changing requests (defence in depth on top of SameSite cookies). */
async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / server tools
  const host = h.get("x-forwarded-host") || h.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function requireAuth(): Promise<NextResponse | null> {
  if (!(await sameOrigin())) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  return (await isAuthed()) ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export { sameOrigin };

/* ---------- brute-force protection ---------- */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip + secret()).digest("hex").slice(0, 16);
}

export function lockedFor(a: AuthState, key: string): number {
  const f = a.failures[key];
  return f?.until && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}

export function recordFailure(a: AuthState, key: string) {
  const now = Date.now();
  const f = a.failures[key] && now - a.failures[key].first < LOCK_MINUTES * 60000 ? a.failures[key] : { n: 0, first: now };
  f.n++;
  if (f.n >= MAX_FAILS) f.until = now + LOCK_MINUTES * 60000;
  a.failures[key] = f;
  // prune old entries
  for (const [k, v] of Object.entries(a.failures)) if (now - v.first > 86400000 && (!v.until || v.until < now)) delete a.failures[k];
}

/* ---------- reset tokens ---------- */
export function newResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}
export function resetTokenMatches(a: AuthState, token: string): boolean {
  if (!a.reset || a.reset.exp < Date.now() || !token) return false;
  return safeEqualStr(createHash("sha256").update(token).digest("hex"), a.reset.hash);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
