import { useState } from "react";
import { Modal } from "./Modal";
import type { Prize } from "../types";

export function PrizeFormModal({
  prize,
  onSave,
  onClose,
}: {
  prize: Prize;
  onSave: (patch: { section: string; name: string; winner_count: number; description: string }) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState(prize.section);
  const [name, setName] = useState(prize.name);
  const [winnerCount, setWinnerCount] = useState(prize.winner_count);
  const [description, setDescription] = useState(prize.description);

  const save = () => {
    if (!section.trim() || !name.trim()) return;
    onSave({
      section: section.trim(),
      name: name.trim(),
      winner_count: Math.max(1, winnerCount),
      description: description.trim(),
    });
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold">Edit prize</h2>

      <div className="mb-3">
        <label className="mb-1 block text-xs text-white/60">Section name</label>
        <input
          autoFocus
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-white/60">Prize name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-white/60">Winners</label>
        <input
          type="number"
          min={1}
          value={winnerCount}
          onChange={(e) => setWinnerCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-24 rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-white/60">Description (optional)</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!section.trim() || !name.trim()}
          className="rounded-md bg-[#F5C518] px-3 py-2 font-semibold text-[#10141F] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
