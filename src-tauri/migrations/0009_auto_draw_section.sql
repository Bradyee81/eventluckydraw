-- Auto Draw keeps its own selected section, separate from Manual Draw's
-- (current_section). Starts as whatever was selected before.
ALTER TABLE app_config ADD COLUMN auto_section TEXT NOT NULL DEFAULT '';
UPDATE app_config SET auto_section = current_section;
