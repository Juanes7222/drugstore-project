//! In-memory diagnostics ring buffer for local sync.
//!
//! The UI's "Red Local" page polls `get_local_sync_diagnostics` to render a
//! live log without requiring the operator to open the devtools console.
//! Every important state transition in `mdns_discovery`, `hub_election` and
//! `hub_supervisor` pushes an entry here via `push(...)`. The buffer is
//! bounded (200 entries) so it never leaks.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

static GLOBAL_BUFFER: OnceLock<Mutex<Vec<DiagnosticEntry>>> = OnceLock::new();

fn global_buffer() -> &'static Mutex<Vec<DiagnosticEntry>> {
    GLOBAL_BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

/// Push a diagnostic entry from anywhere (even without `AppHandle`).
///
/// Discovery/election heartbeats are logged at trace and excluded from the
/// operator-facing ring buffer so push/pull sync lines stay visible.
pub fn push_global(level: &str, target: &str, message: String) {
    const QUIET_TARGETS: &[&str] = &[
        "file_heartbeat",
        "mdns_discovery",
        "hub_election",
        "hub_supervisor",
        "diagnostics",
    ];
    let quiet_info = QUIET_TARGETS.contains(&target) && level == "INFO";

    let entry = DiagnosticEntry {
        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        level: level.to_string(),
        target: target.to_string(),
        message: message.clone(),
    };
    match level {
        "ERROR" => log::error!("[{}] {}", target, message),
        "WARN" => log::warn!("[{}] {}", target, message),
        _ if quiet_info => log::trace!("[{}] {}", target, message),
        _ => log::info!("[{}] {}", target, message),
    }
    if quiet_info {
        return;
    }
    if let Ok(mut guard) = global_buffer().lock() {
        guard.push(entry);
        if guard.len() > 200 {
            let excess = guard.len() - 200;
            guard.drain(0..excess);
        }
    }
}

/// One log line shown in the diagnostics panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

/// Structured debug snapshot for the diagnostics panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncDebugInfo {
    pub workstation_id: String,
    pub friendly_name: String,
    pub hub_eligible: bool,
    pub host_ip: String,
    pub port: u16,
    pub is_current_hub_flag: bool,
    pub daemon_available: bool,
    pub heartbeat_dir: Option<String>,
    pub mdns_peers: usize,
    pub file_peers: usize,
    pub merged_peers: usize,
    pub current_hub: Option<String>,
    pub hub_is_self: bool,
    pub server_running: bool,
    pub server_port: u16,
    pub client_hub_address: Option<String>,
}

pub struct LocalSyncDiagnostics;

impl LocalSyncDiagnostics {
    pub fn new() -> Self {
        Self
    }

    pub fn push(&self, level: &str, target: &str, message: String) {
        push_global(level, target, message);
    }

    pub fn get_entries(&self) -> Vec<DiagnosticEntry> {
        global_buffer()
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = global_buffer().lock() {
            guard.clear();
        }
    }
}

impl Default for LocalSyncDiagnostics {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tauri commands exposed to the frontend
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_local_sync_diagnostics(
    state: tauri::State<LocalSyncDiagnostics>,
) -> Vec<DiagnosticEntry> {
    state.get_entries()
}

#[tauri::command]
pub fn clear_local_sync_diagnostics(state: tauri::State<LocalSyncDiagnostics>) {
    state.clear();
}

#[tauri::command]
pub async fn get_local_sync_debug_info(
    app: tauri::AppHandle,
    diagnostics: tauri::State<'_, LocalSyncDiagnostics>,
) -> Result<LocalSyncDebugInfo, String> {
    use tauri::Manager;

    let election = app.state::<crate::hub_election::HubElectionState>();
    let snapshot = election.diagnostic_snapshot().await;

    let modules = app.state::<crate::LocalSyncModules>();
    let mdns_opt = modules.mdns.lock().await.clone();

    let (daemon_available, heartbeat_dir, mdns_peers, file_peers, merged_peers, host_ip, port) =
        if let Some(mdns) = mdns_opt {
            let mdns_peers = mdns.mdns_peer_count().await;
            let file_peers = mdns.file_peer_count().await;
            let merged = mdns.get_discovered_peers().await.len();
            let daemon_available = mdns.is_daemon_available().await;
            let hb_dir = mdns.heartbeat_dir_string().await;
            let host_ip = mdns.host_ip_string().await;
            let port = mdns.port_value().await;
            (
                daemon_available,
                hb_dir,
                mdns_peers,
                file_peers,
                merged,
                host_ip,
                port,
            )
        } else {
            (false, None, 0, 0, 0, String::new(), 0)
        };

    let current_hub = election.get_current_hub().await;
    let hub_id = current_hub.as_ref().map(|h| h.workstation_id.clone());
    let hub_is_self = current_hub.as_ref().map(|h| h.is_self).unwrap_or(false);

    // Server / client status for diagnostics
    let modules = app.state::<crate::LocalSyncModules>();
    let server_opt = modules.server.lock().await.clone();
    let client_opt = modules.client.lock().await.clone();
    let server_running = if let Some(ref s) = server_opt {
        s.is_running().await
    } else {
        false
    };
    let server_port = if let Some(ref s) = server_opt {
        s.bound_port().await
    } else {
        0
    };
    let client_hub_address = if let Some(c) = client_opt {
        c.get_status().await.current_hub_address
    } else {
        None
    };

    diagnostics.push(
        "INFO",
        "diagnostics",
        format!(
            "debug_info poll: ws={} peers mdns={} file={} merged={} hub={:?} self={} server={}:{} client_hub={:?} daemon={}",
            snapshot.workstation_id,
            mdns_peers,
            file_peers,
            merged_peers,
            hub_id,
            hub_is_self,
            server_running,
            server_port,
            client_hub_address,
            daemon_available
        ),
    );

    Ok(LocalSyncDebugInfo {
        workstation_id: snapshot.workstation_id,
        friendly_name: snapshot.friendly_name,
        hub_eligible: snapshot.hub_eligible,
        host_ip,
        port,
        is_current_hub_flag: snapshot.is_current_hub,
        daemon_available,
        heartbeat_dir,
        mdns_peers,
        file_peers,
        merged_peers,
        current_hub: hub_id,
        hub_is_self,
        server_running,
        server_port,
        client_hub_address,
    })
}
