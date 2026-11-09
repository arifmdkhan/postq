export const publishingPlatforms = ["threads", "facebook", "instagram", "youtube", "tiktok", "pinterest", "linkedin"] as const;
export const firstCommentLimits: Record<string, number> = { facebook: 2000, threads: 500, linkedin: 1250, youtube: 2000 };
export const tiktokPrivacy = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export const threadsReplyControls = {
  everyone: "Everyone",
  accounts_you_follow: "Accounts you follow",
  mentioned_only: "Mentioned accounts",
  followers_only: "Followers",
} as const;
export const channelMediaTypes: Record<string, readonly string[]> = {
  threads: ["image/jpeg", "image/png", "video/mp4"],
  instagram: ["image/jpeg", "video/mp4"],
  facebook: ["image/jpeg", "image/png", "video/mp4"],
  youtube: ["video/mp4"],
  tiktok: ["image/jpeg", "video/mp4"],
  pinterest: ["image/jpeg", "image/png", "video/mp4"],
  linkedin: ["image/jpeg", "image/png", "video/mp4"],
};
export const mediaFormatLabel: Record<string, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "video/mp4": "MP4" };

export function deliveryError(platform: string, caption: string, mime: string | null, destination: string) {
  const allowed = channelMediaTypes[platform];
  if (mime && !allowed?.includes(mime)) return `Choose a supported file for ${platform}.`;
  if (platform === "threads") {
    return (mime || caption) && new TextEncoder().encode(caption).length <= 500 ? "" : "Threads requires a caption or attachment. Captions are limited to 500 UTF-8 bytes.";
  }
  if (platform === "facebook") {
    return /^\d{1,32}$/.test(destination) && (caption || mime)
      ? "" : "Choose a Facebook Page and add text, a JPEG or PNG image, or an MP4 video.";
  }
  if (platform === "pinterest") {
    return mime && /^\d{1,32}$/.test(destination) && Array.from(caption).length <= 800
      ? "" : "Choose a Pinterest board, add JPEG/PNG images or one MP4 video, and keep the description within 800 characters.";
  }
  if (platform === "linkedin") {
    return (caption || mime) && Array.from(caption).length <= 3000 ? "" : "Add a LinkedIn post of up to 3,000 characters or an image.";
  }
  if (platform === "instagram") {
    return (mime === "image/jpeg" || mime === "video/mp4") && ["", "feed", "story"].includes(destination) && caption.length <= 2200 &&
      (destination !== "story" || !caption) ? "" : "Instagram requires JPEG or MP4 and up to 2,200 characters. Stories require an empty caption.";
  }
  if (platform === "youtube") {
    return mime === "video/mp4" && caption.length <= 5000 && ["private", "unlisted", "public"].includes(destination)
      ? "" : "YouTube requires an MP4, visibility, and a description of up to 5,000 characters.";
  }
  if (platform === "tiktok") {
    return ["video/mp4","image/jpeg"].includes(mime??"") && caption.length <= (mime==="image/jpeg"?4000:2200) && tiktokPrivacy.some((option) => option === destination)
      ? "" : "TikTok requires JPEG photos or one MP4, a privacy selection, and a caption within its format limit.";
  }
  return "This platform cannot publish from PostQ.";
}
