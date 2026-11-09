CREATE TABLE assistant_chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  active_until INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','streaming','error','stopped')),
  error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX assistant_chats_owner ON assistant_chats(user_id, updated_at DESC);
