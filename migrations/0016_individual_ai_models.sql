CREATE TABLE ai_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  tested_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(provider_id, model_id)
);
CREATE UNIQUE INDEX ai_model_default ON ai_models(is_default) WHERE is_default = 1;
CREATE INDEX ai_models_provider ON ai_models(provider_id, enabled);

INSERT INTO ai_models(id,provider_id,model_id,label,enabled,created_at)
SELECT p.id || '::' || j.value, p.id, j.value, j.value, 1, p.updated_at + CAST(j.key AS INTEGER)
FROM ai_providers p, json_each(p.models) j
WHERE j.type = 'text' AND length(trim(j.value)) > 0;

UPDATE ai_models SET is_default = 1
WHERE id = (SELECT m.id FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id
  WHERE p.enabled=1 ORDER BY p.is_default DESC, p.updated_at DESC, m.created_at, m.id LIMIT 1);
