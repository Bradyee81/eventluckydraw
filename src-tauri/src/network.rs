// Venue-network checks for buzzer setup: which address the laptop has on the
// WiFi the buzzer will join, whether Windows treats that network as Public,
// and the firewall rule that lets the buzzer reach the app on port 3000.

use std::process::Command;

use base64::Engine;
use serde::Serialize;

pub const BUZZER_PORT: u16 = 3000;
const FIREWALL_RULE_NAME: &str = "Lucky Draw Buzzer";

/// Keeps background netsh/PowerShell calls from flashing a console window.
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

/// Runs a PowerShell script passed as -EncodedCommand, so quotes inside it
/// survive intact. Returns stdout.
fn run_powershell(script: &str) -> Result<String, String> {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    let output = hide_console(
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"])
            .args(["-EncodedCommand", &encoded]),
    )
    .output()
    .map_err(|e| format!("failed to run PowerShell: {e}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[derive(Serialize, Default)]
pub struct WifiNetwork {
    /// The laptop's IPv4 address on its WiFi adapter.
    pub ip: Option<String>,
    /// "Public", "Private" or "DomainAuthenticated".
    category: Option<String>,
}

/// The WiFi adapter's own address (not whichever adapter routes to the
/// internet, which could be Ethernet, a hotspot or a VPN). Uses cmdlet
/// properties rather than netsh text, which Windows translates.
pub fn wifi_network() -> WifiNetwork {
    let script = r#"
$a = Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
  Where-Object { $_.Status -eq 'Up' -and $_.PhysicalMediaType -like '*802.11*' } |
  Select-Object -First 1
if ($a) {
  $ip = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Select-Object -First 1).IPAddress
  $cat = (Get-NetConnectionProfile -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
    Select-Object -First 1).NetworkCategory
  "$ip|$cat"
}
"#;
    let Ok(out) = run_powershell(script) else {
        return WifiNetwork::default();
    };
    let mut parts = out.lines().last().unwrap_or("").splitn(2, '|');
    let non_empty = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    WifiNetwork {
        ip: non_empty(parts.next()),
        category: non_empty(parts.next()),
    }
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
        let script = format!(
            "Start-Process netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList \
             'advfirewall firewall add rule name=\"{FIREWALL_RULE_NAME}\" dir=in action=allow \
             protocol=TCP localport={BUZZER_PORT} profile=any'"
        );
        // A declined admin prompt surfaces as an error inside PowerShell; the
        // re-check below is what decides the result either way.
        let _ = run_powershell(&script);
        Ok(buzzer_firewall_allowed())
    })
    .await
    .map_err(|e| e.to_string())?
}
