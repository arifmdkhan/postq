export async function clientThumbnail(file: File): Promise<Blob | null> {
  if (file.type==="image/jpeg" || file.type==="image/png") return null;
  const url = URL.createObjectURL(file);
  let bitmap: ImageBitmap | undefined;
  let video: HTMLVideoElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let source: CanvasImageSource;
    let width: number;
    let height: number;
    if (file.type.startsWith("video/")) {
      video=document.createElement("video"); video.muted=true; video.preload="auto"; video.src=url;
      await new Promise<void>((resolve,reject)=>{video!.onloadeddata=()=>resolve();video!.onerror=()=>reject(new Error("No video preview"));timer=setTimeout(()=>reject(new Error("Preview timeout")),8000);});
      source=video; width=video.videoWidth; height=video.videoHeight;
    } else { bitmap=await createImageBitmap(file); source=bitmap; width=bitmap.width; height=bitmap.height; }
    if (!width || !height) return null;
    const scale=Math.min(1,480/Math.max(width,height));
    const canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round(width*scale)); canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext("2d")!.drawImage(source,0,0,canvas.width,canvas.height);
    return await new Promise((resolve)=>canvas.toBlob(resolve,"image/jpeg",0.75));
  } catch { return null; }
  finally { clearTimeout(timer); bitmap?.close(); if(video){video.onloadeddata=null;video.onerror=null;video.removeAttribute("src");video.load();} URL.revokeObjectURL(url); }
}
