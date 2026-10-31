import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireAuth } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { syncPeople } from "@/lib/people";
import { buildTask } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { id } = await params;
  const body = await req.json();
  const out = await updateDB((db) => {
    const i = db.tasks.findIndex((t) => t.id === id);
    if (i < 0) return { error: "Not found", status: 404 };
    const { task, error } = buildTask(body, db.tasks[i]);
    if (!task) return { error, status: 400 };
    db.tasks[i] = task;
    syncPeople(db, task.assignees);
    return { task };
  });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { id } = await params;
  const removed = await updateDB((db) => {
    const t = db.tasks.find((x) => x.id === id);
    db.tasks = db.tasks.filter((x) => x.id !== id);
    return t;
  });
  if (removed?.attachments?.length && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(removed.attachments.map((a) => a.pathname)).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
