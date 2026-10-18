import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAppData } from "../AppDataContext";
import { parseParticipantFile, parsePrizeFile } from "../../lib/csv";
import {
  addParticipant,
  addPrize,
  clearParticipants,
  deleteParticipant,
  deletePrize,
  getSectionUsage,
  listPrizes,
  replaceParticipants,
  replacePrizes,
  updateParticipant,
  updatePrize,
} from "../../lib/db";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PrizeFormModal } from "../../components/PrizeFormModal";
import type { Participant, Prize } from "../../types";

const dropdownStyle = { backgroundColor: "#10141F", color: "#E6E9EF" };
const SLOT_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Picks which draw a ticket belongs to; '' = every draw. */
function DrawSelect({
  value,
  sections,
  onChange,
  className = "",
}: {
  value: string;
  sections: string[];
  onChange: (section: string) => void;
  className?: string;
}) {
  const options = value && !sections.includes(value) ? [...sections, value] : sections;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={dropdownStyle}
      className={`rounded-md border border-white/15 bg-white/5 px-2 py-2 text-sm outline-none focus:border-[#F5C518] ${className}`}
    >
      <option value="" style={dropdownStyle}>
        All draws
      </option>
      {options.map((s) => (
        <option key={s} value={s} style={dropdownStyle}>
          {s}
        </option>
      ))}
    </select>
  );
}

export function SetupScreen() {
  const {
    config,
    participants,
    refreshParticipants,
    knownSections,
    sectionSettings,
    refreshSections,
    setSectionSlotCount,
    renameDraw,
    deleteDraw,
  } = useAppData();
  const [importSection, setImportSection] = useState("");
  const [newDrawName, setNewDrawName] = useState("");

  const handleAddDraw = async () => {
    const name = newDrawName.trim();
    if (!name) return;
    await setSectionSlotCount(name, null);
    setNewDrawName("");
  };

  const [renamingDraw, setRenamingDraw] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [deletingDraw, setDeletingDraw] = useState<{ name: string; message: string } | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);

  const startRenameDraw = (name: string) => {
    setDrawError(null);
    setRenamingDraw(name);
    setRenameInput(name);
  };

  const saveRenameDraw = async () => {
    const oldName = renamingDraw;
    const newName = renameInput.trim();
    setRenamingDraw(null);
    if (!oldName || !newName || newName === oldName) return;
    await renameDraw(oldName, newName);
    if (importSection === oldName) setImportSection(newName);
    if (newSection === oldName) setNewSection(newName);
    refreshPrizes();
  };

  const askDeleteDraw = async (name: string) => {
    setDrawError(null);
    const usage = await getSectionUsage(name);
    if (usage.results > 0) {
      setDrawError(
        `"${name}" already has ${usage.results} draw result${usage.results === 1 ? "" : "s"}. Clear them on the Results screen before deleting it, or rename it instead.`
      );
      return;
    }
    const parts = [
      usage.prizes && `${usage.prizes} prize${usage.prizes === 1 ? "" : "s"}`,
      usage.participants && `${usage.participants} ticket${usage.participants === 1 ? "" : "s"} tagged to it`,
      usage.plannedRounds && `${usage.plannedRounds} planned round${usage.plannedRounds === 1 ? "" : "s"}`,
    ].filter(Boolean);
    setDeletingDraw({
      name,
      message:
        parts.length > 0
          ? `This also deletes its ${parts.join(", ")}. This can't be undone.`
          : "Nothing else uses this draw.",
    });
  };

  const confirmDeleteDraw = async () => {
    if (!deletingDraw) return;
    const { name } = deletingDraw;
    setDeletingDraw(null);
    try {
      await deleteDraw(name);
      if (importSection === name) setImportSection("");
      if (newSection === name) setNewSection("");
      refreshPrizes();
    } catch (err) {
      setDrawError(String(err));
    }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setStatus(null);
    try {
      const parsed = await parseParticipantFile(file);
      if (parsed.length === 0) {
        setStatus("No rows found. Expect columns like 'Ticket Number' and 'Name'.");
        return;
      }
      const skipped = await replaceParticipants(importSection, parsed);
      await refreshParticipants();
      const target = importSection ? `"${importSection}"` : "all draws";
      setStatus(
        `Imported ${parsed.length - skipped} participants for ${target} from ${file.name}.` +
          (skipped > 0
            ? ` Skipped ${skipped} ticket number${skipped === 1 ? "" : "s"} already in another draw's list.`
            : "")
      );
    } catch (err) {
      setStatus(`Import failed: ${String(err)}`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClear = async () => {
    await clearParticipants();
    await refreshParticipants();
    setStatus("Participant list cleared. Manual Mode will accept any number, unvalidated.");
  };

  const [newTicket, setNewTicket] = useState("");
  const [newName, setNewName] = useState("");
  const [newSection, setNewSection] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTicket, setEditTicket] = useState("");
  const [editName, setEditName] = useState("");
  const [editSection, setEditSection] = useState("");

  const handleAddParticipant = async () => {
    const ticket = newTicket.trim();
    const name = newName.trim();
    if (!ticket) return;
    try {
      await addParticipant({ ticket_number: ticket, name, section: newSection });
      setNewTicket("");
      setNewName("");
      setStatus(null);
      await refreshParticipants();
    } catch {
      setStatus(`Couldn't add — ticket number "${ticket}" is already in use.`);
    }
  };

  const startEditParticipant = (p: Participant) => {
    setEditingId(p.id);
    setEditTicket(p.ticket_number);
    setEditName(p.name);
    setEditSection(p.section);
  };

  const cancelEditParticipant = () => {
    setEditingId(null);
  };

  const saveEditParticipant = async (id: number) => {
    const ticket = editTicket.trim();
    if (!ticket) return;
    try {
      await updateParticipant(id, {
        ticket_number: ticket,
        name: editName.trim(),
        section: editSection,
      });
      setEditingId(null);
      setStatus(null);
      await refreshParticipants();
    } catch {
      setStatus(`Couldn't save — ticket number "${ticket}" is already in use.`);
    }
  };

  const handleDeleteParticipant = async (id: number) => {
    await deleteParticipant(id);
    await refreshParticipants();
  };

  const downloadTemplate = async () => {
    const path = await save({
      title: "Save participant list template",
      defaultPath: "participant-list-template.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    const csv = "Ticket Number,Name\r\n1001,Jane Doe\r\n1002,John Smith\r\n";
    await writeTextFile(path, csv);
    setStatus(`Template saved to ${path}`);
  };

  // --- Prizes -------------------------------------------------------------
  const prizeFileInputRef = useRef<HTMLInputElement>(null);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [prizeStatus, setPrizeStatus] = useState<string | null>(null);
  const [prizeBusy, setPrizeBusy] = useState(false);
  const [newPrizeSection, setNewPrizeSection] = useState("");
  const [newPrizeName, setNewPrizeName] = useState("");
  const [newPrizeCount, setNewPrizeCount] = useState(1);
  const [newPrizeDescription, setNewPrizeDescription] = useState("");

  const refreshPrizes = () =>
    listPrizes().then((list) => {
      setPrizes(list);
      refreshSections();
    });

  useEffect(() => {
    refreshPrizes();
  }, []);

  const handlePrizeFile = async (file: File) => {
    setPrizeBusy(true);
    setPrizeStatus(null);
    try {
      const parsed = await parsePrizeFile(file);
      if (parsed.length === 0) {
        setPrizeStatus("No rows found. Expect columns like 'Section Name', 'Prize', and 'Winner Count'.");
        return;
      }
      await replacePrizes(parsed);
      await refreshPrizes();
      setPrizeStatus(`Imported ${parsed.length} prizes from ${file.name}.`);
    } catch (err) {
      setPrizeStatus(`Import failed: ${String(err)}`);
    } finally {
      setPrizeBusy(false);
      if (prizeFileInputRef.current) prizeFileInputRef.current.value = "";
    }
  };

  const downloadPrizeTemplate = async () => {
    const path = await save({
      title: "Save prize list template",
      defaultPath: "prize-list-template.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    const csv =
      "Section Name,Prize,Winner Count,Description\r\n" +
      "Grand Prize,iPhone 15 Pro,1,sponsored by Acme\r\n" +
      "Consolation,Gift Voucher,5,\r\n";
    await writeTextFile(path, csv);
    setPrizeStatus(`Template saved to ${path}`);
  };

  const handleAddPrize = async () => {
    if (!newPrizeSection.trim() || !newPrizeName.trim()) return;
    await addPrize({
      section: newPrizeSection.trim(),
      name: newPrizeName.trim(),
      winner_count: Math.max(1, newPrizeCount),
      description: newPrizeDescription.trim(),
    });
    setNewPrizeSection("");
    setNewPrizeName("");
    setNewPrizeCount(1);
    setNewPrizeDescription("");
    refreshPrizes();
  };

  const [editingPrize, setEditingPrize] = useState<Prize | null>(null);
  const [deletingPrize, setDeletingPrize] = useState<Prize | null>(null);

  const saveEditPrize = async (patch: {
    section: string;
    name: string;
    winner_count: number;
    description: string;
  }) => {
    if (!editingPrize) return;
    await updatePrize(editingPrize.id, patch);
    setEditingPrize(null);
    refreshPrizes();
  };

  const confirmDeletePrize = async () => {
    if (!deletingPrize) return;
    await deletePrize(deletingPrize.id);
    setDeletingPrize(null);
    refreshPrizes();
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-1 text-xl font-bold">Setup</h1>
      <p className="mb-6 text-white/60">
        Optional: import a participant list to validate typed numbers and attach names to draw
        results. Skip this step to run Manual Mode with no validation.
      </p>

      <section className="mb-8 rounded-md border border-white/10 bg-white/[0.02] p-4">
        <h2 className="mb-1 font-semibold">Draws</h2>
        <p className="mb-4 text-xs text-white/50">
          Give each draw its own number of digit slots, e.g. Lucky Draw = 4, Grand Lucky Draw = 7.
          Selecting a draw on the Manual Draw or Auto Draw screen switches the slots automatically. Draws
          also come from the section names in your prize list.
        </p>
        {knownSections.length > 0 ? (
          <ul className="mb-4 space-y-2">
            {knownSections.map((name) => {
              const setting = sectionSettings.find((s) => s.name === name);
              const tagged = participants.filter((p) => p.section === name).length;
              return (
                <li
                  key={name}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 px-3 py-2"
                >
                  {renamingDraw === name ? (
                    <input
                      autoFocus
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onBlur={saveRenameDraw}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRenameDraw();
                        if (e.key === "Escape") setRenamingDraw(null);
                      }}
                      className="w-44 rounded-md border border-[#F5C518] bg-white/5 px-2 py-1 text-sm font-semibold outline-none"
                    />
                  ) : (
                    <span className="min-w-36 font-semibold">{name}</span>
                  )}
                  <select
                    value={setting?.slot_count ?? ""}
                    onChange={(e) =>
                      setSectionSlotCount(name, e.target.value === "" ? null : Number(e.target.value))
                    }
                    style={dropdownStyle}
                    className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-[#F5C518]"
                  >
                    <option value="" style={dropdownStyle}>
                      Config default ({config?.slot_count ?? 6} slots)
                    </option>
                    {SLOT_OPTIONS.map((n) => (
                      <option key={n} value={n} style={dropdownStyle}>
                        {n} slots
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-white/40">
                    {tagged} ticket{tagged === 1 ? "" : "s"} of its own
                  </span>
                  <span className="ml-auto flex gap-3 text-xs">
                    <button
                      onClick={() => startRenameDraw(name)}
                      className="text-[#F5C518] hover:underline"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => askDeleteDraw(name)}
                      className="text-[#E27676] hover:underline"
                    >
                      Delete
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-4 text-xs text-white/30">
            No draws yet. Add one below or import a prize list.
          </p>
        )}
        {drawError && <p className="mb-3 text-xs text-[#E27676]">{drawError}</p>}
        <div className="flex items-center gap-2">
          <input
            value={newDrawName}
            onChange={(e) => setNewDrawName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddDraw()}
            placeholder="e.g. Grand Lucky Draw"
            className="w-56 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
          <button
            onClick={handleAddDraw}
            disabled={!newDrawName.trim()}
            className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
          >
            + Add draw
          </button>
        </div>
      </section>

      <div className="rounded-lg border border-dashed border-white/20 bg-white/[0.02] p-8 text-center">
        <div className="mb-4 flex items-center justify-center gap-2 text-sm text-white/70">
          This list is for
          <DrawSelect value={importSection} sections={knownSections} onChange={setImportSection} />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <button
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md bg-[#F5C518] px-4 py-2 font-semibold text-[#10141F] disabled:opacity-50"
        >
          {busy ? "Importing…" : "Choose CSV / Excel file"}
        </button>
        <p className="mt-3 text-xs text-white/40">
          Expected columns: Ticket Number (or Number/ID) and Name. Re-importing replaces only the
          list for the draw selected above, so import each draw's list separately.
        </p>
        <button
          onClick={downloadTemplate}
          className="mt-3 text-xs text-[#F5C518] underline underline-offset-2 hover:text-[#ffd94d]"
        >
          Download CSV template
        </button>
      </div>

      {status && <p className="mt-4 text-sm text-white/80">{status}</p>}

      <div className="mt-8 flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">{participants.length}</div>
          <div className="text-white/50">participants loaded</div>
        </div>
        {participants.length > 0 && (
          <button
            onClick={handleClear}
            className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
          >
            Clear list
          </button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4">
        <div>
          <label className="mb-1 block text-xs text-white/60">Ticket number</label>
          <input
            value={newTicket}
            onChange={(e) => setNewTicket(e.target.value)}
            placeholder="e.g. 1003"
            className="w-32 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">Name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Alex Tan"
            className="w-44 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">Draw</label>
          <DrawSelect value={newSection} sections={knownSections} onChange={setNewSection} />
        </div>
        <button
          onClick={handleAddParticipant}
          disabled={!newTicket.trim()}
          className="rounded-md bg-[#F5C518] px-4 py-2 text-sm font-semibold text-[#10141F] disabled:opacity-40"
        >
          + Add Participant
        </button>
        <span className="pb-2 text-xs text-white/30">For last-minute additions after the CSV import.</span>
      </div>

      {participants.length > 0 && (
        <div className="mt-6 max-h-96 overflow-y-auto rounded-md border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0E1320] text-white/50">
              <tr>
                <th className="px-3 py-2">Ticket #</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Draw</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {participants.slice(0, 200).map((p) =>
                editingId === p.id ? (
                  <tr key={p.id} className="border-t border-white/5 bg-white/[0.03]">
                    <td className="px-3 py-1.5">
                      <input
                        value={editTicket}
                        onChange={(e) => setEditTicket(e.target.value)}
                        className="w-24 rounded border border-white/15 bg-white/5 px-2 py-1 font-mono outline-none focus:border-[#F5C518]"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full rounded border border-white/15 bg-white/5 px-2 py-1 outline-none focus:border-[#F5C518]"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <DrawSelect
                        value={editSection}
                        sections={knownSections}
                        onChange={setEditSection}
                        className="py-1 text-xs"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <button
                        onClick={() => saveEditParticipant(p.id)}
                        className="mr-2 text-[#7CD992] hover:underline"
                      >
                        Save
                      </button>
                      <button onClick={cancelEditParticipant} className="text-white/50 hover:underline">
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-1.5 font-mono">{p.ticket_number}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-white/60">{p.section || "All draws"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <button
                        onClick={() => startEditParticipant(p)}
                        className="mr-2 text-[#F5C518] hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteParticipant(p.id)}
                        className="text-[#E27676] hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          {participants.length > 200 && (
            <div className="p-2 text-center text-white/40">
              …and {participants.length - 200} more
            </div>
          )}
        </div>
      )}

      <hr className="my-10 border-white/10" />

      <h2 className="mb-1 text-lg font-bold">Prizes</h2>
      <p className="mb-6 text-white/60">
        Optional: set up which prize belongs to which section ahead of the event. Auto Draw's
        Planned Rounds picks a section here and fills in the prize and winner count automatically.
      </p>

      <div className="rounded-lg border border-dashed border-white/20 bg-white/[0.02] p-8 text-center">
        <input
          ref={prizeFileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handlePrizeFile(file);
          }}
        />
        <button
          disabled={prizeBusy}
          onClick={() => prizeFileInputRef.current?.click()}
          className="rounded-md bg-[#F5C518] px-4 py-2 font-semibold text-[#10141F] disabled:opacity-50"
        >
          {prizeBusy ? "Importing…" : "Choose CSV / Excel file"}
        </button>
        <p className="mt-3 text-xs text-white/40">
          Expected columns: Section Name, Prize, Winner Count, and an optional Description.
          Re-importing replaces the current prize list.
        </p>
        <button
          onClick={downloadPrizeTemplate}
          className="mt-3 text-xs text-[#F5C518] underline underline-offset-2 hover:text-[#ffd94d]"
        >
          Download CSV template
        </button>
      </div>

      {prizeStatus && <p className="mt-4 text-sm text-white/80">{prizeStatus}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4">
        <div>
          <label className="mb-1 block text-xs text-white/60">Section name</label>
          <input
            value={newPrizeSection}
            onChange={(e) => setNewPrizeSection(e.target.value)}
            placeholder="e.g. Grand Prize"
            className="w-36 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">Prize name</label>
          <input
            value={newPrizeName}
            onChange={(e) => setNewPrizeName(e.target.value)}
            placeholder="e.g. iPhone 15 Pro"
            className="w-40 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">Winners</label>
          <input
            type="number"
            min={1}
            value={newPrizeCount}
            onChange={(e) => setNewPrizeCount(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">Description (optional)</label>
          <input
            value={newPrizeDescription}
            onChange={(e) => setNewPrizeDescription(e.target.value)}
            placeholder="e.g. sponsored by Acme"
            className="w-44 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
        </div>
        <button
          onClick={handleAddPrize}
          disabled={!newPrizeSection.trim() || !newPrizeName.trim()}
          className="rounded-md bg-[#F5C518] px-4 py-2 text-sm font-semibold text-[#10141F] disabled:opacity-40"
        >
          + Add Prize
        </button>
      </div>

      {prizes.length > 0 && (
        <div className="mt-6 max-h-72 overflow-y-auto rounded-md border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0E1320] text-white/50">
              <tr>
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Prize</th>
                <th className="px-3 py-2">Winners</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {prizes.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-3 py-1.5">{p.section}</td>
                  <td className="px-3 py-1.5 font-semibold text-[#F5C518]">{p.name}</td>
                  <td className="px-3 py-1.5">{p.winner_count}</td>
                  <td className="px-3 py-1.5 text-white/60">{p.description}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button
                      onClick={() => setEditingPrize(p)}
                      className="mr-2 text-[#F5C518] hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeletingPrize(p)}
                      className="text-[#E27676] hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingPrize && (
        <PrizeFormModal
          prize={editingPrize}
          onSave={saveEditPrize}
          onClose={() => setEditingPrize(null)}
        />
      )}

      {deletingDraw && (
        <ConfirmModal
          title={`Delete "${deletingDraw.name}"?`}
          message={deletingDraw.message}
          confirmLabel="Delete draw"
          onConfirm={confirmDeleteDraw}
          onCancel={() => setDeletingDraw(null)}
        />
      )}

      {deletingPrize && (
        <ConfirmModal
          title="Delete this prize?"
          message={`"${deletingPrize.name}" under "${deletingPrize.section}" will be removed from the catalog. Past draw records aren't affected.`}
          confirmLabel="Delete"
          onConfirm={confirmDeletePrize}
          onCancel={() => setDeletingPrize(null)}
        />
      )}
    </div>
  );
}
