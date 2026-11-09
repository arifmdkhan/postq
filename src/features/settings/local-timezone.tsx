"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { detectLocalTimezone } from "./actions";
import { StudioLoading } from "@/components/screen-loading";
import { zonedMinute } from "@/features/publishing/timezone";

function subscribe(listener:()=>void){
  window.addEventListener("focus",listener);
  document.addEventListener("visibilitychange",listener);
  return()=>{window.removeEventListener("focus",listener);document.removeEventListener("visibilitychange",listener);};
}
function deviceTimezone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return "";}}
export function useDeviceTimezone(){return useSyncExternalStore(subscribe,deviceTimezone,()=>"");}

export function LocalTimezone({timezone,mode,ready,children}:{timezone:string;mode:"auto"|"manual";ready:boolean;children:React.ReactNode}) {
  const router=useRouter(),pathname=usePathname();
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!ready)return;
    let day=zonedMinute(Date.now(),timezone).slice(0,10);
    const check=()=>{
      const next=zonedMinute(Date.now(),timezone).slice(0,10);
      if(next!==day){day=next;router.refresh();}
    };
    const timer=setInterval(check,60000);
    window.addEventListener("focus",check);
    return()=>{clearInterval(timer);window.removeEventListener("focus",check);};
  },[timezone,ready,router]);
  useEffect(()=>{
    if(mode!=="auto")return;
    let active=true;
    const sync=()=>{
      const local=deviceTimezone();
      setError("");
      if(ready && local===timezone)return;
      void detectLocalTimezone(local).then(result=>{
        if(active && (result.changed || result.mode!==mode || !ready))router.refresh();
      }).catch(()=>{if(active)setError("Could not detect your local timezone. Retry or choose a timezone in Settings.");});
    };
    const timer=setTimeout(sync,0);
    window.addEventListener("focus",sync);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener("focus",sync);};
  },[mode,timezone,ready,retry,router]);
  const invalidManual=!ready && mode==="manual";
  const message=invalidManual?"Your saved timezone is unavailable. Choose a valid timezone in Settings.":error;
  const controls=(invalidManual || mode==="auto" && error) && <Alert variant="destructive" className="m-4 w-auto"><AlertTitle>Choose your timezone</AlertTitle><AlertDescription><p>{message}</p><div className="mt-3 flex gap-3">{mode==="auto"&&<Button variant="outline" onClick={()=>setRetry(retry+1)}>Retry</Button>}<Link className="self-center underline" href="/dashboard/settings">Timezone settings</Link></div></AlertDescription></Alert>;
  if(!ready && pathname!=="/dashboard/settings")return controls || <StudioLoading label="Setting your local timezone" />;
  return <>{controls}{children}</>;
}
