use std::io::{Read, Write};
use std::net::UdpSocket;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::network::{hide_console, wifi_network};

const BUZZER_APP_PORT: u16 = 3000;
const SERIAL_BAUD: u32 = 115200;
const CP210X_VID: u16 = 0x10C4;

/// Serial ports, likeliest buzzer first: CP210x (the buzzer's USB chip), then
/// other USB serial, then anything else. Bluetooth serial ports are dropped —
/// laptops often have a couple, and picking one by accident looked exactly
/// like a dead buzzer.
#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
    use serialport::SerialPortType;
    let mut ports: Vec<_> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .filter(|p| !matches!(p.port_type, SerialPortType::BluetoothPort))
        .collect();
    ports.sort_by_key(|p| match &p.port_type {
        SerialPortType::UsbPort(usb) if usb.vid == CP210X_VID => 0,
        SerialPortType::UsbPort(_) => 1,
        _ => 2,
    });
    ports.into_iter().map(|p| p.port_name).collect()
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

/// Line-at-a-time reader over the buzzer's serial output.
struct SerialLines {
    serial: Box<dyn serialport::SerialPort>,
    pending: String,
    heard_bytes: bool,
}

impl SerialLines {
    /// Next non-empty line, or None once `deadline` passes.
    fn next_line(&mut self, deadline: Instant) -> Result<Option<String>, String> {
        let mut buf = [0u8; 256];
        loop {
            if let Some(pos) = self.pending.find('\n') {
                let line: String = self.pending.drain(..=pos).collect();
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                return Ok(Some(line.to_string()));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            match self.serial.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    self.heard_bytes = true;
                    self.pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => return Err(format!("lost connection to the buzzer: {e}")),
            }
        }
    }
}

/// Pushes WiFi + server credentials to the buzzer over USB serial and waits
/// for it to report back whether it connected.
///
/// Opening the port usually resets the ESP32 (CP2102 auto-reset), and its
/// startup then spends up to ~10s retrying the WiFi it remembers before it
/// reads USB at all. At a new venue that remembered WiFi isn't there, so we
/// wait for startup to finish ("WiFi connected"/"WiFi connection failed")
/// before sending, rather than guessing a fixed delay.

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

    let serial = serialport::new(&port, SERIAL_BAUD)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|e| format!("couldn't open {port}: {e}"))?;
    let mut lines = SerialLines {
        serial,
        pending: String::new(),
        heard_bytes: false,
    };
    // Seeing any of the firmware's own messages proves this is the buzzer.
    let mut heard_firmware = false;

    // Wait out startup. Silence for 3s means it didn't reset and is
    // already running, so it's listening now.
    let opened = Instant::now();
    let startup_deadline = opened + Duration::from_secs(16);
    loop {
        let quiet_deadline = if lines.heard_bytes {
            startup_deadline
        } else {
            opened + Duration::from_secs(3)
        };
        match lines.next_line(quiet_deadline.min(startup_deadline))? {
            Some(line) => {
                if line.contains("Lucky Draw Buzzer") || line.starts_with("Connecting to WiFi") {
                    heard_firmware = true;
                }
                if line.starts_with("WiFi connected") || line.starts_with("WiFi connection failed") {
                    heard_firmware = true;
                    break;
                }
            }
            None if Instant::now() >= startup_deadline || !lines.heard_bytes => break,
            None => {}
        }
    }

    let payload = serde_json::json!({
        "ssid": ssid,
        "password": password,
        "server_url": server_url,
    });
    lines
        .serial
        .write_all(format!("{payload}\n").as_bytes())
        .map_err(|e| format!("failed writing to {port}: {e}"))?;

    // PROV_OK comes straight back; joining WiFi then takes up to ~10s more.
    let mut deadline = Instant::now() + Duration::from_secs(15);
    let mut accepted = false;
    while let Some(line) = lines.next_line(deadline)? {
        if line == "PROV_OK" {
            accepted = true;
            deadline = Instant::now() + Duration::from_secs(20);
        } else if let Some(ip) = line.strip_prefix("PROV_CONNECTED:") {
            return Ok(format!("Buzzer connected — {ip}"));
        } else if line == "PROV_FAILED" {
            return Err(
                "Buzzer couldn't join that WiFi network. Check the password, and that the router has 2.4 GHz WiFi (the buzzer can't use 5 GHz)."
                    .to_string(),
            );
        } else if let Some(reason) = line.strip_prefix("PROV_ERROR:") {
            return Err(format!("Buzzer rejected the request: {reason}"));
        }
    }

    if accepted {
        Err("Buzzer got the WiFi details but didn't finish joining in time. Check the password and that the router has 2.4 GHz WiFi, then try again.".to_string())
    } else if heard_firmware {
        Err("Buzzer started up but didn't take the WiFi details. Unplug it, plug it back in, and try again.".to_string())
    } else {
        Err(format!(
            "No reply from a buzzer on {port}. If you have more than one USB port listed, unplug the buzzer and press Refresh to see which one disappears. If it's the right port, the buzzer may not have its firmware installed."
        ))
    }
}
