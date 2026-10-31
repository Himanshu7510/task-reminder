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

## Admin password & security
- **Forgot password** on the sign-in page emails a one-time reset link to `ADMIN_EMAIL` (expires in 30 min, single use, only the token's SHA-256 is stored; max 1 request per 2 min).
- **Change password** in Settings (needs the current password).
- Passwords must be 10+ chars with upper, lower, number and symbol; stored as a salted **scrypt** hash. `ADMIN_PASSWORD` is only used until the first change/reset.
- Changing or resetting the password **signs out every other session** and emails a security notice.
- **5 wrong attempts → 15-minute lock** per client, plus a delay on each failure.
- HttpOnly + Secure + SameSite cookies (7-day sessions), same-origin check on every API write, security headers (no framing, no-referrer, nosniff, CSP).

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
