import { useAppData } from "../AppDataContext";
import { CHROMA_PRESETS, type AppConfig, type TextAlign } from "../../types";

function AlignPicker({
  value,
  onChange,
}: {
  value: TextAlign;
  onChange: (align: TextAlign) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["left", "center", "right"] as TextAlign[]).map((align) => (
        <button
          key={align}
          onClick={() => onChange(align)}
          className={`rounded-md border px-3 py-1.5 capitalize ${
            value === align
              ? "border-[#F5C518] text-[#F5C518]"
              : "border-white/15 text-white/70 hover:bg-white/5"
          }`}
        >
          {align}
        </button>
      ))}
    </div>
  );
}

export function DisplayScreen() {
  const { config, updateConfig } = useAppData();
  if (!config) return null;

  const set = (patch: Partial<Omit<AppConfig, "id">>) => updateConfig(patch);

  return (
    <div className="mx-auto max-w-2xl p-8">
      <p className="mb-6 text-white/60">
        Background chroma key color and the fixed text slots shown on the Output Window.
      </p>

      <section className="mb-8">
        <label className="mb-2 block font-semibold">Chroma key background</label>
        <div className="grid grid-cols-4 gap-3">
          {CHROMA_PRESETS.map((preset) => (
            <button
              key={preset.hex}
              onClick={() => set({ chroma_color: preset.hex })}
              className={`flex flex-col items-center gap-1.5 rounded-md border p-2 ${
                config.chroma_color === preset.hex
                  ? "border-[#F5C518] ring-1 ring-[#F5C518]"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <div className="h-10 w-full rounded" style={{ backgroundColor: preset.hex }} />
              <span className="text-[11px] text-white/60">{preset.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/40">
          Pick a preset that doesn't visually clash with the digit strip's own colors so the
          switcher can key it out cleanly.
        </p>
      </section>

      <section className="mb-8">
        <label className="mb-2 block font-semibold">Title text</label>
        <input
          value={config.title_text}
          onChange={(e) => set({ title_text: e.target.value })}
          placeholder="e.g. LUCKY DRAW"
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
        />
        <div className="mt-3 flex items-center gap-6">
          <div className="flex items-center gap-3 text-xs text-white/60">
            <label>Size</label>
            <input
              type="number"
              value={config.title_font_size}
              onChange={(e) => set({ title_font_size: Number(e.target.value) })}
              className="w-20 rounded border border-white/15 bg-white/5 px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-white/60">
            <label>Alignment</label>
            <AlignPicker value={config.title_align} onChange={(align) => set({ title_align: align })} />
          </div>
        </div>
      </section>

      <section className="mb-8">
        <label className="mb-2 block font-semibold">Footer / sponsor line</label>
        <input
          value={config.footer_text}
          onChange={(e) => set({ footer_text: e.target.value })}
          placeholder="e.g. Sponsored by Acme Corp"
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
        />
        <div className="mt-3 flex items-center gap-6">
          <div className="flex items-center gap-3 text-xs text-white/60">
            <label>Size</label>
            <input
              type="number"
              value={config.footer_font_size}
              onChange={(e) => set({ footer_font_size: Number(e.target.value) })}
              className="w-20 rounded border border-white/15 bg-white/5 px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-white/60">
            <label>Alignment</label>
            <AlignPicker value={config.footer_align} onChange={(align) => set({ footer_align: align })} />
          </div>
        </div>
      </section>

      <section>
        <label className="mb-2 block font-semibold">Text color</label>
        <input
          type="color"
          value={config.text_color}
          onChange={(e) => set({ text_color: e.target.value })}
          className="h-9 w-16 rounded border border-white/15 bg-transparent"
        />
      </section>
    </div>
  );
}
