import { decode } from "fast-png";

export async function decodePng(bytes: Uint8Array, width: number, height: number) {
  const chunks: Uint8Array[] = [bytes.subarray(0,8)];
  const compressed: Uint8Array[] = [];
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let ended = false;
  for (let offset=8,count=0;offset<bytes.length;count++) {
    if (count>4096 || offset+12>bytes.length) throw new Error("Invalid PNG chunks.");
    const length=view.getUint32(offset);
    const end=offset+12+length;
    if(end>bytes.length) throw new Error("Truncated PNG chunk.");
    const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(count===0 && (type!=="IHDR" || length!==13)) throw new Error("Invalid PNG header.");
    if(type==="IHDR" && count!==0) throw new Error("PNG contains multiple headers.");
    if(type[0]===type[0].toUpperCase() && !["IHDR","PLTE","IDAT","IEND"].includes(type)) throw new Error("Unsupported critical PNG chunk.");
    if(type==="acTL") throw new Error("Use a static PNG image.");
    // Do not inflate optional embedded profiles/text; originals remain untouched in storage.
    if(["IHDR","PLTE","tRNS","IDAT","IEND"].includes(type)) chunks.push(bytes.subarray(offset,end));
    if(type==="IDAT") compressed.push(bytes.subarray(offset+8,end-4));
    if(type==="IEND") {ended=true;break;}
    offset=end;
  }
  if(!ended || !compressed.length) throw new Error("PNG image data is missing.");
  const depth=bytes[24],color=bytes[25];
  const channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
  if(!channels || ![1,2,4,8,16].includes(depth) || width*height*channels*Math.max(1,depth/8)>24_000_000) throw new Error("PNG decoded data exceeds 24 MB. Reduce dimensions or bit depth.");
  const reader=new Blob(compressed.map((chunk)=>new Uint8Array(chunk))).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let total=0;
  try {
    while(true) {
      const result=await reader.read();if(result.done)break;
      total+=result.value.byteLength;
      if(total>width*height*channels*Math.max(1,depth/8)+height*8+1024) throw new Error("PNG decompressed data exceeds its dimensions.");
    }
  } finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  return decode(Buffer.concat(chunks),{checkCrc:true});
}
