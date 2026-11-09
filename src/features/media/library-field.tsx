"use client";
import {useState} from "react";
import type {LibraryItem} from "@/components/library-picker";
import {attachmentIds} from "./attachments";
import {MediaSelection} from "./selection";
import {FieldSelect} from "@/components/field-select";
import {Label} from "@/components/ui/label";
import {attachmentError,mediaLimit} from "@/features/publishing/media-policy";
export function MediaLibraryField({ name, defaultValue = "", initial, allowed, max=35, platform, destination="" }: {
  name: string; defaultValue?: string|string[]; initial: LibraryItem[]; allowed: readonly string[]; max?:number; platform?:string; destination?:string;
}) {
  const [value, setValue] = useState(()=>attachmentIds(defaultValue));
  const [placement,setPlacement]=useState(destination||"feed");
  const [assets,setAssets]=useState(initial.filter((item):item is LibraryItem&{mime:string}=>Boolean(item.mime)));
  const selected=value.flatMap(id=>assets.find(asset=>asset.id===id)??[]);
  const problem=platform?attachmentError(platform,selected,placement,false):null;
  return <><input type="hidden" name={name} value={JSON.stringify(value)} /><MediaSelection label="Scheduled media" value={value} assets={assets} max={platform?mediaLimit(platform,placement):max} allowed={allowed} uploadEnabled={false}
    onChange={setValue} onAsset={item=>setAssets(current=>[...current.filter(asset=>asset.id!==item.id),item])} />
    {platform==="instagram"&&<Label className="grid gap-1">Instagram placement<FieldSelect name="destination" value={placement} onValueChange={value=>setPlacement(value??"feed")} className="w-full" options={[{value:"feed",label:"Feed / Reel"},{value:"story",label:"Story"}]} /></Label>}
    {problem&&<p role="alert" className="text-sm text-destructive">{problem}</p>}
  </>;
}
