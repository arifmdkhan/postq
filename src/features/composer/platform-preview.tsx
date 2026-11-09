import type { ReactNode } from "react";
import { Bookmark, Heart, MessageCircle, Repeat2, Send, Share2, ThumbsUp } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function PlatformPreview({ platform, name, subtitle, title, caption, media, story }: {
  platform: string; name: string; subtitle: string; title: string; caption: string; media: ReactNode; story: boolean;
}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();
  const profile = <div className="flex min-w-0 items-center gap-2.5">
    <Avatar><AvatarFallback className="bg-foreground font-semibold text-background">{initials}</AvatarFallback></Avatar>
    <div className="min-w-0"><p className="truncate text-sm font-semibold">{name}</p><p className="truncate text-xs text-muted-foreground">{subtitle}</p></div>
  </div>;
  const copy = <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{caption || "Your text will appear here."}</p>;
  if (platform === "youtube") return <div className="grid gap-3 p-3">
    <div className="overflow-hidden rounded-xl">{media}</div>
    <h4 className="break-words text-lg font-semibold">{title || "Video title"}</h4>
    {profile}
    <div className="flex gap-4 text-muted-foreground" aria-hidden><ThumbsUp size={17} /><Share2 size={17} /><Bookmark size={17} /></div>
    <div className="rounded-xl bg-muted p-3">{copy}</div>
  </div>;
  if (platform === "tiktok" || story) return <div className="relative isolate flex aspect-[9/16] max-h-[34rem] flex-col justify-end overflow-hidden bg-black text-white">
    <div className="absolute inset-0 -z-10 grid place-items-center [&>*]:max-h-full">{media}</div>
    <div className="grid gap-2 bg-linear-to-t from-black/95 to-black/60 p-4">
      <p className="text-sm font-semibold">{name}</p>{!story && copy}
    </div>
    {!story && <div className="absolute right-3 bottom-28 grid gap-4 rounded-full bg-black/50 p-2" aria-hidden><Heart size={20} /><MessageCircle size={20} /><Share2 size={20} /></div>}
  </div>;
  if (platform === "instagram") return <div className="grid">
    <div className="p-3">{profile}</div>
    {media}
    <div className="grid gap-3 p-3">
      <div className="flex items-center gap-4" aria-hidden><Heart size={20} /><MessageCircle size={20} /><Send size={19} /><Bookmark className="ml-auto" size={19} /></div>
      <div className="grid gap-1"><p className="text-sm font-semibold">{name}</p>{copy}</div>
    </div>
  </div>;
  if (platform === "facebook") return <div className="grid gap-3 py-3">
    <div className="grid gap-2 px-3">{profile}{copy}</div>
    {media}
    <div className="mx-3 flex justify-around border-t pt-2 text-xs text-muted-foreground" aria-hidden>
      <span className="flex items-center gap-1"><ThumbsUp size={15} />Like</span><span className="flex items-center gap-1"><MessageCircle size={15} />Comment</span><span className="flex items-center gap-1"><Share2 size={15} />Share</span>
    </div>
  </div>;
  return <div className="grid gap-3 p-3">
    {profile}{copy}
    {media && <div className="overflow-hidden rounded-xl">{media}</div>}
    <div className="flex gap-4 text-muted-foreground" aria-hidden><Heart size={18} /><MessageCircle size={18} /><Repeat2 size={18} /><Send size={18} /></div>
  </div>;
}
