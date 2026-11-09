"use server";

import { generateText } from "ai";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { assistantModel } from "./model";
import { readCampaign } from "./proposal";
import { platforms, type CampaignPost } from "./chat-types";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDraft } from "@/features/drafts/repository";

type Campaign = Omit<CampaignPost, "id">;
type Result = { caption: string; error: string };

// The composer uses a focused one-shot helper; conversations use /api/chat.
export async function suggestCaption(_previous: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const brief = form.get("brief");
  if (typeof brief !== "string" || !brief.trim() || brief.length > 4000) return { caption: "", error: "Enter a brief up to 4,000 characters." };
  try {
    const model = await assistantModel(form.get("model"));
    if (!model) return { caption: "", error: "Add an AI provider and enable a model in Settings." };
    const db = await database();
    const window = Math.floor(Date.now() / 3_600_000);
    const claim = await db.prepare(`INSERT INTO assistant_usage(user_id,window,requests) VALUES (?,?,1)
      ON CONFLICT(user_id) DO UPDATE SET window=excluded.window,
      requests=CASE WHEN assistant_usage.window<excluded.window THEN 1 ELSE assistant_usage.requests+1 END
      WHERE assistant_usage.window<excluded.window OR (assistant_usage.window=excluded.window AND assistant_usage.requests<10)`)
      .bind(user.id, window).run();
    if (!claim.meta.changes) return { caption: "", error: "Hourly request limit reached. Try again later." };
    const result = await generateText({ model, system: "Write one social media caption from the brief. Return plain text only. Do not invent facts, metrics, or links.",
      prompt: brief.trim(), maxOutputTokens: 1000, maxRetries: 0, abortSignal: AbortSignal.timeout(25_000) });
    return result.text.trim() ? { caption: result.text.trim().slice(0, 9600), error: "" } : { caption: "", error: "The provider returned an empty caption." };
  } catch { return { caption: "", error: "The model could not respond. Check model access in Settings and try again." }; }
}
export async function saveCampaign(ids: string[], form: FormData) {
  const user = await requireUser();
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id))) redirect("/dashboard/assistant");
  const campaign = ids.map((id) => {
    const field = (name: string) => form.get(id + "-" + name);
    const variants = Object.fromEntries(platforms.map((platform) => [platform, field(platform)]));
    return readCampaign({ title: field("title"), caption: field("caption"), date: field("date"), time: field("time"), variants });
  });
  if (!campaign.every((post): post is Campaign => post !== null)) redirect("/dashboard/assistant");
  const db = await database();
  const drafts = campaign.map((post, index) => ({ ...post, id: ids[index], plan: JSON.stringify({ time: post.time, platforms: post.variants }) }));
  await db.prepare(`WITH requested AS (SELECT value AS post FROM json_each(?))
    INSERT INTO drafts (id, user_id, title, body, planned_on, updated_at, delivery_plan)
    SELECT json_extract(post, '$.id'), ?, json_extract(post, '$.title'), json_extract(post, '$.caption'),
      nullif(json_extract(post, '$.date'), ''), ?, json_extract(post, '$.plan')
    FROM requested WHERE NOT EXISTS (
      SELECT 1 FROM requested JOIN drafts ON drafts.id = json_extract(requested.post, '$.id')
    )`).bind(JSON.stringify(drafts), user.id, new Date().toISOString()).run();
  redirect("/dashboard?edit=" + ids[0] + "&compose=1");
}

export async function applyDraftRevision(draftId: string, updatedAt: string, postId: string, form: FormData) {
  const user = await requireUser();
  const draft = await getDraft(user.id, draftId);
  if (!draft || draft.updated_at !== updatedAt) redirect("/dashboard/assistant?revision=stale");
  const field = (name: string) => form.get(postId + "-" + name);
  const variants = Object.fromEntries(platforms.map((platform) => [platform, field(platform)]));
  const post = readCampaign({ title: field("title"), caption: field("caption"), date: field("date"), time: field("time"), variants });
  if (!post) redirect("/dashboard/assistant?revision=invalid");
  const plan = draft.delivery_plan ? JSON.parse(draft.delivery_plan) : {};
  const db = await database();
  const { results: channels } = await db.prepare("SELECT id, platform FROM channels WHERE user_id = ?")
    .bind(user.id).all<{ id: string; platform: string }>();
  const updatedVariants = { ...plan.variants };
  for (const channel of channels) {
    if (updatedVariants[channel.id] && Object.hasOwn(post.variants, channel.platform)) {
      updatedVariants[channel.id] = { ...updatedVariants[channel.id], caption: post.variants[channel.platform] };
    }
  }
  const result = await db.prepare(`UPDATE drafts SET title = ?, body = ?, planned_on = ?, delivery_plan = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND updated_at = ?`).bind(post.title, post.caption, post.date || draft.planned_on,
    JSON.stringify({ ...plan, ...(post.time ? { time: post.time } : {}), variants: updatedVariants, platforms: { ...plan.platforms, ...post.variants } }),
    new Date().toISOString(), draft.id, user.id, updatedAt).run();
  if (!result.meta.changes) redirect("/dashboard/assistant?revision=stale");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
  redirect("/dashboard?edit=" + draft.id + "&compose=1");
}
