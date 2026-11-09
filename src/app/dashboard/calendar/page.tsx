import {channelOptions} from "@/features/publishing/channel-name";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/field-select";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Layers, ArrowRight, CalendarDays, Send } from "lucide-react";
import { Suspense } from "react";
import CalendarLoading from "./loading";
import { Button, buttonVariants } from "@/components/ui/button";
import { calendarMonth, dayLabel, isPlanningDate } from "@/features/drafts/planning";
import { listPlannedDrafts, plannedDayCounts } from "@/features/drafts/repository";
import { publicationCalendar } from "@/features/publishing/calendar";
import { ComposeEntry } from "@/features/composer/entry";
import { CalendarComposeButton } from "@/features/composer/calendar-button";
import { database } from "@/server/db";
import { requireUser } from "@/server/auth";
import { DatePicker } from "@/components/date-time-picker";
import { Badge } from "@/components/ui/badge";
import { workspaceTimezone } from "@/features/settings/timezone";
import { zonedMinute } from "@/features/publishing/timezone";

const shortMonth = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const views = ["Day", "Week", "Month", "Agenda"] as const;

export default function Calendar({ searchParams }: PageProps<"/dashboard/calendar">) {
  return (
    <Suspense fallback={<CalendarLoading />}>
      <CalendarContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CalendarContent({ searchParams }: Pick<PageProps<"/dashboard/calendar">, "searchParams">) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const timezone = await workspaceTimezone();
  const displayTime = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const today = zonedMinute(new Date().valueOf(),timezone).slice(0,10);
  const selected = isPlanningDate(params.day) ? params.day : today;
  const month = calendarMonth(selected);
  const view = params.view === "Day" || params.view === "Week" || params.view === "Agenda" ? params.view : "Month";
  const channel = typeof params.channel === "string" && /^[a-f\d-]{36}$/i.test(params.channel) ? params.channel : "";
  const tag = typeof params.tag === "string" ? params.tag.trim().slice(0, 48) : "";
  const calendarUrl = (day: string, mode = view) => {
    const search = new URLSearchParams({ day, view: mode });
    if (channel) search.set("channel", channel);
    if (tag) search.set("tag", tag);
    return `/dashboard/calendar?${search}`;
  };
  const selectedIndex = month.cells.findIndex(({ date }) => date === selected);
  const weekStart = Math.floor(selectedIndex / 7) * 7;
  const cells = view === "Week" ? month.cells.slice(weekStart, weekStart + 7) : month.cells;
  const visibleDates = cells.map(({ date }) => date).filter(isPlanningDate);
  const rangeStart = view === "Day" ? selected : view === "Agenda" ? month.start : visibleDates[0] ?? month.start;
  const rangeEnd = view === "Day" ? selected : view === "Agenda" ? month.end : visibleDates.at(-1) ?? month.end;
  const shift = (days: number) => new Date(Date.parse(selected) + days * 86_400_000).toISOString().slice(0, 10);
  const previous = view === "Month" || view === "Agenda" ? month.previous : shift(view === "Week" ? -7 : -1);
  const next = view === "Month" || view === "Agenda" ? month.next : shift(view === "Week" ? 7 : 1);
  const db = await database();
  const [counts, drafts, publications, { results: channels }, { results: totals }, { results: tags }] = await Promise.all([
    channel ? [] : plannedDayCounts(user.id, rangeStart, rangeEnd, tag || undefined),
    channel ? [] : listPlannedDrafts(user.id, selected, tag || undefined),
    tag ? { counts: [], selected: [] } : publicationCalendar(user.id, rangeStart, rangeEnd, selected, channel, view === "Agenda", timezone),
    db.prepare("SELECT id, platform, label, profile_name, active FROM channels WHERE user_id = ? ORDER BY platform, id").bind(user.id).all<{ id: string; platform: string; label: string | null; profile_name:string|null; active: number }>(),
    db.prepare("SELECT status, count(*) AS total FROM publications WHERE user_id = ? AND status IN ('scheduled', 'published') GROUP BY status")
      .bind(user.id).all<{ status: string; total: number }>(),
    db.prepare("SELECT DISTINCT tag FROM drafts WHERE user_id = ? AND tag IS NOT NULL ORDER BY tag LIMIT 100").bind(user.id).all<{ tag: string }>(),
  ]);
  const countsByDay = new Map(counts.map(({ planned_on, total }) => [planned_on, total]));
  const deliveryCounts = new Map(publications.counts.map(({ day, total }) => [day, total]));
  const selectedTotal = countsByDay.get(selected) ?? 0;

  return (
    <section className="flex flex-col gap-6 p-4 sm:p-7">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
        <h1 className="text-4xl font-extrabold tracking-tight">Calendar</h1>
        <p className="mt-1 text-muted-foreground">A clear view of what comes next. Times in {timezone}.</p>
      </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="flex items-center gap-2"><CalendarDays className="size-4" aria-hidden />{totals.find(({ status }) => status === "scheduled")?.total ?? 0} scheduled</span>
          <span className="flex items-center gap-2 border-l pl-4"><Send className="size-4" aria-hidden />{totals.find(({ status }) => status === "published")?.total ?? 0} published</span>
        </div>
      </header>
      {!channels.some(({ active }) => active) && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-accent px-4 py-4 text-accent-foreground sm:px-5">
          <Layers aria-hidden className="size-7 shrink-0" />
          <div className="flex-1 basis-52">
            <p className="font-bold">Your calendar starts with a social account.</p>
            <p className="text-sm">Connect an account to start publishing.</p>
          </div>
          <Link href="/dashboard/publishing" className={buttonVariants()}>Connect account <ArrowRight /></Link>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-3 text-2xl font-bold tracking-tight">{view === "Day" ? dayLabel.format(new Date(selected)) : month.title}</h2>
        {isPlanningDate(previous) && <Link aria-label={`Previous ${view.toLowerCase()}`} href={calendarUrl(previous)} className={buttonVariants({ variant: "outline", size: "icon" })}><ChevronLeft /></Link>}
        <Link href={calendarUrl(today)} className={buttonVariants({ variant: "outline" })}>Today</Link>
        {isPlanningDate(next) && <Link aria-label={`Next ${view.toLowerCase()}`} href={calendarUrl(next)} className={buttonVariants({ variant: "outline", size: "icon" })}><ChevronRight /></Link>}
        <form action="/dashboard/calendar" className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <DatePicker key={selected} label="Jump to date" name="day" defaultValue={selected} />
          <input type="hidden" name="view" value={view} />
          <FieldSelect
            key={`channel:${channel}`}
            aria-label="Filter by account"
            className="w-64 max-w-full sm:w-72"
            name="channel"
            defaultValue={channel}
            options={[
              { value: "", label: "All accounts" },
              ...channelOptions(channels)
            ]}
          />
          <FieldSelect
            key={`tag:${tag}`}
            aria-label="Filter by tag"
            name="tag"
            defaultValue={tag}
            options={[
              { value: "", label: "All tags" },
              ...((tags.map(({ tag: name }) => ({ value: name, label: name }))) ?? [])
            ]}
          />
          <Button type="submit" variant="outline">Apply</Button>
        </form>
        <nav aria-label="Calendar view" className="flex rounded-lg border p-0.5">
          {views.map((mode) => (
            <Link key={mode} href={calendarUrl(selected, mode)} aria-current={mode === view ? "page" : undefined}
              className={mode === view ? "rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground" : "rounded-md px-3 py-1.5 text-sm hover:bg-accent"}>{mode}</Link>
          ))}
        </nav>
      </div>
      {view !== "Day" && view !== "Agenda" && (
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {weekdays.map((day) => <div key={day} className="bg-sidebar py-2 text-center text-xs font-semibold">{day}</div>)}
        {cells.map(({ date, day, inMonth }) => {
          if (!isPlanningDate(date)) return <div key={date} className="bg-background" />;
          const count = countsByDay.get(date) ?? 0;
          const deliveries = deliveryCounts.get(date) ?? 0;
          return (
            <div key={date} className="group/day relative min-w-0">
              <Link href={calendarUrl(date)} prefetch={false}
              aria-describedby={`calendar-date-${date}`}
              aria-current={date === selected ? "date" : undefined}
              className={`flex h-full min-h-28 flex-col items-center gap-1 p-1 pb-11 text-sm hover:bg-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary sm:items-start sm:px-3 sm:pt-2.5 ${date === selected ? "bg-accent font-bold text-accent-foreground" : inMonth ? "bg-card" : "bg-background text-muted-foreground"}`}>
              <span className={date === today ? "rounded-full bg-primary px-1.5 font-bold text-primary-foreground" : ""}><span className="mr-1 hidden sm:inline">{date === today ? "" : shortMonth.format(new Date(date))}{" "}</span>{day}</span>
              {count > 0 && <span className="text-xs">{count}<span className="sr-only sm:not-sr-only"> planned</span></span>}
              {deliveries > 0 && <span className="text-xs text-primary">{deliveries}<span className="sr-only sm:not-sr-only"> in queue</span></span>}
              </Link>
              <span id={`calendar-date-${date}`} className="sr-only">{dayLabel.format(new Date(date))}</span>
              <CalendarComposeButton date={date} today={today} timezone={timezone} />
            </div>
          );
        })}
      </div>
      )}
      <Card className="gap-0 py-0 block space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold">{dayLabel.format(new Date(selected))}</h2>
          <ComposeEntry date={selected} calendar />
        </div>
        {drafts.length === 0 ? <p className="text-sm text-muted-foreground">No drafts planned for this day.</p> : (
          <ul className="divide-y">
            {drafts.map(({ id, title }) => <li key={id}><Link className="block break-words py-2 hover:underline" href={`/dashboard?edit=${id}`}>{title}</Link></li>)}
          </ul>
        )}
        {publications.selected.length > 0 && (
          <div className="grid gap-2 border-t pt-3">
            <Link href="/dashboard/publishing" className="w-fit text-sm font-semibold underline">Publishing queue</Link>
            <ul className="divide-y">
              {publications.selected.map((post) => <li key={post.id} className="flex flex-wrap items-center gap-2 break-words py-2 text-sm">
                <Link href={`/dashboard/publishing?post=${post.id}#activity`} className="font-medium hover:underline">{post.title}</Link>
                <span className="text-muted-foreground">· {post.platform} · {view === "Agenda" ? zonedMinute(post.due_at,timezone).slice(0,10) + " · " : ""}{displayTime.format(post.due_at)} {timezone}</span>
                <Badge variant="secondary">{post.status === "review" ? "Needs review" : post.status}</Badge>
              </li>)}
            </ul>
          </div>
        )}
        {selectedTotal > drafts.length && <p className="text-sm text-muted-foreground">Showing {drafts.length} of {selectedTotal} drafts. <Link className="underline" href="/dashboard">Browse all drafts</Link></p>}
      </Card>
    </section>
  );
}
