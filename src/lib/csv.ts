import * as XLSX from "xlsx";
import type { DrawRecord, PrizeInput } from "../types";

const TICKET_HEADER_ALIASES = ["ticket number", "ticket_number", "ticket", "number", "no", "id"];
const NAME_HEADER_ALIASES = ["name", "full name", "participant", "participant name"];

/**
 * Reads every cell as the text shown in the file, so ticket numbers like
 * "0101" keep their leading zero instead of being parsed as the number 101.
 */
async function readFirstSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  // raw: true stops CSV/text values being converted to numbers on read.
  const workbook = XLSX.read(buffer, { type: "array", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw: false returns Excel cells as displayed (e.g. a "0000" number format).
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase();
}

export interface ParsedParticipant {
  ticket_number: string;
  name: string;
}

export async function parseParticipantFile(file: File): Promise<ParsedParticipant[]> {
  const rows = await readFirstSheetRows(file);

  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const ticketHeader = headers.find((h) => TICKET_HEADER_ALIASES.includes(normalizeHeader(h))) ?? headers[0];
  const nameHeader = headers.find((h) => NAME_HEADER_ALIASES.includes(normalizeHeader(h))) ?? headers[1] ?? headers[0];

  const seen = new Set<string>();
  const participants: ParsedParticipant[] = [];
  for (const row of rows) {
    const ticket = String(row[ticketHeader] ?? "").trim();
    const name = String(row[nameHeader] ?? "").trim();
    if (!ticket) continue;
    if (seen.has(ticket)) continue;
    seen.add(ticket);
    participants.push({ ticket_number: ticket, name });
  }
  return participants;
}

const SECTION_HEADER_ALIASES = ["section", "section name", "round"];
const PRIZE_NAME_HEADER_ALIASES = ["prize", "prize name", "name"];
const WINNER_COUNT_HEADER_ALIASES = ["number", "winner count", "winners", "quantity", "qty", "count"];
const DESCRIPTION_HEADER_ALIASES = ["description", "desc", "notes"];
const GROUP_HEADER_ALIASES = ["group", "draw group", "prize group"];

export type ParsedPrize = PrizeInput;

export async function parsePrizeFile(file: File): Promise<ParsedPrize[]> {
  const rows = await readFirstSheetRows(file);

  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const sectionHeader = headers.find((h) => SECTION_HEADER_ALIASES.includes(normalizeHeader(h))) ?? headers[0];
  const nameHeader = headers.find((h) => PRIZE_NAME_HEADER_ALIASES.includes(normalizeHeader(h))) ?? headers[1] ?? headers[0];
  const countHeader = headers.find((h) => WINNER_COUNT_HEADER_ALIASES.includes(normalizeHeader(h)));
  const descriptionHeader = headers.find((h) => DESCRIPTION_HEADER_ALIASES.includes(normalizeHeader(h)));
  const groupHeader = headers.find((h) => GROUP_HEADER_ALIASES.includes(normalizeHeader(h)));

  const prizes: ParsedPrize[] = [];
  for (const row of rows) {
    const section = String(row[sectionHeader] ?? "").trim();
    const name = String(row[nameHeader] ?? "").trim();
    if (!section || !name) continue;
    const winnerCount = countHeader ? Math.max(1, parseInt(String(row[countHeader]), 10) || 1) : 1;
    const description = descriptionHeader ? String(row[descriptionHeader] ?? "").trim() : "";
    const drawGroup = groupHeader ? String(row[groupHeader] ?? "").trim() : "";
    prizes.push({ section, name, winner_count: winnerCount, description, draw_group: drawGroup });
  }
  return prizes;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function drawRecordsToCsv(records: DrawRecord[]): string {
  const header = [
    "Section",
    "Draw #",
    "Group",
    "Prize",
    "Mode",
    "Exclude Repeat Winners",
    "Number",
    "Participant Name",
    "Timestamp",
    "Operator Note",
  ];
  const lines = [header.join(",")];
  for (const r of records) {
    lines.push(
      [
        csvEscape(r.section ?? ""),
        csvEscape(String(r.section_sequence)),
        csvEscape(r.draw_group ?? ""),
        csvEscape(r.prize_name ?? ""),
        csvEscape(r.mode),
        csvEscape(r.exclude_repeat_winners === null ? "" : r.exclude_repeat_winners ? "Yes" : "No"),
        csvEscape(r.number),
        csvEscape(r.participant_name ?? ""),
        csvEscape(r.created_at),
        csvEscape(r.operator_note ?? ""),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}
