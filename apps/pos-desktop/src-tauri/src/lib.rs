use tauri::{Manager, RunEvent};

mod backup;
mod commands;
mod hardware_fingerprint;

use backup::{assess_startup_health, write_clean_shutdown_sentinel, BackupState};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Pharmacy POS is running.", name)
}

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            hardware_fingerprint::get_hardware_fingerprint,
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
