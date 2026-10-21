// The buzzer's CP2102 USB chip needs the Silicon Labs CP210x driver. The
// installer adds it, but if that admin prompt was declined, Buzzer Setup can
// run the same bundled script again.

use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::network::hide_console;

/// Whether the CP210x driver is in the Windows driver store. Matching the
/// .inf file name (not netsh/pnputil labels) keeps this locale-independent.
#[tauri::command]
pub fn usb_driver_installed() -> bool {
    hide_console(Command::new("pnputil").arg("/enum-drivers"))
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("silabser.inf"))
        .unwrap_or(false)
}

/// Runs the bundled drivers/install-cp210x.ps1 (one admin prompt) and
/// returns whether the driver is installed afterwards.
#[tauri::command]
pub async fn install_usb_driver(app: AppHandle) -> Result<bool, String> {
    let script = app
        .path()
        .resource_dir()
        .map_err(|e| format!("couldn't find the app's files: {e}"))?
        .join("drivers")
        .join("install-cp210x.ps1");
    if !script.exists() {
        return Err(format!("driver installer not found at {}", script.display()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        // The script itself skips if the driver is already there, and waits
        // for the elevated pnputil to finish.
        let _ = hide_console(
            Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script),
        )
        .output();
        Ok(usb_driver_installed())
    })
    .await
    .map_err(|e| e.to_string())?
}
