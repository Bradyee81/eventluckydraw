export interface Participant {
  id: number;
  ticket_number: string;
  name: string;
}

export type DrawMode = "manual" | "auto";

export interface DrawRecord {
  id: number;
  number: string;
  participant_id: number | null;
  participant_name: string | null;
  operator_note: string | null;
  section: string;
  // Position of this draw within its section, e.g. the 1st, 2nd, ... draw
  // logged under "Lucky Draw". Resets to 1 whenever the section changes.
  section_sequence: number;
  mode: DrawMode;
  // SQLite has no boolean type — comes back as 0/1, or NULL for manual draws.
  exclude_repeat_winners: number | null;
  // Snapshot of the prize name at the time this was drawn (Auto Mode only;
  // '' for manual draws or auto rounds with no prize attached).
  prize_name: string;
  created_at: string;
}

export interface Prize {
  id: number;
  section: string;
  name: string;
  winner_count: number;
  description: string;
  created_at: string;
}

export interface PlannedRound {
  id: number;
  section: string;
  winner_count: number;
  exclude_repeat_winners: number;
  // Snapshot of the prize name selected when this round was planned.
  prize_name: string;
  position: number;
  created_at: string;
}

export type TextAlign = "left" | "center" | "right";

export interface AppConfig {
  id: 1;
  slot_count: number;
  chroma_color: string;
  title_text: string;
  footer_text: string;
  title_font_size: number;
  footer_font_size: number;
  text_color: string;
  title_align: TextAlign;
  footer_align: TextAlign;
  digit_strip_path: string;
  current_section: string;
}

export interface ChromaPreset {
  name: string;
  hex: string;
}

export const CHROMA_PRESETS: ChromaPreset[] = [
  { name: "Pure Green", hex: "#00FF00" },
  { name: "Broadcast Green", hex: "#00B140" },
  { name: "Chroma Green", hex: "#00FF66" },
  { name: "Deep Green", hex: "#009A44" },
  { name: "Pure Blue", hex: "#0000FF" },
  { name: "Broadcast Blue", hex: "#0047AB" },
  { name: "Sky Blue", hex: "#0AB4E0" },
  { name: "Royal Blue", hex: "#1E3A8A" },
];

export const DEFAULT_DIGIT_STRIP = "/assets/digit-strip-default.svg";
export const DIGIT_CELL_HEIGHT = 300;
export const DIGIT_CELL_WIDTH = 200;
