export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export type ItemType = "task" | "certificate";

export interface Attachment {
  name: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

export interface Task {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  /** For certificates: issuing body / certificate number etc. */
  reference?: string;
  assignees: string[]; // emails
  /** First due date (or expiry date for a certificate), YYYY-MM-DD */
  startDate: string;
  recurrence: Recurrence;
  /** Days before the due date to send a reminder, e.g. [30, 7, 1, 0] */
  reminders: number[];
  /** Keep emailing every day after the due date until marked done (one-off items) */
  overdueDaily: boolean;
  active: boolean;
  /** Occurrence dates (YYYY-MM-DD) marked as done */
  doneFor: string[];
  /** Dedup keys of reminders already sent: `${occurrence}:${offset}` */
  sent: string[];
  attachments: Attachment[];
  /** Who opened the reminder email, per occurrence */
  seen?: { occ: string; email: string; at: string }[];
  /** Who completed which occurrence, and how */
  completions?: { occ: string; email: string; at: string; via: "email" | "dashboard" }[];
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  email: string;
  name: string;
}

export interface LogEntry {
  at: string;
  taskId?: string;
  title: string;
  to: string[];
  kind: "reminder" | "overdue" | "manual" | "digest" | "test" | "assigned" | "security" | "seen" | "completed";
  ok: boolean;
  error?: string;
}

export interface AuthState {
  /** scrypt$N$r$p$salt$hash — when absent, ADMIN_PASSWORD env var is used */
  hash?: string;
  /** Bumped on every password change/reset: invalidates all existing sessions */
  version: number;
  changedAt?: string;
  /** sha256 of the one-time reset token + expiry (ms) */
  reset?: { hash: string; exp: number };
  lastForgotAt?: number;
  /** failed login attempts per client key (hashed IP) */
  failures: Record<string, { n: number; first: number; until?: number }>;
}

export interface DB {
  tasks: Task[];
  people: Person[];
  log: LogEntry[];
  lastRun?: string;
  auth?: AuthState;
}
