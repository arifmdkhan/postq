CREATE TABLE publication_metrics_latest (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  name TEXT NOT NULL, value INTEGER NOT NULL, captured_at INTEGER NOT NULL,
  PRIMARY KEY(publication_id,name)
);
INSERT INTO publication_metrics_latest(publication_id,name,value,captured_at)
  SELECT m.publication_id,m.name,m.value,m.captured_at FROM publication_metrics m
  WHERE m.captured_at=(SELECT max(n.captured_at) FROM publication_metrics n WHERE n.publication_id=m.publication_id AND n.name=m.name);
CREATE TRIGGER capture_latest_metric AFTER INSERT ON publication_metrics
BEGIN
  INSERT INTO publication_metrics_latest(publication_id,name,value,captured_at) VALUES (NEW.publication_id,NEW.name,NEW.value,NEW.captured_at)
  ON CONFLICT(publication_id,name) DO UPDATE SET value=excluded.value,captured_at=excluded.captured_at
    WHERE excluded.captured_at>=publication_metrics_latest.captured_at;
END;
