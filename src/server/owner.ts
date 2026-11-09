export async function workspaceOwner(db: D1Database) {
  const configuredEmail = process.env.POSTQ_OWNER_EMAIL?.trim().toLowerCase();
  await db.prepare(`INSERT OR IGNORE INTO workspace_owner(singleton, user_id)
    SELECT 1, id FROM "user" WHERE (? IS NULL OR lower(email) = ?)
    ORDER BY createdAt, id LIMIT 1`).bind(configuredEmail ?? null, configuredEmail ?? null).run();
  return db.prepare("SELECT user_id FROM workspace_owner WHERE singleton = 1").first<string>("user_id");
}
