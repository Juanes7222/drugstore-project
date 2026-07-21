//! Tauri command handlers for local network sync.
//!
//! These commands bridge the TypeScript UI layer to the Rust local sync,
//! discovery, election, and HTTP server modules.
//!
//! Modules that require configuration (mDNS, server, client) are managed
//! lazily via `LocalSyncModules`. The TypeScript side calls
//! `initialize_local_sync` after loading workstation config.

use std::net::IpAddr;
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::hub_election::{HubInfo, HubScore, HubElectionState};
use crate::LocalSyncModules;
use crate::local_sync_client::{LocalSyncStatus, LocalSyncClientState};
use crate::local_sync_server::{
    ConflictInfo, LocalSyncServerState, LocalOperation, PushResponse, PullResponse,
};
use crate::mdns_discovery::{DiscoveredPeer, MdnsDiscoveryState};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve the mDNS state from the lazy modules container.
/// Returns an error string if not initialised.
async fn resolve_mdns(
    modules: &Mutex<Option<Arc<MdnsDiscoveryState>>>,
) -> Result<Arc<MdnsDiscoveryState>, String> {
    let guard = modules.lock().await;
    guard
        .clone()
        .ok_or_else(|| "Local sync not initialised".to_string())
}

/// Resolve the server state from the lazy modules container.
async fn resolve_server(
    modules: &Mutex<Option<Arc<LocalSyncServerState>>>,
) -> Result<Arc<LocalSyncServerState>, String> {
    let guard = modules.lock().await;
    guard
        .clone()
        .ok_or_else(|| "Local sync not initialised".to_string())
}

/// Resolve the client state from the lazy modules container.
async fn resolve_client(
    modules: &Mutex<Option<Arc<LocalSyncClientState>>>,
) -> Result<Arc<LocalSyncClientState>, String> {
    let guard = modules.lock().await;
    guard
        .clone()
        .ok_or_else(|| "Local sync not initialised".to_string())
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/// Initialise all local sync modules with real configuration.
///
/// Called once by the TypeScript side after loading workstation config
/// from the local database. Idempotent — replaces any existing state.
#[tauri::command]
pub async fn initialize_local_sync(
    app_handle: AppHandle,
    workstation_id: String,
    friendly_name: String,
    hub_eligible: bool,
    local_network_key: String,
    host_ip: String,
    port: Option<u16>,
) -> Result<(), String> {
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let ip: IpAddr = host_ip
        .parse()
        .map_err(|e| format!("invalid host_ip '{host_ip}': {e}"))?;

    // Create all three modules.
    let mdns_state = MdnsDiscoveryState::new(
        workstation_id.clone(),
        friendly_name.clone(),
        hub_eligible,
        &local_network_key,
        app_version.clone(),
        ip,
        port,
    )
    .await
    .map_err(|e| format!("mDNS init failed: {e}"))?;
    let mdns = Arc::new(mdns_state);

    let server = Arc::new(LocalSyncServerState::new(
        local_network_key.clone(),
        port.unwrap_or(49_500),
    ));

    let client = Arc::new(LocalSyncClientState::new(
        local_network_key,
        workstation_id.clone(),
        friendly_name.clone(),
    ));

    // Update the lazy modules.
    let modules = app_handle.state::<LocalSyncModules>();
    {
        let mut guard = modules.mdns.lock().await;
        *guard = Some(mdns);
    }
    {
        let mut guard = modules.server.lock().await;
        *guard = Some(server);
    }
    {
        let mut guard = modules.client.lock().await;
        *guard = Some(client);
    }

    // Update the election state with real ID / name.
    let election = app_handle.state::<HubElectionState>();
    election
        .reconfigure(workstation_id, friendly_name, hub_eligible)
        .await;

    log::info!("Local sync initialised");
    Ok(())
}

// ---------------------------------------------------------------------------
// mDNS discovery
// ---------------------------------------------------------------------------

/// Returns the current list of discovered LAN workstations.
#[tauri::command]
pub async fn get_discovered_peers(
    app_handle: AppHandle,
) -> Result<Vec<DiscoveredPeer>, String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let mdns = resolve_mdns(&modules.mdns).await?;
    Ok(mdns.get_discovered_peers().await)
}

/// Triggers an immediate mDNS re-scan and returns updated peer list.
#[tauri::command]
pub async fn force_rediscovery(
    app_handle: AppHandle,
) -> Result<Vec<DiscoveredPeer>, String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let mdns = resolve_mdns(&modules.mdns).await?;
    // mDNS browsing is continuous; re-reading gives latest data.
    Ok(mdns.get_discovered_peers().await)
}

// ---------------------------------------------------------------------------
// Local sync server (hub)
// ---------------------------------------------------------------------------

/// Start the local HTTP server (only takes effect on the elected hub).
///
/// Passes the Arc to the Axum router so handlers and Tauri commands
/// share the same state (operation log, conflicts, peer heartbeats).
#[tauri::command]
pub async fn start_hub_server(
    app_handle: AppHandle,
) -> Result<(), String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let server = resolve_server(&modules.server).await?;
    LocalSyncServerState::start_shared(server, app_handle).await
}

/// Stop the local HTTP server.
#[tauri::command]
pub async fn stop_hub_server(
    app_handle: AppHandle,
) -> Result<(), String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let server = resolve_server(&modules.server).await?;
    server.stop().await
}

// ---------------------------------------------------------------------------
// Hub election
// ---------------------------------------------------------------------------

/// Force a specific workstation as hub. Pass `null` to clear override.
#[tauri::command]
pub async fn set_hub_override(
    app_handle: AppHandle,
    workstation_id: Option<String>,
) -> Result<(), String> {
    let state = app_handle.state::<HubElectionState>();
    state.set_hub_override(workstation_id).await;
    Ok(())
}

/// Get the currently elected hub (runs election if needed).
#[tauri::command]
pub async fn get_current_hub(
    app_handle: AppHandle,
) -> Result<Option<HubInfo>, String> {
    let election_state = app_handle.state::<HubElectionState>();
    let modules = app_handle.state::<LocalSyncModules>();
    let mdns = resolve_mdns(&modules.mdns).await?;
    Ok(election_state.run_election(&mdns).await)
}

/// Get hub scores for all peers (for the election info UI).
#[tauri::command]
pub async fn get_hub_scores(
    app_handle: AppHandle,
) -> Result<Vec<HubScore>, String> {
    let election_state = app_handle.state::<HubElectionState>();
    let modules = app_handle.state::<LocalSyncModules>();
    let mdns = resolve_mdns(&modules.mdns).await?;
    Ok(election_state.compute_all_scores(&mdns).await)
}

// ---------------------------------------------------------------------------
// Local sync client
// ---------------------------------------------------------------------------

/// Trigger an immediate local push + pull cycle.
#[tauri::command]
pub async fn force_local_sync(
    app_handle: AppHandle,
) -> Result<(), String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let client = resolve_client(&modules.client).await?;

    let hub_address = {
        let status = client.get_status().await;
        status.current_hub_address
    };

    let address = hub_address.ok_or_else(|| "No hub available".to_string())?;

    // Push pending operations.
    let push_result = client.push_operations(vec![], &address).await;
    match &push_result {
        Ok(r) => log::info!("Force sync push: {} accepted, {} rejected", r.accepted, r.rejected),
        Err(e) => log::error!("Force sync push failed: {e}"),
    }

    // Pull pending operations.
    let pull_result = client.pull_operations(&address).await;
    match &pull_result {
        Ok(r) => log::info!("Force sync pull: {} operations received", r.operations.len()),
        Err(e) => log::error!("Force sync pull failed: {e}"),
    }

    // Return success if either push or pull succeeded.
    if push_result.is_ok() || pull_result.is_ok() {
        Ok(())
    } else {
        Err(format!(
            "Push: {:?}, Pull: {:?}",
            push_result.err(),
            pull_result.err()
        ))
    }
}

/// Get the current local sync status.
#[tauri::command]
pub async fn get_local_sync_status(
    app_handle: AppHandle,
) -> Result<LocalSyncStatus, String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let client = resolve_client(&modules.client).await?;
    Ok(client.get_status().await)
}

/// Push operations to the current hub.
#[tauri::command]
pub async fn push_to_hub(
    app_handle: AppHandle,
    operations: Vec<LocalOperation>,
) -> Result<PushResponse, String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let client = resolve_client(&modules.client).await?;
    let status = client.get_status().await;
    let address = status
        .current_hub_address
        .ok_or_else(|| "No hub available".to_string())?;
    client.push_operations(operations, &address).await
}

/// Pull operations from the current hub.
#[tauri::command]
pub async fn pull_from_hub(
    app_handle: AppHandle,
) -> Result<PullResponse, String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let client = resolve_client(&modules.client).await?;
    let status = client.get_status().await;
    let address = status
        .current_hub_address
        .ok_or_else(|| "No hub available".to_string())?;
    client.pull_operations(&address).await
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/// Get list of conflicts recorded on this hub.
#[tauri::command]
pub async fn get_hub_conflicts(
    app_handle: AppHandle,
) -> Result<Vec<ConflictInfo>, String> {
    let modules = app_handle.state::<LocalSyncModules>();
    let server = resolve_server(&modules.server).await?;
    Ok(server.get_conflicts().await)
}

// ---------------------------------------------------------------------------
// Local network management
// ---------------------------------------------------------------------------

/// Enable or disable the local network discovery and sync.
#[tauri::command]
pub async fn set_local_sync_enabled(
    app_handle: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let modules = app_handle.state::<LocalSyncModules>();

    if enabled {
        // Re-enable: update mDNS TXT to mark as eligible.
        let mdns = resolve_mdns(&modules.mdns).await?;
        mdns.update_own_txt("hubEligible", "true").await.ok();
    } else {
        // Disable: mark as ineligible and stop the server.
        let mdns_opt = modules.mdns.lock().await.clone();
        if let Some(mdns) = mdns_opt {
            mdns.update_own_txt("hubEligible", "false").await.ok();
        }
        let server_opt = modules.server.lock().await.clone();
        if let Some(server) = server_opt {
            server.stop().await.ok();
        }
    }

    Ok(())
}
