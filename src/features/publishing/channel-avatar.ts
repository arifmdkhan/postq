import { runtimeConfiguration } from "@/features/settings/configuration";
import { composio, executeSocialTool } from "./composio";

export async function fetchChannelProfile(key: string, account: string, user: string, platform: string) {
  const get = async <T>(endpoint: string, query: Record<string, string> = {}) => {
    const response = await composio<{ status: number; data: T }>(key, "/tools/execute/proxy", {
      connected_account_id: account, user_id: user, endpoint, method: "GET",
      parameters: Object.entries(query).map(([name, value]) => ({ in: "query", name, value })),
    }, 6_000);
    return response.status === 200 ? response.data : null;
  };
  const execute = <T>(slug: string, args: object) => executeSocialTool<T>(key, account, user, slug, args, 6_000);
  let name: unknown;
  let photo: unknown;
  try {
    switch (platform) {
      case "instagram": {
        const profile = await execute<{ name?: string; username?: string; profile_picture_url?: string }>("INSTAGRAM_GET_USER_INFO", { fields: "name,username,profile_picture_url" });
        name = profile?.name || profile?.username;
        photo = profile?.profile_picture_url;
        break;
      }
      case "threads": {
        const profile = await get<{ name?: string; username?: string; threads_profile_picture_url?: string }>("https://graph.threads.net/v1.0/me", { fields: "name,username,threads_profile_picture_url" });
        name = profile?.name || profile?.username;
        photo = profile?.threads_profile_picture_url;
        break;
      }
      case "facebook": {
        const profile = await execute<{ name?: string; picture?: { data?: { url?: string } } }>("FACEBOOK_GET_CURRENT_USER", { fields: "name,picture" });
        name = profile?.name;
        photo = profile?.picture?.data?.url;
        break;
      }
      case "youtube": {
        const response = await execute<{ items?: { snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }[] }>("YOUTUBE_LIST_CHANNELS", { mine: true, part: "snippet" });
        const profile = response?.items?.[0]?.snippet;
        name = profile?.title;
        photo = profile?.thumbnails?.default?.url;
        break;
      }
      case "pinterest": {
        const profile = await get<{ username?: string; business_name?: string; profile_image?: string }>("https://api.pinterest.com/v5/user_account");
        name = profile?.business_name || profile?.username;
        photo = profile?.profile_image;
        break;
      }
      case "linkedin": {
        const profile = await get<{ name?: string; picture?: string }>("https://api.linkedin.com/v2/userinfo");
        name = profile?.name;
        photo = profile?.picture;
        break;
      }
      case "x": {
        const response = await get<{ data?: { name?: string; username?: string; profile_image_url?: string } }>("https://api.x.com/2/users/me", { "user.fields": "profile_image_url" });
        name = response?.data?.name || response?.data?.username;
        photo = response?.data?.profile_image_url;
        break;
      }
      case "tiktok": {
        const response = await executeSocialTool<{ data?: { creator_nickname?: string; creator_username?: string; creator_avatar_url?: string } }>(key, account, user, "TIKTOK_QUERY_CREATOR_INFO", {}, 6_000);
        name = response.data?.creator_nickname || response.data?.creator_username;
        photo = response.data?.creator_avatar_url;
        break;
      }
    }
  } catch {
    // A failed profile lookup must leave the connection usable.
  }
  const url = typeof photo === "string" && photo.length <= 4096 ? URL.parse(photo) : null;
  return {
    name: typeof name === "string" ? name.trim().slice(0, 160) || null : null,
    avatar: url?.protocol === "https:" && !url.username && !url.password ? url.href : null,
  };
}

export async function syncChannelProfiles<T extends { id: string; remote_id: string; platform: string; profile_name: string | null; avatar_url: string | null; profile_checked_at: number | null }>(
  db: D1Database, user: string, channels: T[],
) {
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  if (!key) return channels;
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60_000;
  return Promise.all(channels.map(async (channel) => {
    if ((channel.profile_checked_at ?? 0) > cutoff) return channel;
    const claim = await db.prepare("UPDATE channels SET profile_checked_at = ? WHERE id = ? AND user_id = ? AND active = 1 AND coalesce(profile_checked_at, 0) <= ?")
      .bind(now, channel.id, user, cutoff).run();
    if (!claim.meta.changes) return channel;
    const profile = await fetchChannelProfile(key, channel.remote_id, user, channel.platform);
    await db.prepare("UPDATE channels SET profile_name = coalesce(?, profile_name), avatar_url = coalesce(?, avatar_url) WHERE id = ? AND user_id = ? AND active = 1 AND profile_checked_at = ?")
      .bind(profile.name, profile.avatar, channel.id, user, now).run();
    return { ...channel, profile_name: profile.name ?? channel.profile_name, avatar_url: profile.avatar ?? channel.avatar_url };
  }));
}
