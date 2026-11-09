import { createRequire } from "node:module";
import { readFile,writeFile } from "node:fs/promises";
const require=createRequire(import.meta.url);
const sharp=createRequire(require.resolve("next/package.json"))("sharp");
const source=await readFile(new URL("../public/postq.svg",import.meta.url));
const png=async(size,maskable=false)=>{
  const image=sharp(source).resize(size,size);
  return (maskable?image.flatten({background:"#173df5"}):image).png().toBuffer();
};
for(const size of [192,512])await writeFile(new URL(`../public/postq-${size}.png`,import.meta.url),await png(size));
await writeFile(new URL("../public/postq-maskable-512.png",import.meta.url),await png(512,true));
await writeFile(new URL("../src/app/apple-icon.png",import.meta.url),await png(180));
const sizes=[16,32,48,256],images=await Promise.all(sizes.map(size=>png(size)));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(const [index,size] of sizes.entries()) {
  const entry=6+index*16;header[entry]=size===256?0:size;header[entry+1]=size===256?0:size;
  header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[index].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[index].length;
}
await writeFile(new URL("../src/app/favicon.ico",import.meta.url),Buffer.concat([header,...images]));
const offline=new URL("../public/offline.html",import.meta.url);
const html=await readFile(offline,"utf8");
const mark=`<img id="postq-mark" src="data:image/svg+xml;base64,${source.toString("base64")}" width="48" height="48" alt="PostQ">`;
await writeFile(offline,html.includes('id="postq-mark"')?html.replace(/<img id="postq-mark"[^>]*>/,mark):html.replace("<main>","<main>\n    "+mark));
console.log("Generated PostQ favicon, Apple/PWA icons and offline branding from public/postq.svg.");
