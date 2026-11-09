"use server";
import { runtimeConfiguration } from "@/features/settings/configuration";


import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { isPlanningDate } from "@/features/drafts/planning";
import { getDraft, saveDraft } from "@/features/drafts/repository";
import { futureUtcMinute } from "@/features/publishing/time";
import { deliveryError, firstCommentLimits, threadsReplyControls } from "@/features/publishing/capabilities";
import { getFacebookPages, getPinterestDestinations, getTikTokCreator } from "@/features/publishing/actions";
import { linkedinMember } from "@/features/publishing/composio";
import { zonedMinuteToUtc } from "@/features/publishing/timezone";
import { workspaceTimezone } from "@/features/settings/timezone";
import { mediaDeliveryError } from "@/features/media/validation";
import { attachmentIds, type Attachment } from "@/features/media/attachments";
import { attachmentError } from "@/features/publishing/media-policy";

export async function composePost(id: string, draftId: string | null, _previous: { message: string; done: boolean }, form: FormData) {
  const user = await requireUser();
  const fail = (message: string) => ({ message, done: false });
  const title = String(form.get("title") ?? "").trim();
  const caption = String(form.get("caption") ?? "").trim();
  const hashtags = String(form.get("hashtags") ?? "").trim();
  const body = [caption, hashtags].filter(Boolean).join("\n\n");
  const date = String(form.get("date") ?? "");
  const time = String(form.get("time") ?? "");
  const intent = form.get("intent");
  const tag = String(form.get("tag") ?? "").trim();
  const color = String(form.get("tagColor") ?? "");
  const tagColor = tag && /^#[a-f\d]{6}$/i.test(color) ? color : undefined;
  if (tag.length > 48) return fail("Keep the tag within 48 characters.");
  if (!/^[a-f\d-]{36}$/i.test(id) || !title || title.length > 160 || body.length > 10000 || hashtags.length > 300) {
    return fail("Enter a title and keep the caption and hashtags within their limits.");
  }
  if (date && !isPlanningDate(date)) return fail("Choose a valid date.");
  const draft = draftId ? await getDraft(user.id, draftId) : null;
  if (draftId && !draft) return fail("This draft is no longer available.");
  const expectedVersion = form.get("expectedUpdatedAt");
  let sharedMedia: string[];
  const selectedMedia: Record<string,string[]> = {};
  try {
    sharedMedia=attachmentIds(form.get("sharedMedia"));
    for(const channel of form.getAll("channel"))selectedMedia[String(channel)]=attachmentIds(form.get(`media-${channel}`));
  } catch {return fail("Choose up to 35 distinct media files per selection.");}
  if (draft && expectedVersion !== draft.updated_at) return fail("The draft changed after review. Your edits are still here; copy them before reloading.");
  if (intent === "draft") {
    if (sharedMedia.length) {
      const db = await database();
      if ((await db.prepare("SELECT count(*) AS total FROM media_assets WHERE id IN (SELECT value FROM json_each(?)) AND user_id = ?").bind(JSON.stringify(sharedMedia), user.id).first<number>("total")) !== sharedMedia.length) {
        return fail("The shared attachment is no longer available.");
      }
    }
    const variants = Object.fromEntries(form.getAll("channel").slice(0, 10).filter((channel) => typeof channel === "string" && /^[a-f\d-]{36}$/i.test(channel))
      .map((channel) => [channel, {
        caption: form.get(`inherit-${channel}`) === "yes" ? undefined : String(form.get(`caption-${channel}`) ?? "").slice(0, 10000),
        title: String(form.get(`title-${channel}`) ?? "").trim().slice(0, 100) || undefined,
        media: form.get(`inherit-media-${channel}`) === "yes" ? undefined : selectedMedia[String(channel)],
        destination: String(form.get(`destination-${channel}`) ?? "").slice(0, 32),
        audience: String(form.get(`audience-${channel}`) ?? "").slice(0, 12),
        shareToFeed: form.get(`share-to-feed-${channel}`) === "no" ? "no" : undefined,
        syntheticMedia: form.get(`synthetic-media-${channel}`) === "yes" ? "yes" : undefined,
        link: String(form.get(`link-${channel}`) ?? "").trim().slice(0, 2048) || undefined,
        altText: String(form.get(`alt-${channel}`) ?? "").trim().slice(0, 500) || undefined,
        section: String(form.get(`section-${channel}`) ?? "").trim().slice(0, 32) || undefined,
        topic: String(form.get(`topic-${channel}`) ?? "").trim().slice(0, 50) || undefined,
        replyControl: String(form.get(`reply-control-${channel}`) ?? "").slice(0, 32) || undefined,
        firstComment: String(form.get(`first-comment-${channel}`) ?? "").trim().slice(0, 2000) || undefined,
      }]));
    const result = await saveDraft(user.id, { id: draftId ?? id, title, body, planned_on: date || null, tag: tag || null,
      delivery_plan: JSON.stringify({ variants, media: sharedMedia, tagColor, time: /^\d{2}:\d{2}$/.test(time) ? time : "" }) }, !draftId, typeof expectedVersion === "string" ? expectedVersion : undefined);
    if (!result.meta.changes) return fail("The draft could not be saved.");
  } else {
    if (intent !== "schedule" && intent !== "now") return fail("Choose how to save this post.");
    if (form.get("approvedIntent") !== intent) return fail("The delivery mode changed. Review and approve the current delivery time again.");
    const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
    if (!key) return fail("Configure Composio before publishing.");
    const wallTime = futureUtcMinute(date + "T" + time, -Infinity);
    const timezone = await workspaceTimezone();
    if (!form.get("mcpApproval") && form.get("timezone") !== timezone) return fail("Workspace timezone changed. Reopen and review this composition.");
    const due = intent === "now" ? Date.now() : form.get("mcpApproval") ? wallTime ?? NaN : zonedMinuteToUtc(date + "T" + time, timezone) ?? NaN;
    if (!Number.isFinite(due) || (intent === "schedule" && due <= Date.now())) {
      return fail("Choose a future local date and time.");
    }
    if (form.get("approved") !== "yes") return fail("Review and approve the delivery details first.");
    const channels = form.getAll("channel");
    if (!channels.length || channels.length > 10 || new Set(channels).size !== channels.length ||
        channels.some((channel) => typeof channel !== "string" || !/^[a-f\d-]{36}$/i.test(channel))) {
      return fail("Select up to ten distinct accounts.");
    }
    const db = await database();
    const deliveries = [];
    for (const channel of channels) {
      const mediaIds = selectedMedia[String(channel)];
      const media = mediaIds[0] ?? "";
      const caption = String(form.get(`caption-${channel}`) ?? "").trim();
      let destination = String(form.get(`destination-${channel}`) ?? "").trim();
      const target = await db.prepare(`SELECT c.platform, c.remote_id, m.mime, m.metadata FROM channels c
        LEFT JOIN media_assets m ON m.id = ? AND m.user_id = c.user_id
        WHERE c.id = ? AND c.user_id = ? AND c.active = 1`)
        .bind(media || null, channel, user.id).first<{ platform: string; remote_id: string; mime: string | null; metadata: string | null }>();
      if (!target || (media && !target.mime)) return fail("A selected account or media file is unavailable.");
      const {results: found}=await db.prepare("SELECT id,name,mime,metadata,bytes FROM media_assets WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(user.id,JSON.stringify(mediaIds)).all<Attachment>();
      if(found.length!==mediaIds.length)return fail("A selected media file is unavailable.");
      const assets=mediaIds.map(id=>found.find(asset=>asset.id===id)!);
      const mediaProblem=attachmentError(target.platform,assets,destination);
      if(mediaProblem)return fail(mediaProblem);
      if (caption.length > 10000) return fail("A caption exceeds 10,000 characters.");
      const link = ["facebook", "pinterest", "linkedin"].includes(target.platform) ? String(form.get(`link-${channel}`) ?? "").trim() : "";
      if (link) {
        const url = link.length <= 2048 ? URL.parse(link) : null;
        if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password || (["facebook","linkedin"].includes(target.platform) && target.mime)) {
          return fail("Enter a valid web link. Facebook and LinkedIn link posts require a separate delivery from media posts.");
        }
      }
      const problem = deliveryError(target.platform, caption || (target.platform === "facebook" || target.platform === "linkedin" ? link : ""), target.mime, destination);
      if (problem) return fail(problem);
      if (target.mime) {
        const mediaProblem=mediaDeliveryError(target.platform,target.mime,target.metadata,undefined,destination);
        if (mediaProblem) return fail(mediaProblem);
      }
      if (target.platform === "facebook") {
        const pages = await getFacebookPages(String(channel));
        if (!pages?.some(({ id }) => id === destination)) return fail("Choose a Facebook Page this connection can publish to.");
      }
      if (target.platform === "linkedin") {
        try {
          destination = await linkedinMember(key, target.remote_id, user.id);
        } catch {
          return fail("Could not verify the LinkedIn member. Check the connection in Accounts.");
        }
      }
      let options: Record<string, boolean | string> | null = link ? { link } : null;
      const publicationTitle = ["youtube", "pinterest", "tiktok"].includes(target.platform) ? String(form.get(`title-${channel}`) ?? "").trim() || title : title;
      if (target.platform === "pinterest") {
        const altText = String(form.get(`alt-${channel}`) ?? "").trim();
        const section = String(form.get(`section-${channel}`) ?? "").trim();
        if (Array.from(publicationTitle).length > 100 || Array.from(altText).length > 500) return fail("Pinterest allows up to 100 title and 500 alt text characters.");
        const boards = await getPinterestDestinations(String(channel));
        if (!boards?.some(({ id }) => id === destination)) return fail("Choose a board available to this Pinterest account.");
        if (section) {
          const sections = await getPinterestDestinations(String(channel), destination);
          if (!sections?.some(({ id }) => id === section)) return fail("Choose a section on the selected Pinterest board.");
        }
        options = { ...(link ? { link } : {}), ...(altText ? { altText } : {}), ...(section ? { section } : {}) };
      }
      if (target.platform === "youtube" && (publicationTitle.length > 100 || /[<>]/.test(publicationTitle + caption))) {
        return fail("YouTube titles are limited to 100 characters. Remove angle brackets from the title and description.");
      }
      if (target.platform === "youtube") {
        const audience = form.get(`audience-${channel}`);
        if (audience !== "kids" && audience !== "general") return fail("Choose the YouTube audience.");
        options = { madeForKids: audience === "kids", syntheticMedia: form.get(`synthetic-media-${channel}`) === "yes" };
      }
      if (target.platform === "instagram" && target.mime === "video/mp4" && destination !== "story") {
        options = { shareToFeed: form.get(`share-to-feed-${channel}`) !== "no" };
      }
      if (target.platform === "threads" || (target.platform === "instagram" && target.mime === "image/jpeg" && destination !== "story")) {
        const altText = String(form.get(`alt-${channel}`) ?? "").trim();
        if (altText.length > 500 || (altText && !target.mime)) return fail("Add media and keep the alt text within 500 characters.");
        if (altText) options = { ...options, altText };
      }
      if (target.platform === "threads") {
        const topic = String(form.get(`topic-${channel}`) ?? "").trim();
        const replyControl = String(form.get(`reply-control-${channel}`) ?? "");
        if (topic.length > 50 || (replyControl && !Object.hasOwn(threadsReplyControls, replyControl))) return fail("Check the Threads topic and reply settings.");
        if (topic || replyControl) options = { ...options, ...(topic ? { topic } : {}), ...(replyControl ? { replyControl } : {}) };
      }
      if (target.platform === "tiktok") {
        if (process.env.POSTQ_TIKTOK_DIRECT_POST !== "enabled") return fail("TikTok Direct Post is disabled for this deployment.");
        const creator = await getTikTokCreator(String(channel));
        const photos = target.mime === "image/jpeg";
        const duration = photos ? 0 : Number(JSON.parse(target.metadata??"null")?.duration);
        if (!creator?.options.includes(destination) || (!photos && !(duration > 0 && duration <= creator.maxDuration)) || photos && publicationTitle.length>90) {
          return fail("Check TikTok creator eligibility, video duration, and visibility before scheduling.");
        }
        if (form.get(`music-${channel}`) !== "yes") return fail("Confirm TikTok's music and disclosure terms before scheduling.");
        const allowComment = form.get(`comment-${channel}`) === "yes";
        const allowDuet = form.get(`duet-${channel}`) === "yes";
        const allowStitch = form.get(`stitch-${channel}`) === "yes";
        if ((allowComment && creator.disabled.comment) || (allowDuet && creator.disabled.duet) || (allowStitch && creator.disabled.stitch)) {
          return fail("TikTok interaction settings changed. Reload creator settings.");
        }
        const brandOrganic = form.get(`own-brand-${channel}`) === "yes";
        const brandContent = form.get(`paid-brand-${channel}`) === "yes";
        if (form.get(`commercial-${channel}`) === "yes" && !brandOrganic && !brandContent) return fail("Choose a TikTok commercial disclosure.");
        if (brandContent && !["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS"].includes(destination)) return fail("Choose public or friends visibility for TikTok branded content.");
        options = { allowComment, allowDuet:!photos && allowDuet, allowStitch:!photos && allowStitch, brandOrganic, brandContent, aiGenerated: form.get(`ai-${channel}`) === "yes", autoAddMusic:form.get(`auto-music-${channel}`)==="yes", duration: String(duration) };
      }
      const firstComment = String(form.get(`first-comment-${channel}`) ?? "").trim();
      if (firstComment) {
        if (target.platform === "youtube" && options?.madeForKids) return fail("YouTube disables comments on videos made for kids.");
        const length = target.platform === "threads" ? new TextEncoder().encode(firstComment).length : firstComment.length;
        if (length > (firstCommentLimits[target.platform] ?? 0)) return fail("Check the first comment limit for the selected platform.");
        options = { ...options, firstComment };
      }
      if (media && !["youtube","linkedin"].includes(target.platform) && (!process.env.BETTER_AUTH_URL?.startsWith("https://") || !process.env.BETTER_AUTH_SECRET)) {
        return fail("Media publishing requires an HTTPS PostQ deployment.");
      }
      const postId = String(form.get(`id-${channel}`) ?? "");
      if (!/^[a-f\d-]{36}$/i.test(postId)) return fail("Reopen the composer and try again.");
      deliveries.push({ id: postId, channel, title: publicationTitle, caption, media: media || null, mediaIds, destination: destination || null, platform: target.platform,
        options: options || tag ? JSON.stringify({ ...options, ...(tag ? { tag, tagColor } : {}) }) : null });
    }
    if (new Set(deliveries.map((post) => post.id)).size !== deliveries.length) return fail("Reopen the composer and try again.");
    const result = await db.prepare(
      `WITH requested AS (SELECT value AS post FROM json_each(?)), eligible AS (
         SELECT post, c.user_id, c.id AS channel_id FROM requested
         JOIN channels c ON c.id = json_extract(post, '$.channel') AND c.platform = json_extract(post, '$.platform')
         WHERE c.user_id = ? AND c.active = 1
         AND NOT EXISTS (SELECT 1 FROM publications WHERE id = json_extract(post, '$.id'))
         AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(post,'$.mediaIds')) a WHERE NOT EXISTS
           (SELECT 1 FROM media_assets WHERE id=a.value AND user_id=c.user_id))
       )
       INSERT INTO publications (id, user_id, channel_id, title, caption, due_at, status, media_id, destination, delivery_options,media_ids)
       SELECT json_extract(post, '$.id'), user_id, channel_id, json_extract(post, '$.title'), json_extract(post, '$.caption'), ?, 'scheduled',
         json_extract(post, '$.media'), json_extract(post, '$.destination'), json_extract(post, '$.options'),json_extract(post,'$.mediaIds')
       FROM eligible WHERE (SELECT count(*) FROM eligible) = (SELECT count(*) FROM requested)
       AND (? IS NULL OR EXISTS (SELECT 1 FROM drafts WHERE id=? AND user_id=? AND updated_at=?))
       AND (? IS NULL OR EXISTS (SELECT 1 FROM mcp_requests r JOIN mcp_tokens t ON t.id=r.token_id
         WHERE r.id=? AND r.user_id=? AND r.attempt=? AND r.state='approving' AND r.expires_at>?
           AND t.revoked_at IS NULL AND t.expires_at>?))`,
    ).bind(JSON.stringify(deliveries), user.id, due, expectedVersion || null, draftId, user.id, expectedVersion || null,
      form.get("mcpApproval") || null, form.get("mcpApproval") || null, user.id, form.get("mcpAttempt") || null, Date.now(), Date.now()).run();
    if (result.meta.changes !== deliveries.length) return fail("A selection changed or the posts were already queued.");
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/publishing");
  return { message: intent === "draft" ? "Draft saved." : intent === "now" ? "Post queued for immediate delivery." : "Post scheduled.", done: true };
}
