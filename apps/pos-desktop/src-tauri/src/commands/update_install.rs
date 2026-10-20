//! Tauri command handlers for the POS auto-update installation.
//!
//! The TypeScript update service downloads the installer and hands its path
//! to `trigger_update_install_command`. Everything that touches the
//! filesystem or the process table lives here:
//!
//! - storing the downloaded installer,
//! - hashing it,
//! - snapshotting the running executable so a bad release can be rolled back,
//! - launching the installer and letting the app exit,
//! - relaunching the previous version when the new one is rolled back.
//!
//! The installer is launched as the current user, so the published package
//! must be a per-user install (an NSIS installer built with
//! `perMachine: false`); a per-machine installer would need an elevated
//! shell, which this command deliberately does not request.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{command, AppHandle, Manager};

const UPDATES_DIR: &str = "updates";
const ROLLBACK_DIR: &str = "rollback";
const SENTINELS_DIR: &str = "sentinels";
/// Same key the TypeScript rollback detector writes.
const CRASH_SENTINEL_KEY: &str = ".last-update-startup";

/// Extensions accepted for an installer package.
const INSTALLER_EXTENSIONS: [&str; 5] = ["exe", "msi", "sh", "appimage", "deb"];

/// How long the app keeps running after handing the installer the file
/// handle, so the IPC response reaches the frontend before the app exits.
const EXIT_GRACE_MS: u64 = 1500;

/// What a rollback did, so the frontend can report it before the app exits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackOutcome {
    /// Version relaunched, when a previous snapshot was found.
    pub restored_version: Option<String>,
    /// Whether the previous version was relaunched.
    pub relaunched: bool,
    /// Whether the crash sentinel was reset.
    pub sentinel_reset: bool,
}

/// A previously installed version kept on disk for rollback.
struct Snapshot {
    version: String,
    executable: PathBuf,
    modified: SystemTime,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Keep only the file name of an uploaded installer.
fn sanitize_filename(name: &str) -> Result<String, String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if base.is_empty() || base == "." || base == ".." {
        return Err("The installer has no usable file name.".to_string());
    }
    Ok(base.to_string())
}

/// True when the file name looks like an installer package.
fn has_installer_extension(name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    INSTALLER_EXTENSIONS.contains(&extension.as_str())
}

/// A snapshot is only a rollback candidate when it is a different version.
fn is_previous_version(candidate: &str, current: &str) -> bool {
    !candidate.is_empty() && candidate != current
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(UPDATES_DIR))
}

fn rollback_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(ROLLBACK_DIR))
}

/// Directory holding the snapshot of one version.
fn snapshot_dir(app: &AppHandle, version: &str) -> Result<PathBuf, String> {
    Ok(rollback_root(app)?.join(sanitize_filename(version)?))
}

fn running_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Copy the running executable into the rollback directory so a bad release
/// can be undone by relaunching it.
///
/// Only the executable is copied. A bundle that needs sibling files (the
/// WebView2 loader, for instance) must ship them next to the executable in
/// the install directory; a snapshot taken from a per-user install still
/// finds them through the usual search path.
fn snapshot_current_executable(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let version = running_version(app);
    let dir = snapshot_dir(app, &version)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_name = executable
        .file_name()
        .ok_or_else(|| "The running executable has no file name.".to_string())?;
    let target = dir.join(file_name);
    fs::copy(&executable, &target)
        .map_err(|e| format!("could not snapshot the running executable: {e}"))?;
    Ok(target)
}

/// The most recent snapshot that belongs to another version.
fn previous_snapshot(app: &AppHandle) -> Result<Option<Snapshot>, String> {
    let root = rollback_root(app)?;
    if !root.exists() {
        return Ok(None);
    }

    let current = running_version(app);
    let mut candidates: Vec<Snapshot> = Vec::new();

    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let version = entry.file_name().to_string_lossy().to_string();
        if !is_previous_version(&version, &current) {
            continue;
        }
        let Some(executable) = first_file_in(&entry.path())? else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        candidates.push(Snapshot {
            version,
            executable,
            modified,
        });
    }

    candidates.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(candidates.into_iter().next())
}

/// First regular file inside a directory.
fn first_file_in(dir: &Path) -> Result<Option<PathBuf>, String> {
    let mut found: Option<PathBuf> = None;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file() {
            found = Some(entry.path());
            break;
        }
    }
    Ok(found)
}

/// Launch a program so it outlives the app it replaces.
fn spawn_detached(program: &Path) -> Result<(), String> {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: the installer must
        // keep running after this app exits.
        command.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Close the app shortly after answering the IPC call.
fn exit_after_delay(app: &AppHandle, delay: Duration) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        handle.exit(0);
    });
}

/// Reset the crash counter so the app does not stay in a rollback loop.
fn reset_crash_sentinel(app: &AppHandle) -> Result<(), String> {
    let dir = app_data_dir(app)?.join(SENTINELS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "count": 0,
        "version": running_version(app),
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    fs::write(
        dir.join(format!("{CRASH_SENTINEL_KEY}.json")),
        payload.to_string(),
    )
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Store the downloaded installer and return its path on disk.
#[command]
pub fn write_update_binary_command(
    app: AppHandle,
    version: String,
    filename: String,
    data_base64: String,
) -> Result<String, String> {
    let safe_version = sanitize_filename(&version)?;
    let safe_name = sanitize_filename(&filename)?;
    let bytes = BASE64
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("The installer payload is not valid base64: {e}"))?;

    let dir = updates_dir(&app)?.join(safe_version);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(safe_name);
    fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

/// SHA-256 of a file, as a hex digest.
#[command]
pub fn compute_sha256_command(file_path: String) -> Result<String, String> {
    let mut file = fs::File::open(Path::new(&file_path)).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Launch the downloaded installer and let the app exit so the installer can
/// replace the running files.
#[command]
pub fn trigger_update_install_command(
    app: AppHandle,
    download_path: String,
) -> Result<(), String> {
    let installer = Path::new(&download_path);
    if !installer.is_file() {
        return Err(format!(
            "The downloaded installer is missing: {download_path}"
        ));
    }
    let name = installer
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if !has_installer_extension(name) {
        return Err(format!("Unsupported installer package: {name}"));
    }

    match snapshot_current_executable(&app) {
        Ok(snapshot) => log::info!("snapshotted the running executable to {snapshot:?}"),
        Err(e) => log::error!("could not snapshot the running executable: {e}"),
    }

    spawn_detached(installer)?;
    log::info!("launched the installer {installer:?}");

    exit_after_delay(&app, Duration::from_millis(EXIT_GRACE_MS));
    Ok(())
}

/// Undo a bad release: reset the crash counter and relaunch the version
/// that was running before the update, when one was snapshotted.
#[command]
pub fn rollback_update_command(app: AppHandle) -> Result<RollbackOutcome, String> {
    let sentinel_reset = reset_crash_sentinel(&app).is_ok();
    let mut outcome = RollbackOutcome {
        restored_version: None,
        relaunched: false,
        sentinel_reset,
    };

    match previous_snapshot(&app)? {
        Some(snapshot) => {
            spawn_detached(&snapshot.executable)?;
            log::info!(
                "relaunched version {} from {:?}",
                snapshot.version,
                snapshot.executable
            );
            outcome.restored_version = Some(snapshot.version);
            outcome.relaunched = true;
            exit_after_delay(&app, Duration::from_millis(EXIT_GRACE_MS));
        }
        None => log::warn!("no previous version snapshot to roll back to"),
    }

    Ok(outcome)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_file_name() {
        assert_eq!(sanitize_filename("pos-setup.exe").unwrap(), "pos-setup.exe");
        assert_eq!(
            sanitize_filename("uploads/2026/pos-setup.exe").unwrap(),
            "pos-setup.exe"
        );
        assert_eq!(
            sanitize_filename("C:\\temp\\pos-setup.exe").unwrap(),
            "pos-setup.exe"
        );
    }

    #[test]
    fn rejects_names_without_a_usable_file_name() {
        assert!(sanitize_filename("").is_err());
        assert!(sanitize_filename("   ").is_err());
        assert!(sanitize_filename("..").is_err());
        assert!(sanitize_filename(".").is_err());
    }

    #[test]
    fn accepts_installer_extensions_only() {
        assert!(has_installer_extension("pos-setup.exe"));
        assert!(has_installer_extension("pos-setup.EXE"));
        assert!(has_installer_extension("pos-setup.msi"));
        assert!(has_installer_extension("pos-setup.AppImage"));
        assert!(!has_installer_extension("pos-setup.txt"));
        assert!(!has_installer_extension("pos-setup"));
    }

    #[test]
    fn only_other_versions_are_rollback_candidates() {
        assert!(is_previous_version("1.0.0", "1.1.0"));
        assert!(!is_previous_version("1.1.0", "1.1.0"));
        assert!(!is_previous_version("", "1.1.0"));
    }
}
