-- Snapshot of the prize's group when a winner was logged (e.g. "Group A"),
-- so results show it even if the prize list changes later. '' = no group.
ALTER TABLE draw_records ADD COLUMN draw_group TEXT NOT NULL DEFAULT '';
