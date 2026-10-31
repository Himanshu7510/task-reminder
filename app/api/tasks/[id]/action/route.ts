import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { nextPending } from "@/lib/reminders";
import { notifyNow } from "@/lib/notify";
import { completeOccurrence } from "@/lib/completion";

type Ctx = { params: Promise<{ id: string }> };

/** actions: done (mark current occurrence done), undone, notify (send email now), pause, resume */
export async function POST(req: Request, { params }: Ctx) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { id } = await params;
  const { action, date } = await req.json();
  const out = await updateDB(async (db) => {
    const t = db.tasks.find((x) => x.id === id);
    if (!t) return { error: "Not found" };
    if (action === "done") {
      const n = nextPending(t);
      if (n) completeOccurrence(db, t, n.date, "admin", "dashboard");
    } else if (action === "undone") {
      const d = date || t.doneFor[t.doneFor.length - 1];
      t.doneFor = t.doneFor.filter((x) => x !== d);
      t.completions = (t.completions || []).filter((c) => c.occ !== d);
    } else if (action === "pause") t.active = false;
    else if (action === "resume") t.active = true;
    else if (action === "notify") return { notice: await notifyNow(db, t) };
    else return { error: "Unknown action" };
    t.updatedAt = new Date().toISOString();
    return { ok: true };
  });
  if ("error" in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json(out);
}
