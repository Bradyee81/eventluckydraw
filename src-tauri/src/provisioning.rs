use std::io::{Read, Write};
use std::net::UdpSocket;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::network::{hide_console, wifi_network};

const BUZZER_APP_PORT: u16 = 3000;
const SERIAL_BAUD: u32 = 115200;

#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

/// This machine's LAN IP, used to prefill the buzzer's server URL. Uses the
/// "connect" a UDP socket trick (no packets actually sent) to ask the OS
/// which local address it would route through — works regardless of
/// interface name, unlike trying to match a WiFi-specific adapter.
#[tauri::command]
pub fn detect_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

/// Name of the WiFi network the laptop is connected to, for the buzzer to
/// join too. Deliberately does NOT read the saved WiFi password (`netsh ...
/// key=clear`): that's a classic password-stealer action and antivirus
/// quarantined the app for it. The operator types the password instead.
#[tauri::command]
pub fn detect_wifi_ssid() -> Result<String, String> {
    let interfaces_output = run_netsh(&["wlan", "show", "interfaces"])?;
    extract_field(&interfaces_output, "SSID")
        .ok_or_else(|| "No active WiFi connection found. Connect to the venue WiFi first.".to_string())
}

fn run_netsh(args: &[&str]) -> Result<String, String> {
    let output = hide_console(Command::new("netsh").args(args))
        .output()
        .map_err(|e| format!("failed to run netsh: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "netsh {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// netsh's output is "Label...spaces...: value" per line. Matches the label
/// exactly (after trimming) so "SSID" doesn't also match "BSSID".
fn extract_field(text: &str, label: &str) -> Option<String> {
    for line in text.lines() {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim() == label {
                let value = value.trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Pushes WiFi + server credentials to the buzzer over USB serial and waits
/// for it to report back whether it connected. The ESP32 likely resets when
/// the port opens (CP2102 auto-reset via DTR), so this waits out its boot
/// sequence before writing anything.
#[tauri::command]
pub fn provision_buzzer(
    port: String,
    ssid: String,
    password: String,
    server_url: Option<String>,
) -> Result<String, String> {
    let server_url = server_url.unwrap_or_else(|| {
        // The buzzer joins the laptop's WiFi, so it must use the WiFi
        // adapter's address; the routing guess is only a fallback.
        let ip = wifi_network()
            .ip
            .or_else(detect_local_ip)
            .unwrap_or_else(|| "127.0.0.1".to_string());
        format!("http://{ip}:{BUZZER_APP_PORT}/buzzer-event")
    });

    let mut serial = serialport::new(&port, SERIAL_BAUD)
        .timeout(Duration::from_millis(500))
        .open()
        .map_err(|e| format!("couldn't open {port}: {e}"))?;

    // Let the board finish its post-reset boot sequence before we write.
    std::thread::sleep(Duration::from_millis(2000));

    let payload = serde_json::json!({
        "ssid": ssid,
        "password": password,
        "server_url": server_url,
    });
    let line = format!("{}\n", payload);
    serial
        .write_all(line.as_bytes())
        .map_err(|e| format!("failed writing to {port}: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(15);
    let mut buf = [0u8; 256];
    let mut pending = String::new();

    while Instant::now() < deadline {
        match serial.read(&mut buf) {
            Ok(0) => continue,
            Ok(n) => {
                pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                while let Some(pos) = pending.find('\n') {
                    let line: String = pending.drain(..=pos).collect();
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Some(ip) = line.strip_prefix("PROV_CONNECTED:") {
                        return Ok(format!("Buzzer connected — {ip}"));
                    }
                    if line == "PROV_FAILED" {
                        return Err(
                            "Buzzer couldn't join that WiFi network. Check the password, and that the router has 2.4 GHz WiFi (the buzzer can't use 5 GHz)."
                                .to_string(),
                        );
                    }
                    if let Some(reason) = line.strip_prefix("PROV_ERROR:") {
                        return Err(format!("Buzzer rejected the request: {reason}"));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(e) => return Err(format!("lost connection to {port}: {e}")),
        }
    }

    Err("Buzzer didn't respond in time — check the USB connection and try again.".to_string())
}
