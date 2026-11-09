import { database } from "@/server/db";
import { mediaBucket } from "@/features/media/storage";
import { verifyDeliveryMedia } from "@/features/publishing/media-link";
import { serveMedia } from "@/features/media/serve";

async function serve(request: Request, { params }: RouteContext<"/api/delivery-media/[id]">) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const secret = process.env.BETTER_AUTH_SECRET;
  const selected=search.get("asset")??undefined;
  const missing = () => new Response(null, { status: 404 });
  if (selected && !/^[a-f\d-]{36}$/i.test(selected) || !secret || !await verifyDeliveryMedia(secret, id, Number(search.get("expires")), search.get("signature") ?? "",selected)) return missing();
  const db = await database();
  const asset = await db.prepare(`SELECT m.id, m.user_id, m.mime, m.bytes FROM publications p JOIN media_assets m
    ON m.id = coalesce(?,p.media_id) AND m.user_id = p.user_id WHERE p.id = ? AND p.status IN ('sending', 'published', 'review')
    AND (m.id=p.media_id OR EXISTS (SELECT 1 FROM json_each(p.media_ids) a WHERE a.value=m.id))`)
    .bind(selected??null,id).first<{ id: string; user_id: string; mime: string; bytes: number }>();
  if (!asset) return missing();
  return serveMedia(await mediaBucket(), asset.user_id + "/" + asset.id, request,
    new Headers({ "content-type": asset.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }), asset.bytes);
}

export const GET = serve;
export const HEAD = serve;
