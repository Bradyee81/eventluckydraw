import Database from "@tauri-apps/plugin-sql";
import type { AppConfig, DrawMode, DrawRecord, Participant, PlannedRound, Prize, SectionSetting } from "../types";

let dbPromise: Promise<Database> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:lucky-draw.db");
  }
  return dbPromise;
}

export async function getConfig(): Promise<AppConfig> {
  const db = await getDb();
  const rows = await db.select<AppConfig[]>("SELECT * FROM app_config WHERE id = 1");
  return rows[0];
}

export async function updateConfig(patch: Partial<Omit<AppConfig, "id">>): Promise<AppConfig> {
  const db = await getDb();
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length > 0) {
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => patch[k]);
    await db.execute(`UPDATE app_config SET ${setClause} WHERE id = 1`, values);
  }
  return getConfig();
}

export async function listParticipants(): Promise<Participant[]> {
  const db = await getDb();
  return db.select<Participant[]>("SELECT * FROM participants ORDER BY ticket_number ASC");
}

/**
 * Replaces the list for one draw (section; '' = every draw), leaving other
 * draws' lists alone. Returns how many tickets were skipped because that
 * ticket number already belongs to another draw's list.
 */
export async function replaceParticipants(
  section: string,
  participants: { ticket_number: string; name: string }[]
): Promise<number> {
  const db = await getDb();
  await db.execute("DELETE FROM participants WHERE section = $1", [section]);
  let skipped = 0;
  for (const p of participants) {
    const result = await db.execute(
      "INSERT OR IGNORE INTO participants (ticket_number, name, section) VALUES ($1, $2, $3)",
      [p.ticket_number, p.name, section]
    );
    if (result.rowsAffected === 0) skipped++;
  }
  return skipped;
}

export async function clearParticipants(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM participants");
}

/** Looks the ticket up among those eligible for this section (tagged for it, or untagged). */
export async function findParticipantByTicket(
  ticketNumber: string,
  section: string
): Promise<Participant | null> {
  const db = await getDb();
  const rows = await db.select<Participant[]>(
    "SELECT * FROM participants WHERE ticket_number = $1 AND (section = '' OR section = $2)",
    [ticketNumber, section]
  );
  return rows[0] ?? null;
}

export async function addParticipant(participant: {
  ticket_number: string;
  name: string;
  section: string;
}): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT INTO participants (ticket_number, name, section) VALUES ($1, $2, $3)", [
    participant.ticket_number,
    participant.name,
    participant.section,
  ]);
}

export async function updateParticipant(
  id: number,
  patch: { ticket_number: string; name: string; section: string }
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE participants SET ticket_number = $1, name = $2, section = $3 WHERE id = $4",
    [patch.ticket_number, patch.name, patch.section, id]
  );
}

export async function deleteParticipant(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM participants WHERE id = $1", [id]);
}

/** Inserts a draw record and returns its position within its section (1st, 2nd, ...). */
export async function insertDrawRecord(record: {
  number: string;
  participant_id: number | null;
  participant_name: string | null;
  operator_note: string | null;
  section: string;
  mode: DrawMode;
  exclude_repeat_winners: boolean | null;
  prize_name: string;
}): Promise<number> {
  const db = await getDb();
  const countRows = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) as c FROM draw_records WHERE section = $1",
    [record.section]
  );
  const sectionSequence = (countRows[0]?.c ?? 0) + 1;

  await db.execute(
    "INSERT INTO draw_records (number, participant_id, participant_name, operator_note, section, section_sequence, mode, exclude_repeat_winners, prize_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      record.number,
      record.participant_id,
      record.participant_name,
      record.operator_note,
      record.section,
      sectionSequence,
      record.mode,
      record.exclude_repeat_winners === null ? null : record.exclude_repeat_winners ? 1 : 0,
      record.prize_name,
      new Date().toISOString(),
    ]
  );
  return sectionSequence;
}

export async function listDrawRecords(): Promise<DrawRecord[]> {
  const db = await getDb();
  return db.select<DrawRecord[]>("SELECT * FROM draw_records ORDER BY id DESC");
}

export async function clearDrawRecords(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM draw_records");
}

/** Distinct participant IDs that have already won something (any mode). */
export async function listPriorWinnerIds(): Promise<Set<number>> {
  const db = await getDb();
  const rows = await db.select<{ participant_id: number }[]>(
    "SELECT DISTINCT participant_id FROM draw_records WHERE participant_id IS NOT NULL"
  );
  return new Set(rows.map((r) => r.participant_id));
}

export async function listPlannedRounds(): Promise<PlannedRound[]> {
  const db = await getDb();
  return db.select<PlannedRound[]>("SELECT * FROM planned_rounds ORDER BY position ASC, id ASC");
}

export async function addPlannedRound(round: {
  section: string;
  winner_count: number;
  exclude_repeat_winners: boolean;
  prize_name: string;
}): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(position) as m FROM planned_rounds"
  );
  const position = (rows[0]?.m ?? 0) + 1;
  await db.execute(
    "INSERT INTO planned_rounds (section, winner_count, exclude_repeat_winners, prize_name, position, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      round.section,
      round.winner_count,
      round.exclude_repeat_winners ? 1 : 0,
      round.prize_name,
      position,
      new Date().toISOString(),
    ]
  );
}

export async function deletePlannedRound(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM planned_rounds WHERE id = $1", [id]);
}

export async function listPrizes(): Promise<Prize[]> {
  const db = await getDb();
  return db.select<Prize[]>("SELECT * FROM prizes ORDER BY id ASC");
}

export async function addPrize(prize: {
  section: string;
  name: string;
  winner_count: number;
  description: string;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO prizes (section, name, winner_count, description, created_at) VALUES ($1, $2, $3, $4, $5)",
    [prize.section, prize.name, prize.winner_count, prize.description, new Date().toISOString()]
  );
}

export async function updatePrize(
  id: number,
  patch: { section: string; name: string; winner_count: number; description: string }
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE prizes SET section = $1, name = $2, winner_count = $3, description = $4 WHERE id = $5",
    [patch.section, patch.name, patch.winner_count, patch.description, id]
  );
}

export async function deletePrize(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM prizes WHERE id = $1", [id]);
}

/** Replaces the whole prize catalog, mirroring how participant import works. */
export async function replacePrizes(
  prizes: { section: string; name: string; winner_count: number; description: string }[]
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM prizes");
  for (const p of prizes) {
    await db.execute(
      "INSERT INTO prizes (section, name, winner_count, description, created_at) VALUES ($1, $2, $3, $4, $5)",
      [p.section, p.name, p.winner_count, p.description, new Date().toISOString()]
    );
  }
}

export async function listSectionSettings(): Promise<SectionSetting[]> {
  const db = await getDb();
  return db.select<SectionSetting[]>("SELECT * FROM sections ORDER BY rowid ASC");
}

/** Section names from every source — settings, prizes and participant tags — in first-seen order. */
export async function listKnownSections(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ name: string }[]>(
    `SELECT name FROM sections
     UNION ALL SELECT section FROM prizes
     UNION ALL SELECT section FROM participants`
  );
  return Array.from(new Set(rows.map((r) => r.name).filter(Boolean)));
}

export async function setSectionSlotCount(name: string, slotCount: number | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO sections (name, slot_count) VALUES ($1, $2) ON CONFLICT(name) DO UPDATE SET slot_count = excluded.slot_count",
    [name, slotCount]
  );
}

export async function deleteSectionSetting(name: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM sections WHERE name = $1", [name]);
}
