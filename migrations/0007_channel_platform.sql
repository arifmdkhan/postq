ALTER TABLE channels ADD COLUMN platform TEXT NOT NULL DEFAULT 'threads'
  CHECK(platform IN ('threads', 'instagram', 'facebook'));
