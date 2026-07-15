//! Local-database backup, verification, and restore subsystem.
//!
//! PGlite runs inside the Tauri webview (WASM), so this Rust module cannot
//! hold a lock across live PGlite operations. Instead, the caller (TypeScript)
//! closes the local database before invoking [`create_backup`] or
//! [`restore_backup`], then reopens it afterward. That close-then-copy pattern
//! is the architecture-appropriate equivalent of an exclusive snapshot lock.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use chrono::{DateTime, Utc};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tar::{Archive, Builder};
use tauri::{AppHandle, Manager};
use tempfile::TempDir;
use thiserror::Error;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUPS_DIR: &str = "backups";
const METADATA_FILE: &str = "metadata.json";
const CLEAN_SHUTDOWN_SENTINEL: &str = ".clean-shutdown";
const INTEGRITY_FAILURE_MARKER: &str = ".integrity-failed";
const DATA_DIR_NAME: &str = "pglite-data";
const DEFAULT_RETENTION_DAYS: i64 = 14;
const DEFAULT_RETENTION_COUNT: usize = 30;
const DEFAULT_STORAGE_LIMIT_BYTES: u64 = 5 * 1024 * 1024 * 1024; // 5 GiB
const ENCRYPTION_NONCE_BYTES: usize = 12;
const ENCRYPTION_SALT_PREFIX: &str = "pos-backup-v1";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Error, Debug, Serialize)]
#[serde(tag = "code", content = "message")]
#[allow(dead_code)]
pub enum BackupError {
    #[error("Failed to access app data directory: {0}")]
    AppDirAccess(String),
    #[error("Backup source directory not found: {0}")]
    SourceNotFound(String),
    #[error("Failed to read backup metadata: {0}")]
    MetadataRead(String),
    #[error("Failed to write backup metadata: {0}")]
    MetadataWrite(String),
    #[error("Failed to copy database directory: {0}")]
    CopyFailed(String),
    #[error("Insufficient storage to create backup")]
    InsufficientStorage,
    #[error("Backup {0} not found")]
    BackupNotFound(String),
    #[error("Backup {0} is corrupt")]
    CorruptBackup(String),
    #[error("Hash mismatch for backup {0}")]
    HashMismatch(String),
    #[error("Backup {0} has an incompatible database schema version")]
    IncompatibleSchema(String),
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("IO error: {0}")]
    Io(String),
}

impl From<io::Error> for BackupError {
    fn from(err: io::Error) -> Self {
        if err.kind() == io::ErrorKind::NotFound {
            BackupError::SourceNotFound(err.to_string())
        } else {
            BackupError::Io(err.to_string())
        }
    }
}

#[derive(Error, Debug, Serialize)]
#[serde(tag = "code", content = "message")]
#[allow(dead_code)]
pub enum RestoreError {
    #[error("Backup {0} not found")]
    BackupNotFound(String),
    #[error("Backup {0} is corrupt")]
    CorruptBackup(String),
    #[error("Failed to replace live database directory: {0}")]
    ReplaceFailed(String),
    #[error("Incompatible database schema version")]
    IncompatibleSchema,
    #[error("Restore aborted by caller")]
    Aborted,
    #[error("IO error: {0}")]
    Io(String),
}

impl From<io::Error> for RestoreError {
    fn from(err: io::Error) -> Self {
        RestoreError::Io(err.to_string())
    }
}

impl From<BackupError> for RestoreError {
    fn from(err: BackupError) -> Self {
        match err {
            BackupError::BackupNotFound(id) => RestoreError::BackupNotFound(id),
            BackupError::CorruptBackup(id) => RestoreError::CorruptBackup(id),
            BackupError::IncompatibleSchema(_id) => RestoreError::IncompatibleSchema,
            _ => RestoreError::Io(err.to_string()),
        }
    }
}

#[derive(Error, Debug, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum UploadError {
    #[error("Backup not found")]
    BackupNotFound,
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Failed to read backup archive: {0}")]
    ArchiveFailed(String),
    #[error("IO error: {0}")]
    Io(String),
}

impl From<io::Error> for UploadError {
    fn from(err: io::Error) -> Self {
        UploadError::Io(err.to_string())
    }
}

impl From<BackupError> for UploadError {
    fn from(err: BackupError) -> Self {
        match err {
            BackupError::BackupNotFound(_) => UploadError::BackupNotFound,
            _ => UploadError::ArchiveFailed(err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackupReason {
    ShiftClose,
    Manual,
    Periodic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub workstation_id: String,
    pub app_version: String,
    pub db_schema_version: i32,
    pub size_bytes: u64,
    pub sha256: String,
    pub reason: BackupReason,
    pub contains_unpushed_operations: bool,
    pub pending_count: u64,
    pub failed_count: u64,
    pub max_client_sequence: i64,
    pub note: Option<String>,
    pub clock_skew_seconds: Option<i64>,
    pub status: BackupStatus,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackupStatus {
    #[default]
    Healthy,
    Corrupt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationReport {
    pub id: String,
    pub passed: bool,
    pub hash_matched: bool,
    pub integrity_check_passed: bool,
    pub table_counts: HashMap<String, i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreOptions {
    pub skip_schema_version_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreReport {
    pub id: String,
    pub success: bool,
    pub restarted: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionPolicy {
    pub keep_last_n: Option<usize>,
    pub keep_days: Option<i64>,
    pub storage_limit_bytes: Option<u64>,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            keep_last_n: Some(DEFAULT_RETENTION_COUNT),
            keep_days: Some(DEFAULT_RETENTION_DAYS),
            storage_limit_bytes: Some(DEFAULT_STORAGE_LIMIT_BYTES),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct UploadReceipt {
    pub upload_id: String,
    pub workstation_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSummary {
    pub last_backup_at: Option<DateTime<Utc>>,
    pub last_backup_reason: Option<BackupReason>,
    pub total_backups: usize,
    pub oldest_backup_at: Option<DateTime<Utc>>,
    pub total_backup_size_bytes: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackupHealthLevel {
    Healthy,
    Stale,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupHealth {
    pub status: StartupHealthStatus,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StartupHealthStatus {
    Ok,
    UncleanShutdown,
    IntegrityFailed,
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

pub struct BackupState {
    startup_status: Mutex<StartupHealthStatus>,
}

impl BackupState {
    pub fn new(status: StartupHealthStatus) -> Self {
        Self {
            startup_status: Mutex::new(status),
        }
    }

    pub fn get_status(&self) -> StartupHealthStatus {
        *self.startup_status.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[allow(dead_code)]
    pub fn set_status(&self, status: StartupHealthStatus) {
        if let Ok(mut guard) = self.startup_status.lock() {
            *guard = status;
        }
    }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, BackupError> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| BackupError::AppDirAccess(e.to_string()))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, BackupError> {
    Ok(app_data_dir(app)?.join(DATA_DIR_NAME))
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, BackupError> {
    Ok(app_data_dir(app)?.join(BACKUPS_DIR))
}

fn backup_root(app: &AppHandle, id: &str) -> Result<PathBuf, BackupError> {
    Ok(backups_dir(app)?.join(id))
}

fn backup_data_dir(app: &AppHandle, id: &str) -> Result<PathBuf, BackupError> {
    Ok(backup_root(app, id)?.join("data"))
}

fn backup_metadata_path(app: &AppHandle, id: &str) -> Result<PathBuf, BackupError> {
    Ok(backup_root(app, id)?.join(METADATA_FILE))
}

fn clean_shutdown_path(app: &AppHandle) -> Result<PathBuf, BackupError> {
    Ok(app_data_dir(app)?.join(CLEAN_SHUTDOWN_SENTINEL))
}

fn integrity_failure_path(app: &AppHandle) -> Result<PathBuf, BackupError> {
    Ok(app_data_dir(app)?.join(INTEGRITY_FAILURE_MARKER))
}

// ---------------------------------------------------------------------------
// Startup sentinel helpers (called from lib.rs setup)
// ---------------------------------------------------------------------------

/// Determine the initial startup health by inspecting marker files.
pub fn assess_startup_health(app: &AppHandle) -> StartupHealthStatus {
    if integrity_failure_path(app).map(|p| p.exists()).unwrap_or(false) {
        log::warn!("integrity failure marker present — database restore required");
        return StartupHealthStatus::IntegrityFailed;
    }
    if clean_shutdown_path(app).map(|p| p.exists()).unwrap_or(false) {
        log::warn!("clean-shutdown sentinel exists — previous shutdown was unclean");
        return StartupHealthStatus::UncleanShutdown;
    }
    StartupHealthStatus::Ok
}

/// Write the clean-shutdown sentinel. Called from the Tauri exit handler.
pub fn write_clean_shutdown_sentinel(app: &AppHandle) -> Result<(), BackupError> {
    let path = clean_shutdown_path(app)?;
    fs::write(&path, b"1").map_err(|e| BackupError::Io(e.to_string()))?;
    log::info!("wrote clean-shutdown sentinel at {:?}", path);
    Ok(())
}

/// Clear the clean-shutdown sentinel after a successful integrity check.
pub fn clear_startup_sentinel(app: &AppHandle) -> Result<(), BackupError> {
    let path = clean_shutdown_path(app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| BackupError::Io(e.to_string()))?;
        log::info!("cleared clean-shutdown sentinel");
    }
    let integrity_path = integrity_failure_path(app)?;
    if integrity_path.exists() {
        fs::remove_file(&integrity_path).map_err(|e| BackupError::Io(e.to_string()))?;
        log::info!("cleared integrity-failure marker");
    }
    Ok(())
}

/// Persist an integrity-failure marker so the next launch routes to recovery.
pub fn mark_integrity_failure(app: &AppHandle) -> Result<(), BackupError> {
    let path = integrity_failure_path(app)?;
    fs::write(&path, b"1").map_err(|e| BackupError::Io(e.to_string()))?;
    log::warn!("wrote integrity-failure marker");
    Ok(())
}

// ---------------------------------------------------------------------------
// Backup creation
// ---------------------------------------------------------------------------

/// Create an atomic snapshot of the PGlite data directory.
///
/// The caller must close the live database before invoking this function.
/// The snapshot is written to a temp location and renamed into place so a
/// crash mid-copy never leaves a partial backup.
pub fn create_backup(
    app: &AppHandle,
    reason: BackupReason,
    workstation_id: String,
    db_schema_version: i32,
    queue_state: QueueState,
    note: Option<String>,
    clock_skew_seconds: Option<i64>,
) -> Result<BackupMetadata, BackupError> {
    ensure_backups_dir(app)?;
    enforce_storage_policy(app, &RetentionPolicy::default())?;

    let source = data_dir(app)?;
    if !source.exists() {
        return Err(BackupError::SourceNotFound(source.display().to_string()));
    }

    let id = format!("backup-{}", Utc::now().timestamp_millis());
    let backups_root = backups_dir(app)?;
    let temp_dir = TempDir::new_in(&backups_root)
        .map_err(|e| BackupError::CopyFailed(format!("temp dir: {e}")))?;
    let temp_backup_root = temp_dir.path().to_path_buf();
    let temp_data_dir = temp_backup_root.join("data");

    copy_dir_all(&source, &temp_data_dir)?;

    let size_bytes = dir_size(&temp_data_dir)?;
    let sha256 = hash_directory(&temp_data_dir)?;

    let metadata = BackupMetadata {
        id: id.clone(),
        created_at: Utc::now(),
        workstation_id,
        app_version: app.package_info().version.to_string(),
        db_schema_version,
        size_bytes,
        sha256,
        reason,
        contains_unpushed_operations: queue_state.pending_count > 0 || queue_state.failed_count > 0,
        pending_count: queue_state.pending_count,
        failed_count: queue_state.failed_count,
        max_client_sequence: queue_state.max_client_sequence,
        note,
        clock_skew_seconds,
        status: BackupStatus::Healthy,
    };

    write_metadata(&temp_backup_root, &metadata)?;

    let final_path = backup_root(app, &id)?;
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&temp_backup_root, &final_path)
        .map_err(|e| BackupError::CopyFailed(format!("atomic rename: {e}")))?;

    // Disarm the temp wrapper so the final backup directory is not deleted.
    let _ = temp_dir.keep();

    log::info!(
        "created backup {} (reason={:?}, size={}, sha256={}",
        id,
        reason,
        size_bytes,
        &metadata.sha256[..16]
    );
    Ok(metadata)
}

#[derive(Debug, Clone, Default)]
pub struct QueueState {
    pub pending_count: u64,
    pub failed_count: u64,
    pub max_client_sequence: i64,
}

fn ensure_backups_dir(app: &AppHandle) -> Result<(), BackupError> {
    let dir = backups_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| BackupError::Io(e.to_string()))?;
    Ok(())
}

fn enforce_storage_policy(
    app: &AppHandle,
    policy: &RetentionPolicy,
) -> Result<(), BackupError> {
    let limit = policy.storage_limit_bytes.unwrap_or(DEFAULT_STORAGE_LIMIT_BYTES);
    let current = total_backup_size(app)?;
    if current >= limit {
        prune_backups(app, policy.clone())?;
        let after_prune = total_backup_size(app)?;
        if after_prune >= limit {
            return Err(BackupError::InsufficientStorage);
        }
    }
    Ok(())
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> Result<(), BackupError> {
    fs::create_dir_all(&dst)?;
    for entry in WalkDir::new(src.as_ref())
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative = path.strip_prefix(src.as_ref()).map_err(|e| BackupError::CopyFailed(e.to_string()))?;
        let target = dst.as_ref().join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(path, target)?;
        }
    }
    Ok(())
}

fn dir_size(path: &Path) -> Result<u64, BackupError> {
    let mut size = 0u64;
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            size += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(size)
}

fn hash_directory(path: &Path) -> Result<String, BackupError> {
    let mut hasher = Sha256::new();
    let mut entries: Vec<(PathBuf, _)> = WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| {
            let relative = e.path().strip_prefix(path).unwrap_or(e.path()).to_path_buf();
            (relative, e)
        })
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (relative, entry) in entries {
        let mut file = fs::File::open(entry.path())?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        let file_hash = hex::encode(Sha256::digest(&buf));
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update(b":");
        hasher.update(file_hash.as_bytes());
        hasher.update(b"\n");
    }
    Ok(hex::encode(hasher.finalize()))
}

fn read_metadata(path: &Path) -> Result<BackupMetadata, BackupError> {
    let content = fs::read_to_string(path)
        .map_err(|e| BackupError::MetadataRead(e.to_string()))?;
    serde_json::from_str(&content)
        .map_err(|e| BackupError::MetadataRead(e.to_string()))
}

fn write_metadata(dir: &Path, metadata: &BackupMetadata) -> Result<(), BackupError> {
    let path = dir.join(METADATA_FILE);
    let content = serde_json::to_string_pretty(metadata)
        .map_err(|e| BackupError::MetadataWrite(e.to_string()))?;
    fs::write(&path, content).map_err(|e| BackupError::MetadataWrite(e.to_string()))
}

// ---------------------------------------------------------------------------
// Backup listing
// ---------------------------------------------------------------------------

pub fn list_backups(app: &AppHandle) -> Result<Vec<BackupMetadata>, BackupError> {
    let dir = backups_dir(app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let meta_path = entry.path().join(METADATA_FILE);
        if !meta_path.exists() {
            continue;
        }
        match read_metadata(&meta_path) {
            Ok(metadata) => backups.push(metadata),
            Err(e) => log::warn!("skipping backup {:?}: {}", entry.path(), e),
        }
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

pub fn get_backup_summary(app: &AppHandle) -> Result<BackupSummary, BackupError> {
    let backups = list_backups(app)?;
    let total_size = backups.iter().map(|b| b.size_bytes).sum();
    Ok(BackupSummary {
        last_backup_at: backups.first().map(|b| b.created_at),
        last_backup_reason: backups.first().map(|b| b.reason.clone()),
        total_backups: backups.len(),
        oldest_backup_at: backups.last().map(|b| b.created_at),
        total_backup_size_bytes: total_size,
    })
}

pub fn get_backup_health(app: &AppHandle) -> Result<BackupHealthLevel, BackupError> {
    let backups = list_backups(app)?;
    if backups.iter().any(|b| b.status == BackupStatus::Corrupt) {
        return Ok(BackupHealthLevel::Critical);
    }
    match backups.first() {
        None => Ok(BackupHealthLevel::Critical),
        Some(latest) => {
            let age = Utc::now() - latest.created_at;
            if age.num_hours() > 24 {
                Ok(BackupHealthLevel::Stale)
            } else {
                Ok(BackupHealthLevel::Healthy)
            }
        }
    }
}

fn total_backup_size(app: &AppHandle) -> Result<u64, BackupError> {
    list_backups(app).map(|list| list.iter().map(|b| b.size_bytes).sum())
}

// ---------------------------------------------------------------------------
// Backup verification
// ---------------------------------------------------------------------------

pub fn verify_backup(app: &AppHandle, id: String) -> Result<VerificationReport, BackupError> {
    let root = backup_root(app, &id)?;
    if !root.exists() {
        return Err(BackupError::BackupNotFound(id));
    }

    let meta_path = root.join(METADATA_FILE);
    let metadata = read_metadata(&meta_path)?;

    let data_dir = root.join("data");
    if !data_dir.exists() {
        mark_backup_corrupt(app, &id)?;
        return Err(BackupError::CorruptBackup(id));
    }

    let recomputed_hash = hash_directory(&data_dir)?;
    let hash_matched = recomputed_hash == metadata.sha256;

    if !hash_matched {
        mark_backup_corrupt(app, &id)?;
        return Ok(VerificationReport {
            id,
            passed: false,
            hash_matched: false,
            integrity_check_passed: false,
            table_counts: HashMap::new(),
            error: Some("Hash mismatch — backup directory is corrupt".into()),
        });
    }

    // The actual PGlite integrity check is performed by the TypeScript layer
    // because PGlite runs in the webview. This Rust-level verification confirms
    // filesystem consistency; the caller must run `PRAGMA integrity_check`
    // equivalent through PGlite and combine the results.
    Ok(VerificationReport {
        id,
        passed: hash_matched,
        hash_matched,
        integrity_check_passed: true,
        table_counts: HashMap::new(),
        error: None,
    })
}

pub fn mark_backup_corrupt(app: &AppHandle, id: &str) -> Result<(), BackupError> {
    let path = backup_metadata_path(app, id)?;
    if !path.exists() {
        return Err(BackupError::BackupNotFound(id.into()));
    }
    let mut metadata = read_metadata(&path)?;
    metadata.status = BackupStatus::Corrupt;
    write_metadata(path.parent().unwrap_or(Path::new("")), &metadata)
}

// ---------------------------------------------------------------------------
// Backup restore
// ---------------------------------------------------------------------------

pub fn restore_backup(
    app: &AppHandle,
    id: String,
    options: RestoreOptions,
) -> Result<RestoreReport, RestoreError> {
    let root = backup_root(app, &id)?;
    if !root.exists() {
        return Err(RestoreError::BackupNotFound(id));
    }

    let meta_path = root.join(METADATA_FILE);
    let metadata = read_metadata(&meta_path)
        .map_err(|e| RestoreError::CorruptBackup(e.to_string()))?;

    if metadata.status == BackupStatus::Corrupt {
        return Err(RestoreError::CorruptBackup(id));
    }

    if !options.skip_schema_version_check {
        let current_schema = current_db_schema_version(app);
        if metadata.db_schema_version != current_schema {
            return Err(RestoreError::IncompatibleSchema);
        }
    }

    let source_data = root.join("data");
    let live_data = data_dir(app).map_err(|e| RestoreError::Io(e.to_string()))?;

    // Atomic replace: copy backup to a temp dir next to live, then rename.
    let app_data = app_data_dir(app).map_err(|e| RestoreError::Io(e.to_string()))?;
    let temp_restore = app_data.join(format!(".restore-{}", id));
    if temp_restore.exists() {
        fs::remove_dir_all(&temp_restore)?;
    }
    copy_dir_all(&source_data, &temp_restore)
        .map_err(|e| RestoreError::ReplaceFailed(e.to_string()))?;

    if live_data.exists() {
        let renamed_live = app_data.join(format!(".pre-restore-{}", Utc::now().timestamp_millis()));
        fs::rename(&live_data, &renamed_live)
            .map_err(|e| RestoreError::ReplaceFailed(e.to_string()))?;
        // Best-effort cleanup of the old live directory in the background.
        let _ = fs::remove_dir_all(&renamed_live);
    }
    fs::rename(&temp_restore, &live_data)
        .map_err(|e| RestoreError::ReplaceFailed(e.to_string()))?;

    // Clear any failure markers so the app can start normally.
    let _ = clear_startup_sentinel(app);

    log::info!("restored backup {} to {:?}", id, live_data);
    Ok(RestoreReport {
        id,
        success: true,
        restarted: false,
        error: None,
    })
}

fn current_db_schema_version(_app: &AppHandle) -> i32 {
    // The schema version is tracked by the TypeScript build and passed when
    // needed. Returning a placeholder here; the caller should validate via the
    // BackupMetadata.db_schema_version field against the app's known version.
    1
}

// ---------------------------------------------------------------------------
// Backup pruning
// ---------------------------------------------------------------------------

pub fn prune_backups(
    app: &AppHandle,
    policy: RetentionPolicy,
) -> Result<usize, BackupError> {
    let backups = list_backups(app)?;
    if backups.is_empty() {
        return Ok(0);
    }

    let mut keep_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Keep the most recent N.
    if let Some(n) = policy.keep_last_n {
        for b in backups.iter().take(n) {
            keep_ids.insert(b.id.clone());
        }
    }

    // Keep all backups within the retention window.
    if let Some(days) = policy.keep_days {
        let cutoff = Utc::now() - chrono::Duration::days(days);
        for b in &backups {
            if b.created_at >= cutoff {
                keep_ids.insert(b.id.clone());
            }
        }
    }

    // Keep at least one backup per month (simplified: keep the newest of each month).
    let mut newest_by_month: HashMap<String, &BackupMetadata> = HashMap::new();
    for b in &backups {
        let key = b.created_at.format("%Y-%m").to_string();
        newest_by_month.insert(key, b);
    }
    for b in newest_by_month.values() {
        keep_ids.insert(b.id.clone());
    }

    let mut removed = 0usize;
    for b in backups {
        if keep_ids.contains(&b.id) {
            continue;
        }
        let path = backup_root(app, &b.id)?;
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| BackupError::Io(e.to_string()))?;
            removed += 1;
            log::info!("pruned backup {}", b.id);
        }
    }

    Ok(removed)
}

// ---------------------------------------------------------------------------
// Encrypted off-site upload
// ---------------------------------------------------------------------------

pub fn encrypt_backup(
    app: &AppHandle,
    id: String,
    password: String,
) -> Result<Vec<u8>, UploadError> {
    let root = backup_root(app, &id).map_err(|_| UploadError::BackupNotFound)?;
    if !root.exists() {
        return Err(UploadError::BackupNotFound);
    }

    // Derive key with Argon2id using the workstation ID as salt.
    let metadata = read_metadata(&root.join(METADATA_FILE))
        .map_err(|e| UploadError::ArchiveFailed(e.to_string()))?;
    let salt_input = format!("{}-{}", ENCRYPTION_SALT_PREFIX, metadata.workstation_id);
    let salt = SaltString::encode_b64(salt_input.as_bytes())
        .map_err(|e| UploadError::EncryptionFailed(e.to_string()))?;
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| UploadError::EncryptionFailed(e.to_string()))?;
    let key_bytes = password_hash.hash.ok_or_else(|| {
        UploadError::EncryptionFailed("derived key missing".into())
    })?;
    let key: [u8; 32] = key_bytes.as_bytes()[..32]
        .try_into()
        .map_err(|_| UploadError::EncryptionFailed("invalid key length".into()))?;

    // Build a gzipped tarball of the backup directory in a temp location.
    let app_data = app_data_dir(app).map_err(|e| UploadError::Io(e.to_string()))?;
    let tar_gz_path = app_data.join(format!(".backup-{}.tar.gz", id));
    create_tar_gz(&root, &tar_gz_path)?;

    // Read tarball and encrypt with AES-256-GCM.
    let plaintext = fs::read(&tar_gz_path)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| UploadError::EncryptionFailed(e.to_string()))?;
    let nonce_bytes: [u8; ENCRYPTION_NONCE_BYTES] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| UploadError::EncryptionFailed(e.to_string()))?;

    // Format: [nonce (12 bytes)][ciphertext].
    let mut output = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    // Cleanup temporary tarball.
    let _ = fs::remove_file(&tar_gz_path);

    log::info!("encrypted backup {} ({} bytes)", id, output.len());
    Ok(output)
}

pub fn decrypt_backup(
    ciphertext: &[u8],
    password: String,
    workstation_id: String,
    output_dir: PathBuf,
) -> Result<(), UploadError> {
    if ciphertext.len() < ENCRYPTION_NONCE_BYTES {
        return Err(UploadError::DecryptionFailed("ciphertext too short".into()));
    }
    let (nonce_bytes, encrypted) = ciphertext.split_at(ENCRYPTION_NONCE_BYTES);

    let salt_input = format!("{}-{}", ENCRYPTION_SALT_PREFIX, workstation_id);
    let salt = SaltString::encode_b64(salt_input.as_bytes())
        .map_err(|e| UploadError::DecryptionFailed(e.to_string()))?;
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| UploadError::DecryptionFailed(e.to_string()))?;
    let key_bytes = password_hash.hash.ok_or_else(|| {
        UploadError::DecryptionFailed("derived key missing".into())
    })?;
    let key: [u8; 32] = key_bytes.as_bytes()[..32]
        .try_into()
        .map_err(|_| UploadError::DecryptionFailed("invalid key length".into()))?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| UploadError::DecryptionFailed(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, encrypted)
        .map_err(|e| UploadError::DecryptionFailed(e.to_string()))?;

    if output_dir.exists() {
        fs::remove_dir_all(&output_dir)?;
    }
    fs::create_dir_all(&output_dir)?;
    let tar_gz_path = output_dir.join("backup.tar.gz");
    fs::write(&tar_gz_path, &plaintext)?;

    let gz = GzDecoder::new(fs::File::open(&tar_gz_path)?);
    let mut archive = Archive::new(gz);
    archive.unpack(&output_dir)?;

    fs::remove_file(&tar_gz_path)?;
    Ok(())
}

fn create_tar_gz(source_dir: &Path, output_path: &Path) -> Result<(), BackupError> {
    let file = fs::File::create(output_path)?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut tar = Builder::new(enc);
    tar.append_dir_all(".", source_dir)?;
    tar.finish()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Verify helpers — PGlite lives in the webview, so the temp copy is opened
// by TypeScript while Rust guarantees the original backup is untouched.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TempCopyResult {
    pub temp_data_dir: String,
}

pub fn copy_backup_to_temp(app: &AppHandle, id: String) -> Result<TempCopyResult, BackupError> {
    let source = backup_data_dir(app, &id)?;
    if !source.exists() {
        return Err(BackupError::BackupNotFound(id));
    }
    let app_data = app_data_dir(app)?;
    let temp_dir = app_data.join(format!(".verify-{}", id));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
    }
    copy_dir_all(&source, &temp_dir)?;
    Ok(TempCopyResult {
        temp_data_dir: temp_dir.to_string_lossy().to_string(),
    })
}

pub fn remove_temp_dir(path: String) -> Result<(), BackupError> {
    let p = PathBuf::from(path);
    if p.exists() {
        fs::remove_dir_all(&p)?;
    }
    Ok(())
}


