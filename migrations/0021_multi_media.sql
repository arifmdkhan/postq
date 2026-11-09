ALTER TABLE publications ADD COLUMN media_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_ids) AND json_type(media_ids)='array' AND json_array_length(media_ids)<=35);
UPDATE publications SET media_ids=json_array(media_id) WHERE media_id IS NOT NULL;
CREATE INDEX publications_active_media_owner ON publications(user_id)
WHERE status IN ('scheduled','sending','review') OR (pending_receipt IS NOT NULL AND reconciled_at IS NULL);
