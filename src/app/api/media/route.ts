import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { mediaBucket } from "@/features/media/storage";
import { matchesMediaFormat, maxBytes, mediaTypes } from "@/features/media/formats";
import { inspectMedia, imageThumbnail } from "@/features/media/metadata";

export async function POST(request: Request) {
  const site = process.env.BETTER_AUTH_URL;
  if (!site || request.headers.get("origin") !== new URL(site).origin) return new Response("Forbidden", { status: 403 });
  const user = await requireUser();
  const target = new URL("/dashboard/media", site);
  const json = request.headers.get("accept") === "application/json";
  function reject(code: string, message: string, status: number) {
    if (json) return NextResponse.json({ error: message }, { status });
    target.searchParams.set("error", code);
    return NextResponse.redirect(target, 303);
  }
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxBytes + 327680) {
    return reject("size", "Choose a file up to 10 MiB.", 413);
  }

  let file: FormDataEntryValue | null;
  let folder = "";
  let submittedThumbnail: FormDataEntryValue | null = null;
  try {
    const form = await request.formData();
    file = form.get("file");
    submittedThumbnail = form.get("thumbnail");
    const value = form.get("folder");
    folder = typeof value === "string" ? value.trim().slice(0, 80) : "";
  } catch {
    return new Response("Invalid upload", { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > maxBytes || !mediaTypes.includes(file.type)) {
    return reject("file", "Choose a supported image or video up to 10 MiB.", 400);
  }
  if (!matchesMediaFormat(await file.slice(0, 128).arrayBuffer(), file.type)) {
    return reject("file", "The file contents do not match its selected format.", 400);
  }

  const [db, bucket] = await Promise.all([database(), mediaBucket()]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let inspected: Awaited<ReturnType<typeof inspectMedia>>;
  try {
    inspected = await inspectMedia(bytes,file.type);
    if (!inspected.thumbnail && submittedThumbnail instanceof File && submittedThumbnail.size<=256*1024 && ["image/jpeg","image/png"].includes(submittedThumbnail.type)) {
      const thumb = new Uint8Array(await submittedThumbnail.arrayBuffer());
      const result = await inspectMedia(thumb,submittedThumbnail.type);
      if (result.metadata.width>480 || result.metadata.height>480) return reject("file","Thumbnail dimensions are too large.",400);
      inspected.thumbnail=await imageThumbnail(thumb,submittedThumbnail.type);
    }
  } catch (error) { return reject("file",error instanceof Error ? error.message : "This file could not be validated.",400); }
  const id = crypto.randomUUID();
  const key = user.id + "/" + id;
  // Durable compensation is inserted before either object can be written.
  await db.prepare("INSERT INTO media_deletions(object_key,created_at) VALUES (?,?)").bind(key,Date.now()+3600000).run();
  try {
    await bucket.put(key,bytes);
    if (inspected.thumbnail) await bucket.put(key+"/thumbnail",inspected.thumbnail,{httpMetadata:{contentType:"image/png"}});
    await db.batch([
      db.prepare("INSERT INTO media_assets (id,user_id,name,mime,bytes,created_at,folder,metadata,thumbnail) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id,user.id,file.name.trim().slice(0,160)||"Media",file.type,file.size,Date.now(),folder||null,JSON.stringify(inspected.metadata),inspected.thumbnail?1:0),
      db.prepare("DELETE FROM media_deletions WHERE object_key=?").bind(key),
    ]);
  } catch (error) {
    await db.prepare("UPDATE media_deletions SET created_at=? WHERE object_key=?").bind(Date.now(),key).run();
    throw error;
  }
  return json ? NextResponse.json({ id }, { status: 201 }) : NextResponse.redirect(target, 303);
}
