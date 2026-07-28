//! Tauri command handlers for the update-stability sentinel file.
//!
//! The TypeScript [`RollbackDetector`] writes a small JSON record on every
//! startup and clears it after a stability window. The file lives in
//! `appDataDir/sentinels/<key>.json`. Reading and writing are intentionally
//! separate commands so the read path can return structured fields without
//! forcing the writer to re-parse its own input.
//!
//! The key is sanitized against path traversal before any filesystem access.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use thiserror::Error;

const SENTINELS_DIR: &str = "sentinels";

#[derive(Error, Debug, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum SentinelError {
    #[error("Failed to access app data directory: {0}")]
    AppDirAccess(String),
    #[error("Invalid sentinel key: {0}")]
    InvalidKey(String),
    #[error("Sentinel file is missing or unreadable: {0}")]
    MissingOrCorrupt(String),
    #[error("IO error: {0}")]
    Io(String),
}

impl From<std::io::Error> for SentinelError {
    fn from(err: std::io::Error) -> Self {
        SentinelError::Io(err.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelData {
    pub count: u32,
    pub version: String,
}

/// Strip path separators and parent references from a user-supplied key.
/// Allows only `[A-Za-z0-9_.-]`; anything else becomes an error.
fn sanitize_key(key: &str) -> Result<String, SentinelError> {
    if key.is_empty() || key.len() > 128 {
        return Err(SentinelError::InvalidKey(
            "key must be 1-128 characters".into(),
        ));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
    {
        return Err(SentinelError::InvalidKey(
            "key may only contain letters, digits, '_', '.', '-'".into(),
        ));
    }
    Ok(key.to_string())
}

fn sentinels_dir(app: &AppHandle) -> Result<PathBuf, SentinelError> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| SentinelError::AppDirAccess(e.to_string()))?
        .join(SENTINELS_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn sentinel_path(app: &AppHandle, key: &str) -> Result<PathBuf, SentinelError> {
    let key = sanitize_key(key)?;
    Ok(sentinels_dir(app)?.join(format!("{key}.json")))
}

#[command]
pub fn read_sentinel_command(
    app: AppHandle,
    key: String,
) -> Result<SentinelData, SentinelError> {
    let path = sentinel_path(&app, &key)?;
    if !Path::new(&path).exists() {
        // Missing sentinel = first startup. Caller treats count=0 as "no prior crashes".
        return Ok(SentinelData {
            count: 0,
            version: String::new(),
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| {
        SentinelError::MissingOrCorrupt(format!("{}: {e}", path.display()))
    })?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
        SentinelError::MissingOrCorrupt(format!("invalid JSON: {e}"))
    })?;
    let count = parsed
        .get("count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let version = parsed
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(SentinelData { count, version })
}

/// Full JSON payload as written by the caller. Stored verbatim and
/// returned on the next read. Lets the caller evolve the schema
/// without changing this command.
#[command]
pub fn write_sentinel_command(
    app: AppHandle,
    key: String,
    data: String,
) -> Result<(), SentinelError> {
    let path = sentinel_path(&app, &key)?;
    // Validate that `data` is JSON before writing — prevents a corrupt
    // sentinel from making the read path fail at every startup.
    let _: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| SentinelError::InvalidKey(format!("data is not valid JSON: {e}")))?;
    fs::write(&path, data)?;
    Ok(())
}
