import { get, head, put, BlobPreconditionFailedError, BlobNotFoundError } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";
import type { DB } from "./types";

const DB_PATH = "data/db.json";
const LOCAL_FILE = path.join(process.cwd(), ".data", "db.json");
const useBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

const empty = (): DB => ({ tasks: [], people: [], log: [] });

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

async function load(): Promise<{ db: DB; etag?: string }> {
  if (!useBlob()) {
    try {
      return { db: JSON.parse(await fs.readFile(LOCAL_FILE, "utf8")) };
    } catch {
      return { db: empty() };
    }
  }
  try {
    // Take the version tag from the Blob API (head) — the same format put({ ifMatch }) compares against.
    // The download response's HTTP ETag header is formatted differently and never matches.
    // head() runs first, so if someone writes between head and get, our save is rejected and retried.
    const meta = await head(DB_PATH);
    const res = await get(DB_PATH, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return { db: empty() };
    const text = await readStream(res.stream);
    return { db: { ...empty(), ...JSON.parse(text) }, etag: meta.etag };
  } catch (e) {
    if (e instanceof BlobNotFoundError) return { db: empty() };
    throw e;
  }
}

async function save(db: DB, etag?: string) {
  const body = JSON.stringify(db);
  if (!useBlob()) {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, body);
    return;
  }
  await put(DB_PATH, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

export async function readDB(): Promise<DB> {
  return (await load()).db;
}

/** Read-modify-write with optimistic concurrency (retries if someone else wrote in between). */
export async function updateDB<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const ATTEMPTS = 5;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { db, etag } = await load();
    const result = await fn(db);
    db.log = db.log.slice(-500);
    // Last attempt writes unconditionally so a version-tag problem can never lock the app up again.
    const last = attempt === ATTEMPTS - 1;
    try {
      await save(db, last ? undefined : etag);
      return result;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError && !last) {
        console.warn(`updateDB: version conflict, retrying (${attempt + 1}/${ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not save, please retry.");
}
