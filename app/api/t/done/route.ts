import { NextResponse } from "next/server";
import { updateDB } from "@/lib/db";
import { verifyLink } from "@/lib/tokens";
import { completeOccurrence, recordSeen } from "@/lib/completion";

/**
 * Confirm-complete from the email. Only POST changes anything, so email security scanners that
 * pre-open links can't complete a task by themselves — the person has to press the button.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const k = String(form?.get("k") || "");
  const p = verifyLink(k);
  const back = (q: string) => NextResponse.redirect(new URL(`/done?k=${encodeURIComponent(k)}&${q}`, req.url), 303);
  if (!p) return NextResponse.redirect(new URL("/done?bad=1", req.url), 303);

  const result = await updateDB((db) => {
    const t = db.tasks.find((x) => x.id === p.t);
    if (!t || !t.assignees.includes(p.e)) return "gone";
    recordSeen(db, t, p.o, p.e);
    return completeOccurrence(db, t, p.o, p.e, "email") ? "ok" : "already";
  }).catch((e) => {
    console.error("complete via email:", e);
    return "error";
  });
  return back(result === "ok" ? "ok=1" : result === "already" ? "already=1" : result === "gone" ? "gone=1" : "err=1");
}
