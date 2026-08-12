// Shared with reelMachine.ts (stagger gating) and SlotReel.tsx (CSS transition
// duration). Anything that needs to *wait out* a reveal (e.g. Auto Mode
// sequencing the next winner) must compute its delay from these same
// constants instead of guessing a fixed pause.
export const STAGGER_MS = 220;
export const LANDING_DURATION_MS = 1500;
export const EXTRA_LOOPS = 3;

export function worstCaseRevealMs(slotCount: number): number {
  return slotCount * STAGGER_MS + LANDING_DURATION_MS;
}
