import { readDB, updateDB } from "@/lib/db";
import { verifyLink } from "@/lib/tokens";
import { recordSeen } from "@/lib/completion";

export const dynamic = "force-dynamic";

// 1×1 transparent GIF
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Open-tracking pixel embedded in each assignee's reminder email. Always returns the image. */
export async function GET(req: Request) {
  const p = verifyLink(new URL(req.url).searchParams.get("k"));
  if (p) {
    try {
      const db = await readDB();
      const t = db.tasks.find((x) => x.id === p.t);
      const already = t?.seen?.some((s) => s.occ === p.o && s.email === p.e);
      if (t && t.assignees.includes(p.e) && !already) {
        await updateDB((d) => {
          const task = d.tasks.find((x) => x.id === p.t);
          if (task) recordSeen(d, task, p.o, p.e);
        });
      }
    } catch (e) {
      console.error("open pixel:", e);
    }
  }
  return new Response(GIF, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", "Content-Length": String(GIF.length) },
  });
}
