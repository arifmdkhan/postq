"use client";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { FieldSet, FieldLegend } from "@/components/ui/field";
import { FieldSelect } from "@/components/field-select";
import { BrandMark } from "@/components/brand-mark";
import { Checkbox } from "@/components/ui/checkbox";
import { MediaSelection } from "@/features/media/selection";
import { AttachmentPreview } from "@/features/media/preview";
import { attachmentIds, type Attachment } from "@/features/media/attachments";
import { attachmentError, mediaLimit, mediaPolicyLabel } from "@/features/publishing/media-policy";

import Link from "next/link";
import Image from "next/image";
import { CalendarDays, Plus, Sparkles, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { composePost } from "./actions";
import type { Draft } from "@/features/drafts/repository";
import { getFacebookPages, getPinterestDestinations, getTikTokCreator } from "@/features/publishing/actions";
import { channelMediaTypes, firstCommentLimits, mediaFormatLabel, threadsReplyControls, tiktokPrivacy } from "@/features/publishing/capabilities";
import { uploadMediaFile } from "@/features/media/upload";
import { DatePicker, TimePicker } from "@/components/date-time-picker";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { suggestCaption } from "@/features/assistant/actions";
import { maxBytes, mediaTypes } from "@/features/media/formats";
import { calendarComposeEvent } from "./calendar-button";
import { zonedMinute, zonedMinuteToUtc } from "@/features/publishing/timezone";
import { PlatformPreview } from "./platform-preview";

type Channel = { avatar_url: string | null; id: string; platform: string; label: string | null };
type Options = { channels: Channel[]; connectedOnly: Channel[]; media: { id: string; name: string; mime: string }[]; draft: Draft | null; date?: string; name: string; timezone: string };
type Variant = { caption?: string; title?: string; media?: string[]; destination: string; audience?: string; shareToFeed?: string; syntheticMedia?: string; link?: string; altText?: string; section?: string; topic?: string; replyControl?: string; firstComment?: string };
type Plan = { time?: string; tagColor?: string; media?: string[]; variants?: Record<string, Variant>; platforms?: Record<string, string> };
const quickTags = ["trending", "ai", "tech", "innovation", "growth", "viral", "creators"];
const tagColors = { Meme: "#f59e0b", Promo: "#10b981", Launch: "#7c3aed", "Case Study": "#0891b2", BTS: "#ec4899", Announce: "#3b82f6" };

export function Composer({ channels, connectedOnly, media, draft, date, compact, name, timezone, calendar, openInitially, hideTrigger, onClosed }: Options & {
  compact: boolean; calendar: boolean; openInitially: boolean; hideTrigger?: boolean; onClosed?: () => void;
}) {
  const [draftId, setDraftId] = useState<string | null>(openInitially ? draft?.id ?? crypto.randomUUID() : null);
  const [calendarDate, setCalendarDate] = useState<string>();
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  function close(message?: string) {
    if (!message && (busy || (dirty && !window.confirm("Discard this unsaved composition?")))) return;
    if (message) setNotice(message);
    setDirty(false);
    setDraftId(null);
    onClosed?.();
  }
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      if (busy || !window.confirm("Leave and discard this unsaved composition?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, busy]);
  useEffect(() => {
    if (!calendar) return;
    const open = (event: Event) => {
      setCalendarDate((event as CustomEvent<string>).detail);
      setNotice("");
      setDraftId(crypto.randomUUID());
    };
    window.addEventListener(calendarComposeEvent, open);
    return () => window.removeEventListener(calendarComposeEvent, open);
  }, [calendar]);

  return (
    <Dialog open={Boolean(draftId)} onOpenChange={(open) => {
      if (!open) { close(); return; }
      if (open) { setNotice(""); setCalendarDate(undefined); }
      setDraftId(open ? crypto.randomUUID() : null);
    }}>
      {!hideTrigger && <DialogTrigger render={<Button type="button" size={compact ? "icon-sm" : "default"} variant={compact ? "outline" : "default"}
        aria-label={compact ? "Create draft on selected day" : undefined} />}>
        <Plus data-icon="inline-start" />{!compact && (draft ? "Edit and schedule draft" : "Create post")}
      </DialogTrigger>}
      <span role="status" className={notice ? "text-sm text-muted-foreground" : "sr-only"}>{notice}</span>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-hidden p-0 sm:max-w-[70rem]">
        {draftId && <ComposerForm key={draftId} id={draftId} date={calendarDate ?? date} channels={channels} connectedOnly={connectedOnly} media={media} draft={draft} name={name} timezone={timezone}
          onDirty={setDirty} onBusy={setBusy} close={close} />}
      </DialogContent>
    </Dialog>
  );
}

function ComposerForm({ id, date, channels, connectedOnly, media, draft, name, timezone, close, onDirty, onBusy }: Options & {
  id: string; close: (message?: string) => void; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const [title, setTitle] = useState(draft?.title ?? "");
  const [scheduledDate, setScheduledDate] = useState(draft?.planned_on ?? date ?? "");
  const [plan] = useState<Plan>(() => draft?.delivery_plan ? JSON.parse(draft.delivery_plan) : {});
  const [time, setTime] = useState(plan.time ?? "");
  const [caption, setCaption] = useState(draft?.body ?? "");
  const [hashtags, setHashtags] = useState("");
  const [target, setTarget] = useState("");
  const [previewTarget, setPreviewTarget] = useState("");
  const [sharedMedia, setSharedMedia] = useState<string[]>(()=>attachmentIds(plan.media));
  const [tag, setTag] = useState(draft?.tag ?? "");
  const [tagColor, setTagColor] = useState(plan.tagColor ?? "#7c3aed");
  const [customTag, setCustomTag] = useState(Boolean(draft?.tag && !Object.hasOwn(tagColors, draft.tag)));
  const [mode, setMode] = useState<"now" | "schedule">("schedule");
  const [aiOpen, setAiOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [variants, setVariants] = useState<Record<string, Variant & { id: string }>>(() => Object.fromEntries(
    channels.flatMap(({ id }) => plan.variants?.[id] ? [[id, { ...plan.variants[id], ...(plan.variants[id].media!==undefined?{media:attachmentIds(plan.variants[id].media)}:{}), id: crypto.randomUUID() }]] : []),
  ));
  const [approved, setApproved] = useState(false);
  const [creators, setCreators] = useState<Record<string, Awaited<ReturnType<typeof getTikTokCreator>>>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [uploaded, setUploaded] = useState<Options["media"]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const snapshot = JSON.stringify({ title, caption, scheduledDate, time, hashtags, sharedMedia, tag, tagColor, variants });
  const [initialSnapshot] = useState(snapshot);
  useEffect(() => { onDirty(snapshot !== initialSnapshot); }, [snapshot, initialSnapshot, onDirty]);
  const assets = [...uploaded, ...media.filter((asset) => !uploaded.some(({ id }) => id === asset.id))];
  const remember=(asset:Attachment)=>setUploaded(current=>[...current.filter(item=>item.id!==asset.id),asset]);
  const baseCaption = [caption.trim(), hashtags.trim()].filter(Boolean).join("\n\n");
  const selectedChannels = channels.filter(({ id }) => variants[id]);
  const mediaProblems=selectedChannels.flatMap(channel=>{
    const ids=variants[channel.id].media??sharedMedia;
    const problem=ids.some(id=>!assets.some(asset=>asset.id===id))?"A selected attachment is unavailable. Remove it or choose another file.":attachmentError(channel.platform,ids.flatMap(id=>assets.find(asset=>asset.id===id)??[]),variants[channel.id].destination,false);
    return problem?[problem]:[];
  });
  const previewChannel = selectedChannels.find(({ id }) => id === previewTarget) ??
    selectedChannels.find(({ id }) => id === target) ?? selectedChannels[0];
  const preview = previewChannel ? variants[previewChannel.id] : undefined;
  const previewAssets=(preview?.media??sharedMedia).flatMap(id=>assets.find(asset=>asset.id===id)??[]);
  const [copyStatus, setCopyStatus] = useState("");
  const samplePreview = !draft && !title.trim() && !baseCaption && !sharedMedia.length &&
    !Object.values(variants).some((variant) => variant.caption?.trim() || variant.media?.length);
  const previewTabs = selectedChannels.length ? selectedChannels
    : samplePreview ? [{ id: "threads", platform: "threads", label: "Threads" }, { id: "instagram", platform: "instagram", label: "Instagram" }] : [];
  const activePreviewTab = previewChannel?.id ?? (previewTarget === "instagram" ? "instagram" : "threads");
  const previewName = samplePreview ? "Studio North" : previewChannel?.label || name || "Your studio";
  const previewPlatform = previewChannel?.platform ?? (samplePreview ? activePreviewTab : "threads");
  const previewMedia = samplePreview
    ? <Image src="/studio-poppy.webp" width={560} height={390} alt="Orange poppy in the sample post" unoptimized className="aspect-[1.43] w-full object-cover" />
    : previewAssets.length ? <AttachmentPreview assets={previewAssets} />
      : ["instagram", "youtube", "tiktok", "pinterest", "linkedin"].includes(previewPlatform)
        ? <div className="grid aspect-video place-items-center bg-muted text-sm text-muted-foreground">Your attachments will appear here.</div> : null;
  const activeCaption = target ? variants[target]?.caption ?? baseCaption : caption;
  const targetPlatform = selectedChannels.find(({ id }) => id === target)?.platform;
  const photoCaption=targetPlatform==="tiktok" && (variants[target]?.media??sharedMedia).some(id=>assets.find(asset=>asset.id===id)?.mime==="image/jpeg");
  const captionCount = targetPlatform === "threads"
    ? `${new TextEncoder().encode(activeCaption.trim()).length} / 500 bytes`
    : `${activeCaption.length.toLocaleString()} / ${({ instagram: 2200, tiktok: photoCaption?4000:2200, youtube: 5000, pinterest: 800 } as Record<string, number>)[targetPlatform ?? ""] ?? (target ? 10000 : 9600)} characters`;
  function updateCaption(value: string) {
    setApproved(false);
    if (!target) setCaption(value);
    else setVariants((current) => current[target] ? { ...current, [target]: { ...current[target], caption: value } } : current);
  }
  async function writeCaption() {
    setAiBusy(true);
    setAiError("");
    try {
      const form = new FormData();
      form.set("brief", brief);
      const result = await suggestCaption({ caption: "", error: "" }, form);
      if (result.error) setAiError(result.error);
      else { updateCaption(result.caption.slice(0, target ? 10000 : 9600)); setAiOpen(false); }
    } catch { setAiError("Could not write a caption. Try again."); }
    finally { setAiBusy(false); }
  }
  async function attach(channelId: string, allowed: readonly string[], load: () => Promise<File>) {
    setApproved(false);
    setUploading(channelId);
    setUploadErrors((current) => ({ ...current, [channelId]: "" }));
    try {
      const currentIds=channelId==="shared"?sharedMedia:variants[channelId]?.media??sharedMedia;
      const platform=channels.find(channel=>channel.id===channelId)?.platform;
      if(currentIds.length>=(platform?mediaLimit(platform,variants[channelId]?.destination):35))throw new Error("Remove an attachment before adding another.");
      const added = await uploadMediaFile(await load(), "", allowed);
      setUploaded((current) => [added, ...current]);
      if (channelId === "shared") setSharedMedia(current=>[...current,added.id]);
      else setVariants((current) => current[channelId] ? { ...current, [channelId]: { ...current[channelId], media: [...currentIds,added.id] } } : current);
    } catch (error) {
      setUploadErrors((current) => ({ ...current, [channelId]: error instanceof Error ? error.message : "Upload failed." }));
    } finally { setUploading(null); }
  }
  const utcMinute = zonedMinuteToUtc(scheduledDate + "T" + time, timezone);
  const local = new Date(utcMinute ?? NaN);
  const validLocalTime = utcMinute !== null;
  const [openedAt] = useState(() => Date.now());
  const [now, setNow] = useState(openedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const earliest = new Date(Math.floor(now / 60_000) * 60_000 + 60_000);
  const today = zonedMinute(now, timezone).slice(0,10);
  const minimumTime = scheduledDate === today
    ? zonedMinute(earliest.valueOf(), timezone).slice(0,10) !== today ? "23:59" : zonedMinute(earliest.valueOf(), timezone).slice(11,16)
    : undefined;
  const futureSchedule = validLocalTime && local.getTime() > now;
  const [state, action, pending] = useActionState(composePost.bind(null, id, draft?.id ?? null), { message: "", done: false });
  useEffect(() => { onBusy(pending || uploading !== null || aiBusy); }, [pending, uploading, aiBusy, onBusy]);
  useEffect(() => { if (state.done) close(state.message); }, [state, close]);
  return (
    <form action={action} className="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col"
      onChange={(event) => { if (event.target.getAttribute("name") !== "approved") setApproved(false); }}>
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="offset" value={validLocalTime ? (local.getTime() - Date.parse(scheduledDate + "T" + time + ":00Z")) / 60000 : ""} />
      <input type="hidden" name="expectedUpdatedAt" value={draft?.updated_at ?? ""} />
      <input type="hidden" name="approvedIntent" value={approved ? mode : ""} />
      <input type="hidden" name="caption" value={caption} />
      <input type="hidden" name="sharedMedia" value={JSON.stringify(sharedMedia)} />
      <input type="hidden" name="tag" value={tag} />
      <input type="hidden" name="tagColor" value={tag ? tagColor : ""} />
      <header className="flex items-center gap-2 border-b px-4 py-3 sm:gap-3 sm:px-7 sm:py-4">
        <BrandMark className="size-9 sm:size-11" />
        <div className="min-w-0 flex-1"><DialogTitle className="text-lg font-bold sm:text-xl">{draft ? "Edit draft" : "Compose post"}</DialogTitle><DialogDescription>Preview each account before delivery.</DialogDescription></div>
        <Button type="button" variant="outline" aria-label="Write with AI" aria-expanded={aiOpen} onClick={() => setAiOpen(!aiOpen)}><Sparkles /><span className="hidden sm:inline">Write with AI</span></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Close composer" onClick={() => close()}><X /></Button>
      </header>
      <div className="grid min-h-0 overflow-y-auto md:grid-cols-[1.35fr_1fr] md:overflow-hidden">
        <div className="grid min-w-0 auto-rows-max content-start gap-5 p-4 sm:p-6 md:overflow-y-auto">
          <FieldSet className="min-w-0 text-sm">
            <FieldLegend className="mb-2 font-semibold">1. Publish to</FieldLegend>
            <div className="flex flex-wrap items-center gap-2">
              {channels.map(({ id: channelId, platform, label, avatar_url }) => {
                const account = label || platform;
                const initials = account.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();
                return <Label key={channelId} title={`${account} · ${platform}`} className="relative cursor-pointer has-data-disabled:cursor-not-allowed">
                  <Checkbox className="peer sr-only" name="channel" value={channelId} aria-label={`${account} (${platform})`} checked={Boolean(variants[channelId])} disabled={uploading !== null || pending} onCheckedChange={(selected) => {
                    setApproved(false);
                    const variant = { id: crypto.randomUUID(), caption: plan.platforms?.[platform], destination: "" };
                    if (!selected && target === channelId) setTarget("");
                    setVariants((current) => {
                      const next = { ...current };
                      if (selected) next[channelId] = variant;
                      else delete next[channelId];
                      return next;
                    });
                  }} />
                  <span aria-hidden className="relative grid size-11 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted peer-data-checked:border-primary peer-data-checked:bg-accent peer-data-checked:text-accent-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-data-disabled:opacity-50">
                    <Avatar className="size-8">{avatar_url && <AvatarImage src={avatar_url} alt="" referrerPolicy="no-referrer" />}<AvatarFallback className="bg-current/10 text-xs font-semibold text-current">{initials}</AvatarFallback></Avatar>
                    <span className="absolute -right-0.5 -bottom-0.5 grid size-4.5 place-items-center rounded-full bg-white ring-2 ring-background">
                      <Image src={`/social/${platform}.svg`} width={12} height={12} alt="" unoptimized />
                    </span>
                  </span>
                </Label>;
              })}
              <Link href="/dashboard/publishing" aria-label="Connect account" title="Connect account" className={buttonVariants({ variant: "outline", size: "icon", className: "size-11 rounded-full" })}><Plus /></Link>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{channels.length ? `${Object.keys(variants).length} selected` : "Connect a publishing-enabled account to publish from PostQ."}</p>
            {connectedOnly.length > 0 && <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Connected without publishing access</p>
              <ul className="flex flex-wrap gap-2">
                {connectedOnly.map(({ id, platform, label, avatar_url }) => <li key={id} className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5 text-xs">
                  <Avatar size="sm">{avatar_url && <AvatarImage src={avatar_url} alt="" referrerPolicy="no-referrer" />}<AvatarFallback><Image src={`/social/${platform}.svg`} width={16} height={16} alt="" unoptimized /></AvatarFallback></Avatar>
                  <span className="break-all font-medium capitalize">{label || platform}</span>
                  <span className="text-muted-foreground">{platform === "tiktok" ? "Direct Post disabled" : "Connection only"}</span>
                </li>)}
              </ul>
            </div>}
          </FieldSet>
          {selectedChannels.length > 0 && <FieldSet className="grid gap-2 rounded-xl border bg-card p-3">
            <FieldLegend className="px-1 text-sm font-semibold">Target content</FieldLegend>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={target === "" ? "default" : "outline"} aria-pressed={!target} onClick={() => setTarget("")}>All accounts</Button>
              {selectedChannels.map((channel) => <Button key={channel.id} type="button" size="sm" variant={target === channel.id ? "default" : "outline"}
                aria-pressed={target === channel.id} onClick={() => { setTarget(channel.id); setPreviewTarget(channel.id); }}>
                <Image src={`/social/${channel.platform}.svg`} width={14} height={14} alt={channel.platform} className="shrink-0 rounded-sm bg-white" unoptimized />
                {channel.label || channel.platform}
              </Button>)}
            </div>
            <p className="text-xs text-muted-foreground">{target ? "Changes apply to this account." : "Accounts without a custom caption use the shared caption and hashtags."}</p>
          </FieldSet>}
          {targetPlatform === "youtube"
            ? <><input type="hidden" name="title" value={title || variants[target]?.title || ""} />
              <Label className="grid gap-2 text-sm font-semibold">2. Video title<Input maxLength={100} value={variants[target]?.title ?? title} onChange={(event) => {
                const value = event.target.value;
                setVariants((current) => ({ ...current, [target]: { ...current[target], title: value } }));
              }} placeholder="Title shown on YouTube" /></Label></>
            : <Label className="grid gap-2 text-sm font-semibold">2. Post title<Input name="title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give your post a title" /></Label>}
          <Label className="grid gap-2 text-sm font-medium">
            <span className="flex justify-between gap-2"><strong>3. {targetPlatform === "youtube" ? "Video description" : target ? "Account caption" : "Caption and details"}</strong><span className="text-xs text-muted-foreground">{captionCount}</span></span>
            <Textarea rows={5} value={activeCaption} maxLength={target ? 10000 : 9600} onChange={(e) => updateCaption(e.target.value)} placeholder="Write your caption, hook, and call to action" />
          </Label>
          {target && variants[target]?.caption !== undefined && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => {
            setApproved(false);
            setVariants((current) => ({ ...current, [target]: { ...current[target], caption: undefined } }));
          }}>Use shared caption</Button>}
          {aiOpen && <Card className="gap-0 py-0  grid gap-2 rounded-xl border bg-card p-3">
            <Label className="grid gap-1 text-sm">What should the caption say?<Textarea value={brief} maxLength={4000} onChange={(event) => setBrief(event.target.value)} /></Label>
            <Button type="button" size="sm" disabled={aiBusy || !brief.trim()} onClick={writeCaption}>{aiBusy ? "Writing…" : "Generate caption"}</Button>
            {aiError && <p role="alert" className="text-sm text-destructive">{aiError}</p>}
          </Card>}
          <Label className="grid gap-2 text-sm font-medium">Hashtags<Input name="hashtags" placeholder="#launch #behindthescenes" value={hashtags} maxLength={300} onChange={(e) => setHashtags(e.target.value)} /></Label>
          <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-muted-foreground">Quick hashtags</span>
            {quickTags.map((item) => <Button key={item} type="button" size="xs" variant="outline" onClick={() => {
              const token = "#" + item;
              const value = target ? activeCaption : hashtags;
              if (value.split(/\s+/).includes(token)) return;
              const next = [value.trim(), token].filter(Boolean).join(" ");
              if (target && next.length <= 10000) updateCaption(next);
              if (!target && next.length <= 300) { setHashtags(next); setApproved(false); }
            }}>#{item}</Button>)}
          </div>
          <h3 className="text-sm font-semibold">4. Media attachments and account settings</h3>
          <FieldSet className="grid min-w-0 gap-3 rounded-xl border bg-card p-3 text-sm">
            <FieldLegend className="px-1 font-medium">Media</FieldLegend>
            <p className="text-xs text-muted-foreground">Add media now and choose accounts whenever you’re ready. Accounts can inherit the ordered shared files or choose their own selection. Each account validates its count and formats.</p>
            <MediaSelection label="Shared media" value={sharedMedia} assets={assets} allowed={mediaTypes} max={35} disabled={Boolean(uploading)||pending}
              onAsset={remember} onBusy={busy=>setUploading(busy?"shared":null)} onChange={ids=>{setSharedMedia(ids);setApproved(false);}} />
            <div className="flex gap-2">
              <Input type="text" inputMode="url" aria-label="Shared media URL" placeholder="https://… media URL" />
              <Button type="button" variant="outline" disabled={Boolean(uploading) || pending} onClick={(event) => {
                const input = event.currentTarget.parentElement?.querySelector("input");
                void attach("shared", mediaTypes, () => importMedia(input?.value ?? ""));
              }}>Import</Button>
            </div>
            {uploading === "shared" && <p role="status">Uploading attachment…</p>}
            {uploadErrors.shared && <p role="alert" className="text-destructive">{uploadErrors.shared}</p>}
          </FieldSet>
          <FieldSet className="grid gap-2 rounded-xl border bg-card p-3">
            <FieldLegend className="px-1 text-sm font-semibold">5. Custom tag and color</FieldLegend>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={!tag && !customTag ? "default" : "outline"} onClick={() => { setTag(""); setCustomTag(false); setApproved(false); }}>Platform color</Button>
              {Object.entries(tagColors).map(([item, color]) => <Button key={item} type="button" size="sm" variant={tag === item ? "default" : "outline"} onClick={() => { setTag(item); setTagColor(color); setCustomTag(false); setApproved(false); }}>
                <span className="size-2 rounded-full" style={{ backgroundColor: color }} />{item}
              </Button>)}
              <Button type="button" size="sm" variant="outline" onClick={() => { setTag(""); setCustomTag(true); setApproved(false); }}><Plus /> New tag</Button>
            </div>
            {customTag && <div className="flex gap-2"><Input aria-label="Tag name" value={tag} maxLength={48} onChange={(event) => setTag(event.target.value)} /><Input aria-label="Tag color" type="color" className="w-14" value={tagColor} onChange={(event) => setTagColor(event.target.value)} /></div>}
          </FieldSet>
          {[...connectedOnly, ...selectedChannels].some(({ platform }) => platform === "tiktok") && <Card className="gap-0 py-0  grid gap-2 rounded-xl border bg-card p-3 text-sm">
            <h4 className="flex items-center gap-2 font-semibold">
              <Image src="/social/tiktok.svg" width={16} height={16} alt="" unoptimized /> Finish in TikTok
            </h4>
            <p className="text-muted-foreground">Download the shared attachments in order and copy the caption to finish your post in TikTok.</p>
            <div className="flex flex-wrap items-center gap-2">
              {sharedMedia.map((id,index)=><a key={id} href={`/api/media/${id}`} download className={buttonVariants({variant:"outline",size:"sm"})}>Download attachment {index+1}</a>)}
              <Button type="button" variant="outline" size="sm" disabled={!baseCaption} onClick={async () => {
                try {
                  await navigator.clipboard.writeText(baseCaption);
                  setCopyStatus("Caption copied.");
                } catch {
                  setCopyStatus("Couldn’t copy automatically. Select and copy the caption above.");
                }
              }}>Copy caption</Button>
              <a href="https://www.tiktok.com/upload" target="_blank" rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}>Open TikTok</a>
            </div>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </Card>}
          {selectedChannels.map(({ id: channelId, platform, label, avatar_url }) => {
            const variant = variants[channelId];
            const mediaIds = variant.media ?? sharedMedia;
            const mediaId=mediaIds[0]??"";
            const selectedAssets=mediaIds.flatMap(id=>assets.find(asset=>asset.id===id)??[]);
            const mediaProblem=attachmentError(platform,selectedAssets,variant.destination,false);
            const asset = assets.find(({ id }) => id === mediaId);
            const allowed = channelMediaTypes[platform] ?? [];
            const change = <K extends keyof Variant,>(key: K, value: Variant[K]) => {
              setApproved(false);
              setVariants((current) => current[channelId] ? ({ ...current, [channelId]: { ...current[channelId], [key]: value } }) : current);
            };
            return <Card key={channelId} hidden={Boolean(target && target !== channelId)} className="gap-0 py-0  mb-3 grid gap-3 rounded-xl border bg-card p-4 [&[hidden]]:hidden">
              <h4 className="flex min-w-0 items-center gap-2.5 font-semibold">
                <span className="relative mr-1 shrink-0">
                  <Avatar size="sm">
                    {avatar_url && <AvatarImage src={avatar_url} alt="" referrerPolicy="no-referrer" />}
                    <AvatarFallback aria-hidden>{label?.charAt(0).toUpperCase() || "?"}</AvatarFallback>
                  </Avatar>
                  <Image src={`/social/${platform}.svg`} width={13} height={13} alt={platform}
                    className="absolute -right-1 -bottom-0.5 rounded-sm bg-white ring-1 ring-card" unoptimized />
                </span>
                <span className="min-w-0 break-words">{label || "Connected account"}</span>
              </h4>
              <input type="hidden" name={`id-${channelId}`} value={variant.id} />
              <input type="hidden" name={`caption-${channelId}`} value={variant.caption ?? baseCaption} />
              <input type="hidden" name={`media-${channelId}`} value={JSON.stringify(mediaIds)} />
              {platform === "linkedin" && <p className="text-sm text-muted-foreground">Publishes a public text or link post as this LinkedIn member.</p>}
              {firstCommentLimits[platform] && <Label className="grid gap-1 text-sm">{platform === "threads" ? "First reply" : "First comment"} (optional)
                <Textarea name={`first-comment-${channelId}`} rows={2} maxLength={firstCommentLimits[platform]} value={variant.firstComment ?? ""}
                  onChange={(event) => change("firstComment", event.target.value)} />
                <span className="text-xs text-muted-foreground">Sent after the provider confirms the post. {platform === "youtube" && "Pin it on YouTube after it appears."}</span>
              </Label>}
              {platform === "threads" && <>
                <Label className="grid gap-1 text-sm">Topic (optional)
                  <Input name={`topic-${channelId}`} value={variant.topic ?? ""} maxLength={50} onChange={(event) => change("topic", event.target.value)} />
                </Label>
                <Label className="grid gap-1 text-sm">Who can reply?
                  <FieldSelect
                    name={`reply-control-${channelId}`}
                    value={variant.replyControl ?? ""}
                    onValueChange={(nextValue) => change("replyControl", nextValue)}
                    options={[
                      { value: "", label: "Platform default" },
                      ...((Object.entries(threadsReplyControls).map(([id, text]) => ({ value: id, label: text }))) ?? [])
                    ]}
                  />
                </Label>
              </>}
              {((platform === "threads" && asset) ||
                (platform === "instagram" && asset?.mime === "image/jpeg" && variant.destination !== "story")) &&
                <Label className="grid gap-1 text-sm">Media alt text (optional)
                  <Input name={`alt-${channelId}`} value={variant.altText ?? ""} maxLength={500} onChange={(event) => change("altText", event.target.value)} />
                </Label>}
              {variant.media === undefined && <input type="hidden" name={`inherit-media-${channelId}`} value="yes" />}
              {variant.caption === undefined && <input type="hidden" name={`inherit-${channelId}`} value="yes" />}
              {platform !== "threads" && <FieldSet className="grid gap-3 rounded-lg border p-3">
              <FieldLegend className="px-1 text-sm font-medium capitalize">{platform} settings</FieldLegend>
              {platform === "youtube" && (target
                ? <input type="hidden" name={`title-${channelId}`} value={variant.title ?? ""} />
                : <Label className="grid gap-1 text-sm">Video title
                    <Input name={`title-${channelId}`} value={variant.title ?? ""} maxLength={100} placeholder="Uses the shared title if empty" onChange={(e) => change("title", e.target.value)} />
                  </Label>)}
              {platform === "facebook" && <FacebookPagePicker channelId={channelId} destination={variant.destination}
                onDestination={(value) => change("destination", value)} />}
              {platform === "pinterest" && <>
                <PinterestPicker channelId={channelId} variant={variant} change={change} />
                <Label className="grid gap-1 text-sm">Pin title
                  <Input name={`title-${channelId}`} value={variant.title ?? ""} maxLength={100} placeholder={title || "Use the shared title"}
                    onChange={(event) => change("title", event.target.value)} />
                </Label>
                <Label className="grid gap-1 text-sm">Destination link (optional)
                  <Input type="url" name={`link-${channelId}`} value={variant.link ?? ""} maxLength={2048}
                    onChange={(event) => change("link", event.target.value)} />
                </Label>
                <Label className="grid gap-1 text-sm">Image alt text (applies to selected images, optional)
                  <Input name={`alt-${channelId}`} value={variant.altText ?? ""} maxLength={500}
                    onChange={(event) => change("altText", event.target.value)} />
                </Label>
              </>}
              {["facebook", "linkedin"].includes(platform) && <Label className="grid gap-1 text-sm">Link to share (optional)
                <Input type="url" name={`link-${channelId}`} value={variant.link ?? ""} maxLength={2048}
                  placeholder="https://example.com" onChange={(event) => change("link", event.target.value)} />
                {platform === "facebook" && variant.link && asset && <span className="text-destructive">Remove the attachment to publish a Facebook link post.</span>}
              </Label>}
              {platform === "instagram" && <Label className="grid gap-1 text-sm">Instagram placement
                <FieldSelect
                  name={`destination-${channelId}`}
                  value={variant.destination || "feed"}
                  onValueChange={(nextValue) => change("destination", nextValue)}
                  options={[
                    { value: "feed", label: "Feed or Reel" },
                    { value: "story", label: "Story" }
                  ]}
                />
              </Label>}
              {platform === "instagram" && variant.destination !== "story" && asset?.mime === "video/mp4" && <Label className="flex items-center gap-2 text-sm">
                <input type="hidden" name={`share-to-feed-${channelId}`} value={variant.shareToFeed ?? "yes"} />
                <Checkbox checked={variant.shareToFeed !== "no"} onCheckedChange={(checked) => change("shareToFeed", checked ? "yes" : "no")} /> Also share Reel to feed
              </Label>}
              {platform === "youtube" && <Label className="grid gap-1 text-sm">YouTube visibility
                <FieldSelect
                  name={`destination-${channelId}`}
                  value={variant.destination}
                  onValueChange={(nextValue) => change("destination", nextValue)}
                  options={[
                    { value: "", label: "Choose visibility" },
                    { value: "private", label: "Private" },
                    { value: "unlisted", label: "Unlisted" },
                    { value: "public", label: "Public" }
                  ]}
                />
              </Label>}
              {platform === "youtube" && <Label className="grid gap-1 text-sm">YouTube audience
                <FieldSelect
                  name={`audience-${channelId}`}
                  value={variant.audience ?? ""}
                  onValueChange={(nextValue) => change("audience", nextValue)}
                  options={[
                    { value: "", label: "Choose audience" },
                    { value: "general", label: "General audience" },
                    { value: "kids", label: "Made for kids" }
                  ]}
                />
              </Label>}
              {platform === "youtube" && <Label className="flex items-center gap-2 text-sm">
                <Checkbox name={`synthetic-media-${channelId}`} value="yes" checked={variant.syntheticMedia === "yes"}
                  onCheckedChange={(checked) => change("syntheticMedia", checked ? "yes" : "no")} /> Contains realistic altered or synthetic media
              </Label>}
              {platform === "tiktok" && <>
                {asset?.mime==="image/jpeg"&&<Label className="grid gap-1">Photo post title<Input name={`title-${channelId}`} maxLength={90} value={variant.title??title} onChange={event=>change("title",event.target.value)} /></Label>}
                <Button type="button" variant="outline" onClick={async () => {
                  setApproved(false);
                  change("destination", "");
                  const creator = await getTikTokCreator(channelId);
                  setCreators((current) => ({ ...current, [channelId]: creator }));
                }}>Load TikTok creator settings</Button>
                {creators[channelId] === null && <p role="alert">TikTok creator settings could not be loaded.</p>}
                {creators[channelId] && <TikTokSettings channelId={channelId} creator={creators[channelId]} photos={asset?.mime==="image/jpeg"}
                  destination={variant.destination} onDestination={(value) => change("destination", value)} />}
                <input type="hidden" name={`duration-${channelId}`} value={asset ? durations[asset.id] ?? "" : ""} />
              </>}
              </FieldSet>}
              {allowed.length > 0 && <FieldSet className="grid min-w-0 gap-2 rounded-lg border p-3 text-sm">
                <FieldLegend className="px-1 font-medium">Media</FieldLegend>
                <p className="text-xs text-muted-foreground">{allowed.map(mime=>mediaFormatLabel[mime]).join(", ")} · {mediaPolicyLabel(platform,variant.destination)} · 10 MiB/file (Meta images 8 MB)</p>
                <Label className="flex items-center gap-2"><Checkbox checked={variant.media===undefined} disabled={Boolean(uploading)||pending}
                  onCheckedChange={checked=>change("media",checked?undefined:[...sharedMedia])} />Use shared attachments</Label>
                <MediaSelection label={`media for ${label||platform}`} value={mediaIds} assets={assets} allowed={allowed} max={mediaLimit(platform,variant.destination)}
                  disabled={Boolean(uploading)||pending||variant.media===undefined} onAsset={remember} onBusy={busy=>setUploading(busy?channelId:null)} onChange={ids=>change("media",ids)} />
              </FieldSet>}
              {mediaProblem&&<p role="alert" className="text-sm text-destructive">{mediaProblem}</p>}
              {asset?.mime.startsWith("video/") && <video key={asset.id} hidden preload="metadata"
                src={`/api/media/${asset.id}?preview`} onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  setDurations((current) => ({ ...current, [asset.id]: duration }));
                }} />}
            </Card>;
          })}
        <Card className="gap-0 py-0  flex flex-col gap-3 rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">6. Schedule and publish</h3><div className="flex gap-1">
            {(["now", "schedule"] as const).map((option) => <Button key={option} type="button" size="sm" variant={mode === option ? "default" : "outline"} aria-pressed={mode === option} onClick={() => { setMode(option); setApproved(false); }}>{option === "now" ? "Post now" : "Schedule"}</Button>)}
          </div></div>
          {mode === "schedule" && <FieldSet className="grid grid-cols-2 gap-3"><FieldLegend className="mb-2 text-sm font-medium">Schedule in {timezone}</FieldLegend>
            <DatePicker label="Date" name="date" value={scheduledDate} minDate={today} onChange={(date) => { setScheduledDate(date); setApproved(false); }} />
            <TimePicker label="Time" name="time" value={time} min={minimumTime} onChange={(time) => { setTime(time); setApproved(false); }} />
          </FieldSet>}
          {mode === "now" && <><input type="hidden" name="date" value={scheduledDate} /><input type="hidden" name="time" value={time} /></>}
          {mode === "schedule" && validLocalTime && <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(local)} {timezone}</p>}
          {mode === "schedule" && scheduledDate && time && !validLocalTime && <p role="alert" className="text-sm text-destructive">This local time is unavailable. Choose another time.</p>}
          {mode === "schedule" && (scheduledDate && scheduledDate < today || validLocalTime && !futureSchedule) && <p role="alert" className="text-sm text-destructive">Choose a future date and time to schedule.</p>}
          {Object.keys(variants).length > 0 && <Label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
            <Checkbox name="approved" value="yes" disabled={mediaProblems.length>0} checked={approved} onCheckedChange={setApproved} />
            I approve the displayed captions, destinations, links, attachments, first comments, and delivery time.
          </Label>}
        </Card>
        </div>
        <aside className="min-w-0 border-t bg-background p-4 sm:p-6 md:overflow-y-auto md:border-t-0 md:border-l">
          <div className="grid gap-4 rounded-2xl bg-sidebar p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold"><span aria-hidden className="size-2.5 rounded-full bg-emerald-500" />Live preview</h3>
            {previewTabs.length > 0 && <div role="group" aria-label="Preview account" className="flex flex-wrap gap-0.5 rounded-full border bg-muted/50 p-0.5">
              {previewTabs.map((tab) => <Button key={tab.id} type="button" size="sm" variant={activePreviewTab === tab.id ? "outline" : "ghost"}
                className="rounded-full capitalize" aria-pressed={activePreviewTab === tab.id} onClick={() => setPreviewTarget(tab.id)}>
                <Image src={`/social/${tab.platform}.svg`} width={14} height={14} alt="" className="shrink-0 rounded-sm bg-white" unoptimized />
                {tab.label || tab.platform}
              </Button>)}
            </div>}
          </div>
          <Card role="article" className="gap-0 py-0 block overflow-hidden rounded-xl border bg-card shadow-sm">
            {tag && <div className="h-1.5" style={{ backgroundColor: tagColor }} />}
            <PlatformPreview platform={previewPlatform} name={previewName}
              subtitle={samplePreview ? "@studionorth · Sample" : previewChannel?.platform || "Draft preview"}
              title={preview?.title?.trim() || title.trim()} media={previewMedia}
              story={previewPlatform === "instagram" && preview?.destination === "story"}
              caption={samplePreview ? "A look behind the scenes of our spring collection. Thoughtful details, natural textures, and pieces designed for everyday life." : (preview?.caption ?? baseCaption).trim()} />
          </Card>
          </div>
        </aside>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-3 sm:px-7 sm:py-4">
        {state.message && !state.done && <p role="alert" className="basis-full text-sm text-destructive">{state.message}</p>}
        <Button type="button" variant="ghost" onClick={() => close()}>Cancel</Button>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="draft" formNoValidate variant="outline" disabled={pending || uploading !== null}>Save draft</Button>
          {mode === "now" && <Button type="submit" name="intent" value="now" formNoValidate disabled={pending || uploading !== null || mediaProblems.length>0 || !approved}>Queue now</Button>}
          {mode === "schedule" && <Button type="submit" name="intent" value="schedule" disabled={pending || uploading !== null || mediaProblems.length>0 || !approved || !futureSchedule}><CalendarDays className="hidden sm:block" /> Schedule post</Button>}
        </div>
      </footer>
    </form>
  );
}

async function importMedia(value: string) {
  const url = URL.parse(value.trim());
  if (!url || url.protocol !== "https:" || url.username || url.password) throw new Error("Enter a direct HTTPS media URL.");
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) })
    .catch(() => { throw new Error("Could not read this URL. Use a link that allows browser downloads, or upload the file directly."); });
  if (!response.ok || !response.body) throw new Error("The media URL did not return a file.");
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("Choose a file up to 10 MiB.");
      chunks.push(chunk.value.slice());
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new File(chunks, url.pathname.split("/").at(-1) || "Imported media", { type: response.headers.get("content-type")?.split(";")[0] ?? "" });
}

function PinterestPicker({ channelId, variant, change }: {
  channelId: string; variant: Variant; change: (key: keyof Variant, value: string) => void;
}) {
  const [boards, setBoards] = useState<Awaited<ReturnType<typeof getPinterestDestinations>> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void getPinterestDestinations(channelId).then(
      (value) => { if (active) setBoards(value); },
      () => { if (active) setBoards(null); },
    );
    return () => { active = false; };
  }, [channelId]);
  const board = boards?.find(({ id }) => id === variant.destination);
  return <>
    <input type="hidden" name={`destination-${channelId}`} value={variant.destination} />
    <Label className="grid gap-1 text-sm">Pinterest board
      <FieldSelect
        value={board?.id ?? ""}
        disabled={!boards?.length}
        onValueChange={(nextValue) => {
              change("destination", nextValue);
              change("section", "");
            }}
        options={[
          { value: "", label: boards === undefined ? "Loading boards…" : "Choose a board" },
          ...((boards?.map(({ id, name }) => ({ value: id, label: name }))) ?? [])
        ]}
      />
    </Label>
    {boards === null && <p role="status" className="text-sm text-muted-foreground">Couldn’t load boards. Check the Pinterest connection in Accounts.</p>}
    {boards?.length === 0 && <p role="status" className="text-sm text-muted-foreground">Create a board in Pinterest, then reopen the composer.</p>}
    {board && <PinterestSectionPicker key={board.id} channelId={channelId} board={board.id} section={variant.section ?? ""}
      onChange={(value) => change("section", value)} />}
  </>;
}

function PinterestSectionPicker({ channelId, board, section, onChange }: {
  channelId: string; board: string; section: string; onChange: (value: string) => void;
}) {
  const [sections, setSections] = useState<Awaited<ReturnType<typeof getPinterestDestinations>> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void getPinterestDestinations(channelId, board).then(
      (value) => { if (active) setSections(value); },
      () => { if (active) setSections(null); },
    );
    return () => { active = false; };
  }, [channelId, board]);
  return <Label className="grid gap-1 text-sm">Board section (optional)
    <FieldSelect
      name={`section-${channelId}`}
      value={section}
      onValueChange={(nextValue) => onChange(nextValue)}
      options={[
        { value: "", label: sections === undefined ? "Loading sections…" : "No section" },
        ...(((section && !sections?.some(({ id }) => id === section)) ? [({ value: section, label: "Saved section" })] : [])),
        ...((sections?.map(({ id, name }) => ({ value: id, label: name }))) ?? [])
      ]}
    />
    {sections === null && <span className="text-muted-foreground">Couldn’t load sections. You can publish to the board itself.</span>}
  </Label>;
}

function FacebookPagePicker({ channelId, destination, onDestination }: {
  channelId: string; destination: string; onDestination: (value: string) => void;
}) {
  const [pages, setPages] = useState<Awaited<ReturnType<typeof getFacebookPages>> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void getFacebookPages(channelId).then(
      (result) => { if (active) setPages(result); },
      () => { if (active) setPages(null); },
    );
    return () => { active = false; };
  }, [channelId]);
  const selected = pages?.find(({ id }) => id === destination);
  return <div className="grid gap-1 text-sm">
    <input type="hidden" name={`destination-${channelId}`} value={destination} />
    <Label className="grid gap-1">Facebook Page
      <FieldSelect
        value={selected ? destination : ""}
        disabled={!pages?.length}
        onValueChange={(nextValue) => onDestination(nextValue)}
        options={[
          { value: "", label: pages === undefined ? "Loading Pages…" : "Choose a Page" },
          ...((pages?.map(({ id, name }) => ({ value: id, label: name }))) ?? [])
        ]}
      />
    </Label>
    {selected?.photo && <span className="flex items-center gap-2 text-muted-foreground">
      <Image src={selected.photo} width={24} height={24} alt="" className="rounded-full" referrerPolicy="no-referrer" unoptimized />
      {selected.name}
    </span>}
    {pages === null && <p role="status">Couldn’t load Pages. Check the connection in Accounts and reopen the composer.</p>}
    {pages?.length === 0 && <p role="status">Facebook returned no Pages with publishing access. Reconnect and grant access to the Page you manage.</p>}
    {pages?.length && destination && !selected ? <p role="status">The saved Page is unavailable. Choose another Page to publish.</p> : null}
  </div>;
}

function TikTokSettings({ channelId, creator, destination, onDestination,photos=false }: {
  channelId: string; creator: NonNullable<Awaited<ReturnType<typeof getTikTokCreator>>>; destination: string; onDestination: (value: string) => void; photos?:boolean;
}) {
  const [commercial, setCommercial] = useState(false);
  const [paid, setPaid] = useState(false);
  const [own, setOwn] = useState(false);
  const privacyOptions = tiktokPrivacy.filter((option) => creator.options.includes(option));
  const interactions = ["comment", "duet", "stitch"] as const;
  return <FieldSet className="grid gap-2 rounded-lg border p-3 text-sm">
    <FieldLegend className="px-1 font-medium">{creator.nickname} · @{creator.username}</FieldLegend>
    <Label className="grid gap-1">TikTok visibility
      <FieldSelect
        name={`destination-${channelId}`}
        value={destination}
        onValueChange={(nextValue) => onDestination(nextValue)}
        options={[
          { value: "", label: "Choose visibility" },
          ...((privacyOptions.map((option) => ({ value: option, disabled: commercial && paid && !["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS"].includes(option), label: option === "SELF_ONLY" ? "Only me" : option.toLowerCase().replaceAll("_", " ") }))) ?? [])
        ]}
      />
    </Label>
    <p className="text-xs text-muted-foreground">{photos?"Up to 35 photos. The first photo is the cover.":`Maximum video length: ${creator.maxDuration} seconds.`}</p>
    {photos&&<Label className="flex items-center gap-2"><Checkbox name={`auto-music-${channelId}`} value="yes" />Add TikTok recommended music</Label>}
    {interactions.filter(option=>!photos||option==="comment").map((option) => <Label className="flex items-center gap-2" key={option}>
      <Checkbox name={`${option}-${channelId}`} value="yes" disabled={creator.disabled[option]} />Allow {option}
    </Label>)}
    <Label className="flex items-center gap-2"><Checkbox name={`ai-${channelId}`} value="yes" />AI-generated content</Label>
    <Label className="flex items-center gap-2"><Checkbox name={`commercial-${channelId}`} value="yes" checked={commercial}
      onCheckedChange={(checked) => { setCommercial(checked); setPaid(false); setOwn(false); }} />Disclose commercial content</Label>
    {commercial && <>
      <Label className="flex items-center gap-2"><Checkbox name={`own-brand-${channelId}`} value="yes" checked={own}
        onCheckedChange={setOwn} />Your brand</Label>
      <Label className="flex items-center gap-2"><Checkbox name={`paid-brand-${channelId}`} value="yes" checked={paid}
        onCheckedChange={(checked) => {
          setPaid(checked);
          if (checked && !["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS"].includes(destination)) onDestination("");
        }} />Branded content</Label>
      {(paid || own) && <p className="text-muted-foreground">TikTok will label this post {paid ? "Paid partnership" : "Promotional content"}.</p>}
    </>}
    <Label className="flex items-start gap-2"><Checkbox name={`music-${channelId}`} value="yes" className="mt-1" />
      <span>By posting, I agree to TikTok&apos;s <a className="underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>
        {commercial && paid && <> and <a className="underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a></>}.</span>
    </Label>
  </FieldSet>;
}
