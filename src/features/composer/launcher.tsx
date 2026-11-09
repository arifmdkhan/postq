"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadComposer } from "./load";
import { calendarComposeEvent } from "./calendar-button";

const Composer = dynamic(() => import("./composer").then((module) => module.Composer), { ssr: false });
export function ComposerLauncher({ date, compact = false, draftId, calendar = false, openInitially = false }: {
  date?: string; compact?: boolean; draftId?: string; calendar?: boolean; openInitially?: boolean;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadComposer>> | null>(null);
  const [selectedDate, setSelectedDate] = useState(date);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = useCallback(async (forDate?: string) => {
    returnFocus.current=document.activeElement instanceof HTMLElement && document.activeElement!==document.body ? document.activeElement : null;
    setLoading(true); setError(""); setSelectedDate(forDate);
    try { setData(await loadComposer(draftId)); }
    catch { setError("Could not open the composer. Check sign-in and connectivity, or reload the draft."); }
    finally { setLoading(false); }
  }, [draftId]);
  useEffect(() => {
    if (!openInitially) return;
    const timer=setTimeout(() => { void open(date); },0);
    return () => clearTimeout(timer);
  }, [openInitially, open, date]);
  useEffect(() => {
    if (!calendar) return;
    const listener = (event: Event) => { void open((event as CustomEvent<string>).detail); };
    window.addEventListener(calendarComposeEvent, listener);
    return () => window.removeEventListener(calendarComposeEvent, listener);
  }, [calendar, open]);
  return <div className="contents">
    <Button type="button" size={compact ? "icon-sm" : "default"} variant={compact ? "outline" : "default"}
      ref={trigger} disabled={loading} aria-label={compact ? "Create draft on selected day" : undefined} onClick={() => { void open(date); }}>
      <Plus />{!compact && (loading ? "Opening…" : draftId ? "Edit and schedule draft" : "Create post")}
    </Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {data && <Composer {...data} date={selectedDate} compact={compact} calendar={false} openInitially hideTrigger onClosed={() => {
      setData(null);
      requestAnimationFrame(()=>{(returnFocus.current?.isConnected ? returnFocus.current : trigger.current)?.focus();});
    }} />}
  </div>;
}
