// Flashes the buzzer's ESP32 with the firmware built into the app, so an old
// or blank buzzer can be brought up to date from Buzzer Setup. Same steps as
// the standalone flash tool (`ESP32 Buzzer/flash-tool`), with progress sent
// to the UI instead of printed.

use espflash::connection::reset::{ResetAfterOperation, ResetBeforeOperation};
use espflash::flasher::{Flasher, ProgressCallbacks};
use serialport::SerialPortType;
use tauri::{AppHandle, Emitter};

const BOOTLOADER: &[u8] = include_bytes!("../../ESP32 Buzzer/flash-tool/firmware/bootloader.bin");
const PARTITIONS: &[u8] = include_bytes!("../../ESP32 Buzzer/flash-tool/firmware/partitions.bin");
const BOOT_APP0: &[u8] = include_bytes!("../../ESP32 Buzzer/flash-tool/firmware/boot_app0.bin");
const APP: &[u8] = include_bytes!("../../ESP32 Buzzer/flash-tool/firmware/firmware.bin");

const SEGMENTS: [(u32, &[u8]); 4] = [
    (0x1000, BOOTLOADER),
    (0x8000, PARTITIONS),
    (0xe000, BOOT_APP0),
    (0x10000, APP),
];

const PROGRESS_EVENT: &str = "buzzer-flash:progress";

/// Reports overall progress as a percentage, weighting each segment by its
/// size (espflash reports chunks within the current segment only).
struct UiProgress<'a> {
    app: &'a AppHandle,
    done_before: usize,
    segment_len: usize,
    total_len: usize,
    chunks: usize,
    last_percent: u8,
}

impl UiProgress<'_> {
    fn emit(&mut self, written_in_segment: usize) {
        let done = self.done_before + written_in_segment;
        let percent = (done * 100 / self.total_len).min(100) as u8;
        if percent != self.last_percent {
            self.last_percent = percent;
            let _ = self.app.emit(PROGRESS_EVENT, percent);
        }
    }
}

impl ProgressCallbacks for UiProgress<'_> {
    fn init(&mut self, _addr: u32, total: usize) {
        self.chunks = total.max(1);
    }
    fn update(&mut self, current: usize) {
        self.emit(self.segment_len * current / self.chunks);
    }
    fn finish(&mut self) {
        self.emit(self.segment_len);
    }
}

#[tauri::command]
pub async fn flash_buzzer_firmware(app: AppHandle, port: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || flash(&app, &port))
        .await
        .map_err(|e| format!("flashing stopped unexpectedly: {e}"))?
}

fn flash(app: &AppHandle, port: &str) -> Result<(), String> {
    let usb_info = serialport::available_ports()
        .map_err(|e| format!("couldn't list USB ports: {e}"))?
        .into_iter()
        .find(|p| p.port_name == port)
        .and_then(|p| match p.port_type {
            SerialPortType::UsbPort(info) => Some(info),
            _ => None,
        })
        .ok_or_else(|| format!("{port} isn't a USB device. Plug the buzzer in and press Refresh."))?;

    let serial = serialport::new(port, 115_200)
        .open_native()
        .map_err(|e| format!("couldn't open {port}: {e}"))?;

    let _ = app.emit(PROGRESS_EVENT, 0u8);
    let mut flasher = Flasher::connect(
        serial,
        usb_info,
        None,
        true,
        false,
        false,
        None,
        ResetAfterOperation::default(),
        ResetBeforeOperation::default(),
    )
    .map_err(|e| {
        format!("Couldn't start flashing the buzzer ({e}). Unplug it, plug it back in, and try again.")
    })?;

    let total_len: usize = SEGMENTS.iter().map(|(_, data)| data.len()).sum();
    let mut done_before = 0;
    for (addr, data) in SEGMENTS {
        let mut progress = UiProgress {
            app,
            done_before,
            segment_len: data.len(),
            total_len,
            chunks: 1,
            last_percent: u8::MAX,
        };
        flasher
            .write_bin_to_flash(addr, data, Some(&mut progress))
            .map_err(|e| format!("Flashing failed partway ({e}). Don't unplug during the update — try again."))?;
        done_before += data.len();
    }

    Ok(())
}
