import type { UIMessage } from "ai";

export const platforms = ["threads", "facebook", "instagram", "youtube", "tiktok", "pinterest", "linkedin", "x"] as const;
export type CampaignPost = { id: string; title: string; caption: string; date: string; time: string; variants: Record<string, string> };
export type PostProposal = {
  campaign: CampaignPost[];
  edit?: { id: string; updatedAt: string; title: string };
};
export type ChatMessage = UIMessage;
export type SavedChat = {
  id: string; user_id: string; title: string; messages: string; revision: number;
  request_id: string | null; active_until: number; state: "ready" | "streaming" | "error" | "stopped";
  error: string | null; updated_at: number;
};

export function messageText(message: ChatMessage) {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

export function validMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as ChatMessage;
  return typeof message.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(message.id) && message.role === "user" &&
    Array.isArray(message.parts) && message.parts.length === 1 && message.parts[0].type === "text" &&
    typeof message.parts[0].text === "string" && message.parts[0].text.trim().length > 0 && message.parts[0].text.length <= 4000;
}

export function nextMessages(previous: ChatMessage[], incoming: ChatMessage, retry: boolean, parentId: unknown): ChatMessage[] {
  const duplicate = previous.findIndex((message) => message.id === incoming.id);
  if (duplicate >= 0) {
    if (!retry || previous[duplicate].role !== "user" || previous.slice(duplicate + 1).some((message) => message.role === "user") ||
      messageText(previous[duplicate]) !== messageText(incoming)) throw new Error("This turn changed. Reload the chat.");
    return previous.slice(0, duplicate + 1);
  }
  if ((previous.at(-1)?.id ?? null) !== (parentId ?? null)) throw new Error("This chat changed in another tab. Reload before sending.");
  if (previous.length >= 80) throw new Error("This chat is full. Start a new chat to continue.");
  return [...previous, incoming];
}

export function contextMessages(messages: ChatMessage[]) {
  let size = 0;
  const selected: ChatMessage[] = [];
  for (const message of messages.slice(-20).reverse()) {
    const length = JSON.stringify(message).length;
    if (selected.length && size + length > 60000) break;
    selected.unshift(message);
    size += length;
  }
  return selected;
}
