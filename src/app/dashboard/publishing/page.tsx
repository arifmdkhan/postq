import {publicationMediaIds} from "@/features/media/attachments";
import {mediaLimit} from "@/features/publishing/media-policy";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/field-select";
import { MediaLibraryField } from "@/features/media/library-field";
import { runtimeConfiguration } from "@/features/settings/configuration";
import Image from "next/image";
import Link from "next/link";
import { CircleCheck, Plus, Search, UserRound } from "lucide-react";
import { Suspense } from "react";
import PublishingLoading from "./loading";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Button, buttonVariants } from "@/components/ui/button";
import { cancelPublication, changeLivePublication, connectChannel, disconnectChannel, editScheduledPublication, openLivePublication, renameChannel, reschedulePublication, resolvePublication, resolveLivePublication } from "@/features/publishing/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { channelMediaTypes } from "@/features/publishing/capabilities";
import { commentLimit } from "@/features/publishing/comments";
import { addPublicationComment, resolveComment } from "@/features/publishing/actions";
import { UtcDateTimePicker } from "@/components/date-time-picker";
import { Insights } from "@/features/publishing/insights";
import { connectablePlatforms } from "@/features/publishing/platforms";
import { requireUser } from "@/server/auth";
import { syncChannelProfiles } from "@/features/publishing/channel-avatar";
import { database } from "@/server/db";
import { workspaceTimezone } from "@/features/settings/timezone";
import { zonedMinute } from "@/features/publishing/timezone";

const platforms = [
  { id: "youtube", name: "YouTube", detail: "Your channels" },
  { id: "instagram", name: "Instagram", detail: "Business or Creator accounts" },
  { id: "tiktok", name: "TikTok", detail: "Creator accounts" },
  { id: "facebook", name: "Facebook", detail: "Facebook Pages" },
  { id: "threads", name: "Threads", detail: "Your Threads profiles" },
  { id: "x", name: "X", detail: "Your X accounts" },
  { id: "linkedin", name: "LinkedIn", detail: "Your LinkedIn accounts" },
  { id: "pinterest", name: "Pinterest", detail: "Your Pinterest accounts" },
];

const connectionErrors: Record<string, string> = {
  config: "Set COMPOSIO_API_KEY and the platform's custom auth config if required.",
  credentials: "Composio rejected the project API key. Update COMPOSIO_API_KEY and restart PostQ, then try Connect again.",
  disconnect: "Account is in use. Wait for publishing to finish.",
  "schedule-time": "Choose an unambiguous time in the workspace timezone, in the future.",
  reschedule: "This post is no longer scheduled on an active account.",
  label: "Keep the account label within 80 characters.",
};

const statusNames: Record<string, string> = { scheduled: "Scheduled", sending: "Sending", published: "Published", review: "Needs review", cancelled: "Cancelled" };

export default function PublishingPage({ searchParams }: PageProps<"/dashboard/publishing">) {
  return <Suspense fallback={<PublishingLoading />}><Publishing searchParams={searchParams} /></Suspense>;
}

async function Publishing({ searchParams }: Pick<PageProps<"/dashboard/publishing">, "searchParams">) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const timezone = await workspaceTimezone();
  const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const page = typeof params.page === "string" && /^[1-9]\d{0,7}$/.test(params.page) ? Number(params.page) : 1;
  const focused = typeof params.post === "string" && /^[a-f\d-]{36}$/i.test(params.post) ? params.post : "";
  const commentPage = typeof params.comments === "string" && /^[1-9]\d{0,5}$/.test(params.comments) ? Number(params.comments) : 1;
  const queueUrl = (number: number) => {
    const search = new URLSearchParams({ page: String(number) });
    if (params.tab === "connected") search.set("tab", params.tab);
    if (typeof params.q === "string") search.set("q", params.q.slice(0, 80));
    return `/dashboard/publishing?${search}#activity`;
  };
  const db = await database();
  const [{ results: storedChannels }, { results: queue }, { results: counts }, { results: media }, { results: comments }] = await Promise.all([
    db.prepare("SELECT id, remote_id, platform, label, avatar_url, profile_name, profile_checked_at FROM channels WHERE user_id = ? AND active = 1 ORDER BY id").bind(user.id).all<{ id: string; remote_id: string; platform: string; label: string | null; avatar_url: string | null; profile_name: string | null; profile_checked_at: number | null }>(),
    db.prepare(`SELECT p.id, p.title, p.due_at, p.status, c.platform, p.remote_post_id, p.destination, p.pending_receipt, p.last_error, p.abandoned_at, p.media_id, p.media_ids, p.deleted_at, p.live_change, p.live_change_at, p.live_change_caption, p.live_change_at <= (unixepoch() * 1000 - 120000) AS can_review_live_change, c.active AS channel_active, m.name AS media_name,
      CASE WHEN p.status IN ('review', 'scheduled', 'published') THEN p.caption END AS editable_caption
      FROM publications p JOIN channels c ON c.id = p.channel_id
      LEFT JOIN media_assets m ON m.id = p.media_id AND m.user_id = p.user_id
      WHERE p.user_id = ? AND (? = '' OR p.id = ?) ORDER BY p.due_at DESC, p.id DESC LIMIT 26 OFFSET ?`)
      .bind(user.id, focused, focused, focused ? 0 : (page - 1) * 25).all<{ id: string; title: string; due_at: number; status: string; editable_caption: string | null; platform: string; remote_post_id: string | null; destination: string | null; pending_receipt: string | null; last_error: string | null; abandoned_at: number | null; media_id: string | null; media_ids:string; media_name: string | null; deleted_at: number | null; live_change: string | null; live_change_at: number | null; live_change_caption: string | null; can_review_live_change: number | null; channel_active: number }>(),
    db.prepare("SELECT status, count(*) AS total FROM publications WHERE user_id = ? GROUP BY status")
      .bind(user.id).all<{ status: string; total: number }>(),
    db.prepare("SELECT id, name, mime FROM media_assets WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
      .bind(user.id).all<{ id: string; name: string; mime: string }>(),
    db.prepare(`SELECT pc.body,pc.remote_id,pc.state,pc.created_at FROM publication_comments pc JOIN publications p ON p.id=pc.publication_id
      WHERE p.id=? AND p.user_id=? ORDER BY pc.created_at DESC,pc.body LIMIT 11 OFFSET ?`)
      .bind(focused, user.id, (commentPage - 1) * 10).all<{ body: string; remote_id: string | null; state: string; created_at: number }>(),
  ]);
  const selectedIds=queue.flatMap(publicationMediaIds);
  const {results: selectedAssets}=await db.prepare("SELECT id,name,mime FROM media_assets WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(user.id,JSON.stringify(selectedIds)).all<{id:string;name:string;mime:string}>();
  const channels = await syncChannelProfiles(db, user.id, storedChannels);
  const config = await runtimeConfiguration();
  const configured = Boolean(config.COMPOSIO_API_KEY && config.COMPOSIO_AUTH_CONFIG_THREADS);
  const connected = params.tab === "connected";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const visible = platforms.filter(({ id, name }) =>
    (!connected || channels.some(({ platform }) => platform === id)) && name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="flex flex-col gap-6 p-4 sm:p-7">
      <header>
        <h1 className="text-4xl font-extrabold">Social accounts</h1>
        <p className="mt-1 text-muted-foreground">Connect the accounts you create for.</p>
        <p className="mt-3 text-sm text-muted-foreground">{channels.length} connected accounts</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Connection guide</SheetTrigger>
            <SheetContent>
              <SheetHeader><SheetTitle>Connect a social account</SheetTitle><SheetDescription>Google sign-in opens PostQ. Each social account has its own connection.</SheetDescription></SheetHeader>
              <ol className="grid list-decimal gap-3 px-8">
                <li>Set the Composio project API key on the deployment.</li>
                <li>Threads, TikTok, and X require their own auth config. Instagram, Facebook, YouTube, LinkedIn, and Pinterest use managed OAuth.</li>
                <li>Choose Connect and authorize the account or assets you intend to use.</li>
              </ol>
              <Link href="/dashboard/setup" className="mx-4 w-fit font-medium text-primary underline">Check setup</Link>
            </SheetContent>
          </Sheet>
          <Link href="#activity" className="self-center text-sm font-medium text-primary underline">Publishing activity</Link>
        </div>
      </header>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <nav aria-label="Account filters" className="flex gap-4">
          <Link href="/dashboard/publishing" aria-current={!connected ? "page" : undefined}
            className={`border-b-2 px-2 py-3 text-sm font-semibold ${connected ? "border-transparent text-muted-foreground" : "border-primary text-primary"}`}>All platforms <Badge variant="secondary">{platforms.length}</Badge></Link>
          <Link href="/dashboard/publishing?tab=connected" aria-current={connected ? "page" : undefined}
            className={`border-b-2 px-2 py-3 text-sm font-semibold ${connected ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>Connected <Badge variant="secondary">{channels.length}</Badge></Link>
        </nav>
        <form action="/dashboard/publishing" className="mb-2 flex items-center gap-2">
          {connected && <input type="hidden" name="tab" value="connected" />}
          <InputGroup><InputGroupAddon><Search aria-hidden /></InputGroupAddon><InputGroupInput type="search" name="q" aria-label="Find a platform" placeholder="Find a platform…" maxLength={80} defaultValue={query} /></InputGroup>
          <Button type="submit" variant="outline" size="sm">Find</Button>
        </form>
      </div>
      <div>
        {visible.length === 0 && <p className="p-5 text-sm text-muted-foreground">No matching platforms.</p>}
        <ul className="grid items-start gap-4 xl:grid-cols-2">
          {visible.map(({ id, name, detail }) => {
            const supported = connectablePlatforms.includes(id);
            const ready = id === "threads" ? configured : Boolean(config.COMPOSIO_API_KEY &&
              (id !== "tiktok" || config.COMPOSIO_AUTH_CONFIG_TIKTOK) && (id !== "x" || config.COMPOSIO_AUTH_CONFIG_TWITTER));
            const accounts = channels.filter(({ platform }) => platform === id);
            const status = accounts.length ? `${accounts.length} connected` : ready ? "Not connected" : "Setup required";
            const publishing = id === "threads" ? "Text, images, videos" : id === "facebook" ? "Page posts" : id === "instagram" ? "Feed, Reels, Stories" : id === "pinterest" ? "Image Pins" : id === "linkedin" ? "Member text and links" : id === "youtube" || (id === "tiktok" && process.env.POSTQ_TIKTOK_DIRECT_POST === "enabled") ? "MP4 videos" : "Connection only";
            return (
              <li key={id}><Card className="grid gap-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-white">
                    <Image src={`/social/${id}.svg`} width={22} height={22} alt="" unoptimized />
                  </span>
                  <div><h2 className="font-semibold">{name}</h2><p className="text-sm text-muted-foreground">{detail}</p></div>
                  </div>
                  {supported && ready && <form action={connectChannel.bind(null, id)}><Button type="submit" variant="outline" size="sm" aria-label={`${accounts.length ? "Add another" : "Connect"} ${name} account`}><Plus /> {accounts.length ? "Add account" : "Connect account"}</Button></form>}
                  {supported && !ready && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/dashboard/setup">View setup</Link>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className={accounts.length ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : undefined}>{accounts.length > 0 && <CircleCheck />}{status}</Badge>
                  <Badge variant="outline">{publishing}</Badge>
                </div>
                {accounts.length > 0 && <ul aria-label={`${name} accounts`} className="divide-y rounded-xl border bg-muted/30 px-3">
                  {accounts.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar>{account.avatar_url && <AvatarImage src={account.avatar_url} alt="" referrerPolicy="no-referrer" />}<AvatarFallback><UserRound aria-hidden className="size-4" /></AvatarFallback></Avatar>
                      <span className="min-w-0 break-all text-sm font-medium">{account.label || account.profile_name || name}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Dialog>
                        <DialogTrigger render={<Button variant="ghost" size="sm" />}>Edit label</DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Edit account label</DialogTitle><DialogDescription>Use a name you recognize when selecting a publishing destination.</DialogDescription></DialogHeader>
                          <form action={renameChannel.bind(null, account.id)} className="grid gap-4">
                            <Label className="grid gap-1">Account label<Input name="label" maxLength={80} defaultValue={account.label ?? ""} placeholder={account.profile_name ?? name} /></Label>
                            <DialogFooter showCloseButton><Button type="submit">Save label</Button></DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                      <Dialog>
                        <DialogTrigger render={<Button variant="outline" size="sm" />}>Remove from PostQ</DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Remove account from PostQ?</DialogTitle><DialogDescription>This cancels queued deliveries locally and preserves history. It does not revoke Composio or platform authorization. To revoke that access, remove this connected account in your Composio project and revoke PostQ&apos;s app in the platform&apos;s authorized-app settings.</DialogDescription></DialogHeader>
                          <form action={disconnectChannel.bind(null, account.id)}>
                            <DialogFooter showCloseButton><Button type="submit" variant="destructive">Remove locally</Button></DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </li>)}
                </ul>}
              </Card></li>
            );
          })}
        </ul>
      </div>
      {!configured && <Alert><AlertTitle>Threads requires an optional custom config.</AlertTitle></Alert>}
      {typeof params.error === "string" && params.error !== "schedule-time" && params.error !== "reschedule" && <Alert variant="destructive"><AlertTitle>{(Object.hasOwn(connectionErrors, params.error) ? connectionErrors[params.error] : undefined) ?? "Account connection could not be completed."}</AlertTitle></Alert>}
      {params["channel-updated"] === "1" && <p role="status">Account label saved.</p>}
      <section id="activity" className="grid gap-3">
        <h2 className="text-lg font-bold">Publishing activity</h2>
        {focused && <Link href="/dashboard/publishing#activity" className="w-fit text-sm font-medium text-primary underline">View all deliveries</Link>}
        {params.rescheduled === "1" && <p role="status">Post rescheduled.</p>}
        {params.live === "edited" && <p role="status">Live post updated.</p>}
        {params.live === "deleted" && <p role="status">Live post deleted.</p>}
        {params.live === "resolved" && <p role="status">Live change reviewed.</p>}
        {params.comment === "posted" && <p role="status">Comment posted.</p>}
        {params.comment === "review" && <Alert variant="destructive"><AlertTitle>The provider didn’t confirm the comment. Check the live post before trying again.</AlertTitle></Alert>}
        {params.comment === "duplicate" && <Alert><AlertTitle>This comment has already been submitted. Check the comment history or the live post.</AlertTitle></Alert>}
        {params.comment === "unavailable" && <Alert variant="destructive"><AlertTitle>Commenting is unavailable for this post or the comment exceeds its limit.</AlertTitle></Alert>}
        {params.live === "link" && <Alert><AlertTitle>The platform didn’t return a link for this post.</AlertTitle></Alert>}
        {params.live === "unavailable" && <Alert variant="destructive"><AlertTitle>This action is unavailable. Check the account connection and Page permissions.</AlertTitle></Alert>}
        {params.live === "review" && <Alert variant="destructive"><AlertTitle>The provider didn’t confirm the change. Check the live post before making another change.</AlertTitle></Alert>}
        {params.edit === "saved" && <p role="status">Scheduled post updated.</p>}
        {params.edit === "stale" && <Alert variant="destructive"><AlertTitle>This delivery changed or is already being sent. Check its current status.</AlertTitle></Alert>}
        {params.edit === "invalid" && <Alert variant="destructive"><AlertTitle>Check the title and caption against this platform’s publishing requirements.</AlertTitle></Alert>}
        {params.edit === "media" && <Alert variant="destructive"><AlertTitle>This attachment is unavailable for the selected delivery.</AlertTitle></Alert>}
        {params.review === "resolved" && <p role="status">Review resolved.</p>}
        {params.review === "invalid" && <Alert variant="destructive"><AlertTitle>Enter a valid provider post ID.</AlertTitle></Alert>}
        {params.review === "stale" && <Alert variant="destructive"><AlertTitle>This post no longer needs review.</AlertTitle></Alert>}
        {(params.error === "schedule-time" || params.error === "reschedule") &&
          <Alert variant="destructive"><AlertTitle>{connectionErrors[params.error]}</AlertTitle></Alert>}
        {counts.length > 0 && <ul className="flex flex-wrap gap-2">
          {counts.map(({ status, total }) => <li key={status}><Badge variant="secondary">{statusNames[status]} {total}</Badge></li>)}
        </ul>}
        {queue.length === 0 && <Empty className="border"><EmptyHeader><EmptyTitle>{focused ? "Delivery unavailable" : page === 1 ? "Your publishing queue is empty" : "No posts on this page"}</EmptyTitle></EmptyHeader></Empty>}
        {queue.slice(0, 25).map((post) => (
          <Card role="article" key={post.id} className="gap-0 py-0 flex-row flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <div className="min-w-0">
              <h3 className="break-words font-semibold">{post.title}</h3>
              {publicationMediaIds(post).length>0&&<Badge variant="outline">{publicationMediaIds(post).length} attachments</Badge>}
              <p className="text-sm text-muted-foreground capitalize">{post.platform} · {time.format(post.due_at)} {timezone} · {post.deleted_at ? "Deleted on platform" : statusNames[post.status]}</p>
              {post.destination && post.platform !== "linkedin" && <p className="text-xs text-muted-foreground">{post.platform === "facebook" ? "Page ID" : post.platform === "pinterest" ? "Board ID" : post.platform === "instagram" ? "Placement" : "Visibility"} {post.destination}</p>}
              {post.remote_post_id && <p className="break-all text-xs text-muted-foreground">Provider receipt {post.remote_post_id}</p>}
              {post.last_error && <p role="status" className="text-sm text-destructive">Delivery status: {post.last_error.replaceAll("_", " ")}. Check the platform before retrying.</p>}
              {post.abandoned_at && <p className="text-sm text-muted-foreground">This attempt was closed locally. External processing may still finish; its receipt is retained.</p>}
              {post.pending_receipt && <p className="break-all text-xs text-muted-foreground">
                {post.platform === "tiktok" ? "TikTok submission receipt" : "Upload receipt. Check visibility in YouTube Studio."} · {post.pending_receipt}
              </p>}
              {post.status === "review" && <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-medium">Resolve delivery</summary>
                <p className="my-2">Check the destination account first. Record the post if it exists, or close this attempt without sending it again. Closing does not cancel external processing. Pending receipts remain available for reconciliation.</p>
                <blockquote className="my-2 whitespace-pre-wrap break-words rounded-md bg-muted p-2">{post.editable_caption}</blockquote>
                <form action={resolvePublication.bind(null, post.id)} className="flex flex-wrap items-end gap-2">
                  <Label className="grid gap-1">Provider post ID
                    <Input name="remoteId" inputMode={post.platform === "threads" ? "numeric" : "text"} maxLength={128} required />
                  </Label>
                  <Button type="submit" name="outcome" value="published" variant="outline">Record as published</Button>
                  <Button type="submit" name="outcome" value="discard" formNoValidate variant="outline">Close attempt</Button>
                </form>
              </details>}
            </div>
            {post.status === "published" && !post.deleted_at && post.remote_post_id && config.COMPOSIO_API_KEY && <Insights id={post.id} />}
            {post.status === "published" && !post.deleted_at && !post.live_change && post.channel_active === 1 && config.COMPOSIO_API_KEY &&
              commentLimit(post.platform, post.remote_post_id ?? "") > 0 && <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>{post.platform === "threads" ? "Add reply" : "Add comment"}</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{post.platform === "threads" ? "Reply to this Thread" : "Add a comment"}</DialogTitle>
                  <DialogDescription>The comment will appear on the live post under your connected account.</DialogDescription>
                </DialogHeader>
                <form action={addPublicationComment.bind(null, post.id)} className="grid gap-4">
                  <Label className="grid gap-1">Comment
                    <Textarea name="comment" required rows={4} maxLength={commentLimit(post.platform, post.remote_post_id ?? "")} />
                  </Label>
                  <DialogFooter showCloseButton><Button type="submit">Post {post.platform === "threads" ? "reply" : "comment"}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>}
            {!focused && post.status === "published" && post.remote_post_id && commentLimit(post.platform, post.remote_post_id) > 0 &&
              <Link href={`/dashboard/publishing?post=${post.id}#activity`} className={buttonVariants({ variant: "ghost" })}>Comment history</Link>}
            {focused === post.id && comments.length > 0 && <div className="w-full border-t pt-3">
              <h4 className="text-sm font-semibold">Comments sent from PostQ</h4>
              <ul className="mt-2 grid gap-2">
                {comments.slice(0, 10).map((comment) => <li key={comment.body} className="rounded-lg bg-muted p-3 text-sm">
                  <p className="whitespace-pre-wrap break-words">{comment.body}</p>
                  <p className="text-xs text-muted-foreground">{comment.remote_id ? "Posted" : comment.state === "not-sent" ? "Confirmed not sent. You may submit this comment again." : comment.state === "closed" ? "Closed without retry" : "Awaiting confirmation"}</p>
                  {!comment.remote_id && ["sending", "uncertain"].includes(comment.state) && <details className="mt-2">
                    <summary className="cursor-pointer">Review comment outcome</summary><p className="my-2">Check the platform first. Wait at least two minutes after submission. Only mark not sent if you have established non-delivery.</p>
                    <form action={resolveComment.bind(null, post.id)} className="flex flex-wrap gap-2">
                      <input type="hidden" name="body" value={comment.body} /><Input name="remoteId" aria-label="Confirmed provider comment ID" maxLength={256} />
                      <Button type="submit" name="outcome" value="confirmed" variant="outline">Record comment ID</Button>
                      <Button type="submit" name="outcome" value="not-sent" variant="outline">Confirmed not sent</Button>
                      <Button type="submit" name="outcome" value="closed" variant="outline">Close without retry</Button>
                    </form></details>}
                  {post.platform === "youtube" && !post.deleted_at && post.remote_post_id && comment.remote_id && <a
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(post.remote_post_id)}&lc=${encodeURIComponent(comment.remote_id)}`}
                    target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-primary underline">Open comment to pin on YouTube</a>}
                </li>)}
              </ul>
              <nav aria-label="Comment pages" className="mt-3 flex gap-4 text-sm">
                {commentPage > 1 && <Link className="underline" href={`/dashboard/publishing?post=${post.id}&comments=${commentPage - 1}#activity`}>Previous comments</Link>}
                {comments.length > 10 && <Link className="underline" href={`/dashboard/publishing?post=${post.id}&comments=${commentPage + 1}#activity`}>Older comments</Link>}
              </nav>
            </div>}
            {post.status === "published" && !post.deleted_at && post.live_change && <p role="status" className="text-sm text-muted-foreground">Live change awaiting confirmation. Check the post on the platform.</p>}
            {post.live_change && post.live_change_at && post.can_review_live_change === 1 && <details className="grid gap-2 text-sm">
              <summary className="cursor-pointer font-medium">Review live change</summary>
              <p className="my-2">Check the platform before recording whether the {post.live_change === "deleting" ? "deletion" : "edit"} took effect.</p>
              {post.live_change_caption && <blockquote className="mb-2 whitespace-pre-wrap break-words rounded-md bg-muted p-2">{post.live_change_caption}</blockquote>}
              <form action={resolveLivePublication.bind(null, post.id, post.live_change_at)} className="flex flex-wrap gap-2">
                <Button type="submit" name="outcome" value="applied" variant="outline">Record as applied</Button>
                <Button type="submit" name="outcome" value="unchanged" variant="outline">Record as unchanged</Button>
              </form>
            </details>}
            {post.status === "published" && !post.deleted_at && post.remote_post_id && post.platform === "youtube" && /^[\w-]{11}$/.test(post.remote_post_id) &&
              <a href={`https://studio.youtube.com/video/${post.remote_post_id}/edit`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Open in YouTube Studio</a>}
            {post.status === "published" && !post.deleted_at && post.remote_post_id && post.platform === "facebook" && /^\d+_\d+$/.test(post.remote_post_id) &&
              <a href={`https://www.facebook.com/${post.remote_post_id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Open on Facebook</a>}
            {post.status === "published" && !post.deleted_at && post.remote_post_id && post.platform === "pinterest" && /^\d{1,32}$/.test(post.remote_post_id) &&
              <a href={`https://www.pinterest.com/pin/${post.remote_post_id}/`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Open on Pinterest</a>}
            {post.status === "published" && !post.deleted_at && post.remote_post_id && post.platform === "linkedin" && /^urn:li:(share|ugcPost):\d+$/.test(post.remote_post_id) &&
              <a href={`https://www.linkedin.com/feed/update/${encodeURIComponent(post.remote_post_id)}/`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Open on LinkedIn</a>}
            {post.status === "published" && !post.deleted_at && post.remote_post_id && post.channel_active === 1 &&
              ["threads", "instagram"].includes(post.platform) && <form action={openLivePublication.bind(null, post.id)}>
                <Button variant="outline" type="submit">Open in {post.platform === "threads" ? "Threads" : "Instagram"}</Button>
              </form>}
            {post.status === "published" && !post.deleted_at && !post.live_change && post.channel_active === 1 && config.COMPOSIO_API_KEY &&
              ((post.platform === "facebook" && /^\d+_\d+$/.test(post.remote_post_id ?? "") && post.remote_post_id?.split("_")[0] === post.destination) ||
                (["threads", "pinterest"].includes(post.platform) && /^\d{1,32}$/.test(post.remote_post_id ?? "")) ||
                (post.platform === "youtube" && /^[\w-]{11}$/.test(post.remote_post_id ?? "")) ||
                (post.platform === "linkedin" && /^urn:li:(share|ugcPost):\d+$/.test(post.remote_post_id ?? ""))) && <div className="flex flex-wrap gap-2">
              {["facebook", "pinterest"].includes(post.platform) && <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>Edit live post</DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Edit live {post.platform === "facebook" ? "Facebook post" : "Pin"}</DialogTitle><DialogDescription>Saving updates the live post immediately.</DialogDescription></DialogHeader>
                  <form action={changeLivePublication.bind(null, post.id, "editing")} className="grid gap-4">
                    <input type="hidden" name="original" value={JSON.stringify(post.editable_caption)} />
                    <Label className="grid gap-1">{post.platform === "facebook" ? "Caption" : "Description"}<Textarea name="caption" defaultValue={post.editable_caption ?? ""} maxLength={post.platform === "pinterest" ? 800 : 10000} required={post.platform === "facebook"} /></Label>
                    <DialogFooter showCloseButton><Button type="submit">Update live post</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>}
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>Delete live post</DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Delete this live post?</DialogTitle><DialogDescription>This removes the post from the platform and keeps its delivery history in PostQ.</DialogDescription></DialogHeader>
                  <form action={changeLivePublication.bind(null, post.id, "deleting")}>
                    <DialogFooter showCloseButton><Button variant="destructive" type="submit">Delete live post</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>}
            {post.status === "scheduled" && <div className="flex flex-wrap items-end gap-2">
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>Edit content</DialogTrigger>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Edit scheduled post</DialogTitle>
                    <DialogDescription>Update the content for this delivery before it’s sent.</DialogDescription>
                  </DialogHeader>
                  <form action={editScheduledPublication.bind(null, post.id)} className="grid gap-4">
                    <input type="hidden" name="original" value={JSON.stringify([post.title, post.editable_caption, post.media_id, post.destination, post.media_ids])} />
                    <Label className="grid gap-1">Title<Input name="title" defaultValue={post.title} maxLength={post.platform==="tiktok" && [...selectedAssets,...media].find(asset=>asset.id===post.media_id)?.mime==="image/jpeg"?90:["youtube", "pinterest"].includes(post.platform) ? 100 : 160} required /></Label>
                    <Label className="grid gap-1">{post.platform === "youtube" ? "Description" : "Caption"}
                      <Textarea name="caption" defaultValue={post.editable_caption ?? ""} maxLength={10000} rows={5} />
                    </Label>
                    {post.platform === "tiktok" ? <p className="text-sm text-muted-foreground">TikTok attachment changes require a new delivery approval.</p> :
                      <div className="grid gap-1"><p className="text-sm font-medium">Media attachments</p>
                        <MediaLibraryField
                          name="media"
                          defaultValue={publicationMediaIds(post)} max={mediaLimit(post.platform)} platform={post.platform} destination={post.destination??""}
                          initial={[...selectedAssets,...media]}
                          allowed={channelMediaTypes[post.platform] ?? []}
                        />
                      </div>}
                    {post.platform === "youtube" && <Label className="grid gap-1">YouTube visibility
                      <FieldSelect
                        name="destination"
                        defaultValue={post.destination ?? ""}
                        className="w-full"
                        required
                        options={[
                          { value: "", disabled: true, label: "Choose visibility" },
                          { value: "private", label: "Private" },
                          { value: "unlisted", label: "Unlisted" },
                          { value: "public", label: "Public" }
                        ]}
                      />
                    </Label>}
                    <DialogFooter showCloseButton><Button type="submit">Save changes</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              <form action={reschedulePublication.bind(null, post.id)} className="flex flex-wrap items-end gap-2">
                <UtcDateTimePicker name="due" defaultValue={zonedMinute(post.due_at,timezone)} timezone={timezone} />
                <Button type="submit" variant="outline">Reschedule</Button>
              </form>
              <form action={cancelPublication.bind(null, post.id)}>
                <Button type="submit" variant="outline">Cancel</Button>
              </form>
            </div>}
          </Card>
        ))}
        {(page > 1 || queue.length > 25) && <nav aria-label="Publishing activity pages" className="flex gap-4 text-sm">
          {page > 1 && <Link href={queueUrl(page - 1)} className="underline">Previous page</Link>}
          {queue.length > 25 && <Link href={queueUrl(page + 1)} className="underline">Next page</Link>}
        </nav>}
      </section>
    </section>
  );
}
