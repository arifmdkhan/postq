import { executeSocialTool, linkedinMember } from "./composio";
import { firstCommentLimits } from "./capabilities";

export function commentLimit(platform: string, id: string) {
  if (platform === "facebook" && /^\d+_\d+$/.test(id)) return firstCommentLimits.facebook;
  if (platform === "threads" && /^\d+$/.test(id)) return firstCommentLimits.threads;
  if (platform === "linkedin" && /^urn:li:(share|ugcPost):\d+$/.test(id)) return firstCommentLimits.linkedin;
  if (platform === "youtube" && /^[\w-]{11}$/.test(id)) return firstCommentLimits.youtube;
  return 0;
}

export async function claimPublicationComment(db: D1Database, user: string, id: string, remoteId: string, body: string) {
  const result = await db.prepare(`INSERT INTO publication_comments (publication_id,body,created_at,state)
    SELECT p.id, ?, ?, 'sending' FROM publications p JOIN channels c ON c.id = p.channel_id AND c.user_id = p.user_id AND c.active = 1
    WHERE p.id = ? AND p.user_id = ? AND p.remote_post_id = ? AND p.status = 'published' AND p.deleted_at IS NULL AND p.live_change IS NULL
      AND NOT (c.platform='youtube' AND coalesce(json_extract(p.delivery_options,'$.madeForKids'),0)=1)
    ON CONFLICT(publication_id,body) DO UPDATE SET state='sending',created_at=excluded.created_at,remote_id=NULL
      WHERE publication_comments.state='not-sent'`)
    .bind(body, Date.now(), id, user, remoteId).run();
  return result.meta.changes === 1;
}

export async function sendPublicationComment(
  key: string, account: string, user: string, platform: string, post: string, message: string,
) {
  const execute = <T>(slug: string, args: object) => executeSocialTool<T>(key, account, user, slug, args);
  let id: string | undefined;
  switch (platform) {
    case "facebook":
      id = (await execute<{ id?: string }>("FACEBOOK_CREATE_COMMENT", { object_id: post, message })).id;
      break;
    case "threads":
      id = (await execute<{ post_id?: string }>("THREADS_CREATE_REPLY", {
        user_id: "me", reply_to_id: post, reply_source: "owned", media_type: "TEXT", text: message,
      })).post_id;
      break;
    case "linkedin": {
      const actor = await linkedinMember(key, account, user);
      const result = await execute<{ id?: string; commentUrn?: string }>("LINKEDIN_CREATE_COMMENT_ON_POST", {
        actor, target_urn: post, object: post, message: { text: message },
      });
      id = result.commentUrn ?? result.id;
      break;
    }
    case "youtube": {
      const result = await execute<{ items?: { id: string; snippet?: { channelId?: string } }[] }>("YOUTUBE_GET_VIDEO_DETAILS_BATCH", {
        id: [post], parts: ["snippet"],
      });
      const channelId = result.items?.find((video) => video.id === post)?.snippet?.channelId;
      if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) throw new Error("YouTube channel unavailable");
      const receipt = await execute<{ snippet?: { topLevelComment?: { id?: string } } }>("YOUTUBE_POST_COMMENT", {
        videoId: post, channelId, textOriginal: message,
      });
      id = receipt.snippet?.topLevelComment?.id;
      break;
    }
  }
  if (typeof id !== "string" || !id || id.length > 256) throw new Error("Comment receipt unavailable");
  return id;
}
