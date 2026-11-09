CREATE TABLE workspace_owner (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  user_id TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE RESTRICT
);
CREATE TRIGGER single_workspace_owner
BEFORE INSERT ON "user"
WHEN EXISTS (SELECT 1 FROM workspace_owner)
BEGIN
  SELECT RAISE(ABORT, 'Workspace registration is closed');
END;
CREATE TRIGGER claim_workspace_owner
AFTER INSERT ON "user"
BEGIN
  INSERT INTO workspace_owner(singleton, user_id) VALUES (1, NEW.id);
END;
CREATE TABLE app_settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('openai','anthropic','openai-compatible')),
  base_url TEXT,
  secret TEXT NOT NULL,
  models TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  tested_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ai_single_default ON ai_providers(is_default) WHERE is_default = 1;
