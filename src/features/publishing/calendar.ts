import { database } from "@/server/db";
import { nextDate, zonedDayStart } from "./timezone";

const dayMs = 86_400_000;

export async function publicationCalendar(userId: string, start: string, end: string, day: string, channel: string, agenda: boolean, timezone = "UTC") {
  const db = await database();
  const from = zonedDayStart(day, timezone);
  const days = Array.from({ length: Math.min(42, Math.round((Date.parse(end) - Date.parse(start)) / dayMs) + 1) }, (_, index) => {
    const date = new Date(Date.parse(start) + index * dayMs).toISOString().slice(0,10);
    return { day: date, from: zonedDayStart(date, timezone), to: zonedDayStart(nextDate(date), timezone) };
  });
  const [counts, selected] = await db.batch([
    db.prepare(
      `SELECT json_extract(r.value,'$.day') AS day,count(p.id) AS total FROM json_each(?) r
       LEFT JOIN publications p ON p.user_id=? AND p.status<>'cancelled' AND p.due_at>=json_extract(r.value,'$.from')
       AND p.due_at<json_extract(r.value,'$.to') AND (?='' OR p.channel_id=?) GROUP BY day`,
    ).bind(JSON.stringify(days), userId, channel, channel),
    db.prepare(
      `SELECT p.id, p.title, p.status, p.due_at, c.platform FROM publications p JOIN channels c ON c.id = p.channel_id
       WHERE p.user_id = ? AND p.status <> 'cancelled' AND p.due_at >= ? AND p.due_at < ?
       AND (? = '' OR p.channel_id = ?) ORDER BY p.due_at LIMIT ?`,
    ).bind(userId, agenda ? zonedDayStart(start,timezone) : from, zonedDayStart(nextDate(agenda ? end : day),timezone), channel, channel, agenda ? 100 : 20),
  ]);
  return {
    counts: counts.results as { day: string; total: number }[],
    selected: selected.results as { id: string; title: string; status: string; due_at: number; platform: string }[],
  };
}

