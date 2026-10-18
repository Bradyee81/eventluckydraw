import { useCallback, useRef, useState } from "react";
import type { ReelStatus } from "../components/SlotReel";
import { STAGGER_MS } from "./reelTiming";

export function useReelMachine(slotCount: number) {
  const [statuses, setStatuses] = useState<ReelStatus[]>(() => Array(slotCount).fill("idle"));
  const [digits, setDigits] = useState<(number | null)[]>(() => Array(slotCount).fill(null));
  const nextStartAtRef = useRef(0);
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // The Output window registers its event handlers once, on first render, when
  // slotCount is still the default. Reading the live count from a ref keeps
  // roll/reset covering every reel (e.g. 7–12) instead of that stale default.
  const slotCountRef = useRef(slotCount);
  slotCountRef.current = slotCount;

  const clearPending = useCallback((index: number) => {
    const t = timeoutsRef.current.get(index);
    if (t) {
      clearTimeout(t);
      timeoutsRef.current.delete(index);
    }
  }, []);

  const setDigit = useCallback(
    (index: number, digit: number) => {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });

      clearPending(index);
      const now = Date.now();
      const startAt = Math.max(now, nextStartAtRef.current);
      nextStartAtRef.current = startAt + STAGGER_MS;
      const delay = startAt - now;

      const t = setTimeout(() => {
        timeoutsRef.current.delete(index);
        setStatuses((prev) => {
          const next = [...prev];
          next[index] = "landing";
          return next;
        });
      }, delay);
      timeoutsRef.current.set(index, t);
    },
    [clearPending]
  );

  const roll = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current.clear();
    nextStartAtRef.current = 0;
    setStatuses(Array<ReelStatus>(slotCountRef.current).fill("rolling"));
  }, []);

  const markLanded = useCallback((index: number) => {
    setStatuses((prev) => {
      if (prev[index] !== "landing") return prev;
      const next = [...prev];
      next[index] = "locked";
      return next;
    });
  }, []);

  const undoDigit = useCallback(
    (index: number) => {
      clearPending(index);
      setStatuses((prev) => {
        const next = [...prev];
        next[index] = "idle";
        return next;
      });
      setDigits((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
    },
    [clearPending]
  );

  const reset = useCallback(
    (newSlotCount?: number) => {
      const count = newSlotCount ?? slotCountRef.current;
      timeoutsRef.current.forEach((t) => clearTimeout(t));
      timeoutsRef.current.clear();
      nextStartAtRef.current = 0;
      setStatuses(Array<ReelStatus>(count).fill("idle"));
      setDigits(Array(count).fill(null));
    },
    []
  );

  return { statuses, digits, setDigit, roll, markLanded, undoDigit, reset };
}
