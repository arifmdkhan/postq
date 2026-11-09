export async function retainHistory(db: D1Database, days: number) {
  if (!Number.isInteger(days) || days < 30 || days > 3650) return;
  const cutoff = Date.now() - days * 86400000;
  // Retention is opt-in. Keep draft/publication history, active requests, and the latest metric of each type.
  await db.prepare(`DELETE FROM publication_metrics WHERE rowid IN (SELECT m.rowid FROM publication_metrics m
    WHERE m.captured_at<? AND EXISTS (SELECT 1 FROM publication_metrics_latest latest WHERE latest.publication_id=m.publication_id
      AND latest.name=m.name AND latest.captured_at>m.captured_at) LIMIT 100)`).bind(cutoff).run();
  await db.prepare(`DELETE FROM mcp_requests WHERE id IN (SELECT r.id FROM mcp_requests r JOIN mcp_tokens t ON t.id=r.token_id
    WHERE r.created_at<? AND r.expires_at<? AND r.state<>'approving' AND (t.revoked_at IS NOT NULL OR t.expires_at<?) LIMIT 100)`)
    .bind(cutoff,Date.now(),Date.now()).run();
  await db.prepare("DELETE FROM assistant_proposals WHERE id IN (SELECT id FROM assistant_proposals WHERE created_at<? LIMIT 100)").bind(cutoff).run();
  await db.prepare("DELETE FROM assistant_chats WHERE id IN (SELECT id FROM assistant_chats WHERE updated_at<? AND active_until<=? AND state<>'streaming' LIMIT 100)")
    .bind(cutoff,Date.now()).run();
}
