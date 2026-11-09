"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { composePost } from "@/features/composer/actions";
import { hashToken, newToken } from "./access";
import type { ReviewPayload, ReviewRequest } from "./service";

export async function createMCPToken(form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  const level = String(form.get("level") ?? "read");
  const days = Number(form.get("days"));
  if (!name || name.length > 80 || !["read", "drafts", "manage"].includes(level) || ![7, 30, 90].includes(days)) return { error: "Check the token name, permissions, and expiry." };
  const db = await database();
  const count = await db.prepare("SELECT count(*) AS total FROM mcp_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>?").bind(user.id, Date.now()).first<number>("total");
  if ((count ?? 0) >= 20) return { error: "Revoke an unused token before creating another. Up to 20 active tokens are allowed." };
  const token = newToken();
  const now = Date.now();
  const scopes = ["read", ...(level !== "read" ? ["drafts:write"] : []), ...(level === "manage" ? ["schedule:request"] : [])];
  await db.prepare("INSERT INTO mcp_tokens(id,user_id,name,token_hash,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), user.id, name, await hashToken(token), JSON.stringify(scopes), now, now + days * 86400000).run();
  revalidatePath("/dashboard/settings");
  return { token };
}

export async function revokeMCPToken(id: string) {
  const user = await requireUser();
  const db = await database();
  await db.prepare("UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL").bind(Date.now(), id, user.id).run();
  revalidatePath("/dashboard/settings");
}

type ApprovalResult = { message: string; done?: boolean; error?: boolean };
export async function reviewMCPRequest(id: string, approve: boolean): Promise<ApprovalResult> {
  const user = await requireUser();
  const db = await database();
  const row = await db.prepare(`SELECT r.* FROM mcp_requests r JOIN mcp_tokens t ON t.id=r.token_id
    WHERE r.id=? AND r.user_id=? AND t.revoked_at IS NULL AND t.expires_at>? AND r.expires_at>?`)
    .bind(id, user.id, Date.now(), Date.now()).first<ReviewRequest>();
  if (!row) return { message: "This request expired or its access token was revoked.", error: true };
  if (row.state === "approved" || row.state === "rejected") return { message: row.state === "approved" ? "This request was already approved." : "This request was rejected.", done: true };
  const attempt = crypto.randomUUID();
  const now = Date.now();
  const claim = await db.prepare(`UPDATE mcp_requests SET state=?,attempt=?,claimed_at=? WHERE id=? AND user_id=? AND expires_at>?
    AND (state='pending' OR (state='approving' AND claimed_at<?))`)
    .bind(approve ? "approving" : "rejected", attempt, now, id, user.id, now, now - 120000).run();
  if (!claim.meta.changes) return { message: "This request is already being handled or could not be completed. Refresh its status.", error: true };
  const complete = async (state: string, value: unknown) => {
    await db.prepare("UPDATE mcp_requests SET state=?,result=? WHERE id=? AND user_id=? AND attempt=?")
      .bind(state, JSON.stringify(value), id, user.id, attempt).run();
    revalidatePath("/dashboard/mcp-review"); revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/calendar"); revalidatePath("/dashboard/publishing");
  };
  if (!approve) { await complete("rejected", { message: "Owner rejected the request." }); return { message: "Request rejected. Nothing was changed.", done: true }; }
  const payload: ReviewPayload = JSON.parse(row.payload);
  try {
    if (row.kind === "schedule") {
      const ids = payload.publicationIds ?? [];
      const existing = await db.prepare("SELECT count(*) AS total FROM publications WHERE user_id=? AND id IN (SELECT value FROM json_each(?))")
        .bind(user.id, JSON.stringify(ids)).first<number>("total");
      if (ids.length && existing === ids.length) {
        await complete("approved", { publicationIds: ids });
        return { message: "This exact request was already queued. No duplicate deliveries were created.", done: true };
      }
      const form = new FormData();
      for (const [key, value] of payload.fields ?? []) form.append(key, value);
      form.set("approved", "yes"); form.set("approvedIntent", "schedule"); form.set("mcpApproval", id); form.set("mcpAttempt", attempt);
      const result = await composePost(crypto.randomUUID(), payload.draftId ?? null, { message: "", done: false }, form);
      if (!result.done) { await complete("failed", { message: result.message }); return { message: result.message + " Create a corrected request before approving again.", error: true }; }
      await complete("approved", { publicationIds: ids });
      return { message: "Approved and scheduled. View the deliveries in Accounts or Calendar.", done: true };
    }
    const due = payload.dueAt;
    if (row.kind === "reschedule" && (!Number.isFinite(due) || due <= Date.now())) throw new Error("The requested time is no longer in the future.");
    const result = await db.prepare(`UPDATE publications SET status=?,due_at=?
      WHERE id=? AND user_id=? AND status='scheduled' AND due_at=?
      AND EXISTS (SELECT 1 FROM channels c WHERE c.id=publications.channel_id AND c.user_id=publications.user_id AND c.active=1)
      AND EXISTS (SELECT 1 FROM mcp_requests r JOIN mcp_tokens t ON t.id=r.token_id WHERE r.id=? AND r.attempt=? AND r.state='approving' AND r.expires_at>? AND t.revoked_at IS NULL AND t.expires_at>?)`)
      .bind(row.kind === "cancel" ? "cancelled" : "scheduled", due, payload.postId, user.id, payload.expectedDue, id, attempt, Date.now(), Date.now()).run();
    if (!result.meta.changes) {
      const already = await db.prepare("SELECT status,due_at FROM publications WHERE id=? AND user_id=?").bind(payload.postId, user.id).first<{ status: string; due_at: number }>();
      if (!already || already.status !== (row.kind === "cancel" ? "cancelled" : "scheduled") || already.due_at !== due) throw new Error("The queued post changed or is no longer eligible. Create a new request.");
    }
    await complete("approved", { publicationId: payload.postId, operation: row.kind });
    return { message: row.kind === "cancel" ? "Queued post cancelled." : "Queued post rescheduled.", done: true };
  } catch (error) {
    const message = error instanceof Error && /requested time|queued post changed/.test(error.message) ? error.message : "The request could not be completed. Check its status before creating another.";
    await complete("failed", { message });
    return { message, error: true };
  }
}
