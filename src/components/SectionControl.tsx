import { useState } from "react";
import { Modal } from "./Modal";

export function SectionControl({
  section,
  onSave,
}: {
  section: string;
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const openModal = () => {
    setInput(section);
    setOpen(true);
  };

  const save = () => {
    onSave(input.trim());
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={openModal}
        className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5"
      >
        Section: <span className="font-semibold text-white">{section || "None"}</span>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-2 text-lg font-bold">Draw section</h2>
          <p className="mb-4 text-sm text-white/60">
            Name this section (e.g. "Grand Prize" or "Round 2"). It's attached to every draw
            logged from here on, and shown in Results.
          </p>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="e.g. Grand Prize"
            className="mb-4 w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded-md bg-[#F5C518] px-3 py-2 font-semibold text-[#10141F]"
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
