"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, Person, Recurrence, Task } from "@/lib/types";
import { PasswordField, strongEnough } from "./PasswordField";

type TaskView = Task & { next: { date: string; overdue: boolean } | null; upcoming: string[] };
interface Data {
  tasks: TaskView[];
  people: Person[];
  log: LogEntry[];
  lastRun: string | null;
  today: string;
  tz: string;
  email: { provider: string | null; from: string | null; admin: string | null };
  storage: "blob" | "local";
  cron: boolean;
}
type Tab = "items" | "bulk" | "people" | "activity" | "settings";

const REC: { v: Recurrence; l: string }[] = [
  { v: "none", l: "One-time" }, { v: "daily", l: "Daily" }, { v: "weekly", l: "Weekly" },
  { v: "monthly", l: "Monthly" }, { v: "quarterly", l: "Quarterly" }, { v: "yearly", l: "Yearly" },
];
const recLabel = (r: Recurrence) => REC.find((x) => x.v === r)?.l ?? r;
const PRESETS = [0, 1, 3, 7, 15, 30, 60, 90];

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}
function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(t?: string) {
  const [h, m] = (t || "09:00").split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function nowHHMM() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}
function offsetLabel(o: number) {
  return o === 0 ? "On the day" : o === 1 ? "1 day before" : `${o} days before`;
}

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) location.reload();
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

/* ---------- CSV ---------- */
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const TEMPLATE =
  "title,type,assignees,due_date,due_time,repeat,reminders,reference,description\n" +
  'Fire safety certificate,certificate,ops@example.com,2027-03-31,10:00,yearly,,FS-2291,Renew with municipal fire dept (blank reminders = 2 days before + 1 day before + on the day)\n' +
  'GST return filing,task,"accounts@example.com;ca@example.com",2026-11-20,5:30 PM,monthly,,,File GSTR-3B\n' +
  "Daily site inspection,task,supervisor@example.com,2026-11-01,08:30,daily,0,,Upload photos to the group\n" +
  "ISO 9001 audit,certificate,quality@example.com,15/06/2027,,none,\"90;30;7\",ISO-9001-445,Book auditor early (blank time = 9:00 AM)\n";

/* ---------- Component ---------- */
export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const [editing, setEditing] = useState<TaskView | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api("/api/data")); } catch (e) { flash((e as Error).message, true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(msg: string, bad = false) {
    setToast({ msg, bad });
    setTimeout(() => setToast(null), 4200);
  }

  async function runNow() {
    setBusy(true);
    try {
      const r = await api("/api/cron", "POST");
      flash(r.emailConfigured ? `Reminder run complete — ${r.sent} sent, ${r.failed} failed` : "Ran, but email isn't configured yet (see Settings)", !r.emailConfigured || r.failed > 0);
      load();
    } catch (e) { flash((e as Error).message, true); }
    setBusy(false);
  }

  if (!data) return <div className="loading">Loading…</div>;

  const t0 = data.today;
  const active = data.tasks.filter((t) => t.active && t.next);
  const overdue = active.filter((t) => t.next!.overdue);
  const dueToday = active.filter((t) => t.next!.date === t0);
  const week = active.filter((t) => !t.next!.overdue && daysBetween(t.next!.date, t0) <= 7);
  const certs30 = active.filter((t) => t.type === "certificate" && daysBetween(t.next!.date, t0) <= 30);

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="logo">◷</span> Reminder Desk</div>
        <div className="top-actions">
          <button className="btn ghost" onClick={runNow} disabled={busy} title="Send any reminders due today right now">{busy ? "Running…" : "Run reminders now"}</button>
          <button className="btn primary" onClick={() => setEditing("new")}>+ New task / certificate</button>
          <button className="btn ghost small" onClick={async () => { await api("/api/auth", "DELETE"); location.reload(); }}>Log out</button>
        </div>
      </header>

      {!data.email.provider && (
        <div className="banner">
          <b>Email isn&apos;t set up yet.</b> Reminders are scheduled but can&apos;t be delivered until you add <code>SMTP_USER</code> and <code>SMTP_PASS</code> (a Gmail app password works) in Vercel → Settings → Environment Variables, then redeploy. <a onClick={() => setTab("settings")}>How to set up →</a>
        </div>
      )}

      <section className="stats">
        <Stat n={overdue.length} label="Overdue" tone="red" />
        <Stat n={dueToday.length} label="Due today" tone="amber" />
        <Stat n={week.length} label="Next 7 days" tone="blue" />
        <Stat n={certs30.length} label="Certificates expiring ≤ 30 days" tone="violet" />
        <Stat n={data.tasks.filter((t) => t.active).length} label="Active items" />
      </section>

      <nav className="tabs">
        {([["items", "Tasks & certificates"], ["bulk", "Bulk upload"], ["people", "People"], ["activity", "Email activity"], ["settings", "Settings"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      {tab === "items" && <Items data={data} onEdit={setEditing} reload={load} flash={flash} />}
      {tab === "bulk" && <Bulk reload={load} flash={flash} done={() => setTab("items")} />}
      {tab === "people" && <People data={data} reload={load} flash={flash} />}
      {tab === "activity" && <Activity log={data.log} lastRun={data.lastRun} />}
      {tab === "settings" && <Settings data={data} flash={flash} reload={load} />}

      {editing && (
        <Editor task={editing === "new" ? null : editing} people={data.people} today={t0} onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); flash(m); load(); }} flash={flash} />
      )}
      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return <div className={`stat ${tone || ""}`}><div className="n">{n}</div><div className="l">{label}</div></div>;
}

/* ---------- Items list ---------- */
function Items({ data, onEdit, reload, flash }: { data: Data; onEdit: (t: TaskView) => void; reload: () => void; flash: (m: string, b?: boolean) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("open");
  const [rec, setRec] = useState("all");

  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return data.tasks
      .filter((t) => type === "all" || t.type === type)
      .filter((t) => rec === "all" || t.recurrence === rec)
      .filter((t) =>
        status === "all" ? true :
        status === "open" ? t.active && t.next :
        status === "overdue" ? t.active && t.next?.overdue :
        status === "paused" ? !t.active :
        status === "done" ? !t.next : true)
      .filter((t) => !s || [t.title, t.description, t.reference, ...t.assignees].join(" ").toLowerCase().includes(s))
      .sort((a, b) => (a.next?.date ?? "9999").localeCompare(b.next?.date ?? "9999"));
  }, [data.tasks, q, type, status, rec]);

  async function act(t: TaskView, action: string) {
    try {
      const r = await api(`/api/tasks/${t.id}/action`, "POST", { action });
      if (action === "notify") flash(r.notice?.ok ? `Email sent to ${t.assignees.join(", ")}` : `Email failed: ${r.notice?.error}`, !r.notice?.ok);
      else flash(action === "done" ? (t.recurrence === "none" ? "Marked done" : "Marked done — next occurrence is now active") : "Updated");
      reload();
    } catch (e) { flash((e as Error).message, true); }
  }
  async function remove(t: TaskView) {
    if (!confirm(`Delete "${t.title}"? This also removes its reminders and attachments.`)) return;
    await api(`/api/tasks/${t.id}`, "DELETE");
    flash("Deleted");
    reload();
  }

  return (
    <section className="panel">
      <div className="filters">
        <input placeholder="Search title, email, reference…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option><option value="task">Tasks</option><option value="certificate">Certificates</option>
        </select>
        <select value={rec} onChange={(e) => setRec(e.target.value)}>
          <option value="all">Any repeat</option>{REC.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option><option value="overdue">Overdue</option><option value="paused">Paused</option><option value="done">Completed</option><option value="all">Everything</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <p>No items here yet.</p>
          <p className="muted">Add a task or certificate, or import many at once from the <b>Bulk upload</b> tab.</p>
        </div>
      ) : (
        <div className="list">
          {rows.map((t) => {
            const d = t.next ? daysBetween(t.next.date, data.today) : null;
            const tone = !t.active ? "muted" : d === null ? "ok" : d < 0 ? "red" : d === 0 ? "amber" : d <= 7 ? "amberlite" : "plain";
            return (
              <article key={t.id} className={`row ${!t.active ? "paused" : ""}`}>
                <div className="row-main">
                  <div className="row-title">
                    <span className={`type ${t.type}`}>{t.type === "certificate" ? "Certificate" : "Task"}</span>
                    <b>{t.title}</b>
                    {t.reference && <span className="ref">#{t.reference}</span>}
                    {!t.active && <span className="pill">Paused</span>}
                  </div>
                  <div className="row-meta">
                    <span>👤 {t.assignees.join(", ")}</span>
                    <span>↻ {recLabel(t.recurrence)}</span>
                    <span>🔔 {t.reminders.map(offsetLabel).join(" · ")}{t.recurrence === "none" && t.overdueDaily ? " · daily when overdue" : ""}</span>
                    {t.attachments?.length > 0 && <span>📎 {t.attachments.length}</span>}
                  </div>
                  <Tracking t={t} />
                </div>
                <div className={`due ${tone}`}>
                  {t.next ? (
                    <>
                      <div className="due-d">{fmtDate(t.next.date)}</div>
                      <div className="due-t">{fmtTime(t.dueTime)}</div>
                      <div className="due-r">{d! < 0 ? `${-d!}d overdue` : d === 0 ? "Today" : d === 1 ? "Tomorrow" : `in ${d} days`}</div>
                    </>
                  ) : <div className="due-r">✓ Completed</div>}
                </div>
                <div className="row-actions">
                  {t.next && <button className="btn small" onClick={() => act(t, "done")} title="Mark this occurrence as done">✓ Done</button>}
                  {!t.next && <button className="btn small" onClick={() => act(t, "undone")}>Reopen</button>}
                  <button className="btn small" onClick={() => act(t, "notify")} title="Email the assignees now">✉ Email now</button>
                  <button className="btn small" onClick={() => onEdit(t)}>Edit</button>
                  <details className="more">
                    <summary className="btn small">⋯</summary>
                    <div className="menu">
                      <button onClick={() => act(t, t.active ? "pause" : "resume")}>{t.active ? "Pause reminders" : "Resume reminders"}</button>
                      <button className="danger" onClick={() => remove(t)}>Delete</button>
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- Seen / completed status per assignee ---------- */
function Tracking({ t }: { t: TaskView }) {
  const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const occ = t.next?.date;
  const emailedForOcc = !!occ && t.sent.some((k) => k.startsWith(occ + ":"));
  const seen = (t.seen || []).filter((s) => s.occ === occ);
  const last = [...(t.completions || [])].sort((a, b) => b.at.localeCompare(a.at))[0];
  const showSeen = occ && (emailedForOcc || seen.length > 0);
  if (!showSeen && !last) return null;
  return (
    <div className="tracking">
      {showSeen && t.assignees.map((e) => {
        const s = seen.find((x) => x.email === e);
        return (
          <span key={e} className={`trk ${s ? "seen" : "unseen"}`} title={s ? `Opened the reminder ${time(s.at)}` : "Hasn't opened the reminder yet"}>
            {s ? "👁 Seen" : "○ Not opened"} · {e.split("@")[0]}{s ? ` · ${time(s.at)}` : ""}
          </span>
        );
      })}
      {last && (
        <span className="trk done" title={`Occurrence ${fmtDate(last.occ)}`}>
          ✓ {fmtDate(last.occ)} completed by {last.email === "admin" ? "admin" : last.email.split("@")[0]} {last.via === "email" ? "via email" : "on dashboard"} · {time(last.at)}
        </span>
      )}
    </div>
  );
}

/* ---------- Editor modal ---------- */
function Editor({ task, people, today, onClose, onSaved, flash }: {
  task: TaskView | null; people: Person[]; today: string; onClose: () => void; onSaved: (m: string) => void; flash: (m: string, b?: boolean) => void;
}) {
  const [f, setF] = useState({
    type: task?.type ?? "task",
    title: task?.title ?? "",
    reference: task?.reference ?? "",
    description: task?.description ?? "",
    assignees: task?.assignees ?? [] as string[],
    startDate: task?.startDate ?? today,
    dueTime: task?.dueTime ?? "09:00",
    recurrence: task?.recurrence ?? ("none" as Recurrence),
    reminders: task?.reminders ?? [2, 1, 0],
    overdueDaily: task?.overdueDaily ?? true,
  });
  const [emailInput, setEmailInput] = useState("");
  const [custom, setCustom] = useState("");
  const [notify, setNotify] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState(task?.attachments ?? []);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function addEmails(raw: string) {
    const list = raw.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (list.length) set("assignees", [...new Set([...f.assignees, ...list])]);
    setEmailInput("");
  }
  function setRec(r: Recurrence) {
    const defaults: Record<Recurrence, number[]> = { none: [2, 1, 0], daily: [0], weekly: [2, 1, 0], monthly: [2, 1, 0], quarterly: [2, 1, 0], yearly: [2, 1, 0] };
    setF((x) => ({ ...x, recurrence: r, reminders: task && task.recurrence === r ? x.reminders : defaults[r] }));
  }
  function toggleOffset(o: number) {
    set("reminders", f.reminders.includes(o) ? f.reminders.filter((x) => x !== o) : [...f.reminders, o].sort((a, b) => b - a));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const assignees = emailInput.trim() ? [...new Set([...f.assignees, ...emailInput.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)])] : f.assignees;
    if (!assignees.length) return setErr("Add at least one assignee email");
    if (!f.reminders.length) return setErr("Pick at least one reminder");
    setSaving(true);
    try {
      const body = { ...f, assignees, notifyAssignees: !task && notify };
      const r = task ? await api(`/api/tasks/${task.id}`, "PUT", body) : await api("/api/tasks", "POST", body);
      const id = r.task.id;
      for (const file of files) {
        const fd = new FormData();
        fd.append("taskId", id);
        fd.append("file", file);
        const up = await fetch("/api/files", { method: "POST", body: fd });
        if (!up.ok) flash(`Upload failed for ${file.name}: ${(await up.json().catch(() => ({}))).error || up.status}`, true);
      }
      let msg = task ? "Saved" : "Created";
      if (r.notice) msg += r.notice.ok ? " — assignment email sent" : ` — but email failed: ${r.notice.error}`;
      onSaved(msg);
    } catch (e) { setErr((e as Error).message); }
    setSaving(false);
  }

  async function removeAttachment(p: string) {
    if (!task) return;
    await api("/api/files", "DELETE", { taskId: task.id, pathname: p });
    setAttachments((a) => a.filter((x) => x.pathname !== p));
  }

  const isCert = f.type === "certificate";
  const preview = previewSchedule(f.startDate, f.recurrence, f.reminders, today, f.dueTime, nowHHMM());

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save}>
        <div className="modal-head">
          <h2>{task ? "Edit" : "New"} {isCert ? "certificate" : "task"}</h2>
          <button type="button" className="x" onClick={onClose}>×</button>
        </div>

        <div className="seg">
          <button type="button" className={!isCert ? "on" : ""} onClick={() => set("type", "task")}>Task</button>
          <button type="button" className={isCert ? "on" : ""} onClick={() => setF((x) => ({ ...x, type: "certificate", recurrence: x.recurrence === "none" && !task ? "yearly" : x.recurrence, reminders: !task ? [2, 1, 0] : x.reminders }))}>Certificate</button>
        </div>

        <label>{isCert ? "Certificate name" : "Task title"} *
          <input value={f.title} onChange={(e) => set("title", e.target.value)} required placeholder={isCert ? "e.g. Fire safety NOC" : "e.g. Submit monthly GST return"} />
        </label>
        <div className="grid3">
          <label>{isCert ? "Expiry / renewal date" : "Due date"} *
            <input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} required />
          </label>
          <label>Time (IST) *
            <input type="time" value={f.dueTime} onChange={(e) => set("dueTime", e.target.value)} required step={300} />
          </label>
          <label>Repeats
            <select value={f.recurrence} onChange={(e) => setRec(e.target.value as Recurrence)}>
              {REC.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </label>
        </div>

        <label>Assign to (emails) *</label>
        <div className="chips-input">
          {f.assignees.map((e) => <span key={e} className="chip">{e}<button type="button" onClick={() => set("assignees", f.assignees.filter((x) => x !== e))}>×</button></span>)}
          <input list="people" value={emailInput} placeholder={f.assignees.length ? "Add another…" : "name@company.com"}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => { if (["Enter", ",", ";", " "].includes(e.key)) { e.preventDefault(); addEmails(emailInput); } }}
            onBlur={() => addEmails(emailInput)} />
          <datalist id="people">{people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</datalist>
        </div>

        <label>Email reminders</label>
        <div className="offsets">
          {[...new Set([...PRESETS, ...f.reminders])].sort((a, b) => a - b).map((o) => (
            <button type="button" key={o} className={f.reminders.includes(o) ? "on" : ""} onClick={() => toggleOffset(o)}>{offsetLabel(o)}</button>
          ))}
          <span className="custom">
            <input type="number" min={0} max={366} value={custom} placeholder="Custom" onChange={(e) => setCustom(e.target.value)} />
            <button type="button" className="btn small" onClick={() => { const n = parseInt(custom); if (n >= 0 && n <= 366 && !f.reminders.includes(n)) toggleOffset(n); setCustom(""); }}>Add</button>
          </span>
        </div>
        {f.recurrence === "none" && (
          <label className="check"><input type="checkbox" checked={f.overdueDaily} onChange={(e) => set("overdueDaily", e.target.checked)} /> Keep emailing daily after the date until marked done</label>
        )}
        {preview.length > 0 && <div className="preview"><b>Next emails at {fmtTime(f.dueTime)} IST:</b> {preview.map((p) => fmtDate(p)).join(" · ")}</div>}

        {isCert && (
          <label>Certificate no. / reference
            <input value={f.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Optional" />
          </label>
        )}
        <label>Notes / instructions (included in the email)
          <textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </label>

        <label>{isCert ? "Upload certificate (PDF / image)" : "Attachments"}</label>
        <div className="files">
          {attachments.map((a) => (
            <span key={a.pathname} className="chip"><a href={`/api/files/download?p=${encodeURIComponent(a.pathname)}`} target="_blank">📎 {a.name}</a>
              <button type="button" onClick={() => removeAttachment(a.pathname)}>×</button></span>
          ))}
          {files.map((fl, i) => <span key={i} className="chip new">{fl.name}<button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}
          <label className="btn small file-btn">+ Choose file<input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx" onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])])} /></label>
        </div>

        {!task && <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the assignees now that this was assigned to them</label>}
        {err && <div className="error">{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? "Saving…" : task ? "Save changes" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}

function addM(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
function addD(d: string, n: number) { return new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10); }
function previewSchedule(start: string, r: Recurrence, offsets: number[], today: string, time = "09:00", now = "00:00"): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const occ: string[] = [];
  for (let k = 0; occ.length < 4 && k < 2000; k++) {
    const d = r === "none" ? start : r === "daily" ? addD(start, k) : r === "weekly" ? addD(start, 7 * k) : r === "monthly" ? addM(start, k) : r === "quarterly" ? addM(start, 3 * k) : addM(start, 12 * k);
    if (d >= today) occ.push(d);
    if (r === "none") break;
  }
  const sends = occ.flatMap((o) => offsets.map((x) => addD(o, -x))).filter((d) => d > today || (d === today && time > now));
  return [...new Set(sends)].sort().slice(0, 5);
}

/* ---------- Bulk upload ---------- */
function Bulk({ reload, flash, done }: { reload: () => void; flash: (m: string, b?: boolean) => void; done: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [name, setName] = useState("");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([]);
  const inp = useRef<HTMLInputElement>(null);

  async function onFile(file?: File) {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return flash("Please upload a .csv file (in Excel: File → Save As → CSV)", true);
    setName(file.name);
    setErrors([]);
    const parsed = parseCSV(await file.text());
    if (!parsed.length) flash("No rows found — is the first line a header row?", true);
    setRows(parsed);
  }
  function template() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "reminders-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  async function importRows() {
    setBusy(true);
    try {
      const r = await api("/api/tasks/bulk", "POST", { rows, notifyAssignees: notify });
      setErrors(r.errors);
      flash(`Imported ${r.created} item${r.created === 1 ? "" : "s"}${notify ? `, ${r.mailed} emails sent` : ""}${r.errors.length ? ` — ${r.errors.length} row(s) skipped` : ""}`, r.errors.length > 0);
      reload();
      if (!r.errors.length) { setRows([]); setName(""); done(); }
    } catch (e) { flash((e as Error).message, true); }
    setBusy(false);
  }
  const cols = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <section className="panel">
      <div className="bulk-head">
        <div>
          <h3>Upload many tasks &amp; certificates at once</h3>
          <p className="muted">One row per item. Columns: <code>title</code>, <code>type</code> (task / certificate), <code>assignees</code> (separate several emails with <code>;</code>), <code>due_date</code> (YYYY-MM-DD or DD/MM/YYYY), <code>due_time</code> (e.g. <code>17:30</code> or <code>5:30 PM</code>, IST — blank = 9:00 AM), <code>repeat</code> (none, daily, weekly, monthly, quarterly, yearly), <code>reminders</code> (days before, e.g. <code>30;7;1;0</code> — leave blank for the default 3 reminders: 2 days before, 1 day before, on the day), <code>reference</code>, <code>description</code>.</p>
        </div>
        <button className="btn" onClick={template}>⬇ Download template</button>
      </div>
      <div className="drop" onClick={() => inp.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
        <input ref={inp} type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="drop-icon">⇪</div>
        <div><b>{name || "Drop a CSV file here"}</b></div>
        <div className="muted">{rows.length ? `${rows.length} rows ready to import` : "or click to choose a file"}</div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 50).map((r, i) => (
                <tr key={i} className={errors.some((e) => e.row === i + 2) ? "bad" : ""}><td>{i + 2}</td>{cols.map((c) => <td key={c}>{r[c]}</td>)}</tr>
              ))}</tbody>
            </table>
            {rows.length > 50 && <p className="muted">…and {rows.length - 50} more rows</p>}
          </div>
          <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email every assignee that they&apos;ve been assigned</label>
          <button className="btn primary" disabled={busy} onClick={importRows}>{busy ? "Importing…" : `Import ${rows.length} items`}</button>
        </>
      )}
      {errors.length > 0 && (
        <div className="errlist"><b>Rows that were skipped:</b>{errors.map((e) => <div key={e.row}>Row {e.row}: {e.error}</div>)}</div>
      )}
    </section>
  );
}

/* ---------- People ---------- */
function People({ data, reload, flash }: { data: Data; reload: () => void; flash: (m: string, b?: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/people", "POST", { email, name }); setEmail(""); setName(""); reload(); flash("Saved"); }
    catch (er) { flash((er as Error).message, true); }
  }
  const count = (e: string) => data.tasks.filter((t) => t.assignees.includes(e) && t.active).length;
  return (
    <section className="panel">
      <form className="filters" onSubmit={add}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="email@company.com" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn primary">Add person</button>
      </form>
      <p className="muted">People are added automatically when you assign them. Names here show up as suggestions when assigning.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Active items</th><th></th></tr></thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.email}>
                <td><input className="inline" defaultValue={p.name} placeholder="Add name" onBlur={(e) => e.target.value !== p.name && api("/api/people", "POST", { email: p.email, name: e.target.value }).then(reload)} /></td>
                <td>{p.email}</td>
                <td>{count(p.email)}</td>
                <td><button className="btn small ghost" onClick={async () => { await api("/api/people", "DELETE", { email: p.email }); reload(); }}>Remove</button></td>
              </tr>
            ))}
            {!data.people.length && <tr><td colSpan={4} className="muted">No people yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Activity ---------- */
function Activity({ log, lastRun }: { log: LogEntry[]; lastRun: string | null }) {
  const kinds: Record<string, string> = { reminder: "Reminder", overdue: "Overdue", manual: "Sent manually", digest: "Daily digest", test: "Test", assigned: "Assigned", security: "Security", seen: "Email opened", completed: "Completed" };
  return (
    <section className="panel">
      <p className="muted">Last automatic run: {lastRun ? new Date(lastRun).toLocaleString("en-IN") : "not yet"}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Item</th><th>Type</th><th>To</th><th>Status</th></tr></thead>
          <tbody>
            {log.map((l, i) => (
              <tr key={i}>
                <td>{new Date(l.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td>{l.title}</td>
                <td>{kinds[l.kind] || l.kind}</td>
                <td>{l.to.join(", ")}</td>
                <td>{l.kind === "seen" ? <span className="ok">Opened</span> : l.kind === "completed" ? <span className="ok">Done {l.error}</span> : l.kind === "security" ? (l.ok ? <span className="ok">OK</span> : <span className="bad-t">{l.error}</span>) : l.ok ? <span className="ok">Sent</span> : <span className="bad-t" title={l.error}>Failed — {l.error?.slice(0, 80)}</span>}</td>
              </tr>
            ))}
            {!log.length && <tr><td colSpan={5} className="muted">No emails sent yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Change password ---------- */
function ChangePassword({ flash, adminEmail }: { flash: (m: string, b?: boolean) => void; adminEmail: string | null }) {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!strongEnough(pw)) return setErr("Please meet every password rule.");
    if (pw !== pw2) return setErr("The new passwords don't match.");
    setBusy(true);
    const r = await fetch("/api/auth/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: cur, password: pw }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setCur(""); setPw(""); setPw2(""); flash("Password changed — all other devices were signed out"); }
    else setErr(j.error || "Couldn't change the password");
  }
  return (
    <form className="card" onSubmit={save}>
      <h3>Admin password</h3>
      <p className="muted">Passwords are stored as a salted scrypt hash. Changing it signs out every other device{adminEmail ? `, and a security notice is emailed to ${adminEmail}` : ""}. Forgot it? Use “Forgot password?” on the sign-in page.</p>
      <div className="pw-grid">
        <PasswordField label="Current password" value={cur} onChange={setCur} autoComplete="current-password" />
        <PasswordField label="New password" value={pw} onChange={setPw} autoComplete="new-password" showRules />
        <PasswordField label="Confirm new password" value={pw2} onChange={setPw2} autoComplete="new-password" />
      </div>
      {pw2 && pw !== pw2 && <div className="hint-bad">Passwords don&apos;t match</div>}
      {err && <div className="error">{err}</div>}
      <button className="btn primary" style={{ marginTop: 14 }} disabled={busy || !cur || !strongEnough(pw) || pw !== pw2}>{busy ? "Saving…" : "Change password"}</button>
    </form>
  );
}

/* ---------- Settings ---------- */
function Settings({ data, flash, reload }: { data: Data; flash: (m: string, b?: boolean) => void; reload: () => void }) {
  const [to, setTo] = useState(data.email.admin || "");
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try { await api("/api/test-email", "POST", { to }); flash(`Test email sent to ${to}`); reload(); }
    catch (e) { flash((e as Error).message, true); }
    setBusy(false);
  }
  return (
    <section className="panel settings">
      <div className="card">
        <h3>Email delivery</h3>
        <p>Status: {data.email.provider ? <span className="ok">Connected via {data.email.provider === "smtp" ? "SMTP" : "Resend"}</span> : <span className="bad-t">Not configured</span>}</p>
        {data.email.from && <p className="muted">Sending as {data.email.from}</p>}
        <div className="filters">
          <input type="email" placeholder="you@company.com" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn primary" onClick={test} disabled={busy || !to}>Send test email</button>
        </div>
      </div>
      <ChangePassword flash={flash} adminEmail={data.email.admin} />
      <div className="card">
        <h3>Schedule</h3>
        <p>Each item emails its assignees <b>at its due time</b> (IST) on each reminder day you picked — by default 2 days before, 1 day before and on the due date. Reminders are checked <b>every 10 minutes</b>, so an email arrives within about 10–15 minutes of the set time. A daily digest goes out at 9:00 AM.</p>
        <p className="muted">Daily cron secret: {data.cron ? "set ✓" : "not set — Vercel cron calls will be rejected"} · Storage: {data.storage === "blob" ? "Vercel Blob ✓" : "local file (dev only)"}</p>
        {data.email.admin ? <p className="muted">A daily digest goes to {data.email.admin}.</p> : <p className="muted">Set <code>ADMIN_EMAIL</code> to receive a daily digest.</p>}
      </div>
      <div className="card">
        <h3>Set up Gmail sending (5 minutes)</h3>
        <ol>
          <li>Turn on 2-Step Verification on the Google account you want to send from.</li>
          <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank">myaccount.google.com/apppasswords</a>, create an app password named “Reminders” and copy the 16-character code.</li>
          <li>In Vercel → this project → Settings → Environment Variables add <code>SMTP_USER</code> = your Gmail address and <code>SMTP_PASS</code> = the app password.</li>
          <li>Redeploy (Deployments → ⋯ → Redeploy), then send a test email from here.</li>
        </ol>
        <p className="muted">Other providers: set <code>SMTP_HOST</code> / <code>SMTP_PORT</code> too, or use <code>RESEND_API_KEY</code> + <code>EMAIL_FROM</code>.</p>
      </div>
    </section>
  );
}
