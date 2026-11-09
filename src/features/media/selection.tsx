"use client";
import { useId, useRef, useState } from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { LibraryPicker } from "@/components/library-picker";
import { uploadMediaFile } from "./upload";
import type { Attachment } from "./attachments";

export function MediaSelection({label,value,assets,allowed,max,disabled,onChange,onAsset,onBusy,uploadEnabled=true}:{
  label:string;value:string[];assets:Attachment[];allowed:readonly string[];max:number;disabled?:boolean;
  onChange:(ids:string[])=>void;onAsset:(asset:Attachment)=>void;onBusy?:(busy:boolean)=>void;
  uploadEnabled?:boolean;
}){
  const [error,setError]=useState("");
  const inputId=useId();
  const [progress,setProgress]=useState("");
  const [failed,setFailed]=useState<File[]>([]);
  const busy=useRef(false);
  async function upload(files:File[]){
    if(disabled || busy.current || !files.length)return;
    if(files.length+value.length>max){setError(`This selection allows ${max} files. Remove attachments or choose fewer files.`);return;}
    busy.current=true;onBusy?.(true);setError("");
    const next=[...value],failures:File[]=[],messages:string[]=[];
    try {
      for(const [index,file]of files.entries()){
        setProgress(`Uploading ${index+1} of ${files.length}: ${file.name}`);
        try {const asset=await uploadMediaFile(file,"",allowed);onAsset(asset);next.push(asset.id);onChange([...next]);}
        catch(error){failures.push(file);messages.push(`${file.name}: ${error instanceof Error?error.message:"Upload failed."}`);}
      }
    } finally {setFailed(failures);setError(messages.join("\n"));setProgress("");busy.current=false;onBusy?.(false);}
  }
  const locked=disabled || Boolean(progress);
  const move=(index:number,delta:number)=>{const next=[...value];[next[index],next[index+delta]]=[next[index+delta],next[index]];onChange(next);};
  return <div className="grid min-w-0 gap-3">
    <p className="text-xs text-muted-foreground">{value.length} / {max} selected · First item is the cover. Reorder with the arrow buttons.</p>
    <ol aria-label={`${label} attachments`} className="grid auto-rows-max gap-2">
      {value.map((id,index)=>{const asset=assets.find(item=>item.id===id),name=asset?.name??"Saved attachment";return <li key={id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
        <span className="text-xs text-muted-foreground">{index+1}</span>
        {asset?.mime.startsWith("image/")&&<Image src={`/api/media/${id}?thumbnail`} alt="" width={36} height={36} unoptimized className="size-9 rounded object-cover" />}
        <span className="min-w-0 flex-1 truncate text-sm" title={name}>{name}</span>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} earlier`} disabled={locked || index===0} onClick={()=>move(index,-1)}><ArrowUp /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} later`} disabled={locked || index===value.length-1} onClick={()=>move(index,1)}><ArrowDown /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={locked} onClick={()=>onChange(value.filter(item=>item!==id))}><X /></Button>
        </div>
      </li>;})}
    </ol>
    {uploadEnabled&&<Field className="grid gap-2 rounded-lg border border-dashed p-3" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void upload([...event.dataTransfer.files]);}}>
      <FieldLabel htmlFor={inputId}>Upload {label}</FieldLabel><FieldDescription>Browse or drop multiple files here.</FieldDescription>
      <Input id={inputId} type="file" multiple accept={allowed.join(",")} disabled={locked || value.length>=max} aria-label={`Upload ${label}`} onChange={event=>{const files=[...event.currentTarget.files??[]];event.currentTarget.value="";void upload(files);}} />
    </Field>}
    <LibraryPicker kind="media" label={`Choose ${label}`} value="" selectedIds={value} initial={assets} allowed={allowed} disabled={locked}
      empty="Clear selection" onSelect={item=>{
        if(!item.id){onChange([]);return;}
        if(value.includes(item.id)){onChange(value.filter(id=>id!==item.id));return;}
        if(value.length>=max){setError(`Choose at most ${max} attachments.`);return;}
        if(item.mime)onAsset({...item,mime:item.mime});onChange([...value,item.id]);setError("");
      }} />
    {progress&&<p role="status" className="break-words text-sm">{progress}</p>}
    {error&&<p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>}
    {failed.length>0&&<Button type="button" variant="outline" disabled={locked} onClick={()=>void upload(failed)}>Retry {failed.length} failed uploads</Button>}
  </div>;
}
