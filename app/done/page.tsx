import type { Metadata } from "next";
import { readDB, updateDB } from "@/lib/db";
import { verifyLink } from "@/lib/tokens";
import { recordSeen } from "@/lib/completion";
import { prettyDate, prettyTime } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm completion — Reminder Desk", robots: { index: false, follow: false } };

type SP = Promise<{ k?: string; ok?: string; already?: string; gone?: string; err?: string; bad?: string }>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="login">
      <div className="login-card done-card">
        <div className="brand"><span className="logo">◷</span> Reminder Desk</div>
        {children}
      </div>
    </main>
  );
}

export default async function DonePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const p = verifyLink(sp.k);
  if (!p || sp.bad) {
    return <Shell><h1>Link not valid</h1><p className="muted">This link is invalid or has expired. Please use the button in your most recent reminder email.</p></Shell>;
  }

  let db = await readDB();
  const t = db.tasks.find((x) => x.id === p.t);
  if (!t || !t.assignees.includes(p.e) || sp.gone) {
    return <Shell><h1>No longer assigned</h1><p className="muted">This item was removed or is no longer assigned to {p.e}. Nothing else to do.</p></Shell>;
  }

  // Opening this page counts as having seen the reminder.
  if (!t.seen?.some((s) => s.occ === p.o && s.email === p.e)) {
    await updateDB((d) => { const x = d.tasks.find((y) => y.id === p.t); if (x) recordSeen(d, x, p.o, p.e); }).catch(() => {});
    db = await readDB();
  }

  const task = db.tasks.find((x) => x.id === p.t)!;
  const isCert = task.type === "certificate";
  const doneBy = task.completions?.find((c) => c.occ === p.o);
  const done = task.doneFor.includes(p.o);
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";

  return (
    <Shell>
      <div className="done-meta">
        <span className={`type ${task.type}`}>{isCert ? "Certificate" : "Task"}</span>
        <span className="muted">{isCert ? "Expiry" : "Due"} {prettyDate(p.o)} at {prettyTime(task.dueTime)} IST</span>
      </div>
      <h1>{task.title}</h1>
      {task.reference && <p className="muted">#{task.reference}</p>}
      {task.description && <p className="done-desc">{task.description}</p>}

      {sp.err && <div className="error">Something went wrong saving that. Please press the button again.</div>}

      {done ? (
        <div className="done-ok">
          <div className="done-tick">✓</div>
          <div>
            <b>{sp.ok ? "Thanks — marked as " + (isCert ? "renewed" : "complete") + "." : `Already ${isCert ? "renewed" : "complete"}.`}</b>
            <div className="muted">
              {doneBy ? <>Completed by {doneBy.email} · {when(doneBy.at)}</> : "Marked done on the dashboard."}
              <br />The dashboard is updated and reminders for this date have stopped.
            </div>
          </div>
        </div>
      ) : (
        <form method="post" action="/api/t/done">
          <input type="hidden" name="k" value={sp.k} />
          <p className="muted">This link is for <b>{p.e}</b>. Confirm once the work is finished — this updates the team dashboard and stops further reminders for this {isCert ? "renewal" : "due date"}.</p>
          <button className="btn primary block done-btn">✓ Confirm {isCert ? "renewed" : "complete"}</button>
        </form>
      )}
    </Shell>
  );
}
