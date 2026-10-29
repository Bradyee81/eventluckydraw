import { formatSectionLabel } from "../lib/format";
import type { DrawRecord } from "../types";

export function RecentDraws({ records }: { records: DrawRecord[] }) {
  return (
    <div className="w-64 shrink-0 border-l border-white/10 pl-6">
      <h2 className="mb-3 text-sm font-semibold text-white/60">Recent draws</h2>
      {records.length === 0 && <p className="text-xs text-white/30">No draws logged yet.</p>}
      <ul className="space-y-2">
        {records.map((r) => (
          <li key={r.id} className="rounded-md border border-white/10 bg-white/[0.02] p-2">
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm font-semibold text-[#F5C518]">{r.number}</div>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                {formatSectionLabel(r.section, r.section_sequence)}
              </span>
            </div>
            {r.participant_name && (
              <div className="truncate text-xs text-white/70">{r.participant_name}</div>
            )}
            {(r.prize_name || r.draw_group) && (
              <div className="flex items-center gap-1.5 text-xs">
                {r.draw_group && (
                  <span className="shrink-0 rounded border border-[#F5C518]/40 px-1 text-[10px] font-semibold text-[#F5C518]">
                    {r.draw_group}
                  </span>
                )}
                <span className="truncate text-[#F5C518]">{r.prize_name}</span>
              </div>
            )}
            <div className="text-[10px] text-white/35">
              {new Date(r.created_at).toLocaleTimeString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
