import type { DB } from "./types";

/** Make sure every assignee exists in the people directory */
export function syncPeople(db: DB, emails: string[]) {
  for (const e of emails) {
    if (!db.people.some((p) => p.email === e)) db.people.push({ email: e, name: "" });
  }
}
