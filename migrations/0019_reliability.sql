ALTER TABLE drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER draft_revision AFTER UPDATE OF title, body, planned_on, tag, delivery_plan ON drafts
BEGIN
  UPDATE drafts SET revision = OLD.revision + 1,
    updated_at = CASE WHEN NEW.updated_at <= OLD.updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', OLD.updated_at, '+0.001 seconds') ELSE NEW.updated_at END
    WHERE id = NEW.id;
END;

ALTER TABLE publications ADD COLUMN abandoned_at INTEGER;
ALTER TABLE publications ADD COLUMN last_error TEXT;
ALTER TABLE publications ADD COLUMN reconciled_at INTEGER;
ALTER TABLE publication_comments ADD COLUMN state TEXT NOT NULL DEFAULT 'uncertain'
  CHECK(state IN ('sending','uncertain','confirmed','not-sent','closed'));
UPDATE publication_comments SET state = CASE WHEN remote_id IS NULL THEN 'uncertain' ELSE 'confirmed' END;

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT NOT NULL, error_code TEXT
);
CREATE INDEX delivery_attempts_post ON delivery_attempts(publication_id, started_at DESC);
CREATE TABLE media_deletions (
  object_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER queue_media_deletion AFTER DELETE ON media_assets
BEGIN
  INSERT OR IGNORE INTO media_deletions(object_key,created_at) VALUES (OLD.user_id || '/' || OLD.id,unixepoch()*1000);
END;
ALTER TABLE media_assets ADD COLUMN metadata TEXT;
ALTER TABLE media_assets ADD COLUMN thumbnail INTEGER NOT NULL DEFAULT 0;
CREATE INDEX publications_channel_owner ON publications(user_id, channel_id, due_at DESC, id);
CREATE INDEX metrics_latest ON publication_metrics(publication_id, name, captured_at DESC);
