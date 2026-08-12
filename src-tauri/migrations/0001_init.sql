CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draw_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    participant_id INTEGER,
    participant_name TEXT,
    operator_note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (participant_id) REFERENCES participants (id)
);

CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    slot_count INTEGER NOT NULL DEFAULT 6,
    chroma_color TEXT NOT NULL DEFAULT '#00FF00',
    title_text TEXT NOT NULL DEFAULT '',
    footer_text TEXT NOT NULL DEFAULT '',
    title_font_size INTEGER NOT NULL DEFAULT 48,
    footer_font_size INTEGER NOT NULL DEFAULT 24,
    text_color TEXT NOT NULL DEFAULT '#FFFFFF',
    text_align TEXT NOT NULL DEFAULT 'center',
    digit_strip_path TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO app_config (id) VALUES (1);
