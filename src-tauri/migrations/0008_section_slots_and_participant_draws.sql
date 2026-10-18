-- Per-section settings. slot_count NULL = use the slot count set on Config.
CREATE TABLE IF NOT EXISTS sections (
    name TEXT PRIMARY KEY,
    slot_count INTEGER
);

-- Which draw (section) a participant's ticket belongs to. '' = every draw.
ALTER TABLE participants ADD COLUMN section TEXT NOT NULL DEFAULT '';
