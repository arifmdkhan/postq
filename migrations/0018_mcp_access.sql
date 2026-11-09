CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  rate_window INTEGER NOT NULL DEFAULT 0,
  rate_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mcp_tokens_owner ON mcp_tokens(user_id, created_at DESC);
CREATE TABLE mcp_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES mcp_tokens(id),
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('schedule','reschedule','cancel')),
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approving','approved','rejected','failed')),
  result TEXT,
  attempt TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(token_id,request_key)
);
CREATE INDEX mcp_requests_owner ON mcp_requests(user_id, created_at DESC);
