import { imageSize } from "image-size";
import { decode } from "jpeg-js";
import { encode } from "fast-png";
import { decodePng } from "./png";
import { Input, BufferSource, MP4, WEBM, EncodedPacketSink } from "mediabunny";

export type MediaMetadata = { width: number; height: number; duration?: number; frameRate?: number; codec?: string; audioCodec?: string | null; validated: boolean };
const maxPixels = 6_000_000;
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > maxPixels || Math.max(width,height) > 8192) {
    throw new Error("Use media up to 6 megapixels and 8,192 pixels per side.");
  }
}

export async function imageThumbnail(bytes: Uint8Array, mime: string) {
  const size = imageSize(bytes);
  dimensions(size.width,size.height);
  const pixels = mime === "image/jpeg"
    ? decode(bytes,{useTArray:true,tolerantDecoding:false,maxResolutionInMP:6,maxMemoryUsageInMB:48})
    : mime === "image/png" ? await decodePng(bytes,size.width,size.height) : null;
  if (!pixels) return null;
  if(pixels.width!==size.width || pixels.height!==size.height) throw new Error("Image dimensions do not match the decoded contents.");
  const scale = Math.min(1,480 / Math.max(pixels.width,pixels.height));
  const width = Math.max(1,Math.round(pixels.width*scale));
  const height = Math.max(1,Math.round(pixels.height*scale));
  const data = Buffer.alloc(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const px=Math.min(pixels.width-1,Math.floor(x/scale)),py=Math.min(pixels.height-1,Math.floor(y/scale));
    const channels="channels" in pixels?pixels.channels:4,depth="depth" in pixels?pixels.depth:8;
    const sample=(channel:number)=>depth<8
      ? (pixels.data[py*Math.ceil(pixels.width*depth/8)+Math.floor(px*depth/8)] >> (8-depth-px*depth%8)) & ((1<<depth)-1)
      : pixels.data[(py*pixels.width+px)*channels+channel];
    const values=Array.from({length:channels},(_,channel)=>sample(channel));
    const maximum=(1<<depth)-1;
    const palette="palette" in pixels?pixels.palette:undefined;
    const transparency="transparency" in pixels?pixels.transparency:undefined;
    const rgba=palette ? palette[values[0]] : channels<=2 ? [values[0],values[0],values[0],channels===2?values[1]:maximum] : [...values.slice(0,3),channels===4?values[3]:maximum];
    if(!rgba)throw new Error("PNG palette index is invalid.");
    const transparent=transparency && values.every((value,index)=>value===transparency[index]);
    for (let channel=0;channel<4;channel++) data[(y*width+x)*4+channel]=channel===3 && transparent?0:Math.round((rgba[channel]??(palette?255:maximum))*255/(palette?255:maximum));
  }
  return encode({width,height,data,channels:4,depth:8});
}

export async function inspectMedia(bytes: Uint8Array, mime: string): Promise<{metadata:MediaMetadata;thumbnail:Uint8Array|null}> {
  if (mime.startsWith("image/")) {
    const size = imageSize(bytes);
    dimensions(size.width,size.height);
    const types: Record<string,string> = {"image/jpeg":"jpg","image/png":"png","image/gif":"gif","image/webp":"webp"};
    if (size.type!==types[mime]) throw new Error("Image format does not match its contents.");
    const thumbnail = await imageThumbnail(bytes,mime);
    return {metadata:{width:size.width,height:size.height,validated:thumbnail!==null},thumbnail};
  }
  const input = new Input({formats:[MP4,WEBM],source:new BufferSource(bytes)});
  try {
    const actualMime = await input.getMimeType();
    if (!actualMime.startsWith(mime)) throw new Error("Video format does not match its contents.");
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("The file contains no video track.");
    const width = await video.getDisplayWidth();
    const height = await video.getDisplayHeight();
    dimensions(width,height);
    const codec = await video.getCodec();
    const audio = await input.getPrimaryAudioTrack();
    const audioCodec = audio ? await audio.getCodec() : null;
    const duration = await input.computeDuration();
    // Probe a bounded prefix; provider processing remains the final media compatibility check.
    const frameRate = (await video.computePacketStats(256)).averagePacketRate;
    const sink = new EncodedPacketSink(video);
    const first = await sink.getFirstKeyPacket({verifyKeyPackets:true});
    const last = await sink.getPacket(Infinity);
    if (!first?.data.byteLength || !last?.data.byteLength || !Number.isFinite(duration) || duration<=0 || duration>3600 || !Number.isFinite(frameRate) || frameRate<=0) throw new Error("Use a readable video up to 60 minutes.");
    if (mime==="video/mp4" && (codec!=="avc" || (audioCodec!==null && audioCodec!=="aac"))) throw new Error("PostQ requires H.264 video with optional AAC audio in MP4 files.");
    return {metadata:{width,height,duration,frameRate,codec:codec??"unknown",audioCodec,validated:true},thumbnail:null};
  } finally { input.dispose(); }
}

