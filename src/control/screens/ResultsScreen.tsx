import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { clearDrawRecords, listDrawRecords } from "../../lib/db";
import { markCollected } from "../../lib/collectionPoint";
import { CollectionPointPanel } from "../../components/CollectionPointPanel";
import { onEvent } from "../../lib/events";
import { drawRecordsToCsv } from "../../lib/csv";
import { formatSectionLabel } from "../../lib/format";
import { Modal } from "../../components/Modal";
import type { DrawRecord } from "../../types";

export function ResultsScreen() {
  const [records, setRecords] = useState<DrawRecord[]>([]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const refresh = () => listDrawRecords().then(setRecords);

  useEffect(() => {
    refresh();
    // Collected taps from the collection point page.
    const unlisten = onEvent("winners:changed", refresh);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const toggleCollected = async (r: DrawRecord) => {
    await markCollected(r, r.collected_at === null);
    refresh();
  };
  const collectedCount = records.filter((r) => r.collected_at !== null).length;

  const handleExport = async () => {
    setExportMsg(null);
    const path = await save({
      title: "Export results",
      defaultPath: `lucky-draw-results-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    await writeTextFile(path, drawRecordsToCsv(records));
    setExportMsg(`Exported ${records.length} records to ${path}`);
  };

  const handleClear = async () => {
    await clearDrawRecords();
    await refresh();
    setConfirmingClear(false);
    setExportMsg(null);
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Results</h1>
          <p className="text-white/60">Every confirmed draw, most recent first.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
          >
            Refresh
          </button>
          <button
            onClick={() => setConfirmingClear(true)}
            disabled={records.length === 0}
            className="rounded-md border border-[#E27676]/40 px-3 py-2 text-[#E27676] hover:bg-[#E27676]/10 disabled:opacity-30"
          >
            Clear results
          </button>
          <button
            onClick={handleExport}
            disabled={records.length === 0}
            className="rounded-md bg-[#F5C518] px-4 py-2 font-semibold text-[#10141F] disabled:opacity-30"
          >
            Export CSV
          </button>
        </div>
      </div>

      {exportMsg && <p className="mb-4 text-sm text-[#7CD992]">{exportMsg}</p>}

      <CollectionPointPanel collected={collectedCount} total={records.length} />

      <div className="overflow-hidden rounded-md border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0E1320] text-white/50">
            <tr>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2">Prize</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2">Collected</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-3 py-2 text-white/60">
                  {formatSectionLabel(r.section, r.section_sequence)}
                </td>
                <td className="px-3 py-2 text-[#F5C518]">
                  {r.draw_group && (
                    <span className="mr-1.5 rounded border border-[#F5C518]/40 px-1 text-[10px] font-semibold">
                      {r.draw_group}
                    </span>
                  )}
                  {r.prize_name || "—"}
                </td>
                <td className="px-3 py-2 text-white/60">
                  {r.mode === "auto" ? "Auto" : "Manual"}
                  {r.mode === "auto" && r.exclude_repeat_winners !== null && (
                    <span className="ml-1 text-[10px] text-white/30">
                      ({r.exclude_repeat_winners ? "excl." : "repeats ok"})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">{r.number}</td>
                <td className="px-3 py-2">{r.participant_name ?? "—"}</td>
                <td className="px-3 py-2 text-white/60">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-white/60">{r.operator_note ?? ""}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <button
                    onClick={() => toggleCollected(r)}
                    title={r.collected_at ? new Date(r.collected_at).toLocaleString() : "Mark as collected"}
                    className={
                      r.collected_at
                        ? "rounded border border-[#7CD992]/40 px-2 py-0.5 text-xs text-[#7CD992]"
                        : "rounded border border-white/15 px-2 py-0.5 text-xs text-white/40 hover:bg-white/5"
                    }
                  >
                    {r.collected_at ? "✓ Collected" : "Not yet"}
                  </button>
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-white/40">
                  No draws logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmingClear && (
        <Modal onClose={() => setConfirmingClear(false)}>
          <h2 className="mb-2 text-lg font-bold text-[#E27676]">Clear all results?</h2>
          <p className="mb-4 text-sm text-white/70">
            This permanently deletes all {records.length} logged draw{records.length === 1 ? "" : "s"}.
            Export a CSV first if you want a copy. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirmingClear(false)}
              className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleClear}
              className="rounded-md bg-[#E27676] px-3 py-2 font-semibold text-[#10141F]"
            >
              Delete all
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
