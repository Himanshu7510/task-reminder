import { NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { requireAuth } from "@/lib/auth";
import { updateDB } from "@/lib/db";

const MAX = 4 * 1024 * 1024; // Vercel function body limit is ~4.5 MB

/** Upload a certificate / supporting file to a task (multipart: taskId, file) */
export async function POST(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "File storage is not configured (BLOB_READ_WRITE_TOKEN missing)" }, { status: 500 });
  const form = await req.formData();
  const taskId = String(form.get("taskId") || "");
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "File too large (max 4 MB)" }, { status: 400 });
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-100);
  const blob = await put(`files/${taskId}/${Date.now()}-${safe}`, file, { access: "private", contentType: file.type || "application/octet-stream" });
  const ok = await updateDB((db) => {
    const t = db.tasks.find((x) => x.id === taskId);
    if (!t) return false;
    t.attachments = [...(t.attachments || []), { name: file.name, pathname: blob.pathname, size: file.size, uploadedAt: new Date().toISOString() }];
    return true;
  });
  if (!ok) { await del(blob.pathname).catch(() => {}); return NextResponse.json({ error: "Task not found" }, { status: 404 }); }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { taskId, pathname } = await req.json();
  await updateDB((db) => {
    const t = db.tasks.find((x) => x.id === taskId);
    if (t) t.attachments = t.attachments.filter((a) => a.pathname !== pathname);
  });
  await del(pathname).catch(() => {});
  return NextResponse.json({ ok: true });
}
