import { publishMediaPost, publishThread, sendTikTok, sendTikTokPhotos, uploadYouTube, stageLinkedInFile, uploadPinterestVideo, type DeliveryMedia } from "./composio";
import { publicationMediaIds, type Attachment } from "../media/attachments";
import { attachmentError } from "./media-policy";
import { deliveryMediaUrl } from "./media-link";
import { publishDue } from "./runner";
import { claimPublicationComment, commentLimit, sendPublicationComment } from "./comments";
import { integrationConfiguration } from "../settings/encryption";
import { workspaceOwner } from "../../server/owner";
import { reconcilePending } from "./reconcile";
import { cleanupMedia } from "../media/cleanup";
import { deliveryFailure } from "./receipts";
import { retainHistory } from "./retention";

type SchedulerEnv = Pick<CloudflareEnv, "DB" | "MEDIA"> & Partial<Record<"BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" |
  "POSTQ_ENCRYPTION_KEY" | "POSTQ_PREVIOUS_ENCRYPTION_KEY" | "POSTQ_PUBLISHING_PAUSED" | "POSTQ_RETENTION_DAYS" | "POSTQ_TIKTOK_DIRECT_POST" | "COMPOSIO_API_KEY", string>>;

export async function runScheduled(env: SchedulerEnv) {
  const db = env.DB;
  const started = Date.now();
  const lockId = crypto.randomUUID();
  const lock = await db.prepare(`INSERT INTO app_settings(name,value,updated_at) VALUES ('scheduler-lock',?,?)
    ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE app_settings.updated_at<?`)
    .bind(lockId, started, started - 14 * 60000).run();
  if (!lock.meta.changes) return;
  let status = "ready";
  try {
    await cleanupMedia(db, env.MEDIA);
    await retainHistory(db,Number(env.POSTQ_RETENTION_DAYS));
    const rows = await db.prepare("SELECT name,value FROM app_settings WHERE name LIKE 'integration:%'").all<{ name: string; value: string }>();
    const config = integrationConfiguration(rows.results, Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    if (env.POSTQ_PUBLISHING_PAUSED === "yes") { status = "paused"; return; }
    if (!config.COMPOSIO_API_KEY) { status = config.POSTQ_CONFIG_ERRORS ? "credentials_need_repair" : "not_configured"; return; }
    const key = config.COMPOSIO_API_KEY;
    const ownerId = await workspaceOwner(db);
    if (!ownerId) { status = "no_owner"; return; }
    const deadline = started + 5 * 60000;
    await reconcilePending(db, key, ownerId, deadline);
    await publishDue(db, async (account, user, caption, platform, post) => {
      const ids=publicationMediaIds(post);
      const found=await db.prepare("SELECT id,name,mime,metadata,bytes FROM media_assets WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(user,JSON.stringify(ids)).all<Attachment>();
      if(found.results.length!==ids.length)throw new Error("Media unavailable");
      const assets=ids.map(id=>found.results.find(asset=>asset.id===id)!);
      if(attachmentError(platform,assets,post.destination??""))throw new Error("Media requires validation");
      if (platform === "threads" && !ids.length) return publishThread(key, account, user, caption, post.delivery_options);
      if (platform === "youtube") {
        const video = ids[0] && await env.MEDIA.get(user + "/" + ids[0]);
        if (!video || video.size > 10 * 1024 * 1024) throw new Error("Video unavailable");
        return uploadYouTube(key, account, user, post, await video.arrayBuffer(), async (id) => {
          await db.prepare("UPDATE publications SET pending_receipt=? WHERE id=? AND status='sending'").bind(id, post.id).run();
        });
      }
      const media:DeliveryMedia[]=[];
      for(const asset of assets){
        const item:DeliveryMedia={mime:asset.mime,url:""};
        if(platform==="linkedin" || platform==="pinterest"&&asset.mime==="video/mp4"){
          const object=await env.MEDIA.get(user+"/"+asset.id);
          if(!object || object.size>10*1024*1024)throw new Error("Media unavailable");
          if(platform==="linkedin")item.file=await stageLinkedInFile(key,asset.name,asset.mime,await object.arrayBuffer(),deadline);
          else item.registeredId=await uploadPinterestVideo(key,account,user,await object.arrayBuffer(),deadline);
        } else {
          if (!env.BETTER_AUTH_URL || !env.BETTER_AUTH_SECRET) throw new Error("Media delivery unavailable");
          item.url=await deliveryMediaUrl(env.BETTER_AUTH_URL,env.BETTER_AUTH_SECRET,post.id,asset.id);
        }
        media.push(item);
      }
      if (platform === "tiktok" && media.length && post.destination) {
        if (env.POSTQ_TIKTOK_DIRECT_POST !== "enabled") throw new Error("TikTok Direct Post is disabled");
        return media[0].mime==="image/jpeg" ? sendTikTokPhotos(key,account,user,post.title,caption,post.destination,media.map(item=>item.url),post.delivery_options)
          : sendTikTok(key, account, user, caption, post.destination, media[0].url, post.delivery_options);
      }
      return publishMediaPost(key, account, user, platform, post, media,deadline);
    }, ownerId, Math.min(deadline - 30000, Date.now() + 180000));
    const firstComments = await db.prepare(`SELECT p.id,p.remote_post_id,c.remote_id,c.platform,json_extract(p.delivery_options,'$.firstComment') AS body
      FROM publications p JOIN channels c ON c.id=p.channel_id AND c.user_id=p.user_id AND c.active=1
      WHERE p.user_id=? AND p.status='published' AND p.remote_post_id IS NOT NULL AND p.deleted_at IS NULL AND p.abandoned_at IS NULL
        AND p.live_change IS NULL AND json_type(p.delivery_options,'$.firstComment')='text'
        AND NOT EXISTS (SELECT 1 FROM publication_comments pc WHERE pc.publication_id=p.id AND pc.body=json_extract(p.delivery_options,'$.firstComment'))
      ORDER BY p.due_at LIMIT 5`).bind(ownerId).all<{ id: string; remote_post_id: string; remote_id: string; platform: string; body: string }>();
    for (const post of firstComments.results) {
      if (Date.now() >= deadline) break;
      const length = post.platform === "threads" ? new TextEncoder().encode(post.body).length : post.body.length;
      if (!length || length > commentLimit(post.platform, post.remote_post_id)) continue;
      if (!await claimPublicationComment(db, ownerId, post.id, post.remote_post_id, post.body)) continue;
      try {
        const receipt = await sendPublicationComment(key, post.remote_id, ownerId, post.platform, post.remote_post_id, post.body);
        await db.prepare("UPDATE publication_comments SET remote_id=?,state='confirmed' WHERE publication_id=? AND body=?").bind(receipt, post.id, post.body).run();
      } catch {
        // The comment may have been sent. Keep its claim for manual review.
        await db.prepare("UPDATE publication_comments SET state='uncertain' WHERE publication_id=? AND body=?").bind(post.id, post.body).run();
      }
    }
  } catch (error) {
    status = deliveryFailure(error);
    console.error(JSON.stringify({ event: "scheduler_failed", code: status }));
    throw error;
  } finally {
    await db.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES ('scheduler-status',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .bind(JSON.stringify({ status, started, finished: Date.now() }), Date.now()).run();
    await db.prepare("DELETE FROM app_settings WHERE name='scheduler-lock' AND value=?").bind(lockId).run();
  }
}

