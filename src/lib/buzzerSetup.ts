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
