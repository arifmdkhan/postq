import { database } from "@/server/db";
import { requireUser } from "@/server/auth";
import { csvCell, publishedSelection, reportFilters } from "@/features/publishing/report";
import { workspaceTimezone } from "@/features/settings/timezone";

export async function GET(request: Request) {
  const user = await requireUser();
  const query = new URL(request.url).searchParams;
  const { args } = reportFilters(user.id, query.get("channel"), query.get("from"), query.get("to"), await workspaceTimezone());
  const db = await database();
  const { results } = await db.prepare(`SELECT p.id,p.title,c.platform,c.label,p.due_at,p.remote_post_id,m.name,m.value,m.captured_at
    FROM publications p JOIN channels c ON c.id = p.channel_id
    LEFT JOIN publication_metrics_latest m ON p.id=m.publication_id WHERE ${publishedSelection}
    ORDER BY p.due_at DESC,p.id,m.name LIMIT 10001`).bind(...args)
    .all<{ title: string; platform: string; label: string | null; due_at: number; remote_post_id: string | null; name: string | null; value: number | null; captured_at: number | null }>();
  if (results.length > 10000) return new Response("Choose a shorter date range to export this report.", { status: 413 });
  const rows = results.map((post) => [
    post.title, post.platform, post.label, new Date(post.due_at).toISOString(), post.remote_post_id, post.name, post.value,
    post.captured_at === null ? null : new Date(post.captured_at).toISOString(),
  ].map(csvCell).join(","));
  return new Response(["Title,Platform,Account,Scheduled UTC,Provider ID,Metric,Value,Snapshot UTC", ...rows].join("\r\n") + "\r\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="postq-analytics.csv"', "cache-control": "private, no-store" },
  });
}
