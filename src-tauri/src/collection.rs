//! Collection point page: a live winners list the prize desk opens on a phone
//! or tablet at http://<laptop>:3000/winners, served by the buzzer's web
//! server (same port, so the buzzer's firewall rule covers it too).
//!
//! The Control window owns the data: it publishes the winners list here, and a
//! "Collected" tap on the page is passed back to it as a `winners:collect`
//! event to save in the database.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Request, Response};

use crate::network::BUZZER_PORT;
use crate::provisioning::detect_local_ip;
use crate::win::wifi_adapter_ipv4;

const PAGE: &str = include_str!("../collection/winners.html");

/// Latest winners list from the Control window, as JSON.
static WINNERS_JSON: Mutex<String> = Mutex::new(String::new());

#[tauri::command]
pub fn publish_winners(json: String) {
    *WINNERS_JSON.lock().unwrap() = json;
}

#[derive(Serialize)]
pub struct CollectionPage {
    /// None when the laptop has no network address.
    url: Option<String>,
    qr_svg: Option<String>,
}

/// Address of the page on the WiFi the buzzer uses, plus a QR code of it.
#[tauri::command]
pub fn collection_page() -> CollectionPage {
    let Some(ip) = wifi_adapter_ipv4().or_else(detect_local_ip) else {
        return CollectionPage { url: None, qr_svg: None };
    };
    let url = format!("http://{ip}:{BUZZER_PORT}/winners");
    let qr_svg = qr_svg(url.clone()).ok();
    CollectionPage { url: Some(url), qr_svg }
}

/// QR code of any text (e.g. the online page's link), as an SVG string.
#[tauri::command]
pub fn qr_svg(text: String) -> Result<String, String> {
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(180, 180)
        .quiet_zone(true)
        .build())
}

#[derive(Deserialize, Serialize, Clone)]
struct CollectRequest {
    id: i64,
    collected: bool,
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

/// Answers the request if it is for the collection page, otherwise hands it
/// back for the buzzer handler.
pub fn handle(app_handle: &AppHandle, mut request: Request) -> Option<Request> {
    let path = request.url().split('?').next().unwrap_or("").to_string();
    if !path.starts_with("/winners") {
        return Some(request);
    }
    let no_store = header("Cache-Control", "no-store");
    let response = match (request.method(), path.as_str()) {
        (Method::Get, "/winners" | "/winners/") => Response::from_string(PAGE)
            .with_header(header("Content-Type", "text/html; charset=utf-8"))
            .with_header(no_store),
        (Method::Get, "/winners.json") => {
            let json = WINNERS_JSON.lock().unwrap().clone();
            let json = if json.is_empty() { r#"{"winners":[]}"#.to_string() } else { json };
            Response::from_string(json)
                .with_header(header("Content-Type", "application/json"))
                .with_header(no_store)
        }
        (Method::Post, "/winners/collect") => {
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            match serde_json::from_str::<CollectRequest>(&body) {
                Ok(collect) => {
                    let _ = app_handle.emit("winners:collect", collect);
                    Response::from_string("ok")
                }
                Err(_) => Response::from_string("bad request").with_status_code(400),
            }
        }
        _ => Response::from_string("not found").with_status_code(404),
    };
    let _ = request.respond(response);
    None
}
