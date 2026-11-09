import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { workspaceTimezone } from "@/features/settings/timezone";
import ReviewLoading from "./loading";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { ReviewPayload, ReviewRequest } from "@/features/mcp/service";
import { ReviewControls } from "./review-controls";

const labels: Record<string, string> = { link: "Destination link", alt: "Image alt text", section: "Board section", topic: "Topic", "reply-control": "Who can reply", audience: "YouTube audience", "share-to-feed": "Share to feed", "synthetic-media": "Synthetic media disclosure", duration: "Video duration (seconds)", music: "Music terms confirmed", comment: "Allow comments", duet: "Allow duets", stitch: "Allow stitches", "own-brand": "Own brand disclosure", "paid-brand": "Paid promotion", commercial: "Commercial content", ai: "AI-generated disclosure", "first-comment": "First comment" };
export default function MCPReviewPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  return <Suspense fallback={<ReviewLoading />}><Review searchParams={searchParams} /></Suspense>;
}
async function Review({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const user = await requireUser();
  const { request } = await searchParams;
  const db = await database();
  const row = await db.prepare(`SELECT r.*,t.name AS client_name,t.revoked_at AS token_revoked,t.expires_at AS token_expiry,CAST(strftime('%s','now') AS INTEGER)*1000 AS server_now
    FROM mcp_requests r JOIN mcp_tokens t ON t.id=r.token_id WHERE r.id=? AND r.user_id=?`)
    .bind(request ?? "", user.id).first<ReviewRequest & { client_name: string; token_revoked: number | null; token_expiry: number; claimed_at: number | null; server_now: number }>();
  if (!row) return <section className="grid gap-4 p-7"><h1 className="text-2xl font-semibold">Request unavailable</h1><p className="text-muted-foreground">Check that you are signed in to the correct PostQ workspace.</p><Link href="/dashboard/settings?tab=integrations" className="underline">Back to integrations</Link></section>;
  const payload: ReviewPayload = JSON.parse(row.payload);
  const now = row.server_now;
  const expired = row.expires_at <= now || row.token_expiry <= now || Boolean(row.token_revoked);
  const recoverable = row.state === "approving" && (row.claimed_at ?? now) < now - 120000;
  const ready = !expired && (row.state === "pending" || recoverable);
  const status = expired && row.state === "pending" ? "Expired" : row.state;
  const timezone=await workspaceTimezone();
  const displayTime=new Intl.DateTimeFormat("en",{dateStyle:"full",timeStyle:"short",timeZone:timezone});
  const date=displayTime.format(new Date(payload.dueAt));
  return <section className="mx-auto grid w-full max-w-4xl gap-5 p-4 sm:p-7">
    <header className="grid gap-2"><div className="flex items-center gap-2"><ShieldCheck className="size-5" /><Badge variant="outline" className="capitalize">{status}</Badge></div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Review {row.kind === "schedule" ? "scheduled post" : row.kind === "cancel" ? "cancellation" : "reschedule"}</h1>
      <p className="text-sm text-muted-foreground">Requested by {row.client_name}. This request cannot run until you approve it here.</p></header>
    {expired && <Alert variant="destructive"><AlertTitle>Approval unavailable</AlertTitle><AlertDescription>The request or its access token expired, or the token was revoked. Ask the client to prepare a new request.</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>{payload.title}</CardTitle><CardDescription>{row.kind === "cancel" ? "Cancel this queued delivery" : date + " · " + timezone}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        {row.kind==="cancel" && <p className="text-sm">Currently scheduled for {date} {timezone}</p>}
        {payload.timezone && payload.timezone!==timezone && <p className="text-xs text-muted-foreground">The client requested this instant in {payload.timezone}; shown above in your workspace timezone.</p>}
        {payload.expectedDue && row.kind === "reschedule" && <p className="text-sm">Previous time: {displayTime.format(new Date(payload.expectedDue))} {timezone}</p>}
        {payload.caption && <p className="text-sm leading-6 whitespace-pre-wrap wrap-anywhere">{payload.caption}</p>}
        {payload.targets?.map((target, index) => <Card role="article" key={index} className="grid gap-3 p-4">
          <h2 className="flex items-center gap-2 font-medium"><Image src={"/social/" + target.platform + ".svg"} alt={target.platform} width={20} height={20} />{target.name}</h2>
          {target.title !== payload.title && <p className="font-medium">{target.title}</p>}
          <p className="text-sm leading-6 whitespace-pre-wrap wrap-anywhere">{target.caption || "No caption"}</p>
          {(target.mediaIds??(target.mediaId?[target.mediaId]:[])).length>0&&<ol className="grid gap-2">{(target.mediaIds??[target.mediaId!]).map((id,index)=><li key={id}><a href={"/api/media/"+id} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">{index+1}. {target.mediaNames?.[index]??target.mediaName??"Attachment"}{index===0?" · Cover":""}</a></li>)}</ol>}
          {target.destination && <p className="break-all text-sm text-muted-foreground">Destination: {target.destination}</p>}
          {Object.entries(target.options).length > 0 && <dl className="grid gap-2 text-sm">{Object.entries(target.options).map(([key, value]) => <div key={key} className="grid gap-1 sm:grid-cols-[12rem_1fr]"><dt className="text-muted-foreground">{labels[key] ?? key}</dt><dd className="whitespace-pre-wrap wrap-anywhere">{value}</dd></div>)}</dl>}
        </Card>)}
      </CardContent>
    </Card>
    {row.result && <Alert><AlertDescription>{JSON.parse(row.result).message ?? "This request was handled. Check its delivery status in Accounts."}</AlertDescription></Alert>}
    <p className="text-xs text-muted-foreground">Approval applies only to this saved request. PostQ rechecks draft versions, account access, media rules, and future time before scheduling.</p>
    <ReviewControls id={row.id} ready={ready} kind={row.kind} />
    <div className="flex flex-wrap gap-3"><Link className={buttonVariants({ variant: "outline" })} href="/dashboard/publishing#activity">View deliveries</Link><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/settings?tab=integrations">Back to integrations</Link></div>
  </section>;
}
