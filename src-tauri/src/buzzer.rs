use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
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

/// Whether the Output window's reels are spinning. Sent with every
/// announcement ("SPIN=1"), so firmware v3+ can light the button while they
/// spin. Older firmware reads only the port number and ignores the rest.
static REELS_SPINNING: AtomicBool = AtomicBool::new(false);
/// Wakes the announcer to send straight away when the spinning state changes.
static ANNOUNCE_NOW: OnceLock<Sender<()>> = OnceLock::new();

#[tauri::command]
pub fn set_reels_spinning(spinning: bool) {
    if REELS_SPINNING.swap(spinning, Ordering::SeqCst) != spinning {
        if let Some(tx) = ANNOUNCE_NOW.get() {
            let _ = tx.send(());
        }
    }
}

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
    spawn_request_loop(app_handle.clone(), server, connected, last_seen);
    spawn_announcer(app_handle);
}

/// Broadcasts "LUCKYDRAW <port> SPIN=<0|1>" on the WiFi every couple of
/// seconds, and straight away when the reels start or stop. Bound to the WiFi
/// adapter's address so it goes out on the network the buzzer is on (not
/// Ethernet/VPN). Outbound, so no firewall rule is needed for it.
///
/// A change is also sent directly to the last buzzer that reached us: WiFi
/// delivers that more reliably than a broadcast, so the button light follows
/// the reels promptly.
fn spawn_announcer(app_handle: AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    let _ = ANNOUNCE_NOW.set(tx);
    std::thread::spawn(move || loop {
        let changed = rx.recv_timeout(ANNOUNCE_EVERY).is_ok();
        let spinning = REELS_SPINNING.load(Ordering::SeqCst);
        let message = format!("LUCKYDRAW {BUZZER_PORT} SPIN={}", u8::from(spinning));

        let Some(ip) = wifi_adapter_ipv4().or_else(detect_local_ip) else {
            continue;
        };
        let socket = match UdpSocket::bind((ip.as_str(), 0)).and_then(|s| {
            s.set_broadcast(true)?;
            Ok(s)
        }) {
            Ok(socket) => socket,
            Err(err) => {
                eprintln!("buzzer: announcement on {ip} failed: {err}");
                continue;
            }
        };
        let _ = socket.send_to(message.as_bytes(), ("255.255.255.255", DISCOVERY_PORT));
        if changed {
            let buzzer_ip = app_handle
                .state::<BuzzerContactState>()
                .0
                .lock()
                .unwrap()
                .last_ip
                .clone();
            if let Some(buzzer_ip) = buzzer_ip {
                let _ = socket.send_to(message.as_bytes(), (buzzer_ip.as_str(), DISCOVERY_PORT));
            }
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
        for request in server.incoming_requests() {
            // Phones on the collection point page share this server.
            let Some(mut request) = crate::collection::handle(&app_handle, request) else {
                continue;
            };
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
