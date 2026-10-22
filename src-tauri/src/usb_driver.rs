// The buzzer's CP2102 USB chip needs the Silicon Labs CP210x driver. The
// installer adds it, but if that admin prompt was declined, Buzzer Setup can
// install the same bundled driver.

use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::network::hide_console;
use crate::win::run_elevated;

/// Whether the CP210x driver is in the Windows driver store. Matching the
/// .inf file name (not pnputil's labels) keeps this locale-independent.
#[tauri::command]
pub fn usb_driver_installed() -> bool {
    hide_console(Command::new("pnputil").arg("/enum-drivers"))
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("silabser.inf"))
        .unwrap_or(false)
}

/// Adds the bundled driver with pnputil (one admin prompt) and returns
/// whether it's installed afterwards.
#[tauri::command]
pub async fn install_usb_driver(app: AppHandle) -> Result<bool, String> {
    let inf = app
        .path()
        .resource_dir()
        .map_err(|e| format!("couldn't find the app's files: {e}"))?
        .join("drivers")
        .join("cp210x")
        .join("silabser.inf");
    if !inf.exists() {
        return Err(format!("driver files not found at {}", inf.display()));
    }

    tauri::async_runtime::spawn_blocking(move || {
        if usb_driver_installed() {
            return Ok(true);
        }
        run_elevated("pnputil", &format!("/add-driver \"{}\" /install", inf.display()))?;
        Ok(usb_driver_installed())
    })
    .await
    .map_err(|e| e.to_string())?
}
