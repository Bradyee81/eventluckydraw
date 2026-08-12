ALTER TABLE draw_records ADD COLUMN mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE draw_records ADD COLUMN exclude_repeat_winners INTEGER;
