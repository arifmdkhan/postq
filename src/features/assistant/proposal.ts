import { futureUtcMinute } from "../publishing/time";
import { isPlanningDate } from "../drafts/planning";
import { platforms, type CampaignPost } from "./chat-types";

export function readCampaign(value: unknown): Omit<CampaignPost, "id"> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<CampaignPost>;
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160 ||
    typeof input.caption !== "string" || !input.caption.trim() || input.caption.length > 9600) return null;
  const variants = Object.fromEntries(platforms.flatMap((platform) => {
    const caption = input.variants?.[platform];
    return typeof caption === "string" && caption.length <= 10000 ? [[platform, caption]] : [];
  }));
  const date = isPlanningDate(input.date) ? input.date : "";
  const time = typeof input.time === "string" && futureUtcMinute("2000-01-01T" + input.time, -Infinity) !== null ? input.time : "";
  return { title: input.title.trim(), caption: input.caption, date, time, variants };
}
