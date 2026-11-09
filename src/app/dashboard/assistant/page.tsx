import { Suspense } from "react";
import AssistantLoading from "./loading";
import { configuredModels } from "@/features/assistant/model";
import { Compose } from "@/features/assistant/compose";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { listDrafts } from "@/features/drafts/repository";
import { type SavedChat, type ChatMessage } from "@/features/assistant/chat-types";

export default function AssistantPage({ searchParams }: PageProps<"/dashboard/assistant">) {
  return <Suspense fallback={<AssistantLoading />}><Assistant searchParams={searchParams} /></Suspense>;
}

async function Assistant({ searchParams }: Pick<PageProps<"/dashboard/assistant">, "searchParams">) {
  const user = await requireUser();
  const db = await database();
  const [{ results: history }, drafts, params, { results: chats }, models] = await Promise.all([db.prepare(`SELECT id, brief, json_extract(proposal, '$.caption') AS caption, created_at
    FROM assistant_proposals WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 25`)
    .bind(user.id).all<{ id: string; brief: string; caption: string; created_at: number }>(), listDrafts(user.id), searchParams,
    db.prepare("SELECT id,title,updated_at FROM assistant_chats WHERE user_id=? ORDER BY updated_at DESC LIMIT 50").bind(user.id)
      .all<{ id: string; title: string; updated_at: number }>(), configuredModels()]);
  const id = typeof params.chat === "string" && /^[a-f\d-]{36}$/i.test(params.chat) ? params.chat : crypto.randomUUID();
  const saved = await db.prepare("SELECT * FROM assistant_chats WHERE id=? AND user_id=?").bind(id, user.id).first<SavedChat>();
  const messages: ChatMessage[] = saved ? JSON.parse(saved.messages) : [];
  const context = typeof params.context === "string" ? await db.prepare("SELECT id,brief FROM assistant_proposals WHERE id=? AND user_id=?")
    .bind(params.context, user.id).first<{ id: string; brief: string }>() : null;
  return (
    <section data-studio-chat className="flex h-full min-h-0 flex-col p-3 sm:p-4">
      <Compose key={id + (context?.id ?? "")} id={id} initialContext={context} initialMessages={messages} savedState={saved?.state} savedError={saved?.error} models={models} chats={chats} history={history} drafts={drafts.slice(0,20)} revision={typeof params.revision === "string" ? params.revision : undefined} />
    </section>
  );
}
