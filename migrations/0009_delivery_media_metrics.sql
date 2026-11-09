ALTER TABLE publications ADD COLUMN media_id TEXT;
ALTER TABLE publications ADD COLUMN destination TEXT;
ALTER TABLE drafts ADD COLUMN delivery_plan TEXT;
ALTER TABLE media_assets ADD COLUMN folder TEXT;
ALTER TABLE media_assets ADD COLUMN tags TEXT;
CREATE INDEX publications_media ON publications(user_id, media_id, status);

CREATE TABLE publication_metrics (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (publication_id, captured_at, name)
);

CREATE TABLE assistant_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  brief TEXT NOT NULL,
  proposal TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX assistant_proposals_owner ON assistant_proposals(user_id, created_at DESC);
