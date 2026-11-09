CREATE TABLE channels (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  remote_id TEXT NOT NULL UNIQUE,
  state TEXT UNIQUE,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  UNIQUE(user_id, id)
);
CREATE INDEX channels_owner ON channels(user_id, active);

CREATE TABLE publications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  claimed_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'sending', 'published', 'review', 'cancelled')),
  remote_post_id TEXT,
  FOREIGN KEY(user_id, channel_id) REFERENCES channels(user_id, id) ON DELETE CASCADE
);
CREATE INDEX publications_due ON publications(status, due_at, id);
CREATE INDEX publications_owner ON publications(user_id, due_at DESC);

