-- Prizes in a section that share a group are drawn together in one round
-- (e.g. "Group A" = 6 prizes at once). Empty = the prize is drawn on its own.
ALTER TABLE prizes ADD COLUMN draw_group TEXT NOT NULL DEFAULT '';
