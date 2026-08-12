ALTER TABLE app_config ADD COLUMN title_align TEXT NOT NULL DEFAULT 'center';
ALTER TABLE app_config ADD COLUMN footer_align TEXT NOT NULL DEFAULT 'center';

UPDATE app_config SET title_align = text_align, footer_align = text_align;
