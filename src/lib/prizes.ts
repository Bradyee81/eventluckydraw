import type { DrawMode, DrawRecord, Prize } from "../types";

/** One winner's place in a round: which prize (and its group) they get. */
export interface PrizeSlot {
  name: string;
  group: string;
}

/** Prizes expanded into one slot per winner, e.g. [iPhone x1, Voucher x2]
 *  -> [iPhone, Voucher, Voucher]. `count` overrides each prize's winner
 *  count (used for the winners a prize still needs). */
export function buildPrizePlan(
  prizes: Prize[],
  count: (prize: Prize) => number = (p) => p.winner_count
): PrizeSlot[] {
  const plan: PrizeSlot[] = [];
  for (const prize of prizes) {
    for (let i = 0; i < count(prize); i++) plan.push({ name: prize.name, group: prize.draw_group });
  }
  return plan;
}

export interface PrizeProgress {
  prize: Prize;
  drawn: number;
  remaining: number;
}

/** How many winners each prize in a section already has, matching that
 *  mode's logged draws to prizes by name in list order (so two "Voucher" rows
 *  fill up one after the other). */
export function prizeProgress(
  sectionPrizes: Prize[],
  sectionRecords: DrawRecord[],
  mode: DrawMode
): PrizeProgress[] {
  const drawnByName = new Map<string, number>();
  for (const r of sectionRecords) {
    if (r.mode === mode && r.prize_name) {
      drawnByName.set(r.prize_name, (drawnByName.get(r.prize_name) ?? 0) + 1);
    }
  }
  return sectionPrizes.map((prize) => {
    const available = drawnByName.get(prize.name) ?? 0;
    const drawn = Math.min(available, prize.winner_count);
    drawnByName.set(prize.name, available - drawn);
    return { prize, drawn, remaining: prize.winner_count - drawn };
  });
}

/** How much of a section one Auto Draw round draws. */
export type RoundSize = "prize" | "group" | "all";

/** The prizes the next round draws, in list order. "prize": the first prize
 *  that still needs winners. "group": that prize plus every other prize in
 *  its group that still needs winners (just the prize if it has no group).
 *  "all": everything still needing winners. Empty when fully drawn. */
export function nextRoundPrizes(progress: PrizeProgress[], size: RoundSize = "group"): PrizeProgress[] {
  const remaining = progress.filter((p) => p.remaining > 0);
  const first = remaining[0];
  if (!first) return [];
  if (size === "all") return remaining;
  const group = first.prize.draw_group;
  if (size === "prize" || !group) return [first];
  return remaining.filter((p) => p.prize.draw_group === group);
}
