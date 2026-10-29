-- When the prize desk marked this winner's prize as handed out (from the
-- collection point page or the Results screen). NULL = not collected yet.
ALTER TABLE draw_records ADD COLUMN collected_at TEXT;
