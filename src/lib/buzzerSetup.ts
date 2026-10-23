import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function listSerialPorts(): Promise<string[]> {
  return invoke("list_serial_ports");
}

export function detectLocalIp(): Promise<string | null> {
  return invoke("detect_local_ip");
}

/** Name of the WiFi the laptop is on. The password is typed by the operator, never read from Windows. */
export function detectWifiSsid(): Promise<string> {
  return invoke("detect_wifi_ssid");
}

export function provisionBuzzer(params: {
  port: string;
  ssid: string;
  password: string;
  serverUrl?: string;
}): Promise<string> {
  return invoke("provision_buzzer", params);
}

/** Flashes the firmware built into the app onto the buzzer; onProgress gets 0–100. */
export async function flashBuzzerFirmware(
  port: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const unlisten = await listen<number>("buzzer-flash:progress", (e) => onProgress(e.payload));
  try {
    await invoke("flash_buzzer_firmware", { port });
  } finally {
    unlisten();
  }
}

export interface WifiNetwork {
  /** The laptop's address on its WiFi adapter. */
  ip: string | null;
}

export interface BuzzerContact {
  /** False when the app couldn't open port 3000 (usually another copy is running). */
  listening: boolean;
  /** Messages received from a buzzer since the app started. */
  count: number;
  last_ip: string | null;
  /** Firmware version from the buzzer's last message (v2+); null before any message or on old firmware. */
  firmware: number | null;
  /** True when the last message came from firmware too old to report a version. */
  firmware_unversioned: boolean;
}

/** Version of the buzzer firmware built into this copy of the app. */
export function bundledFirmwareVersion(): Promise<number | null> {
  return invoke("bundled_firmware_version");
}

export function detectWifiNetwork(): Promise<WifiNetwork> {
  return invoke("detect_wifi_network");
}

export function buzzerFirewallAllowed(): Promise<boolean> {
  return invoke("buzzer_firewall_allowed");
}

/** Shows one admin prompt; resolves to whether the firewall rule now exists. */
export function allowBuzzerFirewall(): Promise<boolean> {
  return invoke("allow_buzzer_firewall");
}

export function buzzerContact(): Promise<BuzzerContact> {
  return invoke("buzzer_contact");
}

/** Whether the CP210x USB driver the buzzer board needs is installed. */
export function usbDriverInstalled(): Promise<boolean> {
  return invoke("usb_driver_installed");
}

/** Runs the bundled driver installer (one admin prompt); resolves to whether it's installed now. */
export function installUsbDriver(): Promise<boolean> {
  return invoke("install_usb_driver");
}
