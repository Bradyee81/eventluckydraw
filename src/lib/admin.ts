import { invoke } from "@tauri-apps/api/core";

export function verifyAdminPassword(password: string): Promise<boolean> {
  return invoke("verify_admin_password", { password });
}
