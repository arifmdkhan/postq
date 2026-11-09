import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { mediaTypes } from "@/features/media/formats";

export async function GET(request: Request) {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "media" && kind !== "draft") return new Response("Invalid library", { status: 400 });
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  if (!Number.isInteger(page)) return new Response("Invalid page", { status: 400 });
  const query = (params.get("q") || "").slice(0, 120);
  const allowed = (params.get("mime") || mediaTypes.join(",")).split(",").filter((mime) => mediaTypes.includes(mime));
  const db = await database();
  const { results } = kind === "media"
    ? await db.prepare(`SELECT id,name,mime FROM media_assets WHERE user_id=? AND instr(lower(name),lower(?))>0
        AND mime IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?`)
      .bind(user.id, query, JSON.stringify(allowed), (page - 1) * 20).all()
    : await db.prepare(`SELECT id,title AS name FROM drafts WHERE user_id=? AND instr(lower(title),lower(?))>0
        ORDER BY updated_at DESC,id DESC LIMIT 21 OFFSET ?`).bind(user.id, query, (page - 1) * 20).all();
  return Response.json({ items: results.slice(0, 20), next: results.length > 20 }, { headers: { "Cache-Control": "private, no-store" } });
}
