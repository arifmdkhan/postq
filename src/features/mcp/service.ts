import { deliveryError, channelMediaTypes, firstCommentLimits, threadsReplyControls } from "../publishing/capabilities";
import { futureUtcMinute } from "../publishing/time";
import { hashToken, type MCPAccess } from "./access";
import { attachmentIds, type Attachment } from "../media/attachments";
import { attachmentError, mediaLimit, mediaPolicyLabel } from "../publishing/media-policy";

export type Target = { channelId: string; caption?: string; title?: string; mediaId?: string; mediaIds?:string[]; destination?: string; options?: Record<string, string> };
export type ScheduleInput = { requestKey: string; draftId: string; expectedUpdatedAt: string; dueAt: string; timezone: string; targets: Target[] };
export type ReviewPayload = {
  draftId?: string; expectedUpdatedAt?: string; title: string; dueAt: number; timezone?: string;
  fields?: [string, string][]; publicationIds?: string[];
  targets?: { name: string; platform: string; caption: string; title: string; mediaName: string | null; mediaId: string | null; mediaIds?:string[]; mediaNames?:string[]; destination: string; options: Record<string, string> }[];
  postId?: string; expectedDue?: number; caption?: string;
};
export type ReviewRequest = { id: string; user_id: string; token_id: string; kind: "schedule" | "reschedule" | "cancel"; payload: string; state: string; result: string | null; created_at: number; expires_at: number };
export const optionNames = ["link", "alt", "section", "topic", "reply-control", "audience", "share-to-feed", "synthetic-media", "duration", "music", "auto-music", "comment", "duet", "stitch", "own-brand", "paid-brand", "commercial", "ai", "first-comment"] as const;
export class MCPFailure extends Error {}

export function utcDue(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.000)?)?Z$/.test(value) ? futureUtcMinute(value.slice(0, 16)) : null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}

export class MCPService {
  constructor(readonly db: D1Database, readonly access: MCPAccess, readonly origin: string) {}
  require(scope: MCPAccess["scopes"][number]) {
    if (!this.access.scopes.includes(scope)) throw new MCPFailure("This access token does not allow that action.");
  }
  async listChannels() {
    this.require("read");
    const { results } = await this.db.prepare("SELECT id,platform,COALESCE(nullif(trim(label),''),nullif(trim(profile_name),''),platform) AS name,avatar_url,active FROM channels WHERE user_id=? ORDER BY platform,id")
      .bind(this.access.user_id).all();
    return { channels: results, publishingRules: { mediaTypes: channelMediaTypes, mediaLimits:Object.fromEntries(Object.keys(channelMediaTypes).map(platform=>[platform,{maxItems:mediaLimit(platform),rule:mediaPolicyLabel(platform)}])), firstCommentLimits, threadsReplyControls }, note: "Connection alone does not prove publishing permission. Final validation runs during approval." };
  }
  async listDrafts(offset = 0, query = "") {
    this.require("read");
    const { results } = await this.db.prepare("SELECT id,title,body,planned_on,tag,updated_at FROM drafts WHERE user_id=? AND (instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0) ORDER BY updated_at DESC,id LIMIT 25 OFFSET ?")
      .bind(this.access.user_id, query, query, offset).all();
    return { drafts: results, nextOffset: results.length === 25 ? offset + 25 : null };
  }
  async getDraft(id: string) {
    this.require("read");
    const draft = await this.db.prepare("SELECT id,title,body,planned_on,tag,updated_at,delivery_plan FROM drafts WHERE user_id=? AND id=?").bind(this.access.user_id, id)
      .first<{ id: string; title: string; body: string; updated_at: string; delivery_plan: string | null }>();
    if (!draft) throw new MCPFailure("Draft unavailable.");
    return draft;
  }
  async createDraft(input: { requestKey: string; title: string; caption: string }) {
    this.require("drafts:write");
    await this.db.prepare("INSERT INTO drafts(id,user_id,title,body,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .bind(input.requestKey, this.access.user_id, input.title, input.caption, new Date().toISOString()).run();
    const draft = await this.getDraft(input.requestKey);
    if (draft.title !== input.title || draft.body !== input.caption) throw new MCPFailure("That request key is already used. Use a new key for different content.");
    return { draft, reviewUrl: this.origin + "/dashboard?compose=1&edit=" + draft.id };
  }
  async updateDraft(input: { draftId: string; expectedUpdatedAt: string; title: string; caption: string }) {
    this.require("drafts:write");
    const changed = await this.db.prepare("UPDATE drafts SET title=?,body=?,updated_at=? WHERE id=? AND user_id=? AND updated_at=?")
      .bind(input.title, input.caption, new Date().toISOString(), input.draftId, this.access.user_id, input.expectedUpdatedAt).run();
    if (!changed.meta.changes) throw new MCPFailure("The draft changed or is unavailable. Fetch it again before editing.");
    return this.getDraft(input.draftId);
  }
  async listPosts(offset = 0, status?: string) {
    this.require("read");
    const { results } = await this.db.prepare(`SELECT p.id,p.title,p.caption,p.due_at,p.status,p.remote_post_id,c.platform,COALESCE(c.label,c.profile_name,c.platform) AS channel_name
      FROM publications p JOIN channels c ON c.id=p.channel_id AND c.user_id=p.user_id
      WHERE p.user_id=? AND (? IS NULL OR p.status=?) ORDER BY p.due_at DESC,p.id LIMIT 25 OFFSET ?`)
      .bind(this.access.user_id, status ?? null, status ?? null, offset).all();
    return { posts: results, nextOffset: results.length === 25 ? offset + 25 : null, dueAtUnit: "Unix milliseconds, UTC" };
  }
  async getPost(id: string) {
    this.require("read");
    const post = await this.db.prepare("SELECT id,title,caption,due_at,status,channel_id,media_id,media_ids,destination,remote_post_id,delivery_options FROM publications WHERE id=? AND user_id=?")
      .bind(id, this.access.user_id).first<{ id: string; title: string; caption: string; due_at: number; status: string }>();
    if (!post) throw new MCPFailure("Post unavailable.");
    const { results: metrics } = await this.db.prepare("SELECT name,value,captured_at FROM publication_metrics WHERE publication_id=? ORDER BY captured_at DESC LIMIT 100").bind(id).all();
    return { post, metrics, note: "Stored metric snapshots only. Missing values are unavailable, not zero." };
  }
  async listMedia(offset = 0) {
    this.require("read");
    const { results } = await this.db.prepare("SELECT id,name,mime,bytes,folder,tags,created_at FROM media_assets WHERE user_id=? ORDER BY created_at DESC,id LIMIT 25 OFFSET ?")
      .bind(this.access.user_id, offset).all();
    return { media: results, nextOffset: results.length === 25 ? offset + 25 : null };
  }
  async getChannel(id: string) {
    this.require("read");
    const channel = await this.db.prepare("SELECT id,platform,remote_id FROM channels WHERE user_id=? AND id=? AND active=1")
      .bind(this.access.user_id, id).first<{ id: string; platform: string; remote_id: string }>();
    if (!channel) throw new MCPFailure("Active account unavailable.");
    return channel;
  }
  async saveRequest(key: string, kind: ReviewRequest["kind"], input: unknown, payload: ReviewPayload) {
    this.require("schedule:request");
    const fingerprint = await hashToken(canonical({ kind, input }));
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.prepare(`INSERT INTO mcp_requests(id,user_id,token_id,request_key,fingerprint,kind,payload,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM mcp_tokens WHERE id=? AND revoked_at IS NULL AND expires_at>?)
      ON CONFLICT(token_id,request_key) DO NOTHING`).bind(id, this.access.user_id, this.access.id, key, fingerprint, kind, JSON.stringify(payload), now,
        Math.min(now + 3600000, this.access.expires_at), this.access.id, now).run();
    const row = await this.db.prepare("SELECT id,fingerprint,state FROM mcp_requests WHERE token_id=? AND request_key=? AND user_id=?")
      .bind(this.access.id, key, this.access.user_id).first<{ id: string; fingerprint: string; state: string }>();
    if (!row) throw new MCPFailure("Access expired or was revoked.");
    if (row.fingerprint !== fingerprint) throw new MCPFailure("This request key belongs to different content. Use a new request key.");
    return { requestId: row.id, state: row.state, reviewUrl: this.origin + "/dashboard/mcp-review?request=" + row.id,
      message: row.state === "pending" ? "Not executed. The workspace owner must open the review URL and approve this exact request in PostQ." : "This request was already handled or is processing. Use get_request_status to check its result." };
  }
  async prepareSchedule(input: ScheduleInput) {
    this.require("schedule:request");
    const due = utcDue(input.dueAt);
    if (due === null || !input.dueAt.endsWith("Z")) throw new MCPFailure("Use a real future UTC minute ending in Z, including the correct offset for the user's local time.");
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(new Date(due)); } catch { throw new MCPFailure("Choose a valid IANA timezone."); }
    const draft = await this.getDraft(input.draftId);
    if (draft.updated_at !== input.expectedUpdatedAt) throw new MCPFailure("Draft changed. Fetch it again before requesting approval.");
    if (!input.targets.length || input.targets.length > 10 || new Set(input.targets.map(({ channelId }) => channelId)).size !== input.targets.length) throw new MCPFailure("Choose one to ten distinct accounts.");
    const fields: [string, string][] = [["title", draft.title], ["caption", draft.body], ["date", new Date(due).toISOString().slice(0, 10)],
      ["time", new Date(due).toISOString().slice(11, 16)], ["offset", "0"], ["intent", "schedule"], ["expectedUpdatedAt", draft.updated_at]];
    const targets: NonNullable<ReviewPayload["targets"]> = [];
    const publicationIds: string[] = [];
    const plan=JSON.parse(draft.delivery_plan??"{}");
    for (const target of input.targets) {
      const channel = await this.db.prepare("SELECT platform,COALESCE(nullif(trim(label),''),nullif(trim(profile_name),''),platform) AS name FROM channels WHERE id=? AND user_id=? AND active=1")
        .bind(target.channelId, this.access.user_id).first<{ platform: string; name: string }>();
      if (!channel) throw new MCPFailure("Selected account is unavailable.");
      if(target.mediaId && target.mediaIds)throw new MCPFailure("Use mediaIds or the legacy mediaId, not both.");
      let ids:string[];
      const variant=plan.variants?.[target.channelId]??{};
      try{ids=attachmentIds(target.mediaIds??target.mediaId??variant.media??plan.media);}catch{throw new MCPFailure("Choose up to 35 distinct media IDs.");}
      const {results:found}=await this.db.prepare("SELECT id,name,mime FROM media_assets WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(this.access.user_id,JSON.stringify(ids)).all<Attachment>();
      if(found.length!==ids.length)throw new MCPFailure("Selected media is unavailable.");
      const assets=ids.map(id=>found.find(asset=>asset.id===id)!);
      const media=assets[0]??null;
      const caption = (target.caption ?? variant.caption ?? plan.platforms?.[channel.platform] ?? draft.body).trim();
      const destination = target.destination ?? variant.destination ?? "";
      const title=(target.title??variant.title??draft.title).trim()||draft.title;
      const defaults=Object.fromEntries([["link","link"],["altText","alt"],["section","section"],["topic","topic"],["replyControl","reply-control"],["audience","audience"],["shareToFeed","share-to-feed"],["syntheticMedia","synthetic-media"],["firstComment","first-comment"]]
        .filter(([field])=>typeof variant[field]==="string"&&variant[field]).map(([field,key])=>[key,variant[field] as string]));
      const options = {...defaults,...target.options};
      const mediaProblem=attachmentError(channel.platform,assets,destination,false);
      if(mediaProblem)throw new MCPFailure(mediaProblem);
      if (Object.keys(options).some((key) => !optionNames.includes(key as typeof optionNames[number]))) throw new MCPFailure("Unsupported platform option.");
      const problem = deliveryError(channel.platform, caption || options.link || "", media?.mime ?? null, destination);
      if (problem) throw new MCPFailure(problem);
      const publicationId = crypto.randomUUID();
      publicationIds.push(publicationId);
      fields.push(["channel", target.channelId], ["id-" + target.channelId, publicationId], ["caption-" + target.channelId, caption],
        ["media-" + target.channelId, JSON.stringify(ids)], ["destination-" + target.channelId, destination], ["title-" + target.channelId, title]);
      for (const [name, value] of Object.entries(options)) fields.push([name + "-" + target.channelId, value]);
      targets.push({ name: channel.name, platform: channel.platform, caption, title, mediaName: media?.name ?? null, mediaId: media?.id ?? null, mediaIds:ids,mediaNames:assets.map(asset=>asset.name),destination, options });
    }
    return this.saveRequest(input.requestKey, "schedule", input, { draftId: draft.id, expectedUpdatedAt: draft.updated_at, title: draft.title, dueAt: due, timezone: input.timezone, fields, targets, publicationIds });
  }
  async prepareChange(input: { requestKey: string; postId: string; expectedDueAt: number; dueAt?: string }, kind: "cancel" | "reschedule") {
    this.require("schedule:request");
    const { post } = await this.getPost(input.postId);
    if (post.status !== "scheduled" || post.due_at !== input.expectedDueAt) throw new MCPFailure("Post changed or is no longer queued. Fetch it again.");
    const due = kind === "reschedule" ? utcDue(input.dueAt) : post.due_at;
    if (due === null || (kind === "reschedule" && !input.dueAt?.endsWith("Z"))) throw new MCPFailure("Choose a future UTC minute ending in Z.");
    return this.saveRequest(input.requestKey, kind, input, { postId: post.id, title: post.title, caption: post.caption, expectedDue: post.due_at, dueAt: due });
  }
  async requestStatus(id: string) {
    this.require("read");
    const row = await this.db.prepare("SELECT id,kind,state,result,expires_at FROM mcp_requests WHERE id=? AND user_id=? AND token_id=?")
      .bind(id, this.access.user_id, this.access.id).first<Pick<ReviewRequest, "id" | "kind" | "state" | "result" | "expires_at">>();
    if (!row) throw new MCPFailure("Request unavailable.");
    return { ...row, state: row.state === "pending" && row.expires_at <= Date.now() ? "expired" : row.state, result: row.result ? JSON.parse(row.result) : null };
  }
}
