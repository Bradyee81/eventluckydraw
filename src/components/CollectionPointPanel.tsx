import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import {
  changeOnlinePin,
  getCollectionPage,
  qrSvg,
  turnOffOnline,
  turnOnOnline,
  useOnlineStatus,
  type CollectionPage,
} from "../lib/collectionPoint";

const validPin = (pin: string) => /^\d{4,8}$/.test(pin);

/** Results screen panel: the two ways the prize desk can follow the winners. */
export function CollectionPointPanel({ collected, total }: { collected: number; total: number }) {
  const [wifi, setWifi] = useState<CollectionPage | null>(null);
  const online = useOnlineStatus();
  const [onlineQr, setOnlineQr] = useState<string | null>(null);
  const [bigQr, setBigQr] = useState<{ svg: string; url: string } | null>(null);
  const [setup, setSetup] = useState<"on" | "pin" | "off" | null>(null);

  useEffect(() => {
    getCollectionPage().then(setWifi);
  }, []);
  useEffect(() => {
    if (online.url) qrSvg(online.url).then(setOnlineQr);
    else setOnlineQr(null);
  }, [online.url]);

  // Re-render every few seconds so "synced Ns ago" stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const syncedAgo = online.syncedAt ? Math.round((Date.now() - online.syncedAt) / 1000) : null;

  return (
    <div className="mb-6 rounded-md border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="font-semibold">Collection point</h2>
        <span className="text-xs text-white/50">
          {collected} of {total} prize{total === 1 ? "" : "s"} collected
        </span>
      </div>
      <p className="mb-4 text-xs text-white/60">
        The prize desk opens one of these pages on a phone to see every winner as they're drawn
        and tick off prizes handed out. Ticks show here in the Collected column.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-start justify-between gap-3 rounded-md border border-white/10 p-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Online (any phone, with PIN)</h3>
            {online.room ? (
              <>
                <p className="mt-1 select-all break-all font-mono text-[#F5C518]">{online.url}</p>
                <p className={`mt-1 text-xs ${online.error ? "text-[#E27676]" : "text-white/50"}`}>
                  {online.error
                    ? `Not syncing: ${online.error}. Draws carry on; the page catches up when the internet is back.`
                    : syncedAgo === null
                      ? "Connecting…"
                      : `Live · synced ${syncedAgo < 5 ? "just now" : `${syncedAgo}s ago`}`}
                </p>
                <div className="mt-2 flex gap-2 text-xs">
                  <button
                    onClick={() => setSetup("pin")}
                    className="rounded border border-white/15 px-2 py-1 text-white/70 hover:bg-white/5"
                  >
                    Change PIN
                  </button>
                  <button
                    onClick={() => setSetup("off")}
                    className="rounded border border-[#E27676]/40 px-2 py-1 text-[#E27676] hover:bg-[#E27676]/10"
                  >
                    Turn off
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-white/60">
                  Works on mobile data, so phones don't need the venue WiFi. This laptop needs
                  internet.
                </p>
                <button
                  onClick={() => setSetup("on")}
                  className="mt-2 rounded-md bg-[#F5C518] px-3 py-1.5 text-xs font-semibold text-[#10141F]"
                >
                  Turn on online page
                </button>
              </>
            )}
          </div>
          {online.room && onlineQr && (
            <QrButton svg={onlineQr} onClick={() => setBigQr({ svg: onlineQr, url: online.url! })} />
          )}
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border border-white/10 p-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">On this WiFi (no PIN)</h3>
            {wifi?.url ? (
              <p className="mt-1 select-all font-mono text-[#F5C518]">{wifi.url}</p>
            ) : (
              <p className="mt-1 text-xs text-[#E27676]">This laptop isn't on a network.</p>
            )}
            <p className="mt-1 text-xs text-white/50">
              Phone must be on the same WiFi as this laptop. No internet needed.
            </p>
          </div>
          {wifi?.qr_svg && (
            <QrButton svg={wifi.qr_svg} onClick={() => setBigQr({ svg: wifi.qr_svg!, url: wifi.url! })} />
          )}
        </div>
      </div>

      {bigQr && (
        <Modal onClose={() => setBigQr(null)}>
          <h2 className="mb-3 text-lg font-bold">Scan to open the collection point page</h2>
          <div
            className="mx-auto rounded bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
            style={{ width: 320, height: 320 }}
            dangerouslySetInnerHTML={{ __html: bigQr.svg }}
          />
          <p className="mt-3 break-all text-center font-mono text-[#F5C518]">{bigQr.url}</p>
        </Modal>
      )}

      {(setup === "on" || setup === "pin") && (
        <PinModal
          title={setup === "on" ? "Turn on the online page" : "Change the PIN"}
          withName={setup === "on"}
          onCancel={() => setSetup(null)}
          onSave={async (name, pin) => {
            if (setup === "on") await turnOnOnline(name, pin);
            else await changeOnlinePin(pin);
            setSetup(null);
          }}
        />
      )}

      {setup === "off" && (
        <TurnOffModal onCancel={() => setSetup(null)} onDone={() => setSetup(null)} />
      )}
    </div>
  );
}

function QrButton({ svg, onClick }: { svg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Show a bigger QR code"
      className="shrink-0 rounded bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
      style={{ width: 88, height: 88 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function PinModal({
  title,
  withName,
  onSave,
  onCancel,
}: {
  title: string;
  withName: boolean;
  onSave: (name: string, pin: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("Lucky Draw");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim() || "Lucky Draw", pin);
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : String(err)}. Check this laptop is on the internet.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {withName && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-white/60">Page title</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-[#F5C518]"
          />
        </div>
      )}
      <div className="mb-2">
        <label className="mb-1 block text-xs text-white/60">PIN for the prize desk (4–8 digits)</label>
        <input
          autoFocus
          value={pin}
          inputMode="numeric"
          maxLength={8}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && validPin(pin) && !busy && save()}
          className="w-40 rounded-md border border-white/15 bg-white/5 px-3 py-2 font-mono text-lg tracking-widest outline-none focus:border-[#F5C518]"
        />
      </div>
      <p className="mb-4 text-xs text-white/50">
        Anyone with the link and this PIN can see the winners and tick prizes. Phones remember the
        PIN until someone presses Lock on the page.
        {withName && " Winners' number, name, prize, group and draw are sent online."}
      </p>
      {error && <p className="mb-3 text-sm text-[#E27676]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!validPin(pin) || busy}
          className="rounded-md bg-[#F5C518] px-3 py-2 font-semibold text-[#10141F] disabled:opacity-40"
        >
          {busy ? "Saving…" : withName ? "Turn on" : "Save PIN"}
        </button>
      </div>
    </Modal>
  );
}

function TurnOffModal({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-2 text-lg font-bold text-[#E27676]">Turn off the online page?</h2>
      <p className="mb-4 text-sm text-white/70">
        The link stops working and the online copy of the winners is deleted. Results on this
        laptop stay as they are. Turning it on again gives a new link.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await turnOffOnline().catch(() => {});
            onDone();
          }}
          className="rounded-md bg-[#E27676] px-3 py-2 font-semibold text-[#10141F] disabled:opacity-40"
        >
          {busy ? "Turning off…" : "Turn off"}
        </button>
      </div>
    </Modal>
  );
}
