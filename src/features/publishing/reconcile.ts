import { checkTikTokReceipt, reconcileYouTube } from "./composio";
import { deliveryFailure, validPostReceipt } from "./receipts";

export async function reconcilePending(db: D1Database, key: string, user: string, deadline: number) {
  const { results } = await db.prepare(`SELECT p.id,p.pending_receipt,p.destination,p.delivery_options,p.abandoned_at,c.platform,c.remote_id
    FROM publications p JOIN channels c ON c.id=p.channel_id AND c.user_id=p.user_id
    WHERE p.user_id=? AND p.pending_receipt IS NOT NULL AND p.reconciled_at IS NULL
      AND p.status IN ('review','sending','cancelled') AND coalesce(p.checked_at,0)<?
    ORDER BY coalesce(p.checked_at,0),p.claimed_at LIMIT 2`).bind(user, Date.now() - 120000)
    .all<{ id: string; pending_receipt: string; destination: string | null; delivery_options: string | null; abandoned_at: number | null; platform: string; remote_id: string }>();
  for (const post of results) {
    if (Date.now() >= deadline) break;
    await db.prepare("UPDATE publications SET checked_at=? WHERE id=? AND pending_receipt=?")
      .bind(Date.now(), post.id, post.pending_receipt).run();
    let remoteId: string | null = null;
    let terminal = false;
    let error: string | null = null;
    try {
      if (post.platform === "youtube") {
        if (await reconcileYouTube(key, post.remote_id, user, post.pending_receipt, post, !post.abandoned_at)) {
          remoteId = post.pending_receipt; terminal = true;
        } else error = post.abandoned_at ? "upload_exists_local_attempt_closed" : "youtube_settings_unconfirmed";
      } else if (post.platform === "tiktok") {
        const receipt = await checkTikTokReceipt(key, post.remote_id, user, post.pending_receipt);
        if (receipt?.status === "PUBLISH_COMPLETE") {
          terminal = true;
          remoteId = receipt.publicaly_available_post_id?.map((id) => typeof id === "number" && !Number.isSafeInteger(id) ? "" : String(id))
            .find((id) => validPostReceipt("tiktok", id)) ?? null;
          if (!remoteId) error = "provider_complete_no_public_id";
        } else if (receipt?.status === "FAILED") { terminal = true; error = "provider_processing_failed"; }
      }
    } catch (failure) { error = deliveryFailure(failure); }
    await db.prepare(`UPDATE publications SET status=CASE WHEN ? IS NOT NULL THEN 'published' WHEN abandoned_at IS NOT NULL THEN 'cancelled' ELSE 'review' END,
      remote_post_id=coalesce(?,remote_post_id),last_error=?,reconciled_at=? WHERE id=? AND pending_receipt=? AND reconciled_at IS NULL`)
      .bind(remoteId, remoteId, error, terminal ? Date.now() : null, post.id, post.pending_receipt).run();
  }
}
