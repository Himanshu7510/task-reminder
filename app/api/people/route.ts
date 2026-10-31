import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { updateDB } from "@/lib/db";

export async function POST(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { email, name } = await req.json();
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  await updateDB((db) => {
    const p = db.people.find((x) => x.email === e);
    if (p) p.name = String(name || p.name);
    else db.people.push({ email: e, name: String(name || "") });
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { email } = await req.json();
  await updateDB((db) => { db.people = db.people.filter((p) => p.email !== email); });
  return NextResponse.json({ ok: true });
}
