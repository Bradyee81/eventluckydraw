import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SlotReel } from "../components/SlotReel";
import { useReelMachine } from "../lib/reelMachine";
import { getConfig } from "../lib/db";
import { onEvent, type ShowResultPayload } from "../lib/events";
import { DEFAULT_DIGIT_STRIP, type AppConfig } from "../types";

function useReelCellHeight(slotCount: number) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const byHeight = size.h * 0.42;
  const byWidth = (size.w * 0.86) / Math.max(slotCount, 1) / (200 / 300);
  return Math.max(70, Math.min(byHeight, byWidth, 260));
}

export function OutputApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const slotCount = config?.slot_count ?? 6;
  const { statuses, digits, setDigit, roll, markLanded, undoDigit, reset } = useReelMachine(slotCount);
  const cellHeight = useReelCellHeight(slotCount);
  const [resultPopup, setResultPopup] = useState<ShowResultPayload | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
    const unlistens = [
      onEvent("config:updated", (cfg) => {
        setConfig((prev) => {
          if (prev && prev.slot_count !== cfg.slot_count) {
            reset(cfg.slot_count);
          }
          return cfg;
        });
      }),
      onEvent("draw:digit-set", ({ index, digit }) => setDigit(index, digit)),
      onEvent("draw:digit-undo", ({ index }) => undoDigit(index)),
      onEvent("draw:roll", () => roll()),
      onEvent("draw:reset", () => {
        reset();
        setResultPopup(null);
      }),
      onEvent("draw:show-result", (payload) => setResultPopup(payload)),
      onEvent("draw:hide-result", () => setResultPopup(null)),
    ];
    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWindow().setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stripUrl = config?.digit_strip_path || DEFAULT_DIGIT_STRIP;
  const bg = config?.chroma_color || "#00FF00";

  return (
    <div
      className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: bg }}
    >
      {config?.title_text ? (
        <div
          className="mb-8 w-full self-stretch px-16 font-bold"
          style={{
            fontSize: config.title_font_size,
            color: config.text_color,
            textAlign: config.title_align,
          }}
        >
          {config.title_text}
        </div>
      ) : null}

      <div className="flex gap-3">
        {Array.from({ length: slotCount }).map((_, i) => (
          <SlotReel
            key={i}
            stripUrl={stripUrl}
            status={statuses[i] ?? "idle"}
            digit={digits[i] ?? null}
            cellHeight={cellHeight}
            onLanded={() => markLanded(i)}
          />
        ))}
      </div>

      {config?.footer_text ? (
        <div
          className="mt-8 w-full self-stretch px-16 font-medium"
          style={{
            fontSize: config.footer_font_size,
            color: config.text_color,
            textAlign: config.footer_align,
          }}
        >
          {config.footer_text}
        </div>
      ) : null}

      {resultPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 animate-[fadeIn_0.3s_ease-out]">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-4 border-[#F5C518] bg-[#10141F] p-10 text-center shadow-2xl">
            <div className="mb-6 text-3xl font-black tracking-wide text-[#F5C518]">
              {resultPopup.title}
            </div>
            <div className="space-y-3">
              {resultPopup.entries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-6 rounded-lg bg-white/5 px-6 py-3"
                >
                  <div className="text-left">
                    <div className="text-2xl font-bold text-white">{entry.name ?? "—"}</div>
                    {entry.prize && <div className="text-sm text-[#F5C518]/80">{entry.prize}</div>}
                  </div>
                  <span className="font-mono text-2xl tracking-widest text-[#F5C518]">
                    {entry.number}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
