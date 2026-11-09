ALTER TABLE drafts ADD COLUMN tag TEXT;
CREATE INDEX drafts_by_tag ON drafts(user_id, tag, updated_at DESC, id DESC) WHERE tag IS NOT NULL;
