ALTER TABLE publications ADD COLUMN live_change TEXT CHECK (live_change IN ('editing', 'deleting'));
ALTER TABLE publications ADD COLUMN deleted_at INTEGER;
ALTER TABLE publications ADD COLUMN live_change_at INTEGER;
ALTER TABLE publications ADD COLUMN live_change_caption TEXT;
