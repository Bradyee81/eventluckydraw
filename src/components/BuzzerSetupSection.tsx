import { useCallback, useEffect, useState } from "react";
import { useAppData } from "../control/AppDataContext";
import {
  allowBuzzerFirewall,
  buzzerContact,
  buzzerFirewallAllowed,
  bundledFirmwareVersion,
  detectWifiSsid,
  detectWifiNetwork,
  flashBuzzerFirmware,
  installUsbDriver,
  listSerialPorts,
  provisionBuzzer,
  usbDriverInstalled,
  type BuzzerContact,
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

// Must match patternFor() in the buzzer firmware (ESP32 Buzzer/src/main.cpp).
const LIGHT_STATES: [color: string, label: string, meaning: string][] = [
  ["#7CD992", "Green, steady", "connected to Lucky Draw, ready"],
  ["#F5C518", "Yellow, slow blink", "on the WiFi, looking for Lucky Draw. Open the app on a laptop on the same WiFi."],
  ["#5B8DEF", "Blue, fast blink", "joining the WiFi"],
  ["#E27676", "Red, steady", "can't join the WiFi. Check the router is on, or press Connect again with the right password."],
  ["#E27676", "Red, slow blink", "no WiFi saved yet. Plug it in and press Connect."],
  ["#B57BEE", "Purple, fast blink", "receiving new WiFi details from Connect"],
  ["#FFFFFF", "White flash", "button pressed"],
];

/**
 * Venue routine: laptop joins the router's WiFi, buzzer plugs in over USB,
 * Connect sends it this network's details, then we confirm the buzzer can
 * actually reach the app (not just that it joined WiFi).
 */
export function BuzzerSetupSection() {
  const { buzzerConnected } = useAppData();
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [ssid, setSsid] = useState<string | null>(null);
  // Typed by the operator. The app never reads saved WiFi passwords from
  // Windows (antivirus treats that as password theft), and doesn't store it.
  const [wifiPassword, setWifiPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [network, setNetwork] = useState<WifiNetwork | null>(null);
  const [firewallOk, setFirewallOk] = useState<boolean | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [driverOk, setDriverOk] = useState<boolean | null>(null);
  const [driverBusy, setDriverBusy] = useState(false);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [contact, setContact] = useState<BuzzerContact | null>(null);
  // null = not flashing; otherwise 0–100.
  const [flashPercent, setFlashPercent] = useState<number | null>(null);
  const [flashResult, setFlashResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [bundledFirmware, setBundledFirmware] = useState<number | null>(null);

  const refreshPorts = useCallback(() => {
    listSerialPorts().then((found) => {
      setPorts(found);
      setSelectedPort((prev) => (prev && found.includes(prev) ? prev : found[0] ?? ""));
    });
  }, []);

  const refreshNetwork = useCallback(() => {
    detectWifiSsid()
      .then(setSsid)
      .catch(() => setSsid(null));
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
    usbDriverInstalled()
      .then(setDriverOk)
      .catch(() => setDriverOk(null));
    bundledFirmwareVersion()
      .then(setBundledFirmware)
      .catch(() => setBundledFirmware(null));
  }, [refreshPorts, refreshNetwork]);

  // The buzzer reports its firmware version with every message, so keep this
  // current while the screen is open (it's a cheap in-memory read).
  useEffect(() => {
    const poll = () => buzzerContact().then(setContact).catch(() => {});
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);

  const handleInstallDriver = async () => {
    setDriverBusy(true);
    setDriverError(null);
    try {
      const ok = await installUsbDriver();
      setDriverOk(ok);
      if (ok) {
        // Windows takes a moment to assign a COM port to an already plugged-in buzzer.
        setTimeout(refreshPorts, 2000);
      } else {
        setDriverError("Driver wasn't installed. Approve the admin prompt to install it.");
      }
    } catch (err) {
      setDriverError(String(err));
    } finally {
      setDriverBusy(false);
    }
  };

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
      const currentSsid = await detectWifiSsid();
      setSsid(currentSsid);
      // Snapshot first, so only a message sent *after* setup counts as proof.
      const before = await buzzerContact();
      setStatus("sending");
      const joined = await provisionBuzzer({
        port: selectedPort,
        ssid: currentSsid,
        password: wifiPassword,
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

  const handleFlash = async () => {
    if (!selectedPort) return;
    setFlashPercent(0);
    setFlashResult(null);
    try {
      await flashBuzzerFirmware(selectedPort, setFlashPercent);
      // The old Connect error no longer applies.
      setStatus("idle");
      setMessage(null);
      setFlashResult({ ok: true, text: "Buzzer firmware updated. Now press Connect." });
    } catch (err) {
      setFlashResult({ ok: false, text: String(err) });
    } finally {
      setFlashPercent(null);
    }
  };

  const flashing = flashPercent !== null;
  const busy = status === "detecting" || status === "sending" || status === "verifying" || flashing;
  // A connected buzzer is out of date when it reports an older version, or
  // none at all (firmware from before versions existed).
  const firmwareOutdated =
    buzzerConnected &&
    !!contact &&
    (contact.firmware_unversioned ||
      (contact.firmware !== null && bundledFirmware !== null && contact.firmware < bundledFirmware));
  // provision_buzzer's errors name this button when old or missing firmware is the likely cause.
  const suggestFlash =
    firmwareOutdated || (status === "error" && !!message?.includes("Update buzzer firmware"));

  // Pick up a buzzer being plugged in or out without pressing Refresh.
  // Paused while busy so the port can't change under a Connect or flash.
  useEffect(() => {
    if (busy) return;
    const timer = setInterval(refreshPorts, 2000);
    return () => clearInterval(timer);
  }, [busy, refreshPorts]);

  return (
    <section className="mt-8 border-t border-white/10 pt-8">
      <label className="mb-2 block font-semibold">Buzzer setup</label>
      <p className="mb-4 max-w-lg text-xs text-white/40">
        At the venue: connect this laptop to the router's WiFi (not by cable), type the WiFi
        password below, plug the buzzer in over USB, then press Connect. It sends the buzzer this
        network's details and checks the buzzer can reach the app. No reflashing needed.
      </p>

      <div className="mb-4 max-w-lg space-y-1.5 rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs">
        <div className="flex items-center gap-1.5 text-white/60">
          <span className={`h-2 w-2 rounded-full ${buzzerConnected ? "bg-[#7CD992]" : "bg-white/25"}`} />
          Buzzer {buzzerConnected ? "connected" : "disconnected"}
        </div>
        <div className="text-white/60">
          WiFi:{" "}
          {ssid ? (
            <span className="text-white">
              {ssid}
              {network?.ip && ` · laptop address ${network.ip}`}
            </span>
          ) : (
            <span className="text-[#E27676]">not connected to WiFi</span>
          )}
        </div>
        <div className="text-white/60">
          Buzzer firmware:{" "}
          {!buzzerConnected || !contact || (contact.firmware === null && !contact.firmware_unversioned) ? (
            <span className="text-white/40">shows once the buzzer is connected</span>
          ) : firmwareOutdated ? (
            <span className="text-[#F5C518]">
              {contact.firmware !== null ? `v${contact.firmware}` : "old version"} — update available
              {bundledFirmware !== null && ` (v${bundledFirmware})`}. Plug the buzzer in by USB and
              press Update buzzer firmware below.
            </span>
          ) : (
            <span className="text-[#7CD992]">v{contact.firmware} ✓ up to date</span>
          )}
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
        <div className="flex flex-wrap items-center gap-2 text-white/60">
          USB driver:
          {driverOk === true && <span className="text-[#7CD992]">installed ✓</span>}
          {driverOk === false && (
            <>
              <span className="text-[#F5C518]">not installed</span>
              <button
                onClick={handleInstallDriver}
                disabled={driverBusy}
                className="rounded border border-[#F5C518]/50 px-2 py-0.5 text-[#F5C518] hover:bg-[#F5C518]/10 disabled:opacity-50"
              >
                {driverBusy ? "Installing…" : "Install USB driver"}
              </button>
            </>
          )}
          {driverOk === null && <span className="text-white/40">checking…</span>}
        </div>
        {driverError && <p className="text-[#E27676]">{driverError}</p>}
      </div>

      <details className="mb-4 max-w-lg text-xs text-white/60">
        <summary className="cursor-pointer text-white/50 hover:text-white/80">
          What the buzzer's light means
        </summary>
        <ul className="mt-2 space-y-1 pl-1">
          {LIGHT_STATES.map(([color, label, meaning]) => (
            <li key={label} className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span>
                <span className="text-white/80">{label}</span> — {meaning}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-white/40">
          Buzzers without the coloured light show the same blinking on the board's small LED.
          Firmware older than v2 has no light.
        </p>
      </details>

      <div className="mb-3 max-w-lg">
        <label className="mb-1 block text-xs text-white/60">
          WiFi password{ssid ? ` for "${ssid}"` : ""}
        </label>
        <div className="flex items-center gap-2">
          <input
            type={showPassword ? "text" : "password"}
            value={wifiPassword}
            onChange={(e) => setWifiPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="Router's WiFi password (blank if none)"
            autoComplete="off"
            className="w-64 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#F5C518]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="text-xs text-white/50 hover:text-white"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-1 text-xs text-white/40">
          Sent only to the buzzer over USB. The app doesn't save it.
        </p>
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
            <div className="py-1.5">
              <p className="text-sm text-[#E27676]">No device found</p>
              <p className="text-xs text-white/40">
                {driverOk === false
                  ? "Install the USB driver above, then plug the buzzer in."
                  : "Plug the buzzer in with a USB data cable. It shows up here automatically."}
              </p>
            </div>
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
            ? "Checking WiFi…"
            : status === "sending"
              ? "Sending to buzzer (up to 30s)…"
              : status === "verifying"
                ? "Checking…"
                : "Connect"}
        </button>
      </div>

      {message && (
        <p
          className={`mt-3 whitespace-pre-line text-sm ${
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

      <div className="mt-4 max-w-lg">
        {flashing ? (
          <div>
            <p className="mb-1.5 text-sm text-white/70">
              Updating buzzer firmware… {flashPercent}% — about a minute, don't unplug it.
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#F5C518] transition-[width] duration-300"
                style={{ width: `${flashPercent}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleFlash}
              disabled={busy || !selectedPort}
              className={
                suggestFlash
                  ? "rounded-md border border-[#F5C518]/60 px-3 py-1.5 text-sm text-[#F5C518] hover:bg-[#F5C518]/10 disabled:opacity-50"
                  : "rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 disabled:opacity-50"
              }
            >
              Update buzzer firmware
            </button>
            {!suggestFlash && (
              <span className="text-xs text-white/40">For a new buzzer, or if Connect says to.</span>
            )}
          </div>
        )}
        {flashResult && (
          <p className={`mt-2 text-sm ${flashResult.ok ? "text-[#7CD992]" : "text-[#E27676]"}`}>
            {flashResult.text}
          </p>
        )}
      </div>

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
          {firewallOk !== false && (
            <li>
              If Windows treats this WiFi as a Public network, set it to Private: Windows Settings →
              Network &amp; internet → WiFi → this network → Private.
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
