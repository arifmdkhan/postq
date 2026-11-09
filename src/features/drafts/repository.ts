import { database } from "@/server/db";

export type Draft = {
  id: string;
  title: string;
  body: string;
  planned_on: string | null;
  tag: string | null;
  updated_at: string;
  revision: number;
  delivery_plan?: string | null;
};

export async function listDrafts(userId: string, cursor?: string, tag?: string, query?: string) {
  const db = await database();
  const page = db.prepare(
    `SELECT id, title, tag FROM drafts
     WHERE user_id = ? AND (? IS NULL OR tag = ?)
       AND (? IS NULL OR instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0)
       AND (? IS NULL OR (updated_at, id) < (
         SELECT updated_at, id FROM drafts WHERE user_id = ? AND id = ?
       ))
     ORDER BY updated_at DESC, id DESC LIMIT 21`,
  );
  const { results } = await page.bind(userId, tag ?? null, tag ?? null, query ?? null, query ?? null, query ?? null, cursor ?? null, userId, cursor ?? null).all<Pick<Draft, "id" | "title" | "tag">>();
  return results;
}

export async function saveDraft(userId: string, draft: Omit<Draft, "updated_at" | "revision">, creating: boolean, expectedUpdatedAt?: string) {
  const db = await database();
  const now = new Date().toISOString();
  if (creating) {
    return db.prepare(
      `INSERT INTO drafts (id,user_id,title,body,planned_on,tag,updated_at,delivery_plan) SELECT ?,?,?,?,?,?,?,?
       WHERE NOT EXISTS (SELECT 1 FROM json_tree(?) j WHERE (j.key='media' OR j.path LIKE '%.media') AND j.type='text' AND j.value<>''
         AND NOT EXISTS (SELECT 1 FROM media_assets WHERE id=j.value AND user_id=?)) ON CONFLICT(id) DO NOTHING`,
    ).bind(draft.id, userId, draft.title, draft.body, draft.planned_on, draft.tag, now, draft.delivery_plan ?? null, draft.delivery_plan ?? null, userId).run();
  }
  return db.prepare(
    `UPDATE drafts SET title=?,body=?,planned_on=?,tag=?,updated_at=?,delivery_plan=COALESCE(?,delivery_plan)
      WHERE user_id=? AND id=? AND updated_at=?
      AND NOT EXISTS (SELECT 1 FROM json_tree(coalesce(?,delivery_plan)) j WHERE (j.key='media' OR j.path LIKE '%.media') AND j.type='text' AND j.value<>''
        AND NOT EXISTS (SELECT 1 FROM media_assets WHERE id=j.value AND user_id=drafts.user_id))`,
  ).bind(draft.title, draft.body, draft.planned_on, draft.tag, now, draft.delivery_plan ?? null, userId, draft.id, expectedUpdatedAt ?? null, draft.delivery_plan ?? null).run();
}

export async function deleteDraft(userId: string, draftId: string) {
  const db = await database();
  await db.prepare("DELETE FROM drafts WHERE user_id = ? AND id = ?").bind(userId, draftId).run();
}


export async function getDraft(userId: string, id: string) {
  const db = await database();
  return db.prepare("SELECT id, title, body, planned_on, tag, updated_at, revision, delivery_plan FROM drafts WHERE user_id = ? AND id = ?")
    .bind(userId, id).first<Draft>();
}

export async function plannedDayCounts(userId: string, start: string, end: string, tag?: string) {
  const db = await database();
  const { results } = await db.prepare(
    `SELECT planned_on, count(*) AS total FROM drafts
     WHERE user_id = ? AND planned_on >= ? AND planned_on <= ? AND (? IS NULL OR tag = ?) GROUP BY planned_on`,
  ).bind(userId, start, end, tag ?? null, tag ?? null).all<{ planned_on: string; total: number }>();
  return results;
}

export async function listPlannedDrafts(userId: string, day: string, tag?: string) {
  const db = await database();
  const { results } = await db.prepare(
    "SELECT id, title FROM drafts WHERE user_id = ? AND planned_on = ? AND (? IS NULL OR tag = ?) ORDER BY id LIMIT 20",
  ).bind(userId, day, tag ?? null, tag ?? null).all<Pick<Draft, "id" | "title">>();
  return results;
}
