export interface Participant {
  id: number;
  ticket_number: string;
  name: string;
  // The draw (section) this ticket belongs to, e.g. "Grand Lucky Draw".
  // '' means the ticket is eligible in every draw.
  section: string;
}

export interface SectionSetting {
  name: string;
  // Digit slots shown while this section is selected. null = use Config's slot count.
  slot_count: number | null;
}

/** Tickets tagged for this section plus untagged ones (eligible everywhere). */
export function participantsForSection<T extends { section: string }>(all: T[], section: string): T[] {
  return all.filter((p) => p.section === "" || p.section === section);
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
  // Snapshot of the prize name at the time this was drawn ('' when no prize
  // was attached).
  prize_name: string;
  // Snapshot of that prize's group, e.g. "Group A" ('' = none).
  draw_group: string;
  // When the prize was handed out at the collection point (NULL = not yet).
  collected_at: string | null;
  created_at: string;
}

export interface Prize {
  id: number;
  section: string;
  name: string;
  winner_count: number;
  description: string;
  /** Prizes in a section with the same group are drawn together; "" = on its own. */
  draw_group: string;
  created_at: string;
}

/** A prize as entered or imported, before it has an id. */
export type PrizeInput = Pick<Prize, "section" | "name" | "winner_count" | "description" | "draw_group">;

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
  // Section selected on Manual Draw.
  current_section: string;
  // Section selected on Auto Draw (kept separately so the two screens don't follow each other).
  auto_section: string;
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
