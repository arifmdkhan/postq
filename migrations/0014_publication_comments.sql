CREATE TABLE publication_comments (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  remote_id TEXT,
  PRIMARY KEY (publication_id, body)
);
