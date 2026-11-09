CREATE TABLE channels_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  remote_id TEXT NOT NULL UNIQUE,
  state TEXT UNIQUE,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  label TEXT,
  platform TEXT NOT NULL DEFAULT 'threads' CHECK(platform IN ('threads', 'instagram', 'facebook', 'youtube', 'linkedin', 'pinterest', 'tiktok', 'x')),
  UNIQUE(user_id, id)
);

CREATE TABLE publications_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  claimed_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'sending', 'published', 'review', 'cancelled')),
  remote_post_id TEXT,
  media_id TEXT,
  destination TEXT,
  pending_receipt TEXT,
  checked_at INTEGER,
  delivery_options TEXT,
  FOREIGN KEY(user_id, channel_id) REFERENCES channels_next(user_id, id) ON DELETE CASCADE
);

INSERT INTO channels_next (id, user_id, remote_id, state, expires_at, active, platform)
  SELECT id, user_id, remote_id, state, expires_at, active, platform FROM channels;
INSERT INTO publications_next (id, user_id, channel_id, title, caption, due_at, claimed_at, status, remote_post_id, media_id, destination)
  SELECT id, user_id, channel_id, title, caption, due_at, claimed_at, status, remote_post_id, media_id, destination FROM publications;

CREATE TABLE publication_metrics_next (
  publication_id TEXT NOT NULL REFERENCES publications_next(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (publication_id, captured_at, name)
);
INSERT INTO publication_metrics_next SELECT * FROM publication_metrics;
DROP TABLE publication_metrics;
DROP TABLE publications;
DROP TABLE channels;
ALTER TABLE channels_next RENAME TO channels;
ALTER TABLE publications_next RENAME TO publications;

CREATE INDEX channels_owner ON channels(user_id, active);
CREATE INDEX publications_due ON publications(status, due_at, id);
CREATE INDEX publications_owner ON publications(user_id, due_at DESC);

ALTER TABLE publication_metrics_next RENAME TO publication_metrics;
CREATE INDEX publications_media ON publications(user_id, media_id, status);
