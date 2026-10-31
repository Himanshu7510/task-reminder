import { get } from "@vercel/blob";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const deny = await requireAuth();
  if (deny) return deny;
  const p = new URL(req.url).searchParams.get("p") || "";
  if (!p.startsWith("files/")) return new Response("Bad path", { status: 400 });
  const res = await get(p, { access: "private" });
  if (!res || res.statusCode !== 200) return new Response("Not found", { status: 404 });
  const name = p.split("/").pop()!.replace(/^\d+-/, "");
  return new Response(res.stream, {
    headers: { "Content-Type": res.blob.contentType, "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
