import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listDrawRecords, setDrawRecordCollected } from "./db";
import { emitEvent, onEvent } from "./events";
import type { DrawRecord } from "../types";

// The collection point: the prize desk sees every winner live and ticks off
// prizes handed out, either
// - on this WiFi: the page the app serves itself at :3000/winners, or
// - online: insphoto.pages.dev/w/<code>, behind a PIN, from any phone on
//   mobile data. The app syncs to the `luckydraw` function in the InsPhoto
//   Supabase project.

/** How often the winners list is re-read for the WiFi page. */
const PUBLISH_EVERY_MS = 1500;
/** How often the online page is synced (when it's turned on). */
const SYNC_EVERY_MS = 3000;

const ONLINE_API = "https://pqhstyhtakohvwfjpmmf.supabase.co/functions/v1/luckydraw";
const ONLINE_PAGE = "https://insphoto.pages.dev/w/";
const ONLINE_KEY = "collection.online";
const PENDING_KEY = "collection.onlinePending";

export interface CollectionPage {
  url: string | null;
  qr_svg: string | null;
}

export const getCollectionPage = () => invoke<CollectionPage>("collection_page");
export const qrSvg = (text: string) => invoke<string>("qr_svg", { text });

/** A draw record's identity online: its id plus draw time, so a reused id is a new winner. */
const uidOf = (r: DrawRecord) => `${r.id}@${r.created_at}`;

// --- Online settings and status --------------------------------------------

interface OnlineRoom {
  code: string;
  /** Publish key: lets this laptop (only) change the room. */
  key: string;
  name: string;
}

export interface OnlineStatus {
  room: OnlineRoom | null;
  url: string | null;
  /** Last time a sync went through. */
  syncedAt: number | null;
  error: string | null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

let status: OnlineStatus = (() => {
  const room = readJson<OnlineRoom | null>(ONLINE_KEY, null);
  return { room, url: room ? ONLINE_PAGE + room.code : null, syncedAt: null, error: null };
})();
const listeners = new Set<() => void>();
function setStatus(patch: Partial<OnlineStatus>) {
  status = { ...status, ...patch };
  if ("room" in patch) status.url = status.room ? ONLINE_PAGE + status.room.code : null;
  listeners.forEach((l) => l());
}

export function useOnlineStatus(): OnlineStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status
  );
}

/** Collected ticks made on this laptop that the online page hasn't had yet. */
const pending: Map<string, boolean> = new Map(readJson<[string, boolean][]>(PENDING_KEY, []));
const savePending = () => localStorage.setItem(PENDING_KEY, JSON.stringify([...pending]));

async function callOnline<T>(route: string, body: object): Promise<T> {
  const res = await fetch(ONLINE_API + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The online page answered ${res.status}`);
  return data as T;
}

/** Turns on the online page with a new link. */
export async function turnOnOnline(name: string, pin: string): Promise<void> {
  const { code, key } = await callOnline<{ code: string; key: string }>("/create", { name, pin });
  const room = { code, key, name };
  localStorage.setItem(ONLINE_KEY, JSON.stringify(room));
  pending.clear();
  savePending();
  lastSentWinners = "";
  setStatus({ room, syncedAt: null, error: null });
  syncOnline();
}

export async function changeOnlinePin(pin: string): Promise<void> {
  const room = status.room;
  if (!room) return;
  await callOnline("/pin", { code: room.code, key: room.key, pin, name: room.name });
}

/** Turns the online page off and deletes its copy of the winners. */
export async function turnOffOnline(): Promise<void> {
  const room = status.room;
  if (!room) return;
  try {
    await callOnline("/delete", { code: room.code, key: room.key });
  } finally {
    localStorage.removeItem(ONLINE_KEY);
    pending.clear();
    savePending();
    setStatus({ room: null, syncedAt: null, error: null });
  }
}

// --- Syncing ----------------------------------------------------------------

/** Marks a winner collected (or not) from this laptop or the WiFi page. */
export async function markCollected(r: DrawRecord, collected: boolean): Promise<void> {
  await setDrawRecordCollected(r.id, collected ? new Date().toISOString() : null);
  if (status.room) {
    pending.set(uidOf(r), collected);
    savePending();
    syncOnline();
  }
  await publishLocal();
  await emitEvent("winners:changed", {});
}

let lastPublished = "";
async function publishLocal(records?: DrawRecord[]) {
  records ??= await listDrawRecords();
  const json = JSON.stringify({
    winners: records.map((r) => ({
      id: r.id,
      number: r.number,
      name: r.participant_name ?? "",
      prize: r.prize_name,
      group: r.draw_group,
      section: r.section,
      collected: r.collected_at !== null,
    })),
  });
  if (json !== lastPublished) {
    lastPublished = json;
    await invoke("publish_winners", { json });
  }
}

let lastSentWinners = "";
let syncing = false;
let syncAgain = false;

async function syncOnline() {
  const room = status.room;
  if (!room) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    const records = await listDrawRecords();
    const winners = JSON.stringify(
      records.map((r) => ({
        uid: uidOf(r),
        id: r.id,
        number: r.number,
        name: r.participant_name ?? "",
        prize: r.prize_name,
        group: r.draw_group,
        section: r.section,
        drawn_at: r.created_at,
      }))
    );
    const sent = new Map(pending);
    const { collected } = await callOnline<{ collected: Record<string, string | null> }>("/sync", {
      code: room.code,
      key: room.key,
      // The full list only when it changed; otherwise just collect the ticks.
      ...(winners !== lastSentWinners ? { winners: JSON.parse(winners) } : {}),
      collect: [...sent].map(([uid, c]) => ({ uid, collected: c })),
    });
    if (status.room?.code !== room.code) return; // turned off meanwhile
    lastSentWinners = winners;
    for (const [uid, c] of sent) if (pending.get(uid) === c) pending.delete(uid);
    savePending();

    // Ticks made on phones come back here.
    let changed = false;
    for (const r of records) {
      const uid = uidOf(r);
      if (!(uid in collected) || pending.has(uid)) continue;
      if ((collected[uid] !== null) !== (r.collected_at !== null)) {
        await setDrawRecordCollected(r.id, collected[uid]);
        changed = true;
      }
    }
    if (changed) {
      await publishLocal();
      await emitEvent("winners:changed", {});
    }
    setStatus({ syncedAt: Date.now(), error: null });
  } catch (err) {
    setStatus({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      syncOnline();
    }
  }
}

/**
 * Keeps both collection point pages fed with the current winners and saves
 * "Collected" taps from them. Mounted once in the Control window. Reading
 * the records on a timer covers every screen that logs, undoes or clears
 * draws without each one reporting.
 */
export function useCollectionPointPublisher() {
  useEffect(() => {
    publishLocal();
    syncOnline();
    const localTimer = setInterval(publishLocal, PUBLISH_EVERY_MS);
    const onlineTimer = setInterval(syncOnline, SYNC_EVERY_MS);
    const unlisten = onEvent("winners:collect", async ({ id, collected }) => {
      const record = (await listDrawRecords()).find((r) => r.id === id);
      if (record) await markCollected(record, collected);
    });
    return () => {
      clearInterval(localTimer);
      clearInterval(onlineTimer);
      unlisten.then((fn) => fn());
    };
  }, []);
}
