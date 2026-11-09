"use client";
import {useCallback,useSyncExternalStore,useState} from "react";
import Image from "next/image";
import {Film} from "lucide-react";
import {Carousel,CarouselContent,CarouselItem,CarouselPrevious,CarouselNext,type CarouselApi} from "@/components/ui/carousel";
import type {Attachment} from "./attachments";

export function AttachmentPreview({assets}:{assets:Attachment[]}){
  const [api,setApi]=useState<CarouselApi>();
  const subscribe=useCallback((listener:()=>void)=>{api?.on("select",listener);api?.on("reInit",listener);return()=>{api?.off("select",listener);api?.off("reInit",listener);};},[api]);
  const index=useSyncExternalStore(subscribe,()=>api?.selectedScrollSnap()??0,()=>0);
  return <Carousel setApi={setApi} className="min-w-0" aria-label="Attachment preview">
    <CarouselContent>{assets.map((asset,position)=><CarouselItem key={asset.id}>
      {asset.mime.startsWith("image/")?<Image src={`/api/media/${asset.id}?thumbnail`} width={560} height={400} alt={asset.name} unoptimized className="max-h-96 w-full bg-muted object-contain" />
        :position===index?<video controls preload="metadata" src={`/api/media/${asset.id}?preview`} className="max-h-96 w-full bg-black object-contain" />
          :<div className="grid aspect-video place-items-center bg-muted"><Film aria-hidden /><span>Video {position+1}</span></div>}
    </CarouselItem>)}</CarouselContent>
    {assets.length>1&&<div className="flex items-center justify-between gap-3 p-2"><CarouselPrevious className="static translate-y-0" /><span className="text-xs text-muted-foreground" aria-live="polite">{index+1} / {assets.length}</span><CarouselNext className="static translate-y-0" /></div>}
  </Carousel>;
}
