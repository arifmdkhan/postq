import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { mediaBucket } from "@/features/media/storage";
import { serveMedia } from "@/features/media/serve";

export async function GET(request: Request, context: RouteContext<"/api/media/[id]">) {
  const [user, { id }] = await Promise.all([requireUser(), context.params]);
  if (!/^[a-f\d-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const db = await database();
  const asset = await db.prepare("SELECT name,mime,bytes,thumbnail FROM media_assets WHERE user_id=? AND id=?")
    .bind(user.id,id).first<{ name:string;mime:string;bytes:number;thumbnail:number }>();
  if (!asset) return new Response("Not found", { status: 404 });
  if (new URL(request.url).searchParams.has("thumbnail")) {
    if (!asset.thumbnail) return new Response("Not found",{status:404});
    const bucket=await mediaBucket();
    const key=user.id+"/"+id+"/thumbnail";
    const object=await bucket.head(key);
    if (!object) return new Response("Not found",{status:404});
    return serveMedia(bucket,key,request,new Headers({"content-type":"image/png","cache-control":"private, no-store","x-content-type-options":"nosniff"}),object.size);
  }
  const preview = new URL(request.url).searchParams.has("preview");
  const filename = encodeURIComponent(asset.name.toWellFormed()).replace(/['()*]/g,
    (value) => "%" + value.charCodeAt(0).toString(16).toUpperCase());
  return serveMedia(await mediaBucket(), user.id + "/" + id, request, new Headers({
    "content-type": preview ? asset.mime : "application/octet-stream",
    "content-disposition": (preview ? "inline" : "attachment") + "; filename*=UTF-8''" + filename,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  }), asset.bytes);
}

