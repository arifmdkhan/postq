import { channelMediaTypes } from "./capabilities";
import { mediaDeliveryError } from "../media/validation";
import type { Attachment } from "../media/attachments";

export const mediaLimits: Record<string,number> = {threads:20, instagram:10, facebook:10, linkedin:20, pinterest:5, tiktok:35, youtube:1};
export function mediaLimit(platform:string, destination="") {return platform === "instagram" && destination === "story" ? 1 : mediaLimits[platform] ?? 0;}
export function mediaPolicyLabel(platform:string, destination="") {
  if(platform === "youtube")return "One MP4 video";
  if(platform === "instagram" && destination === "story")return "One JPEG or MP4 per Story";
  if(platform === "threads" || platform === "instagram")return `Up to ${mediaLimit(platform)} images/videos, including mixed carousels`;
  if(platform === "facebook")return "Up to 10 photos, or one MP4 video; no mixing";
  if(platform === "tiktok")return "Up to 35 JPEG photos, or one MP4 video; no mixing";
  if(platform === "linkedin" || platform === "pinterest")return `Up to ${mediaLimit(platform)} images, or one MP4 video; no mixing`;
  return `Up to ${mediaLimit(platform)} images`;
}
export function attachmentError(platform:string, assets:Attachment[], destination="", inspect=true) {
  if(!assets.length && ["instagram","youtube","pinterest","tiktok"].includes(platform))return `Add media for ${platform}.`;
  if(assets.length>mediaLimit(platform,destination))return `${platform} allows ${mediaLimit(platform,destination)} attachments for this placement in PostQ.`;
  if(assets.some(asset=>!channelMediaTypes[platform]?.includes(asset.mime)))return `Choose supported media for ${platform}.`;
  const videos=assets.filter(asset=>asset.mime.startsWith("video/"));
  if(videos.length && assets.length>1 && !["threads","instagram"].includes(platform))return `${platform} supports multiple photos or one video, not a mixed post.`;
  for(const asset of assets){
    if(["threads","instagram"].includes(platform) && asset.mime.startsWith("image/") && (asset.bytes??0)>8_000_000)return `${asset.name}: images must be at most 8 MB.`;
    if(inspect){const error=mediaDeliveryError(platform,asset.mime,asset.metadata??null,undefined,destination);if(error)return `${asset.name}: ${error}`;}
    if(platform==="linkedin" && asset.mime==="video/mp4" && inspect){const data=JSON.parse(asset.metadata??"null");if(data.duration<3 || data.duration>1800 || asset.bytes!==undefined && asset.bytes<75_000)return "LinkedIn MP4 videos require 3 seconds–30 minutes and at least 75 kB.";}
    if(platform==="pinterest" && asset.mime==="video/mp4" && inspect){const data=JSON.parse(asset.metadata??"null");if(data.duration<4 || data.duration>300)return "Pinterest videos require 4 seconds–5 minutes in PostQ.";}
    if(platform==="tiktok" && asset.mime==="image/jpeg" && inspect){const data=JSON.parse(asset.metadata??"null");if(Math.min(data.width,data.height)>1080 || Math.max(data.width,data.height)>1920)return "TikTok photos in PostQ must fit 1080×1920 pixels (either orientation).";}
    if(platform==="instagram" && assets.length>1 && inspect){
      const data=JSON.parse(asset.metadata??"null");
      const ratio=data.width/data.height;
      if(ratio<0.8 || ratio>1.91 || asset.mime==="video/mp4" && (data.duration<3 || data.duration>60))return "Instagram carousels in PostQ require aspect ratios 4:5–1.91:1 and videos of 3–60 seconds.";
    }
  }
  return "";
}
