// Standalone flasher for the Lucky Draw buzzer's ESP32.
//
// Carries the compiled firmware baked in (see `firmware/*.bin`, embedded
// below), so flashing a buzzer never needs VS Code or PlatformIO — just
// this one .exe, plugged into a buzzer over USB.

use std::io::{self, Write};

use espflash::connection::reset::{ResetAfterOperation, ResetBeforeOperation};
use espflash::elf::RomSegment;
use espflash::flasher::{Flasher, ProgressCallbacks};
use serialport::{SerialPortType, UsbPortInfo};

const BOOTLOADER: &[u8] = include_bytes!("../firmware/bootloader.bin");
const PARTITIONS: &[u8] = include_bytes!("../firmware/partitions.bin");
const BOOT_APP0: &[u8] = include_bytes!("../firmware/boot_app0.bin");
const APP: &[u8] = include_bytes!("../firmware/firmware.bin");

const LABELS: [&str; 4] = ["bootloader", "partition table", "boot selector", "app"];

/// Prints one line per segment; espflash calls `init` as each one starts.
struct SimpleProgress {
    segment: usize,
}

impl ProgressCallbacks for SimpleProgress {
    fn init(&mut self, addr: u32, _total: usize) {
        let label = LABELS.get(self.segment).copied().unwrap_or("data");
        self.segment += 1;
        print!("  writing {label} @ 0x{addr:x}... ");
        let _ = io::stdout().flush();
    }
    fn update(&mut self, _current: usize) {}
    fn finish(&mut self) {
        println!("done");
    }
}

fn pause_and_exit(code: i32) -> ! {
    println!();
    print!("Press Enter to close this window...");
    let _ = io::stdout().flush();
    let mut discard = String::new();
    let _ = io::stdin().read_line(&mut discard);
    std::process::exit(code);
}

fn pick_port() -> Option<(String, UsbPortInfo)> {
    let ports = match serialport::available_ports() {
        Ok(p) => p,
        Err(e) => {
            println!("Couldn't list serial ports: {e}");
            return None;
        }
    };

    let usb_ports: Vec<_> = ports
        .into_iter()
        .filter_map(|p| match p.port_type {
            SerialPortType::UsbPort(info) => Some((p.port_name, info)),
            _ => None,
        })
        .collect();

    if usb_ports.is_empty() {
        println!("No USB serial devices found. Plug in the buzzer and try again.");
        return None;
    }

    if usb_ports.len() == 1 {
        let (name, info) = usb_ports.into_iter().next().unwrap();
        println!("Found buzzer on {name}");
        return Some((name, info));
    }

    println!("Multiple USB serial devices found:");
    for (i, (name, _)) in usb_ports.iter().enumerate() {
        println!("  {}. {name}", i + 1);
    }
    print!("Which one is the buzzer? Enter a number: ");
    let _ = io::stdout().flush();

    let mut input = String::new();
    if io::stdin().read_line(&mut input).is_err() {
        return None;
    }
    let choice: usize = input.trim().parse().ok()?;
    usb_ports.into_iter().nth(choice.checked_sub(1)?)
}

fn main() {
    println!("Lucky Draw Buzzer Flasher");
    println!("==========================");
    println!();

    let Some((port_name, usb_info)) = pick_port() else {
        pause_and_exit(1);
    };

    println!("Connecting...");
    let serial_port = match serialport::new(&port_name, 115_200).open_native() {
        Ok(p) => p,
        Err(e) => {
            println!("Couldn't open {port_name}: {e}");
            pause_and_exit(1);
        }
    };

    let mut flasher = match Flasher::connect(
        serial_port,
        usb_info,
        None,
        true,
        false,
        false,
        None,
        ResetAfterOperation::default(),
        ResetBeforeOperation::default(),
    ) {
        Ok(f) => f,
        Err(e) => {
            println!("Couldn't connect to the buzzer: {e}");
            println!("(Make sure it's plugged in and not in use by another program.)");
            pause_and_exit(1);
        }
    };

    println!("Connected — chip: {:?}", flasher.chip());
    println!("Flashing (this takes about a minute, don't unplug)...");

    let segments = [
        RomSegment { addr: 0x1000, data: BOOTLOADER.into() },
        RomSegment { addr: 0x8000, data: PARTITIONS.into() },
        RomSegment { addr: 0xe000, data: BOOT_APP0.into() },
        RomSegment { addr: 0x10000, data: APP.into() },
    ];
    // One call for all segments: espflash resets the chip at the end of each
    // write call, so writing them one at a time talked to a rebooting chip
    // from the second segment on ("Communication error while flashing").
    let mut progress = SimpleProgress { segment: 0 };
    if let Err(e) = flasher.write_bins_to_flash(&segments, Some(&mut progress)) {
        println!("Flashing failed: {e}");
        pause_and_exit(1);
    }

    println!();
    println!("Done! The buzzer will reboot and is ready to be provisioned from the Lucky Draw app.");
    pause_and_exit(0);
}
