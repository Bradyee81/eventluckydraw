import { useEffect, useRef } from "react";
import { EXTRA_LOOPS, LANDING_DURATION_MS } from "../lib/reelTiming";

export type ReelStatus = "idle" | "landing" | "locked";

interface SlotReelProps {
  stripUrl: string;
  status: ReelStatus;
  digit: number | null;
  cellHeight: number;
  onLanded?: () => void;
  landingDurationMs?: number;
  extraLoops?: number;
}

const NATIVE_CELL_RATIO = 200 / 300; // width : height of one digit cell in the source strip
const DIGIT_COUNT = 10;

export function SlotReel({
  stripUrl,
  status,
  digit,
  cellHeight,
  onLanded,
  landingDurationMs = LANDING_DURATION_MS,
  extraLoops = EXTRA_LOOPS,
}: SlotReelProps) {
  const reelRef = useRef<HTMLDivElement>(null);
  const cellWidth = cellHeight * NATIVE_CELL_RATIO;
  const cycleHeight = cellHeight * DIGIT_COUNT;

  useEffect(() => {
    const el = reelRef.current;
    if (!el) return;

    el.style.setProperty("--idle-distance", `${cycleHeight}px`);

    if (status === "idle") {
      el.style.transition = "none";
      el.style.backgroundPositionY = "0px";
      el.classList.add("animate-idle-spin");
      return;
    }

    el.classList.remove("animate-idle-spin");

    if (status === "landing" && digit !== null) {
      el.style.transition = "none";
      el.style.backgroundPositionY = "0px";
      // Force reflow so the reset above is committed before the transition starts.
      void el.offsetHeight;
      const targetY = -(extraLoops * cycleHeight + digit * cellHeight);
      el.style.transition = `background-position-y ${landingDurationMs}ms cubic-bezier(0.12, 0.85, 0.28, 1)`;
      el.style.backgroundPositionY = `${targetY}px`;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", handleEnd);
        clearTimeout(fallback);
        onLanded?.();
      };
      const handleEnd = (e: TransitionEvent) => {
        if (e.propertyName !== "background-position-y") return;
        finish();
      };
      el.addEventListener("transitionend", handleEnd);
      // Safety net: browsers occasionally drop transitionend (tab throttling,
      // interrupted transitions). Never let a reel spin forever if it's missed.
      const fallback = setTimeout(finish, landingDurationMs + 300);
      return () => {
        el.removeEventListener("transitionend", handleEnd);
        clearTimeout(fallback);
      };
    }

    if (status === "locked" && digit !== null) {
      el.style.transition = "none";
      el.style.backgroundPositionY = `${-(digit * cellHeight)}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, digit, cellHeight]);

  return (
    <div
      className="relative overflow-hidden rounded-md border border-white/10 bg-[#10141F] shadow-[inset_0_0_18px_rgba(0,0,0,0.6)]"
      style={{ width: cellWidth, height: cellHeight }}
    >
      <div
        ref={reelRef}
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${stripUrl})`,
          backgroundRepeat: "repeat-y",
          backgroundSize: `${cellWidth}px ${cycleHeight}px`,
          backgroundPositionY: 0,
        }}
      />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_10px_14px_-8px_rgba(0,0,0,0.85),inset_0_-10px_14px_-8px_rgba(0,0,0,0.85)]" />
    </div>
  );
}
