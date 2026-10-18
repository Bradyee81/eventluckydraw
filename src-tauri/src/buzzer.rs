use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tiny_http::{Response, Server};

/// Port + path the ESP32 buzzer POSTs to over the venue's local WiFi (FR15).
/// Must match SERVER_URL in the buzzer firmware (Lucky-Draw-Bizzer/src/main.cpp).
const BUZZER_PORT: u16 = 3000;

/// The firmware sends a heartbeat every 5s; if we haven't heard anything
/// (heartbeat or button press) within this window, treat it as disconnected.
const STALE_AFTER: Duration = Duration::from_secs(12);

#[derive(Deserialize)]
struct BuzzerEvent {
    event: String,
}

pub fn spawn(app_handle: AppHandle) {
    let server = match Server::http(("0.0.0.0", BUZZER_PORT)) {
        Ok(server) => server,
        Err(err) => {
            eprintln!("buzzer: failed to bind port {BUZZER_PORT}: {err}");
            return;
        }
    };
    println!("buzzer: listening on 0.0.0.0:{BUZZER_PORT}");

    let connected = Arc::new(AtomicBool::new(false));
    let last_seen: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

    spawn_watchdog(app_handle.clone(), connected.clone(), last_seen.clone());
    spawn_request_loop(app_handle, server, connected, last_seen);
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

            *last_seen.lock().unwrap() = Some(Instant::now());
            if !connected.swap(true, Ordering::SeqCst) {
                emit_status(&app_handle, true);
            }

            match serde_json::from_str::<BuzzerEvent>(&body) {
                Ok(BuzzerEvent { event }) if event == "roll" || event == "reveal" => {
                    println!("buzzer: {event} event");
                    let _ = app_handle.emit("buzzer:pressed", ());
                }
                Ok(BuzzerEvent { event }) if event == "heartbeat" => {}
                Ok(BuzzerEvent { event }) => {
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
