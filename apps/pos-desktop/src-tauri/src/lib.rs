use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tokio::sync::Mutex;

mod backup;
mod commands;
mod hardware_fingerprint;
mod hub_election;
mod local_sync_client;
mod local_sync_server;
mod mdns_discovery;
mod printer_discovery;

use backup::{assess_startup_health, write_clean_shutdown_sentinel, BackupState};

// ---------------------------------------------------------------------------
// Greet command (legacy)
// ---------------------------------------------------------------------------

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Pharmacy POS is running.", name)
}

// ---------------------------------------------------------------------------
// Lazy local sync modules
// ---------------------------------------------------------------------------

/// Container for local sync modules that are initialised lazily.
///
/// The TypeScript side calls `initialize_local_sync` after loading the
/// workstation configuration from the local database. Until then, the
/// modules remain `None` and commands return empty/default responses.
pub struct LocalSyncModules {
    pub mdns: Mutex<Option<Arc<mdns_discovery::MdnsDiscoveryState>>>,
    pub server: Mutex<Option<Arc<local_sync_server::LocalSyncServerState>>>,
    pub client: Mutex<Option<Arc<local_sync_client::LocalSyncClientState>>>,
}

impl LocalSyncModules {
    fn empty() -> Self {
        Self {
            mdns: Mutex::new(None),
            server: Mutex::new(None),
            client: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            let initial_status = assess_startup_health(app.handle());
            app.manage(BackupState::new(initial_status));

            // Local sync modules start empty; TS initialises after config load.
            app.manage(LocalSyncModules::empty());

            // Hub election — always initialised with defaults.
            // TS updates the ID/name via election command after config load.
            app.manage(hub_election::HubElectionState::new(
                String::new(),
                String::new(),
                true,
            ));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            hardware_fingerprint::get_hardware_fingerprint,
            // Backup commands
            commands::backup::get_startup_health,
            commands::backup::acknowledge_clean_startup,
            commands::backup::report_integrity_failure,
            commands::backup::create_backup_command,
            commands::backup::list_backups_command,
            commands::backup::verify_backup_command,
            commands::backup::restore_backup_command,
            commands::backup::prune_backups_command,
            commands::backup::get_backup_summary_command,
            commands::backup::get_backup_health_command,
            commands::backup::encrypt_backup_command,
            commands::backup::decrypt_backup_command,
            commands::backup::mark_backup_corrupt_command,
            commands::backup::copy_backup_to_temp_command,
            commands::backup::remove_temp_dir_command,
            commands::backup::write_data_dir_file_command,
            commands::backup::read_data_dir_file_command,
            commands::backup::delete_data_dir_file_command,
            commands::backup::read_backup_dump_command,
            // Printer discovery commands
            commands::printer_discovery::discover_printers,
            commands::printer_discovery::scan_network_printers,
            commands::printer_discovery::test_print,
            commands::printer_discovery::get_printer_status,
            commands::printer_discovery::print_file,
            commands::printer_discovery::print_escpos,
            commands::printer_discovery::print_label_image,
            commands::printer_discovery::open_cash_drawer,
            commands::printer_discovery::customer_display_update,
            commands::printer_discovery::detect_printer_paper_size,
            commands::printer_discovery::write_temp_file,
            commands::printer_discovery::file_exists,
            // Local sync commands
            commands::local_sync::initialize_local_sync,
            commands::local_sync::get_discovered_peers,
            commands::local_sync::force_rediscovery,
            commands::local_sync::start_hub_server,
            commands::local_sync::stop_hub_server,
            commands::local_sync::set_hub_override,
            commands::local_sync::force_local_sync,
            commands::local_sync::get_local_sync_status,
            commands::local_sync::get_current_hub,
            commands::local_sync::get_hub_scores,
            commands::local_sync::get_hub_conflicts,
            commands::local_sync::push_to_hub,
            commands::local_sync::pull_from_hub,
            commands::local_sync::set_local_sync_enabled,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            if let Err(e) = write_clean_shutdown_sentinel(app_handle) {
                log::error!("failed to write clean-shutdown sentinel: {}", e);
            }
        }
    });
}
