ALTER TABLE draw_records ADD COLUMN section_sequence INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS planned_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL,
    winner_count INTEGER NOT NULL,
    exclude_repeat_winners INTEGER NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
