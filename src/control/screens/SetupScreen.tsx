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
  listPrizes,
  replaceParticipants,
  replacePrizes,
  updateParticipant,
  updatePrize,
} from "../../lib/db";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PrizeFormModal } from "../../components/PrizeFormModal";
import type { Participant, Prize } from "../../types";

export function SetupScreen() {
  const { participants, refreshParticipants } = useAppData();
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
      await replaceParticipants(parsed);
      await refreshParticipants();
      setStatus(`Imported ${parsed.length} participants from ${file.name}.`);
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTicket, setEditTicket] = useState("");
  const [editName, setEditName] = useState("");

  const handleAddParticipant = async () => {
    const ticket = newTicket.trim();
    const name = newName.trim();
    if (!ticket) return;
    try {
      await addParticipant({ ticket_number: ticket, name });
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
  };

  const cancelEditParticipant = () => {
    setEditingId(null);
  };

  const saveEditParticipant = async (id: number) => {
    const ticket = editTicket.trim();
    if (!ticket) return;
    try {
      await updateParticipant(id, { ticket_number: ticket, name: editName.trim() });
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

  const refreshPrizes = () => listPrizes().then(setPrizes);

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

      <div className="rounded-lg border border-dashed border-white/20 bg-white/[0.02] p-8 text-center">
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
          Expected columns: Ticket Number (or Number/ID) and Name. Re-importing replaces the
          current list.
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
