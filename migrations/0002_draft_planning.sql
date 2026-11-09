ALTER TABLE drafts ADD COLUMN planned_on TEXT;
CREATE INDEX drafts_by_planned_day ON drafts(user_id, planned_on, id) WHERE planned_on IS NOT NULL;
