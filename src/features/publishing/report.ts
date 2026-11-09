import { isPlanningDate } from "@/features/drafts/planning";
import { nextDate, zonedDayStart } from "./timezone";

export function reportFilters(userId: string, channelInput: unknown, fromInput: unknown, toInput: unknown, timezone = "UTC") {
  const channel = typeof channelInput === "string" && /^[a-f\d-]{36}$/i.test(channelInput) ? channelInput : "";
  const from = isPlanningDate(fromInput) ? fromInput : "";
  const to = isPlanningDate(toInput) ? toInput : "";
  const args = [userId, channel, channel, from ? zonedDayStart(from,timezone) : 0, to ? zonedDayStart(nextDate(to),timezone) : Number.MAX_SAFE_INTEGER] as const;
  return { channel, from, to, args };
}

export const publishedSelection = "p.user_id = ? AND p.status = 'published' AND (? = '' OR p.channel_id = ?) AND p.due_at >= ? AND p.due_at < ?";

export function csvCell(value: string | number | null) {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const text = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + text.replaceAll('"', '""') + '"';
}
