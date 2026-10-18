import { useState } from "react";
import { Modal } from "./Modal";
import { useAppData } from "../control/AppDataContext";
import { verifyAdminPassword } from "../lib/admin";

/** Wipes the last event so the app starts fresh. Needs the admin password. */
export function FactoryResetSection() {
  const { factoryReset } = useAppData();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const close = () => {
    setOpen(false);
    setPassword("");
    setError(null);
  };

  const run = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await verifyAdminPassword(password))) {
        setError("Wrong admin password.");
        setPassword("");
        return;
      }
      await factoryReset();
      setDone(true);
      close();
    } catch (err) {
      setError(`Reset failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 rounded-md border border-[#E27676]/30 bg-[#E27676]/[0.04] p-4">
      <h2 className="mb-1 font-semibold text-[#E27676]">Factory reset</h2>
      <p className="mb-3 max-w-lg text-xs text-white/50">
        Clears everything from the last event: participants, prizes, draw results, planned rounds,
        draws and their slot counts, plus every setting (slot count, background, title and footer,
        digit strip). Export your results first if you need them. This can't be undone, and needs
        the admin password.
      </p>
      <button
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
        className="rounded-md border border-[#E27676]/50 px-4 py-2 text-sm font-semibold text-[#E27676] hover:bg-[#E27676]/10"
      >
        Factory reset…
      </button>
      {done && <p className="mt-2 text-xs text-[#7CD992]">Reset complete. The app is ready for a new event.</p>}

      {open && (
        <Modal onClose={close}>
          <h2 className="mb-2 text-lg font-bold text-[#E27676]">Factory reset?</h2>
          <p className="mb-4 text-sm text-white/70">
            All participants, prizes, results, planned rounds, draws and settings will be deleted.
            The buzzer's WiFi setup is kept. Enter the admin password to continue.
          </p>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
              if (e.key === "Escape") close();
            }}
            placeholder="Admin password"
            className="mb-2 w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#E27676]"
          />
          <p className="mb-4 min-h-4 text-xs text-[#E27676]">{error}</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={run}
              disabled={!password || busy}
              className="rounded-md bg-[#E27676] px-3 py-2 font-semibold text-[#10141F] disabled:opacity-40"
            >
              {busy ? "Checking…" : "Reset everything"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
