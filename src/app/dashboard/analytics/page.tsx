import {channelOptions} from "@/features/publishing/channel-name";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/field-select";
import Link from "next/link";
import { BarChart3, Share2 } from "lucide-react";
import { Suspense } from "react";
import AnalyticsLoading from "./loading";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { Insights } from "@/features/publishing/insights";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-time-picker";
import { publishedSelection as selection, reportFilters } from "@/features/publishing/report";
import { workspaceTimezone } from "@/features/settings/timezone";

export default function AnalyticsPage({ searchParams }: PageProps<"/dashboard/analytics">) {
  return <Suspense fallback={<AnalyticsLoading />}><Analytics searchParams={searchParams} /></Suspense>;
}

async function Analytics({ searchParams }: Pick<PageProps<"/dashboard/analytics">, "searchParams">) {
  const [user, filters] = await Promise.all([requireUser(), searchParams]);
  const db = await database();
  const timezone = await workspaceTimezone();
  const displayTime=new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:timezone});
  const { channel, from, to, args } = reportFilters(user.id, filters.channel, filters.from, filters.to, timezone);
  const page = typeof filters.page === "string" && /^[1-9]\d{0,5}$/.test(filters.page) ? Number(filters.page) : 1;
  const pageUrl = (number: number) => "/dashboard/analytics?" + new URLSearchParams({channel,from,to,page:String(number)});
  const [total, { results: channels }, { results: posts }, { results: metrics }] = await Promise.all([
    db.prepare(`SELECT count(*) AS total FROM publications p WHERE ${selection}`).bind(...args).first<number>("total"),
    db.prepare("SELECT id, platform, label, profile_name, active FROM channels WHERE user_id = ? ORDER BY platform, id").bind(user.id).all<{ id: string; platform: string; label: string | null; profile_name:string|null; active: number }>(),
    db.prepare(`SELECT p.id,p.title,c.platform FROM publications p JOIN channels c ON c.id=p.channel_id WHERE ${selection} ORDER BY p.due_at DESC,p.id DESC LIMIT 26 OFFSET ?`)
      .bind(...args,(page-1)*25).all<{ id: string; title: string; platform: string }>(),
    db.prepare(`SELECT m.name,sum(m.value) AS total,max(m.captured_at) AS captured_at,min(m.captured_at) AS oldest_at,count(*) AS coverage
      FROM publication_metrics_latest m JOIN publications p ON p.id=m.publication_id WHERE ${selection} GROUP BY m.name`)
      .bind(...args).all<{ name: string; total: number; captured_at: number; oldest_at: number; coverage: number }>(),
  ]);
  const connected = channels.filter(({ active }) => active).length;
  const views = metrics.find(({ name }) => name === "views")?.total;
  const engagement = metrics.filter(({ name }) => ["likes","reactions","comments","replies","reposts","quotes","shares","saves","pin_clicks","outbound_clicks"].includes(name));
  return (
    <section className="flex flex-col gap-5 p-4 sm:p-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-4xl font-extrabold">Analytics</h1><p className="mt-1 text-muted-foreground">Performance and delivery history across your accounts.</p></div>
        <a className={buttonVariants({ variant: "outline" })} href={`/api/analytics/export?${new URLSearchParams({ channel, from, to })}`} download>Export CSV</a>
      </header>
      <form className="flex flex-wrap items-end gap-3" action="/dashboard/analytics">
        <Label className="grid min-w-0 max-w-full gap-1 text-sm">Account<FieldSelect
                                                       name="channel"
                                                       defaultValue={channel}
                                                       className="h-8 w-64 max-w-full rounded-md border bg-card px-2 sm:w-72"
                                                       options={[
                                                         { value: "", label: "All accounts" },
                                                         ...channelOptions(channels)
                                                       ]}
                                                     /></Label>
        <div className="w-fit"><DatePicker key={from} label={`Scheduled from (${timezone})`} name="from" defaultValue={from} /></div>
        <div className="w-fit"><DatePicker key={to} label={`Scheduled through (${timezone})`} name="to" defaultValue={to} /></div>
        <Button type="submit">Apply</Button>
      </form>
      <Card className="gap-0 py-0"><dl className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
        {[["Published posts", total ?? 0, "Selected posts"], ["Views", views ?? "—", "Latest snapshots"], ["Engagement", engagement.length ? engagement.reduce((sum, metric) => sum + metric.total, 0) : "—", "Latest snapshots"], ["Connected accounts", connected, "Across your studio"]].map(([label, value, detail]) =>
          <div key={label} className="grid gap-1 p-4 sm:p-6"><dt className="text-sm font-medium">{label}</dt><dd className="text-4xl font-bold tracking-tight tabular-nums">{value}</dd><dd className="text-sm text-muted-foreground">{detail}</dd></div>)}
      </dl></Card>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="gap-0 py-0 block rounded-xl border bg-card p-5">
          <h2 className="text-xl font-bold tracking-tight">Performance</h2>
          <p className="text-sm text-muted-foreground">Metrics depend on what each account shares.</p>
          <div className="mt-5 grid min-h-44 place-content-center justify-items-center gap-2 border-y border-dashed text-center">
            <BarChart3 className="size-8 text-primary" aria-hidden />
            <p className="font-semibold">{metrics.length ? "Latest available totals for selected posts" : "Load post insights below to collect metrics"}</p>
            {metrics.length > 0 && <p className="text-sm text-muted-foreground">Last snapshot {displayTime.format(Math.max(...metrics.map(({captured_at})=>captured_at)))} {timezone}</p>}
            {metrics.length > 0 && <ul className="mt-3 grid gap-1 text-left text-sm">{metrics.map((metric) => <li key={metric.name}>{metric.name.replaceAll("_"," ")}: {metric.total.toLocaleString()} · {metric.coverage} of {total ?? 0} posts · snapshots {displayTime.format(metric.oldest_at)} to {displayTime.format(metric.captured_at)} {timezone}</li>)}</ul>}
          </div>
        </Card>
        <Card className="gap-0 py-0  flex flex-col gap-4 rounded-xl border bg-card p-5">
          <h2 className="text-xl font-bold tracking-tight">Accounts</h2>
          <div className="grid flex-1 place-content-center justify-items-center gap-3 py-4 text-center">
            <Share2 className="size-8 text-primary" aria-hidden />
            <p>{connected ? `${connected} connected` : "Connect an account to get started."}</p>
            <Link href="/dashboard/publishing" className={buttonVariants()}>Manage accounts</Link>
          </div>
        </Card>
      </div>
      <Card className="gap-0 py-0 block overflow-hidden rounded-xl border bg-card">
        <h2 className="px-5 py-4 text-xl font-bold tracking-tight">Published content</h2>
        <div className="divide-y border-t">
          {posts.length ? posts.slice(0,25).map(({ id, title, platform }) => (
            <article key={id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div><h3 className="font-semibold">{title}</h3><p className="text-sm text-muted-foreground capitalize">{platform}</p></div><Insights id={id} />
            </article>
          )) : <p className="px-5 py-10 text-center text-sm text-muted-foreground">Your published posts will appear here.</p>}
        </div>
      </Card>
      <nav aria-label="Analytics pages" className="flex gap-4 text-sm">{page>1&&<Link className="underline" href={pageUrl(page-1)}>Previous</Link>}{posts.length>25&&<Link className="underline" href={pageUrl(page+1)}>Older posts</Link>}</nav>
    </section>
  );
}

