use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Response, Server};

use crate::provisioning::detect_local_ip;
use crate::win::wifi_adapter_ipv4;

/// Port + path the ESP32 buzzer POSTs to over the venue's local WiFi (FR15).
/// Must match SERVER_URL in the buzzer firmware (ESP32 Buzzer/src/main.cpp).
const BUZZER_PORT: u16 = 3000;

/// Buzzers (firmware v2+) listen here for our announcement and send to
/// whichever laptop made it, so a new laptop address needs no re-setup.
/// Must match DISCOVERY_PORT / DISCOVERY_PREFIX in the firmware.
const DISCOVERY_PORT: u16 = 3001;
const ANNOUNCE_EVERY: Duration = Duration::from_secs(2);

/// The firmware sends a heartbeat every 5s; if we haven't heard anything
/// (heartbeat or button press) within this window, treat it as disconnected.
const STALE_AFTER: Duration = Duration::from_secs(12);

/// What Buzzer Setup needs to confirm a buzzer really reaches the app: a
/// running count of messages (so it can wait for a *new* one after setup),
/// who sent the last one, and whether we managed to listen at all.
#[derive(Default, Clone, Serialize)]
pub struct BuzzerContact {
    listening: bool,
    count: u64,
    last_ip: Option<String>,
    /// Firmware version the buzzer reported in its last message. None until
    /// we hear from one, or when it runs firmware older than v2 (no version).
    firmware: Option<u32>,
    /// Whether any message has arrived without a version, i.e. old firmware.
    firmware_unversioned: bool,
}

#[derive(Default)]
pub struct BuzzerContactState(Mutex<BuzzerContact>);

#[tauri::command]
pub fn buzzer_contact(state: State<'_, BuzzerContactState>) -> BuzzerContact {
    state.0.lock().unwrap().clone()
}

#[derive(Deserialize)]
struct BuzzerEvent {
    event: String,
    /// Sent by firmware v2+.
    fw: Option<u32>,
}

pub fn spawn(app_handle: AppHandle) {
    app_handle.manage(BuzzerContactState::default());
    let server = match Server::http(("0.0.0.0", BUZZER_PORT)) {
        Ok(server) => server,
        Err(err) => {
            // Usually another copy of Lucky Draw already holds the port.
            eprintln!("buzzer: failed to bind port {BUZZER_PORT}: {err}");
            return;
        }
    };
    println!("buzzer: listening on 0.0.0.0:{BUZZER_PORT}");
    app_handle.state::<BuzzerContactState>().0.lock().unwrap().listening = true;

    let connected = Arc::new(AtomicBool::new(false));
    let last_seen: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

    spawn_watchdog(app_handle.clone(), connected.clone(), last_seen.clone());
    spawn_request_loop(app_handle, server, connected, last_seen);
    spawn_announcer();
}

/// Broadcasts "LUCKYDRAW <port>" on the WiFi every couple of seconds. Bound
/// to the WiFi adapter's address so it goes out on the network the buzzer is
/// on (not Ethernet/VPN). Outbound, so no firewall rule is needed for it.
fn spawn_announcer() {
    std::thread::spawn(|| {
        let message = format!("LUCKYDRAW {BUZZER_PORT}");
        loop {
            if let Some(ip) = wifi_adapter_ipv4().or_else(detect_local_ip) {
                let sent = UdpSocket::bind((ip.as_str(), 0)).and_then(|socket| {
                    socket.set_broadcast(true)?;
                    socket.send_to(message.as_bytes(), ("255.255.255.255", DISCOVERY_PORT))
                });
                if let Err(err) = sent {
                    eprintln!("buzzer: announcement on {ip} failed: {err}");
                }
            }
            std::thread::sleep(ANNOUNCE_EVERY);
        }
    });
}

fn spawn_watchdog(
    app_handle: AppHandle,
    connected: Arc<AtomicBool>,
    last_seen: Arc<Mutex<Option<Instant>>>,
) {
    std::thread::spawn(move || {
        let mut ticks_since_broadcast: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let stale = matches!(*last_seen.lock().unwrap(), Some(t) if t.elapsed() > STALE_AFTER);
            if stale && connected.swap(false, Ordering::SeqCst) {
                emit_status(&app_handle, false);
            }

            // Status is otherwise only emitted on change (connect/disconnect),
            // which a window that mounts its listener after the transition
            // already happened would miss forever (e.g. the buzzer's first
            // heartbeat lands before the frontend finishes loading). Re-broadcast
            // the current state periodically so any late subscriber self-corrects.
            ticks_since_broadcast += 1;
            if ticks_since_broadcast >= 3 {
                ticks_since_broadcast = 0;
                emit_status(&app_handle, connected.load(Ordering::SeqCst));
            }
        }
    });
}

fn spawn_request_loop(
    app_handle: AppHandle,
    server: Server,
    connected: Arc<AtomicBool>,
    last_seen: Arc<Mutex<Option<Instant>>>,
) {
    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);

            let parsed = serde_json::from_str::<BuzzerEvent>(&body);

            *last_seen.lock().unwrap() = Some(Instant::now());
            {
                let state = app_handle.state::<BuzzerContactState>();
                let mut contact = state.0.lock().unwrap();
                contact.count += 1;
                contact.last_ip = request.remote_addr().map(|a| a.ip().to_string());
                if let Ok(event) = &parsed {
                    contact.firmware = event.fw;
                    contact.firmware_unversioned = event.fw.is_none();
                }
            }
            if !connected.swap(true, Ordering::SeqCst) {
                emit_status(&app_handle, true);
            }

            match parsed {
                Ok(BuzzerEvent { event, .. }) if event == "roll" || event == "reveal" => {
                    println!("buzzer: {event} event");
                    let _ = app_handle.emit("buzzer:pressed", ());
                }
                Ok(BuzzerEvent { event, .. }) if event == "heartbeat" => {}
                Ok(BuzzerEvent { event, .. }) => {
                    println!("buzzer: unrecognized event \"{event}\"");
                }
                Err(_) => {
                    println!("buzzer: unparseable request body: {body:?}");
                }
            }

            let _ = request.respond(Response::from_string("ok"));
        }
    });
}

fn emit_status(app_handle: &AppHandle, connected: bool) {
    println!(
        "buzzer: status -> {}",
        if connected { "connected" } else { "disconnected" }
    );
    let _ = app_handle.emit("buzzer:status", serde_json::json!({ "connected": connected }));
}
