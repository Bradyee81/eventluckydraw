import { useCallback, useEffect, useState } from "react";
import { useAppData } from "../control/AppDataContext";
import {
  allowBuzzerFirewall,
  buzzerContact,
  buzzerFirewallAllowed,
  detectWifiCredentials,
  detectWifiNetwork,
  listSerialPorts,
  provisionBuzzer,
  type BuzzerContact,
  type WifiInfo,
  type WifiNetwork,
} from "../lib/buzzerSetup";

type SetupStatus =
  | "idle"
  | "detecting"
  | "sending"
  | "verifying" // joined WiFi, waiting for its first message to reach the app
  | "success"
  | "unreachable" // joined WiFi but the app never heard from it
  | "error";

// The buzzer sends a heartbeat every 5s, so a working setup is heard well within this.
const VERIFY_TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Venue routine: laptop joins the router's WiFi, buzzer plugs in over USB,
 * Connect sends it this network's details, then we confirm the buzzer can
 * actually reach the app (not just that it joined WiFi).
 */
export function BuzzerSetupSection() {
  const { buzzerConnected } = useAppData();
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [wifi, setWifi] = useState<WifiInfo | null>(null);
  const [network, setNetwork] = useState<WifiNetwork | null>(null);
  const [firewallOk, setFirewallOk] = useState<boolean | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [contact, setContact] = useState<BuzzerContact | null>(null);

  const refreshPorts = useCallback(() => {
    listSerialPorts().then((found) => {
      setPorts(found);
      setSelectedPort((prev) => (prev && found.includes(prev) ? prev : found[0] ?? ""));
    });
  }, []);

  const refreshNetwork = useCallback(() => {
    detectWifiCredentials()
      .then(setWifi)
      .catch(() => setWifi(null));
    detectWifiNetwork()
      .then(setNetwork)
      .catch(() => setNetwork(null));
    buzzerFirewallAllowed()
      .then(setFirewallOk)
      .catch(() => setFirewallOk(null));
  }, []);

  useEffect(() => {
    refreshPorts();
    refreshNetwork();
  }, [refreshPorts, refreshNetwork]);

  const handleAllowFirewall = async () => {
    setFirewallBusy(true);
    try {
      setFirewallOk(await allowBuzzerFirewall());
    } finally {
      setFirewallBusy(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedPort) return;
    setStatus("detecting");
    setMessage(null);
    try {
      const creds = await detectWifiCredentials();
      setWifi(creds);
      // Snapshot first, so only a message sent *after* setup counts as proof.
      const before = await buzzerContact();
      setStatus("sending");
      const joined = await provisionBuzzer({
        port: selectedPort,
        ssid: creds.ssid,
        password: creds.password,
      });

      setStatus("verifying");
      setMessage(`${joined}. Checking it can reach the app…`);
      const deadline = Date.now() + VERIFY_TIMEOUT_MS;
      let latest = before;
      while (Date.now() < deadline) {
        await sleep(1000);
        latest = await buzzerContact();
        if (latest.count > before.count) break;
      }
      setContact(latest);

      if (latest.count > before.count) {
        setStatus("success");
        setMessage(
          `Buzzer is connected and talking to the app${latest.last_ip ? ` (${latest.last_ip})` : ""}. You can unplug the USB.`
        );
      } else {
        // Refresh the checks the diagnosis below relies on.
        setFirewallOk(await buzzerFirewallAllowed().catch(() => null));
        setNetwork(await detectWifiNetwork().catch(() => null));
        setStatus("unreachable");
        setMessage(`${joined}, but the app isn't hearing from it.`);
      }
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
    }
  };

  const busy = status === "detecting" || status === "sending" || status === "verifying";
  const isPublic = network?.category === "Public";

  return (
    <section className="mt-8 border-t border-white/10 pt-8">
      <label className="mb-2 block font-semibold">Buzzer setup</label>
      <p className="mb-4 max-w-lg text-xs text-white/40">
        At the venue: connect this laptop to the router's WiFi (not by cable), plug the buzzer in
        over USB, then press Connect. It sends the buzzer this network's details and checks the
        buzzer can reach the app. No reflashing needed.
      </p>

      <div className="mb-4 max-w-lg space-y-1.5 rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs">
        <div className="flex items-center gap-1.5 text-white/60">
          <span className={`h-2 w-2 rounded-full ${buzzerConnected ? "bg-[#7CD992]" : "bg-white/25"}`} />
          Buzzer {buzzerConnected ? "connected" : "disconnected"}
        </div>
        <div className="text-white/60">
          WiFi:{" "}
          {wifi ? (
            <span className="text-white">
              {wifi.ssid}
              {network?.ip && ` · laptop address ${network.ip}`}
            </span>
          ) : (
            <span className="text-[#E27676]">not connected to WiFi</span>
          )}
          {isPublic && <span className="text-[#F5C518]"> · Public network</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-white/60">
          Firewall:
          {firewallOk === true && <span className="text-[#7CD992]">buzzer allowed ✓</span>}
          {firewallOk === false && (
            <>
              <span className="text-[#F5C518]">not set up yet</span>
              <button
                onClick={handleAllowFirewall}
                disabled={firewallBusy}
                className="rounded border border-[#F5C518]/50 px-2 py-0.5 text-[#F5C518] hover:bg-[#F5C518]/10 disabled:opacity-50"
              >
                {firewallBusy ? "Waiting for permission…" : "Allow buzzer through firewall"}
              </button>
            </>
          )}
          {firewallOk === null && <span className="text-white/40">checking…</span>}
        </div>
        {firewallOk === false && (
          <p className="text-white/40">
            One-time, needs admin. Without it, Windows may block the buzzer on new networks
            (especially Public ones).
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-white/60">USB port</label>
          {ports.length > 0 ? (
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              style={{ backgroundColor: "#10141F", color: "#E6E9EF" }}
              className="w-36 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
            >
              {ports.map((p) => (
                <option key={p} value={p} style={{ backgroundColor: "#10141F", color: "#E6E9EF" }}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-white/30">No USB devices found. Plug the buzzer in.</p>
          )}
        </div>
        <button
          onClick={() => {
            refreshPorts();
            refreshNetwork();
          }}
          className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5"
        >
          Refresh
        </button>
        <button
          onClick={handleConnect}
          disabled={busy || !selectedPort}
          className="rounded-md bg-[#F5C518] px-5 py-2 font-semibold text-[#10141F] disabled:opacity-50"
        >
          {status === "detecting"
            ? "Reading WiFi…"
            : status === "sending"
              ? "Sending to buzzer…"
              : status === "verifying"
                ? "Checking…"
                : "Connect"}
        </button>
      </div>

      {message && (
        <p
          className={`mt-3 text-sm ${
            status === "error" || status === "unreachable"
              ? "text-[#E27676]"
              : status === "success"
                ? "text-[#7CD992]"
                : "text-white/70"
          }`}
        >
          {message}
        </p>
      )}

      {status === "unreachable" && (
        <ul className="mt-2 max-w-lg list-disc space-y-1.5 pl-5 text-xs text-white/70">
          {contact && !contact.listening && (
            <li>
              This copy of Lucky Draw couldn't open port 3000, so another copy is probably
              running. Close every Lucky Draw window, start just one, and press Connect again.
            </li>
          )}
          {firewallOk === false && (
            <li>
              Windows Firewall is most likely blocking it. Press{" "}
              <button onClick={handleAllowFirewall} className="text-[#F5C518] underline">
                Allow buzzer through firewall
              </button>{" "}
              and approve the admin prompt. The buzzer will connect within a few seconds, no need to
              press Connect again.
            </li>
          )}
          {firewallOk !== false && isPublic && (
            <li>
              Windows treats this WiFi as a Public network. If the dot stays grey, set it to
              Private: Windows Settings → Network &amp; internet → WiFi → this network → Private.
            </li>
          )}
          <li>
            Check the laptop is on the same router's WiFi as the buzzer (not on a cable or another
            network), then press Connect again.
          </li>
        </ul>
      )}
    </section>
  );
}
