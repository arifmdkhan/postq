import type { ChatMessage, SavedChat } from "./chat-types";
import { nextMessages } from "./chat-types";

export const claimChatSql = `UPDATE assistant_chats SET messages=?, revision=revision+1, request_id=?,
  active_until=?, state='streaming', error=NULL, updated_at=?
  WHERE id=? AND user_id=? AND revision=? AND active_until<=?`;
export const finishChatSql = `UPDATE assistant_chats SET messages=?, state=?, error=?, active_until=0, updated_at=?
  WHERE id=? AND user_id=? AND request_id=? AND revision=?`;

export async function claimChat(db: D1Database, userId: string, id: string, message: ChatMessage, retry: boolean, parentId: unknown) {
  const now = Date.now();
  await db.prepare(`INSERT INTO assistant_chats(id,user_id,title,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, userId, message.parts[0].type === "text" ? message.parts[0].text.trim().slice(0, 80) : "New chat", now).run();
  const saved = await db.prepare("SELECT * FROM assistant_chats WHERE id=? AND user_id=?").bind(id, userId).first<SavedChat>();
  if (!saved) throw new Error("Chat unavailable.");
  if (saved.active_until > now) throw new Error("A reply is still running. Wait a moment, then reload.");
  if (retry && saved.request_id === message.id && saved.state === "ready") throw new Error("This reply is already saved. Reload the chat.");
  const messages = nextMessages(JSON.parse(saved.messages), message, retry, parentId);
  const result = await db.prepare(claimChatSql).bind(JSON.stringify(messages), message.id, now + 100_000, now,
    id, userId, saved.revision, now).run();
  if (!result.meta.changes) throw new Error("This chat changed. Reload before sending.");
  return { messages, revision: saved.revision + 1 };
}

export async function finishChat(db: D1Database, userId: string, id: string, requestId: string, revision: number,
  messages: ChatMessage[], state: "ready" | "error" | "stopped", error: string | null = null) {
  const result = await db.prepare(finishChatSql).bind(JSON.stringify(messages), state, error, Date.now(), id, userId, requestId, revision).run();
  if (!result.meta.changes) throw new Error("Chat save lost its request lease.");
}
