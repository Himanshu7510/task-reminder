import { createHmac, timingSafeEqual } from "crypto";

/** A signed, tamper-proof link payload for one assignee + one task occurrence. */
export interface LinkPayload {
  t: string; // task id
  e: string; // assignee email
  o: string; // occurrence date (YYYY-MM-DD)
  x: number; // expiry (ms)
}

const LINK_DAYS = 90;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return "email-link:" + (s || "dev-only-secret");
}

export function signLink(taskId: string, email: string, occurrence: string): string {
  const p: LinkPayload = { t: taskId, e: email, o: occurrence, x: Date.now() + LINK_DAYS * 86400000 };
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);
  return `${body}.${sig}`;
}

export function verifyLink(token: string | null | undefined): LinkPayload | null {
  if (!token || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const good = createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as LinkPayload;
    if (!p.t || !p.e || !p.o || p.x < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
