// Venue-network checks for buzzer setup: which address the laptop has on the
// WiFi the buzzer will join, and the firewall rule that lets the buzzer reach
// the app on port 3000.

use std::process::Command;

use serde::Serialize;

use crate::win::{run_elevated, wifi_adapter_ipv4};

pub const BUZZER_PORT: u16 = 3000;
const FIREWALL_RULE_NAME: &str = "Lucky Draw Buzzer";

/// Keeps background netsh/pnputil queries from flashing a console window.
#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    cmd
}

#[derive(Serialize, Default)]
pub struct WifiNetwork {
    /// The laptop's IPv4 address on its WiFi adapter.
    pub ip: Option<String>,
}

/// The WiFi adapter's own address (not whichever adapter routes to the
/// internet, which could be Ethernet, a hotspot or a VPN).
pub fn wifi_network() -> WifiNetwork {
    WifiNetwork { ip: wifi_adapter_ipv4() }
}

#[tauri::command]
pub fn detect_wifi_network() -> WifiNetwork {
    wifi_network()
}

/// Whether our inbound allow rule for the buzzer port exists. Reading rules
/// doesn't need admin.
#[tauri::command]
pub fn buzzer_firewall_allowed() -> bool {
    hide_console(
        Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule"])
            .arg(format!("name={FIREWALL_RULE_NAME}")),
    )
    .output()
    .map(|o| o.status.success())
    .unwrap_or(false)
}

/// Adds an inbound allow rule for the buzzer port on every network type
/// (Public included, which is what Windows picks for a new venue router).
/// Shows one admin prompt; returns whether the rule now exists.
#[tauri::command]
pub async fn allow_buzzer_firewall() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        run_elevated(
            "netsh",
            &format!(
                "advfirewall firewall add rule name=\"{FIREWALL_RULE_NAME}\" dir=in action=allow \
                 protocol=TCP localport={BUZZER_PORT} profile=any"
            ),
        )?;
        Ok(buzzer_firewall_allowed())
    })
    .await
    .map_err(|e| e.to_string())?
}
