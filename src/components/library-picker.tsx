"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type LibraryItem = { id: string; name: string; mime?: string };
export function LibraryPicker({ kind, label, value, initial, onSelect, allowed, empty = "None", extras = [], disabled = false, selectedIds }: {
  kind: "media" | "draft"; label: string; value: string; initial: LibraryItem[]; onSelect: (item: LibraryItem) => void;
  allowed?: readonly string[]; empty?: string; extras?: LibraryItem[]; disabled?: boolean;
  selectedIds?:string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selected, setSelected] = useState<LibraryItem>();
  const [next, setNext] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mime = allowed?.join(",") ?? "";
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ kind, q: query, page: String(page) });
      if (mime) params.set("mime", mime);
      void fetch("/api/library?" + params, { signal: controller.signal, redirect: "error" }).then(async (response) => {
        if (!response.ok) throw new Error("Library unavailable");
        const result = await response.json() as { items: LibraryItem[]; next: boolean };
        if (!Array.isArray(result.items) || typeof result.next !== "boolean") throw new Error("Invalid library response");
        if (controller.signal.aborted) return;
        setItems(result.items); setNext(result.next);
      }).catch(() => { if (!controller.signal.aborted) setError("Could not load the library. Check connectivity and sign-in, then retry."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, kind, query, page, mime]);
  const current = [...extras, ...initial, ...(selected ? [selected] : [])].find((item) => item.id === value);
  const choose = (item: LibraryItem) => { setSelected(item); onSelect(item); if(!selectedIds)setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button type="button" variant="outline" disabled={disabled} className="max-w-full justify-start truncate" aria-label={selectedIds?`${label}: Add from library (${selectedIds.length} selected)`:`${label}: ${current?.name || (value ? "Saved selection · browse library" : empty)}`} />}>
      {selectedIds ? `Add from library (${selectedIds.length} selected)` : current?.name || (value ? "Saved selection · browse library" : empty)}
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>Search all saved {kind === "media" ? "media" : "drafts"}.</DialogDescription></DialogHeader>
      <Input aria-label={`Search ${kind}`} type="search" value={query} maxLength={120} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
      <div className="grid gap-2">
        <Button variant="ghost" type="button" onClick={() => choose({ id: "", name: empty })}>{empty}</Button>
        {extras.map((item) => <Button key={item.id} variant="ghost" type="button" onClick={() => choose(item)}>{item.name}</Button>)}
        {items.map((item) => selectedIds ? <Label key={item.id} className="flex min-h-10 items-center gap-3 rounded-lg border p-3"><Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={()=>choose(item)} /><span className="break-all">{item.name}</span></Label> : <Button key={item.id} variant={value === item.id ? "default" : "outline"} type="button" className="h-auto min-h-10 justify-start whitespace-normal break-all" onClick={() => choose(item)}>{item.name}</Button>)}
      </div>
      {loading && <p role="status">Loading…</p>}{error && <p role="alert">{error}</p>}
      {!loading && !error && !items.length && <p>No matching items.</p>}
      <nav aria-label={`${label} pages`} className="flex gap-2">
        <Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button type="button" variant="outline" disabled={!next || loading} onClick={() => setPage(page + 1)}>Next</Button>
        {error && <Button type="button" onClick={() => { setOpen(false); setTimeout(() => setOpen(true), 0); }}>Retry</Button>}
      </nav>
      {selectedIds && <Button type="button" onClick={()=>setOpen(false)}>Done · {selectedIds.length} selected</Button>}
    </DialogContent>
  </Dialog>;
}
