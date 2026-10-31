# Reminder Desk — Task & Certificate Reminders

Assign tasks and certificates to people by email and let the app remind them automatically.

## Features
- **Tasks and certificates** — certificates have an expiry/renewal date, certificate number and an uploaded copy (PDF/image).
- **Repeat schedules** — one-time, daily, weekly, monthly, quarterly, yearly (31st-of-month and 29-Feb handled).
- **Multiple reminders per item** — e.g. 60, 30, 7 and 1 day before and on the day; any custom number of days.
- **Assign by email** — several assignees per item; optional "you've been assigned" email; people directory.
- **Overdue follow-up** — one-time items keep emailing daily until marked done (optional).
- **Bulk upload** — import hundreds of items from a CSV (template included; Excel → Save As CSV).
- **Email now**, **mark done** (recurring items roll to the next occurrence), pause/resume.
- **Daily digest** to the admin, plus an email activity log.
- Runs daily at **9:00 AM IST** via Vercel Cron (`vercel.json`).

## Stack
Next.js 16 (App Router) · Vercel Blob (private) for data and files · Nodemailer (SMTP/Gmail) or Resend · Vercel Cron.

## Environment variables
See `.env.example`. Required in production: `ADMIN_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` (auto-added when you connect a Blob store), and either `SMTP_USER` + `SMTP_PASS` or `RESEND_API_KEY`.

### Gmail setup
1. Enable 2-Step Verification on the Google account.
2. Create an App Password at https://myaccount.google.com/apppasswords.
3. Set `SMTP_USER` (Gmail address) and `SMTP_PASS` (app password) in Vercel, then redeploy.
4. Dashboard → Settings → **Send test email**.

## CSV columns
| column | example |
|---|---|
| title | Fire safety certificate |
| type | `task` or `certificate` |
| assignees | `a@x.com;b@x.com` |
| due_date | `2027-03-31` or `31/03/2027` |
| repeat | none, daily, weekly, monthly, quarterly, yearly |
| reminders | `60;30;7;1` (days before; 0 = on the day) |
| reference | FS-2291 |
| description | Free text, included in the email |

## Local development
```bash
npm install
ADMIN_PASSWORD=admin npm run dev   # data is stored in .data/db.json when no Blob token is set
```
