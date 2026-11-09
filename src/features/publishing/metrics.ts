import { executeSocialTool } from "./composio";

export async function providerMetrics(key: string, account: string, user: string, platform: string, id: string) {
  const execute = <T>(slug: string, args: object) => executeSocialTool<T>(key, account, user, slug, args);
  let counts: Record<string, unknown> = {};
  if (platform === "instagram" && /^\d+$/.test(id)) {
    const post = await execute<Record<string, number>>("INSTAGRAM_GET_IG_MEDIA", {
      ig_media_id: id, fields: "id,like_count,comments_count",
    });
    counts = { likes: post.like_count, comments: post.comments_count };
  } else if (platform === "facebook" && /^\d+_\d+$/.test(id)) {
    type Edge = { summary?: { total_count?: number } };
    const post = await execute<{ reactions?: Edge; comments?: Edge; shares?: { count?: number } }>("FACEBOOK_GET_POST", {
      post_id: id, fields: "id,reactions.summary(true),comments.summary(true),shares",
    });
    counts = { reactions: post.reactions?.summary?.total_count, comments: post.comments?.summary?.total_count, shares: post.shares?.count };
  } else if (platform === "youtube" && /^[\w-]{11}$/.test(id)) {
    const response = await execute<{ items?: { id: string; statistics?: Record<string, string> }[] }>("YOUTUBE_GET_VIDEO_DETAILS_BATCH", {
      id: [id], parts: ["statistics"],
    });
    const stats = response.items?.find((item) => item.id === id)?.statistics;
    counts = { views: stats?.viewCount, likes: stats?.likeCount, comments: stats?.commentCount };
  } else if (platform === "pinterest" && /^\d{1,32}$/.test(id)) {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    now.setUTCDate(now.getUTCDate() - 29);
    const result = await execute<{ analytics?: Record<string, { lifetime_metrics?: Record<string, number> }> }>("PINTEREST_GET_PIN_ANALYTICS", {
      pin_id: id, start_date: now.toISOString().slice(0, 10), end_date: end,
      metric_types: ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"],
    });
    const available = Object.values(result.analytics ?? {}).map((entry) => entry.lifetime_metrics).filter(Boolean);
    const stats = available.length === 1 ? available[0] : undefined;
    counts = { impressions: stats?.IMPRESSION, saves: stats?.SAVE, pin_clicks: stats?.PIN_CLICK, outbound_clicks: stats?.OUTBOUND_CLICK };
  } else if (platform === "tiktok" && /^\d+$/.test(id)) {
    const response = await execute<{ data?: { videos?: ({ id: string } & Record<string, number | string>)[] } }>("TIKTOK_QUERY_VIDEOS", {
      video_ids: [id],
    });
    const video = response.data?.videos?.find((item) => item.id === id);
    counts = { views: video?.view_count, likes: video?.like_count, comments: video?.comment_count, shares: video?.share_count };
  }
  return Object.entries(counts).flatMap(([name, raw]) => {
    const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [{ name, value }] : [];
  });
}
