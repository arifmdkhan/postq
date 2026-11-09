import type { MediaMetadata } from "./metadata";

export function mediaDeliveryError(platform: string, mime: string, raw: string | null, maxDuration?: number, destination = "") {
  let metadata: MediaMetadata;
  try { metadata=JSON.parse(raw??"null"); } catch { return "Re-upload this media to validate it before publishing."; }
  if (!metadata?.validated) return "Re-upload this media to validate it before publishing.";
  if (mime==="video/mp4" && (metadata.codec!=="avc" || !(metadata.duration!>0))) return "Choose a validated H.264 MP4 video.";
  if (platform==="tiktok" && maxDuration!==undefined && (!maxDuration || metadata.duration!>maxDuration)) return "The video exceeds this creator's allowed duration.";
  if (mime === "video/mp4" && ["instagram", "tiktok"].includes(platform)) {
    if (!(metadata.frameRate! >= 23 && metadata.frameRate! <= 60.01)) return "Use a video at 23–60 FPS. Re-upload older files to validate frame rate.";
    if (platform === "tiktok" && (Math.min(metadata.width,metadata.height)<360 || Math.max(metadata.width,metadata.height)>4096)) return "TikTok requires both dimensions between 360 and 4,096 pixels.";
    if (platform === "instagram" && (metadata.width>1920 || metadata.width/metadata.height<0.01 || metadata.width/metadata.height>10 || metadata.duration!<3 || metadata.duration!>(destination==="story"?60:900))) return "Instagram requires 3–900 seconds (up to 60 for PostQ Stories), width up to 1,920 pixels, and aspect ratio 0.01–10.";
  }
  return "";
}
