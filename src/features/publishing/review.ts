export async function resolveReviewedPublication(db: D1Database, userId: string, id: string, remoteId: string | null) {
  const result = await db.prepare(
    `UPDATE publications SET status = ?, remote_post_id = ?, abandoned_at = ?,
       reconciled_at = CASE WHEN ? IS NOT NULL THEN ? ELSE reconciled_at END
     WHERE user_id = ? AND id = ? AND status = 'review'`,
  ).bind(remoteId ? "published" : "cancelled", remoteId, remoteId ? null : Date.now(), remoteId, Date.now(), userId, id).run();
  return result.meta.changes === 1;
}
