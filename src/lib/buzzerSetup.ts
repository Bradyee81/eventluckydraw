import { invoke } from "@tauri-apps/api/core";

export interface WifiInfo {
  ssid: string;
  password: string;
}

export function listSerialPorts(): Promise<string[]> {
  return invoke("list_serial_ports");
}

export function detectLocalIp(): Promise<string | null> {
  return invoke("detect_local_ip");
}

export function detectWifiCredentials(): Promise<WifiInfo> {
  return invoke("detect_wifi_credentials");
}

export function provisionBuzzer(params: {
  port: string;
  ssid: string;
  password: string;
  serverUrl?: string;
}): Promise<string> {
  return invoke("provision_buzzer", params);
}

export interface WifiNetwork {
  /** The laptop's address on its WiFi adapter. */
  ip: string | null;
  /** "Public", "Private" or "DomainAuthenticated". */
  category: string | null;
}

export interface BuzzerContact {
  /** False when the app couldn't open port 3000 (usually another copy is running). */
  listening: boolean;
  /** Messages received from a buzzer since the app started. */
  count: number;
  last_ip: string | null;
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
