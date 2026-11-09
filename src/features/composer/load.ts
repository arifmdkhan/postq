"use server";
import { database } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getDraft } from "@/features/drafts/repository";
import { publishingPlatforms } from "@/features/publishing/capabilities";
import { workspaceTimezone } from "@/features/settings/timezone";
import { attachmentIds } from "@/features/media/attachments";

export async function loadComposer(draftId?: string) {
  const user = await requireUser();
  const db = await database();
  const draft = draftId ? await getDraft(user.id, draftId) : null;
  if (draftId && !draft) throw new Error("This draft was removed or is unavailable.");
  const plan = draft?.delivery_plan ? JSON.parse(draft.delivery_plan) : {};
  const selectedMedia = [...attachmentIds(plan.media), ...Object.values(plan.variants ?? {}).flatMap((variant) => attachmentIds((variant as { media?:unknown }).media))];
  const [storedChannels, media] = await Promise.all([
    db.prepare("SELECT id,platform,coalesce(nullif(trim(label),''),nullif(trim(profile_name),'')) AS label,avatar_url FROM channels WHERE user_id=? AND active=1 ORDER BY platform,id")
      .bind(user.id).all<{ id: string; platform: string; label: string | null; avatar_url: string | null }>(),
    db.prepare(`SELECT id,name,mime FROM media_assets WHERE user_id=? AND id IN (SELECT value FROM json_each(?))
      UNION SELECT id,name,mime FROM (SELECT id,name,mime FROM media_assets WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20)`)
      .bind(user.id, JSON.stringify(selectedMedia), user.id).all<{ id: string; name: string; mime: string }>(),
  ]);
  const canPublish = ({ platform }: { platform: string }) => publishingPlatforms.some((supported) => supported === platform) &&
    (platform !== "tiktok" || process.env.POSTQ_TIKTOK_DIRECT_POST === "enabled");
  return { draft, media: media.results, name: user.name, timezone: await workspaceTimezone(),
    channels: storedChannels.results.filter(canPublish), connectedOnly: storedChannels.results.filter((channel) => !canPublish(channel)) };
}
