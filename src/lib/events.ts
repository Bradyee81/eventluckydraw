import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppConfig } from "../types";

export interface DigitSetPayload {
  index: number;
  digit: number;
}

export interface DigitUndoPayload {
  index: number;
}

export interface DrawConfirmedPayload {
  number: string;
  participantName: string | null;
}

export interface ResultEntry {
  number: string;
  name: string | null;
}

export interface ShowResultPayload {
  title: string;
  entries: ResultEntry[];
}

export type LuckyDrawEvents = {
  "draw:digit-set": DigitSetPayload;
  "draw:digit-undo": DigitUndoPayload;
  "draw:reset": Record<string, never>;
  "draw:confirmed": DrawConfirmedPayload;
  "draw:show-result": ShowResultPayload;
  "draw:hide-result": Record<string, never>;
  "config:updated": AppConfig;
  "buzzer:status": { connected: boolean };
};

export function emitEvent<K extends keyof LuckyDrawEvents>(
  event: K,
  payload: LuckyDrawEvents[K]
): Promise<void> {
  return emit(event, payload);
}

export function onEvent<K extends keyof LuckyDrawEvents>(
  event: K,
  handler: (payload: LuckyDrawEvents[K]) => void
): Promise<UnlistenFn> {
  return listen<LuckyDrawEvents[K]>(event, (e) => handler(e.payload));
}
