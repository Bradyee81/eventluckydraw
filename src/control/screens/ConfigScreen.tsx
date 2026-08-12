import { useRef } from "react";
import { useAppData } from "../AppDataContext";
import { DEFAULT_DIGIT_STRIP } from "../../types";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ConfigScreen() {
  const { config, updateConfig } = useAppData();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!config) return null;
  const stripUrl = config.digit_strip_path || DEFAULT_DIGIT_STRIP;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-1 text-xl font-bold">Config</h1>
      <p className="mb-6 text-white/60">
        Set the number of slots for this event and the digit strip artwork shared across all
        slots.
      </p>

      <section className="mb-8">
        <label className="mb-2 block font-semibold">Slot count</label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={5}
            max={12}
            value={config.slot_count}
            onChange={(e) => updateConfig({ slot_count: Number(e.target.value) })}
            className="w-64"
          />
          <span className="w-10 text-center text-lg font-bold text-[#F5C518]">
            {config.slot_count}
          </span>
        </div>
        <p className="mt-1 text-xs text-white/40">
          5–12 slots, based on the ticket digit length for this event.
        </p>
      </section>

      <section>
        <label className="mb-2 block font-semibold">Digit strip design</label>
        <div className="flex items-start gap-4">
          <div
            className="overflow-hidden rounded-md border border-white/10 bg-[#10141F]"
            style={{
              width: 80,
              height: 120,
              backgroundImage: `url(${stripUrl})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: "80px 1200px",
              backgroundPosition: "0 0",
            }}
          />
          <p className="sr-only">Preview shows digit 0 from the current strip.</p>
          <div>
            <div className="mb-2 flex gap-2">
              <button
                onClick={() => updateConfig({ digit_strip_path: "" })}
                className="rounded-md border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/5"
              >
                Use default strip
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-md bg-[#F5C518] px-3 py-1.5 font-semibold text-[#10141F]"
              >
                Upload custom strip
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const dataUrl = await readFileAsDataUrl(file);
                  await updateConfig({ digit_strip_path: dataUrl });
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
            </div>
            <p className="max-w-sm text-xs text-white/40">
              One vertical strip image with digits 0–9 stacked in order, equal height per digit,
              no gaps. This is shared across every slot.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
