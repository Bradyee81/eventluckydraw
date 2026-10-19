import { usePresent } from "../lib/presentWindow";

const dropdownStyle = { backgroundColor: "#10141F", color: "#E6E9EF" };

/**
 * Display picker + Present/Exit Present, pinned to the side menu.
 * `compact` is the one-button version for the collapsed menu.
 */
export function PresentControl({ compact = false }: { compact?: boolean }) {
  const { presenting, displays, selectedKey, selectDisplay, refreshDisplays, toggle } = usePresent();

  if (compact) {
    return (
      <button
        onClick={toggle}
        title={presenting ? "Exit Present" : "Present"}
        className={`rounded-md px-1.5 py-1 text-xs font-bold ${
          presenting ? "bg-white/10 text-white" : "bg-[#F5C518] text-[#10141F]"
        }`}
      >
        {presenting ? "■" : "▶"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-1">
      {displays.length > 1 && (
        <select
          value={selectedKey}
          onChange={(e) => selectDisplay(e.target.value)}
          onFocus={refreshDisplays}
          disabled={presenting}
          title="Which screen to present on"
          style={dropdownStyle}
          className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[#F5C518] disabled:opacity-50"
        >
          {displays.map((d) => (
            <option key={d.key} value={d.key} style={dropdownStyle}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={toggle}
        className={`w-full rounded-md px-4 py-2 font-semibold ${
          presenting ? "bg-white/10 text-white" : "bg-[#F5C518] text-[#10141F]"
        }`}
      >
        {presenting ? "Exit Present" : "Present"}
      </button>
    </div>
  );
}
