import nodemailer from "nodemailer";
type Transporter = ReturnType<typeof nodemailer.createTransport>;

export interface Mail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export function emailProvider(): "resend" | "smtp" | null {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return null;
}

function fromAddress() {
  return process.env.EMAIL_FROM || (process.env.SMTP_USER ? `Reminders <${process.env.SMTP_USER}>` : "Reminders <onboarding@resend.dev>");
}

let transporter: Transporter | null = null;

export async function sendMail(m: Mail): Promise<void> {
  const to = [...new Set(m.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) throw new Error("No recipients");
  const provider = emailProvider();
  if (!provider) throw new Error("Email is not configured. Add SMTP_USER + SMTP_PASS (or RESEND_API_KEY) in Vercel environment variables.");

  if (provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress(), to, subject: m.subject, html: m.html, text: m.text }),
    });
    if (!r.ok) throw new Error(`Resend error ${r.status}: ${await r.text()}`);
    return;
  }

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  await transporter.sendMail({ from: fromAddress(), to: to.join(", "), subject: m.subject, html: m.html, text: m.text });
}

export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function layout(heading: string, accent: string, rows: [string, string][], body: string, cta = "Open dashboard"): string {
  const r = rows
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280;width:130px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#111827;font-weight:600">${v}</td></tr>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
   <tr><td style="background:${accent};height:6px"></td></tr>
   <tr><td style="padding:24px 28px 8px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#71717a">Task &amp; Certificate Reminder</div>
   <h1 style="margin:6px 0 0;font-size:20px;color:#111827">${heading}</h1></td></tr>
   <tr><td style="padding:12px 28px"><table width="100%" style="font-size:14px">${r}</table></td></tr>
   ${body ? `<tr><td style="padding:4px 28px 8px;font-size:14px;color:#374151;line-height:1.55">${body}</td></tr>` : ""}
   <tr><td style="padding:16px 28px 28px"><a href="${appUrl()}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${cta}</a></td></tr>
  </table>
  <div style="font-size:12px;color:#a1a1aa;margin-top:12px">You're receiving this because you are assigned to this item.</div>
  </td></tr></table></body></html>`;
}

export { esc };
