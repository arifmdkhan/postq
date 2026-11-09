"use client";

import { useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { zonedMinute } from "@/features/publishing/timezone";

export const calendarComposeEvent = "postq:calendar-compose";

function subscribe(listener: () => void) {
  const timer = setInterval(listener, 60_000);
  return () => clearInterval(timer);
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CalendarComposeButton({ date, today, timezone }: { date: string; today: string; timezone: string }) {
  const localToday = useSyncExternalStore(subscribe, () => zonedMinute(Date.now(),timezone).slice(0,10), () => today);
  if (date < localToday) return null;
  return <Button type="button" variant="outline" size="icon-sm" aria-label={`Create post for ${date}`}
    className="absolute right-1 bottom-1 z-20 size-8 opacity-100 focus-visible:opacity-100 md:size-9 md:opacity-0 md:group-hover/day:opacity-100 md:group-focus-within/day:opacity-100"
    onClick={() => window.dispatchEvent(new CustomEvent(calendarComposeEvent, { detail: date }))}><Plus /></Button>;
}
