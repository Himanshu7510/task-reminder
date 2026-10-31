import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { syncPeople } from "@/lib/people";
import { buildTask } from "@/lib/validate";
import { notifyAssigned } from "@/lib/notify";

export async function POST(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const body = await req.json();
  const { task, error } = buildTask(body);
  if (!task) return NextResponse.json({ error }, { status: 400 });
  const notice = await updateDB(async (db) => {
    db.tasks.push(task);
    syncPeople(db, task.assignees);
    return body.notifyAssignees ? await notifyAssigned(db, task) : null;
  });
  return NextResponse.json({ task, notice });
}
