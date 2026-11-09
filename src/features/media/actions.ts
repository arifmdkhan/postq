"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { mediaBucket } from "./storage";
import { cleanupMedia } from "./cleanup";

export async function updateAsset(id: string, form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  const folder = String(form.get("folder") ?? "").trim();
  const tags = String(form.get("tags") ?? "").trim();
  if (!name || name.length > 160 || folder.length > 80 || tags.length > 160) redirect("/dashboard/media?error=details");
  const db = await database();
  await db.prepare("UPDATE media_assets SET name = ?, folder = ?, tags = ? WHERE id = ? AND user_id = ?")
    .bind(name, folder || null, tags || null, id, user.id).run();
  revalidatePath("/dashboard/media");
  redirect("/dashboard/media?updated=1");
}

export async function deleteAsset(id: string) {
  const user = await requireUser();
  if (typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id)) return;
  const db = await database();
  const result = await db.prepare(`DELETE FROM media_assets WHERE user_id = ? AND id = ?
    AND NOT EXISTS (SELECT 1 FROM publications WHERE (media_id = media_assets.id OR EXISTS (SELECT 1 FROM json_each(publications.media_ids) a WHERE a.value=media_assets.id))
      AND user_id = media_assets.user_id AND (status IN ('scheduled', 'sending', 'review') OR (pending_receipt IS NOT NULL AND reconciled_at IS NULL)))
    AND NOT EXISTS (SELECT 1 FROM drafts d,json_tree(d.delivery_plan) j
      WHERE d.user_id=media_assets.user_id AND j.type='text' AND j.value=media_assets.id)`).bind(user.id, id).run();
  if (!result.meta.changes) redirect("/dashboard/media?error=in-use");
  await cleanupMedia(db, await mediaBucket());
  revalidatePath("/dashboard/media");
}

