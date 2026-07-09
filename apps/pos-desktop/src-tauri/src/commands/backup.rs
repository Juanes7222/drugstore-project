//! Tauri command handlers for the backup subsystem.
//!
//! Each command is intentionally thin: validate input, delegate to the domain
//! module in `crate::backup`, and map errors into a serializable `Result`.

use std::path::PathBuf;

use tauri::{command, AppHandle, State};

use crate::backup::{
    clear_startup_sentinel, copy_backup_to_temp, create_backup, decrypt_backup, encrypt_backup,
    get_backup_health, get_backup_summary, list_backups, mark_backup_corrupt, mark_integrity_failure,
    prune_backups, remove_temp_dir, restore_backup, verify_backup, BackupError, BackupHealthLevel,
    BackupMetadata, BackupReason, BackupState, BackupSummary, QueueState, RestoreError,
    RestoreOptions, RestoreReport, RetentionPolicy, StartupHealth, StartupHealthStatus,
    TempCopyResult, UploadError, VerificationReport,
};

// ---------------------------------------------------------------------------
// Startup health
// ---------------------------------------------------------------------------

#[command]
pub fn get_startup_health(state: State<'_, BackupState>) -> Result<StartupHealth, BackupError> {
    let status = state.get_status();
    let message = match status {
        StartupHealthStatus::Ok => "Database started cleanly".into(),
        StartupHealthStatus::UncleanShutdown => {
            "Unclean shutdown detected — review recommended".into()
        }
        StartupHealthStatus::IntegrityFailed => {
            "Database integrity check failed — restore required".into()
        }
    };
    Ok(StartupHealth { status, message })
}

#[command]
pub fn acknowledge_clean_startup(app: AppHandle) -> Result<(), BackupError> {
    clear_startup_sentinel(&app)
}

#[command]
pub fn report_integrity_failure(app: AppHandle) -> Result<(), BackupError> {
    mark_integrity_failure(&app)
}

// ---------------------------------------------------------------------------
// Backup lifecycle
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CreateBackupRequest {
    pub reason: BackupReason,
    pub workstation_id: String,
    pub db_schema_version: i32,
    pub pending_count: u64,
    pub failed_count: u64,
    pub max_client_sequence: i64,
    pub note: Option<String>,
    pub clock_skew_seconds: Option<i64>,
}

#[command]
pub fn create_backup_command(
    app: AppHandle,
    request: CreateBackupRequest,
) -> Result<BackupMetadata, BackupError> {
    create_backup(
        &app,
        request.reason,
        request.workstation_id,
        request.db_schema_version,
        QueueState {
            pending_count: request.pending_count,
            failed_count: request.failed_count,
            max_client_sequence: request.max_client_sequence,
        },
        request.note,
        request.clock_skew_seconds,
    )
}

#[command]
pub fn list_backups_command(app: AppHandle) -> Result<Vec<BackupMetadata>, BackupError> {
    list_backups(&app)
}

#[command]
pub fn verify_backup_command(
    app: AppHandle,
    id: String,
) -> Result<VerificationReport, BackupError> {
    verify_backup(&app, id)
}

#[command]
pub fn restore_backup_command(
    app: AppHandle,
    id: String,
    options: RestoreOptions,
) -> Result<RestoreReport, RestoreError> {
    restore_backup(&app, id, options)
}

#[command]
pub fn prune_backups_command(
    app: AppHandle,
    policy: Option<RetentionPolicy>,
) -> Result<usize, BackupError> {
    prune_backups(&app, policy.unwrap_or_default())
}

#[command]
pub fn get_backup_summary_command(app: AppHandle) -> Result<BackupSummary, BackupError> {
    get_backup_summary(&app)
}

#[command]
pub fn get_backup_health_command(app: AppHandle) -> Result<BackupHealthLevel, BackupError> {
    get_backup_health(&app)
}

// ---------------------------------------------------------------------------
// Encrypted upload helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize)]
pub struct EncryptBackupRequest {
    pub id: String,
    pub password: String,
}

#[command]
pub fn encrypt_backup_command(
    app: AppHandle,
    request: EncryptBackupRequest,
) -> Result<Vec<u8>, UploadError> {
    encrypt_backup(&app, request.id, request.password)
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct DecryptBackupRequest {
    pub ciphertext: Vec<u8>,
    pub password: String,
    pub workstation_id: String,
    pub output_path: String,
}

#[command]
pub fn decrypt_backup_command(
    request: DecryptBackupRequest,
) -> Result<(), UploadError> {
    decrypt_backup(
        &request.ciphertext,
        request.password,
        request.workstation_id,
        PathBuf::from(request.output_path),
    )
}

// ---------------------------------------------------------------------------
// Housekeeping (exposed for tests and recovery UI)
// ---------------------------------------------------------------------------

#[command]
pub fn mark_backup_corrupt_command(
    app: AppHandle,
    id: String,
) -> Result<(), BackupError> {
    mark_backup_corrupt(&app, &id)
}

#[command]
pub fn copy_backup_to_temp_command(
    app: AppHandle,
    id: String,
) -> Result<TempCopyResult, BackupError> {
    copy_backup_to_temp(&app, id)
}

#[command]
pub fn remove_temp_dir_command(path: String) -> Result<(), BackupError> {
    remove_temp_dir(path)
}
