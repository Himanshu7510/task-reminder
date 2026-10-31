import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { updateDB } from "@/lib/db";
import { syncPeople } from "@/lib/people";
import { buildTask } from "@/lib/validate";
import { notifyAssigned } from "@/lib/notify";

/** Body: { rows: Array<Record<string,string>>, notifyAssignees?: boolean } — rows come from the CSV upload */
export async function POST(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const { rows, notifyAssignees } = await req.json();
  if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "No rows" }, { status: 400 });
  if (rows.length > 1000) return NextResponse.json({ error: "Max 1000 rows per upload" }, { status: 400 });

  const result = await updateDB(async (db) => {
    const errors: { row: number; error: string }[] = [];
    let created = 0, mailed = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Record<string, string>;
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const hit = Object.keys(r).find((x) => x.trim().toLowerCase().replace(/[\s_-]+/g, "") === k);
          if (hit && r[hit] !== undefined && r[hit] !== "") return r[hit];
        }
        return undefined;
      };
      const input = {
        title: pick("title", "task", "name", "certificate", "taskname"),
        type: (pick("type", "category") || "task").toLowerCase().startsWith("cert") ? "certificate" : "task",
        assignees: pick("assignees", "assignee", "email", "emails", "assignto", "assigneeemail"),
        startDate: pick("duedate", "date", "expirydate", "expiry", "startdate", "due"),
        dueTime: pick("duetime", "time", "remindertime", "remindat"),
        recurrence: (pick("repeat", "recurrence", "frequency") || "none").toLowerCase(),
        reminders: pick("reminders", "reminderdays", "remindbefore", "daysbefore"),
        description: pick("description", "notes", "details") || "",
        reference: pick("reference", "certificateno", "certno", "ref") || "",
      };
      const { task, error } = buildTask(input);
      if (!task) { errors.push({ row: i + 2, error: error! }); continue; }
      db.tasks.push(task);
      syncPeople(db, task.assignees);
      created++;
      if (notifyAssignees) { const n = await notifyAssigned(db, task); if (n.ok) mailed++; }
    }
    return { created, mailed, errors };
  });
  return NextResponse.json(result);
}
