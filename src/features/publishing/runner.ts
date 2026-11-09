import { deliveryFailure } from "./receipts";
type Job = { id: string; user_id: string; channel_id: string; title: string; caption: string; media_id: string | null; media_ids:string; destination: string | null; delivery_options: string | null };

export async function publishDue(db: D1Database, publish: (account: string, user: string, caption: string, platform: string, job: Job) => Promise<string | { pending: string }>, ownerId?: string, deadline = Date.now() + 180_000) {
  const now = Date.now();
  await db.prepare("UPDATE publications SET status = 'review' WHERE status = 'sending' AND claimed_at < ? AND (? IS NULL OR user_id = ?)")
    .bind(now - 600_000, ownerId ?? null, ownerId ?? null).run();

  for (let index = 0; index < 10 && Date.now() < deadline; index++) {
    const job = await db.prepare(
      `UPDATE publications SET status = 'sending', claimed_at = ?
       WHERE id = (SELECT id FROM publications WHERE status = 'scheduled' AND due_at <= ? AND (? IS NULL OR user_id = ?) ORDER BY due_at, id LIMIT 1)
       RETURNING id, user_id, channel_id, title, caption, media_id, media_ids, destination, delivery_options`,
    ).bind(now, now, ownerId ?? null, ownerId ?? null).first<Job>();
    if (!job) return;

    const channel = await db.prepare("SELECT remote_id, platform FROM channels WHERE id = ? AND user_id = ? AND active = 1 AND platform IN ('threads', 'instagram', 'facebook', 'youtube', 'tiktok', 'pinterest', 'linkedin')")
      .bind(job.channel_id, job.user_id).first<{ remote_id: string; platform: string }>();
    if (!channel) {
      await db.prepare("UPDATE publications SET status = 'cancelled' WHERE id = ? AND status = 'sending'").bind(job.id).run();
      continue;
    }

    const attemptId = crypto.randomUUID();
    await db.prepare("INSERT INTO delivery_attempts(id,publication_id,started_at,outcome) VALUES (?,?,?,'sending')")
      .bind(attemptId, job.id, Date.now()).run();
    let receipt: string | { pending: string };
    try {
      receipt = await publish(channel.remote_id, job.user_id, job.caption, channel.platform, job);
    } catch (error) {
      const code = deliveryFailure(error);
      await db.prepare("UPDATE publications SET status = 'review', last_error = ? WHERE id = ? AND status = 'sending'").bind(code, job.id).run();
      await db.prepare("UPDATE delivery_attempts SET outcome='uncertain', error_code=?, finished_at=? WHERE id=?")
        .bind(code, Date.now(), attemptId).run();
      console.warn(JSON.stringify({ event: "delivery_needs_review", publicationId: job.id, code }));
      continue;
    }
    await db.prepare("UPDATE publications SET status = ?, remote_post_id = ?, pending_receipt = ? WHERE id = ? AND status = 'sending'")
      .bind(typeof receipt === "string" ? "published" : "review", typeof receipt === "string" ? receipt : null,
        typeof receipt === "string" ? null : receipt.pending, job.id).run();
    await db.prepare("UPDATE delivery_attempts SET outcome=?, finished_at=? WHERE id=?")
      .bind(typeof receipt === "string" ? "confirmed" : "processing", Date.now(), attemptId).run();
  }
}
