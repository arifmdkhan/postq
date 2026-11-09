"use server";
import { runtimeConfiguration } from "@/features/settings/configuration";


import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { connectablePlatforms } from "./platforms";
import { composio, ComposioRequestError, executeSocialTool, linkedinMember, listFacebookPages, listPinterestDestinations, tiktokCreator } from "./composio";
import { zonedMinuteToUtc } from "./timezone";
import { workspaceTimezone } from "@/features/settings/timezone";
import { resolveReviewedPublication } from "./review";
import { providerMetrics } from "./metrics";
import { deliveryError } from "./capabilities";
import { claimPublicationComment, commentLimit, sendPublicationComment } from "./comments";
import { validPostReceipt } from "./receipts";
import { attachmentIds, publicationMediaIds, type Attachment } from "../media/attachments";
import {attachmentError} from "./media-policy";

export async function addPublicationComment(id: string, form: FormData) {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  const body = String(form.get("comment") ?? "").trim();
  const finish = (state: string) => redirect(`/dashboard/publishing?post=${encodeURIComponent(id)}&comment=${state}#activity`);
  if (!key || !body || body.length > 2000) return finish("unavailable");
  const db = await database();
  const post = await db.prepare(`SELECT p.remote_post_id, c.remote_id, c.platform FROM publications p
    JOIN channels c ON c.id = p.channel_id AND c.user_id = p.user_id AND c.active = 1
    WHERE p.id = ? AND p.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL AND p.live_change IS NULL`)
    .bind(id, user.id).first<{ remote_post_id: string | null; remote_id: string; platform: string }>();
  if (!post?.remote_post_id || (post.platform === "threads" ? new TextEncoder().encode(body).length : body.length) >
      commentLimit(post.platform, post.remote_post_id)) return finish("unavailable");
  if (!await claimPublicationComment(db, user.id, id, post.remote_post_id, body)) return finish("duplicate");
  try {
    const receipt = await sendPublicationComment(key, post.remote_id, user.id, post.platform, post.remote_post_id, body);
    await db.prepare("UPDATE publication_comments SET remote_id = ?, state='confirmed' WHERE publication_id = ? AND body = ?")
      .bind(receipt, id, body).run();
  } catch {
    await db.prepare("UPDATE publication_comments SET state='uncertain' WHERE publication_id=? AND body=? AND state='sending'").bind(id, body).run();
    revalidatePath("/dashboard/publishing");
    return finish("review");
  }
  revalidatePath("/dashboard/publishing");
  return finish("posted");
}

export async function resolveComment(id: string, form: FormData) {
  const user = await requireUser();
  const body = String(form.get("body") ?? "");
  const outcome = form.get("outcome");
  const remoteId = String(form.get("remoteId") ?? "").trim();
  if (!["confirmed", "not-sent", "closed"].includes(String(outcome)) || (outcome === "confirmed" && (!remoteId || remoteId.length > 256 || /\s/.test(remoteId)))) return;
  const db = await database();
  await db.prepare(`UPDATE publication_comments SET state=?,remote_id=? WHERE publication_id=? AND body=?
    AND state IN ('sending','uncertain') AND created_at<?
    AND EXISTS (SELECT 1 FROM publications WHERE id=publication_comments.publication_id AND user_id=?)`)
    .bind(outcome, outcome === "confirmed" ? remoteId : null, id, body, Date.now() - 120000, user.id).run();
  revalidatePath("/dashboard/publishing");
}

export async function changeLivePublication(id: string, operation: "editing" | "deleting", form: FormData) {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  const url = `/dashboard/publishing?post=${encodeURIComponent(id)}`;
  const result = (state: string) => redirect(`${url}&live=${state}#activity`);
  if (!key || (operation !== "editing" && operation !== "deleting")) return result("unavailable");
  const db = await database();
  const post = await db.prepare(`SELECT p.caption, p.remote_post_id, p.destination, c.platform, c.remote_id
    FROM publications p JOIN channels c ON c.id = p.channel_id AND c.user_id = p.user_id AND c.active = 1
    WHERE p.id = ? AND p.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL AND p.live_change IS NULL`)
    .bind(id, user.id).first<{ caption: string; remote_post_id: string | null; destination: string | null; platform: string; remote_id: string }>();
  if (!post?.remote_post_id) return result("unavailable");
  const facebook = post.platform === "facebook" && /^\d+_\d+$/.test(post.remote_post_id) &&
    post.remote_post_id.split("_")[0] === post.destination;
  const threads = post.platform === "threads" && /^\d+$/.test(post.remote_post_id) && operation === "deleting";
  const pinterest = post.platform === "pinterest" && /^\d{1,32}$/.test(post.remote_post_id);
  const linkedin = post.platform === "linkedin" && /^urn:li:(share|ugcPost):\d+$/.test(post.remote_post_id) && operation === "deleting";
  const youtube = post.platform === "youtube" && /^[\w-]{11}$/.test(post.remote_post_id) && operation === "deleting";
  if (!facebook && !threads && !pinterest && !linkedin && !youtube) return result("unavailable");
  const message = String(form.get("caption") ?? "").trim();
  if (operation === "editing" && ((!message && !pinterest) || Array.from(message).length > (pinterest ? 800 : 10000) ||
      form.get("original") !== JSON.stringify(post.caption))) return result("unavailable");
  if (facebook) {
    try {
      const pages = await listFacebookPages(key, post.remote_id, user.id);
      if (!pages.some((page) => page.id === post.destination)) return result("unavailable");
    } catch {
      return result("unavailable");
    }
  }
  if (linkedin) {
    try {
      if (await linkedinMember(key, post.remote_id, user.id) !== post.destination) return result("unavailable");
    } catch {
      return result("unavailable");
    }
  }
  const startedAt = Date.now();
  const claimed = await db.prepare(`UPDATE publications SET live_change = ?, live_change_at = ?, live_change_caption = ?
    WHERE id = ? AND user_id = ? AND status = 'published' AND deleted_at IS NULL AND live_change IS NULL
      AND remote_post_id = ? AND caption = ?
      AND EXISTS (SELECT 1 FROM channels WHERE id = publications.channel_id AND user_id = publications.user_id AND active = 1)`)
    .bind(operation, startedAt, operation === "editing" ? message : null, id, user.id, post.remote_post_id, post.caption).run();
  if (!claimed.meta.changes) return result("unavailable");
  try {
    const editing = operation === "editing";
    const receipt = await executeSocialTool<{ success?: boolean; deleted_post_id?: string; deleted?: boolean; pin_id?: string; video_id?: string; http_status?: number; id?: string }>(
      key, post.remote_id, user.id,
      youtube ? "YOUTUBE_DELETE_VIDEO" : linkedin ? "LINKEDIN_DELETE_LINKED_IN_POST" : pinterest ? editing ? "PINTEREST_UPDATE_PIN" : "PINTEREST_DELETE_PIN"
        : threads ? "THREADS_DELETE_POST" : editing ? "FACEBOOK_UPDATE_POST" : "FACEBOOK_DELETE_POST",
      youtube ? { videoId: post.remote_post_id, confirmDelete: true } : linkedin ? { share_id: post.remote_post_id } : pinterest ? { pin_id: post.remote_post_id, ...(editing ? { description: message } : {}) }
        : { post_id: post.remote_post_id, ...(editing ? { message } : {}) });
    const confirmed = youtube ? receipt.deleted === true && receipt.http_status === 204 && receipt.video_id === post.remote_post_id
      : linkedin || (pinterest ? editing ? receipt.id === post.remote_post_id
      : receipt.deleted === true && receipt.pin_id === post.remote_post_id
      : receipt.success === true && (!threads || receipt.deleted_post_id === post.remote_post_id));
    if (!confirmed) throw new Error("Unconfirmed live change");
    await db.prepare(`UPDATE publications SET caption = ?, deleted_at = ?, live_change = NULL, live_change_at = NULL, live_change_caption = NULL
      WHERE id = ? AND user_id = ? AND live_change = ? AND live_change_at = ?`)
      .bind(operation === "editing" ? message : post.caption, operation === "deleting" ? Date.now() : null, id, user.id, operation, startedAt).run();
  } catch {
    revalidatePath("/dashboard/publishing");
    return result("review");
  }
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/calendar");
  return result(operation === "editing" ? "edited" : "deleted");
}

export async function resolveLivePublication(id: string, startedAt: number, form: FormData) {
  const user = await requireUser();
  const outcome = form.get("outcome");
  if (outcome !== "applied" && outcome !== "unchanged") return;
  const db = await database();
  const now = Date.now();
  const saved = await db.prepare(`UPDATE publications SET
    caption = CASE WHEN ? = 'applied' AND live_change = 'editing' THEN live_change_caption ELSE caption END,
    deleted_at = CASE WHEN ? = 'applied' AND live_change = 'deleting' THEN ? ELSE deleted_at END,
    live_change = NULL, live_change_at = NULL, live_change_caption = NULL
    WHERE id = ? AND user_id = ? AND status = 'published' AND live_change IS NOT NULL AND live_change_at = ? AND live_change_at <= ?`)
    .bind(outcome, outcome, now, id, user.id, startedAt, now - 120_000).run();
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/calendar");
  redirect(`/dashboard/publishing?post=${encodeURIComponent(id)}&live=${saved.meta.changes ? "resolved" : "review"}#activity`);
}

export async function openLivePublication(id: string) {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  const db = await database();
  const post = await db.prepare(`SELECT p.remote_post_id, c.remote_id, c.platform
    FROM publications p JOIN channels c ON c.id = p.channel_id AND c.user_id = p.user_id
    WHERE p.id = ? AND p.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL AND c.active = 1`)
    .bind(id, user.id).first<{ remote_post_id: string | null; remote_id: string; platform: string }>();
  let permalink: URL | null = null;
  if (key && post?.remote_post_id && /^\d{1,32}$/.test(post.remote_post_id)) {
    try {
      const threads = post.platform === "threads";
      if (threads || post.platform === "instagram") {
        const response = await executeSocialTool<{ permalink?: string }>(key, post.remote_id, user.id,
          threads ? "THREADS_GET_POST" : "INSTAGRAM_GET_IG_MEDIA",
          { [threads ? "post_id" : "ig_media_id"]: post.remote_post_id, fields: "permalink" }, 6_000);
        const candidate = response.permalink ? URL.parse(response.permalink) : null;
        const hosts = threads ? ["threads.com", "www.threads.com", "threads.net", "www.threads.net"] : ["instagram.com", "www.instagram.com"];
        if (candidate?.protocol === "https:" && !candidate.username && !candidate.password && !candidate.port && hosts.includes(candidate.hostname)) {
          permalink = candidate;
        }
      }
    } catch {
      // Leave the user in Publishing activity when the provider cannot resolve the link.
    }
  }
  redirect(permalink?.href ?? `/dashboard/publishing?post=${encodeURIComponent(id)}&live=link#activity`);
}

export async function editScheduledPublication(id: string, form: FormData) {
  const user = await requireUser();
  const db = await database();
  const url = `/dashboard/publishing?post=${encodeURIComponent(id)}`;
  const post = await db.prepare(`SELECT p.title, p.caption, p.destination, p.media_id, p.media_ids, p.delivery_options, m.mime, c.platform
    FROM publications p JOIN channels c ON c.id = p.channel_id AND c.user_id = p.user_id AND c.active = 1
    LEFT JOIN media_assets m ON m.id = p.media_id AND m.user_id = p.user_id
    WHERE p.id = ? AND p.user_id = ? AND p.status = 'scheduled'`)
    .bind(id, user.id).first<{ title: string; caption: string; destination: string | null; media_id: string | null; media_ids:string; mime: string | null; platform: string; delivery_options: string | null }>();
  if (!post || form.get("original") !== JSON.stringify([post.title, post.caption, post.media_id, post.destination, post.media_ids])) {
    redirect(`${url}&edit=stale#activity`);
  }
  const title = String(form.get("title") ?? "").trim();
  const caption = String(form.get("caption") ?? "").trim();
  const link = ["facebook", "linkedin"].includes(post.platform) ? JSON.parse(post.delivery_options ?? "{}").link as string | undefined : undefined;
  const destination = post.platform === "instagram" || post.platform === "youtube"
    ? String(form.get("destination") ?? post.destination ?? "") || null : post.destination;
  let ids:string[];
  try {ids=form.has("media")?attachmentIds(form.get("media")):publicationMediaIds(post);}catch{redirect(`${url}&edit=media#activity`);}
  const encoded=JSON.stringify(ids),mediaId=ids[0]??null;
  const mediaChanged=encoded!==JSON.stringify(publicationMediaIds(post));
  const {results:found}=await db.prepare("SELECT id,name,mime,metadata,bytes FROM media_assets WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(user.id,encoded).all<Attachment>();
  if(found.length!==ids.length || attachmentError(post.platform,ids.map(id=>found.find(asset=>asset.id===id)!),destination??""))redirect(`${url}&edit=media#activity`);
  const mime=found.find(asset=>asset.id===mediaId)?.mime??null;
  if((ids.length && link) || mediaChanged && post.platform==="tiktok" || mediaChanged && ids.length && !["youtube","linkedin"].includes(post.platform) && (!process.env.BETTER_AUTH_URL?.startsWith("https://") || !process.env.BETTER_AUTH_SECRET))redirect(`${url}&edit=media#activity`);
  if(!title || title.length>(post.platform==="tiktok"&&mime==="image/jpeg"?90:["youtube","pinterest"].includes(post.platform)?100:160) || caption.length>10000 || post.platform==="youtube" && /[<>]/.test(title+caption) || deliveryError(post.platform,caption||link||"",mime,destination??""))redirect(`${url}&edit=invalid#activity`);
  const saved=await db.prepare(`UPDATE publications SET title=?,caption=?,media_id=?,destination=?,media_ids=?
    WHERE id=? AND user_id=? AND status='scheduled' AND title=? AND caption=? AND media_id IS ? AND destination IS ? AND media_ids=?
    AND NOT EXISTS (SELECT 1 FROM json_each(?) a WHERE NOT EXISTS (SELECT 1 FROM media_assets WHERE id=a.value AND user_id=publications.user_id))
    AND EXISTS (SELECT 1 FROM channels WHERE id=publications.channel_id AND user_id=publications.user_id AND active=1)`)
    .bind(title,caption,mediaId,destination,encoded,id,user.id,post.title,post.caption,post.media_id,post.destination,post.media_ids,encoded).run();
  if (!saved.meta.changes) redirect(`${url}&edit=stale#activity`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/publishing");
  redirect(`${url}&edit=saved#activity`);
}

export async function connectChannel(platform: string) {
  const user = await requireUser();
  const { COMPOSIO_API_KEY, COMPOSIO_AUTH_CONFIG_THREADS, BETTER_AUTH_URL, COMPOSIO_AUTH_CONFIG_TIKTOK, COMPOSIO_AUTH_CONFIG_TWITTER } = await runtimeConfiguration();
  const custom = platform === "threads" ? COMPOSIO_AUTH_CONFIG_THREADS : platform === "tiktok"
    ? COMPOSIO_AUTH_CONFIG_TIKTOK : platform === "x" ? COMPOSIO_AUTH_CONFIG_TWITTER : null;
  if (!connectablePlatforms.includes(platform)) redirect("/dashboard/publishing?error=connect");
  if (!COMPOSIO_API_KEY || !BETTER_AUTH_URL || (["threads", "tiktok", "x"].includes(platform) && !custom)) redirect("/dashboard/publishing?error=config");

  const state = crypto.randomUUID();
  const callback = new URL("/api/channels/callback", BETTER_AUTH_URL);
  callback.searchParams.set("state", state);
  let target: URL;
  try {
    type ConnectLink = { connected_account_id?: string; redirect_url?: string };
    let link: ConnectLink;
    if (custom) {
      link = await composio<ConnectLink>(COMPOSIO_API_KEY, "/connected_accounts/link", {
        user_id: user.id, auth_config_id: custom, callback_url: callback.href,
      });
    } else {
      const session = await composio<{ session_id?: string }>(COMPOSIO_API_KEY, "/tool_router/session", {
        user_id: user.id, toolkits: { enable: [platform] },
      });
      if (!session.session_id || !/^trs_[a-z\d_-]+$/i.test(session.session_id)) throw new Error("Invalid Composio session");
      link = await composio<ConnectLink>(COMPOSIO_API_KEY, `/tool_router/session/${session.session_id}/link`, {
        toolkit: platform, callback_url: callback.href,
      });
    }
    target = new URL(link.redirect_url ?? "");
    if (target.protocol !== "https:" || target.username || target.password ||
        !/^ca_[a-z\d_-]+$/i.test(link.connected_account_id ?? "")) throw new Error("Invalid connection link");
    const db = await database();
    await db.prepare("DELETE FROM channels WHERE user_id = ? AND active = 0 AND expires_at <= ? AND NOT EXISTS (SELECT 1 FROM publications WHERE channel_id = channels.id)")
      .bind(user.id, Date.now()).run();
    const saved = await db.prepare(
      `INSERT INTO channels (id, user_id, remote_id, state, expires_at, platform) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(remote_id) DO UPDATE SET state = excluded.state, expires_at = excluded.expires_at
       WHERE channels.user_id = excluded.user_id AND channels.active = 0 AND channels.platform = excluded.platform`,
    )
      .bind(crypto.randomUUID(), user.id, link.connected_account_id, state, Date.now() + 30 * 60_000, platform).run();
    if (!saved.meta.changes) throw new Error("Connection already active");
  } catch (error) {
    if (error instanceof ComposioRequestError && error.status === 401) {
      redirect("/dashboard/publishing?error=credentials");
    }
    redirect("/dashboard/publishing?error=connect");
  }
  redirect(target.href);
}

export async function getTikTokCreator(channelId: string) {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  if (!key || typeof channelId !== "string") return null;
  const db = await database();
  const account = await db.prepare("SELECT remote_id FROM channels WHERE id = ? AND user_id = ? AND platform = 'tiktok' AND active = 1")
    .bind(channelId, user.id).first<string>("remote_id");
  if (!account) return null;
  try {
    return await tiktokCreator(key, account, user.id);
  } catch {
    return null;
  }
}

export async function getFacebookPages(channelId: string) {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  if (!key || typeof channelId !== "string") return null;
  const db = await database();
  const account = await db.prepare("SELECT remote_id FROM channels WHERE id = ? AND user_id = ? AND platform = 'facebook' AND active = 1")
    .bind(channelId, user.id).first<string>("remote_id");
  if (!account) return null;
  try {
    return await listFacebookPages(key, account, user.id);
  } catch {
    return null;
  }
}

export async function getPinterestDestinations(channelId: string, board?: string) {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  if (!key || typeof channelId !== "string" || (board !== undefined && (typeof board !== "string" || !/^\d{1,32}$/.test(board)))) return null;
  const db = await database();
  const account = await db.prepare("SELECT remote_id FROM channels WHERE id = ? AND user_id = ? AND platform = 'pinterest' AND active = 1")
    .bind(channelId, user.id).first<string>("remote_id");
  if (!account) return null;
  try {
    return await listPinterestDestinations(key, account, user.id, board);
  } catch {
    return null;
  }
}

export async function renameChannel(id: string, form: FormData) {
  const user = await requireUser();
  const label = String(form.get("label") ?? "").trim();
  if (label.length > 80) redirect("/dashboard/publishing?error=label");
  const db = await database();
  await db.prepare("UPDATE channels SET label = ? WHERE id = ? AND user_id = ? AND active = 1").bind(label || null, id, user.id).run();
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/publishing?channel-updated=1");
}

export async function cancelPublication(id: string) {
  const user = await requireUser();
  if (typeof id !== "string" || id.length !== 36) return;
  const db = await database();
  await db.prepare("UPDATE publications SET status = 'cancelled' WHERE user_id = ? AND id = ? AND status = 'scheduled'")
    .bind(user.id, id).run();
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/calendar");
}

export async function reschedulePublication(id: string, form: FormData) {
  const user = await requireUser();
  const due = zonedMinuteToUtc(form.get("due"), await workspaceTimezone(), Date.now());
  if (due === null) {
    redirect("/dashboard/publishing?error=schedule-time#activity");
  }
  const db = await database();
  const result = await db.prepare(
    `UPDATE publications SET due_at = ?
     WHERE id = ? AND user_id = ? AND status = 'scheduled'
       AND EXISTS (SELECT 1 FROM channels WHERE id = publications.channel_id AND user_id = publications.user_id AND active = 1)`,
  ).bind(due, id, user.id).run();
  if (!result.meta.changes) redirect("/dashboard/publishing?error=reschedule#activity");
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/calendar");
  redirect("/dashboard/publishing?rescheduled=1#activity");
}

export async function resolvePublication(id: string, form: FormData) {
  const user = await requireUser();
  const outcome = form.get("outcome");
  const value = form.get("remoteId");
  const remoteId = typeof value === "string" ? value.trim() : "";
  const db = await database();
  const platform = await db.prepare("SELECT c.platform FROM publications p JOIN channels c ON c.id=p.channel_id WHERE p.id=? AND p.user_id=?")
    .bind(id, user.id).first<string>("platform");
  if (!platform || (outcome !== "discard" && (outcome !== "published" || !validPostReceipt(platform, remoteId)))) {
    redirect("/dashboard/publishing?review=invalid#activity");
  }
  const resolved = await resolveReviewedPublication(db, user.id, id, outcome === "published" ? remoteId : null);
  if (!resolved) redirect("/dashboard/publishing?review=stale#activity");
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/analytics");
  redirect("/dashboard/publishing?review=resolved#activity");
}

export async function disconnectChannel(id: string) {
  const user = await requireUser();
  if (typeof id !== "string" || id.length !== 36) return;
  const db = await database();
  const [result] = await db.batch([
    db.prepare(
      `UPDATE channels SET active = 0 WHERE user_id = ? AND id = ? AND active = 1
       AND NOT EXISTS (SELECT 1 FROM publications WHERE channel_id = channels.id AND status = 'sending')`,
    ).bind(user.id, id),
    db.prepare(
      `UPDATE publications SET status = 'cancelled' WHERE user_id = ? AND channel_id = ? AND status = 'scheduled'
       AND EXISTS (SELECT 1 FROM channels WHERE id = publications.channel_id AND user_id = publications.user_id AND active = 0)`,
    ).bind(user.id, id),
  ]);
  if (!result.meta.changes) redirect("/dashboard/publishing?error=disconnect");
  revalidatePath("/dashboard/publishing");
  revalidatePath("/dashboard/calendar");
  redirect("/dashboard/publishing");
}

type Insights = { metrics: { name: string; value: number }[]; error: string };

export async function getInsights(id: string): Promise<Insights> {
  const user = await requireUser();
  const key = (await runtimeConfiguration()).COMPOSIO_API_KEY;
  if (!key || typeof id !== "string" || id.length !== 36) return { metrics: [], error: "Insights unavailable." };
  const db = await database();
  const post = await db.prepare(
    `SELECT p.remote_post_id, c.remote_id, c.platform FROM publications p JOIN channels c ON p.channel_id = c.id
     WHERE p.id = ? AND p.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL AND c.active = 1`,
  ).bind(id, user.id).first<{ remote_post_id: string | null; remote_id: string; platform: string }>();
  if (!post?.remote_post_id || !validPostReceipt(post.platform, post.remote_post_id)) return { metrics: [], error: "Insights unavailable for this post." };
  if (post.platform === "linkedin") return { metrics: [], error: "LinkedIn analytics is not supported by this connection. View metrics on LinkedIn." };

  const names = ["views", "likes", "replies", "reposts", "quotes"];
  try {
    const metrics = post.platform === "threads" && /^\d+$/.test(post.remote_post_id)
      ? await threadsMetrics(key, post.remote_id, user.id, post.remote_post_id, names)
      : await providerMetrics(key, post.remote_id, user.id, post.platform, post.remote_post_id);
    if (metrics.length) {
      const capturedAt = Date.now();
      await db.batch(metrics.map(({ name, value }) => db.prepare(
        "INSERT INTO publication_metrics (publication_id, captured_at, name, value) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      ).bind(id, capturedAt, name, value)));
      revalidatePath("/dashboard/analytics");
    }
    return { metrics, error: metrics.length ? "" : "The provider returned no insights yet." };
  } catch {
    return { metrics: [], error: "Could not load insights. Check the account’s permissions and try again." };
  }
}

async function threadsMetrics(key: string, account: string, userId: string, postId: string, names: string[]) {
    const result = await composio<{
      status: number;
      data?: { data?: { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[] };
    }>(key, "/tools/execute/proxy", {
      connected_account_id: account,
      user_id: userId,
      endpoint: `https://graph.threads.net/v1.0/${postId}/insights`,
      method: "GET",
      parameters: [{ in: "query", name: "metric", value: names.join(",") }],
    });
    if (result.status !== 200 || !Array.isArray(result.data?.data)) throw new Error("Insights unavailable");
    return result.data.data.flatMap((item) => {
      const value = item.total_value?.value ?? item.values?.[0]?.value;
      return item.name && names.includes(item.name) && typeof value === "number" && Number.isFinite(value)
        ? [{ name: item.name, value }] : [];
    });
}
