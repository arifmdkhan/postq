export async function cleanupMedia(db: D1Database, bucket: R2Bucket, limit = 20) {
  const { results } = await db.prepare("SELECT object_key FROM media_deletions WHERE created_at<=? ORDER BY created_at LIMIT ?")
    .bind(Date.now(),limit).all<{ object_key: string }>();
  for (const { object_key: key } of results) {
    try {
      await bucket.delete([key, key + "/thumbnail"]);
      await db.prepare("DELETE FROM media_deletions WHERE object_key=?").bind(key).run();
    } catch {
      await db.prepare("UPDATE media_deletions SET attempts=attempts+1 WHERE object_key=?").bind(key).run();
    }
  }
}
