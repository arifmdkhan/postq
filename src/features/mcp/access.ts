export const mcpScopes = ["read", "drafts:write", "schedule:request"] as const;
export type MCPScope = typeof mcpScopes[number];
export type MCPAccess = { id: string; user_id: string; scopes: MCPScope[]; expires_at: number };
export type MCPToken = { id: string; name: string; scopes: string; created_at: number; expires_at: number; revoked_at: number | null; last_used_at: number | null };

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "postq_mcp_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function authenticateMCP(db: D1Database, authorization: string | null): Promise<MCPAccess | null> {
  const value = /^Bearer (postq_mcp_[a-f\d]{64})$/i.exec(authorization ?? "")?.[1];
  if (!value) return null;
  const row = await db.prepare(`SELECT t.id,t.user_id,t.scopes,t.expires_at FROM mcp_tokens t
    JOIN workspace_owner o ON o.user_id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`)
    .bind(await hashToken(value), Date.now()).first<{ id: string; user_id: string; scopes: string; expires_at: number }>();
  return row ? { ...row, scopes: JSON.parse(row.scopes) } : null;
}
export async function allowMCPRequest(db: D1Database, access: MCPAccess) {
  const now = Date.now();
  const window = Math.floor(now / 60000);
  const result = await db.prepare(`UPDATE mcp_tokens SET last_used_at=?,rate_window=?,
    rate_count=CASE WHEN rate_window<? THEN 1 ELSE rate_count+1 END
    WHERE id=? AND revoked_at IS NULL AND expires_at>? AND (rate_window<? OR rate_count<120)`)
    .bind(now, window, window, access.id, now, window).run();
  return result.meta.changes === 1;
}
