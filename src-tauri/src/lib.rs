use tauri::{Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

mod admin;
mod buzzer;
mod firmware;
mod network;
mod password_hash;
mod provisioning;
mod usb_driver;
mod win;

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create core tables",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "split text_align into title_align and footer_align",
            sql: include_str!("../migrations/0002_split_text_align.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add draw sections",
            sql: include_str!("../migrations/0003_draw_sections.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add auto mode round metadata",
            sql: include_str!("../migrations/0004_auto_mode.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add section sequence numbering and planned rounds",
            sql: include_str!("../migrations/0005_section_sequence_and_planned_rounds.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add prizes catalog",
            sql: include_str!("../migrations/0006_prizes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add section and winner count to prizes catalog",
            sql: include_str!("../migrations/0007_prize_catalog_sections.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add per-section slot counts and participant draw tags",
            sql: include_str!("../migrations/0008_section_slots_and_participant_draws.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add separate auto draw section",
            sql: include_str!("../migrations/0009_auto_draw_section.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:lucky-draw.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            provisioning::list_serial_ports,
            provisioning::detect_local_ip,
            provisioning::detect_wifi_ssid,
            provisioning::provision_buzzer,
            firmware::flash_buzzer_firmware,
            firmware::bundled_firmware_version,
            admin::verify_admin_password,
            buzzer::buzzer_contact,
            network::detect_wifi_network,
            network::buzzer_firewall_allowed,
            network::allow_buzzer_firewall,
            usb_driver::usb_driver_installed,
            usb_driver::install_usb_driver,
        ])
        .setup(|app| {
            buzzer::spawn(app.handle().clone());
            Ok(())
        })
        // The Output window is only useful alongside the Control window, so
        // closing Control quits the whole app instead of leaving Output orphaned.
        .on_window_event(|window, event| {
            if window.label() == "control" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
