//! Hub role supervisor.
//!
//! Background task that closes the loop between hub election and the LAN
//! HTTP server: periodically re-runs the election and starts the local
//! sync server when this workstation is the elected hub, or stops it when
//! the role moves to another workstation.
//!
//! This deliberately lives in Rust (not in a React effect) so the hub keeps
//! working no matter which screen is open in the webview — the previous
//! design only ran the election while the local-network page was mounted,
//! and nothing ever called `start_hub_server`, so no workstation ever
//! became a reachable hub.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::hub_election::HubElectionState;
use crate::LocalSyncModules;

/// How often the supervisor re-evaluates the hub role.
///
/// Matches the UI polling cadence (5 s) so role changes propagate within
/// one tick on every workstation.
const SUPERVISOR_TICK: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

/// Supervisor runtime state managed by Tauri.
pub struct HubSupervisorState {
    /// Master switch mirrored from the UI enable/disable action. While
    /// false the loop actively demotes this workstation (stops the server)
    /// instead of promoting it.
    enabled: AtomicBool,
    /// Handle to the running loop so re-initialisation can replace it.
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl HubSupervisorState {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            task: Mutex::new(None),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
}

impl Default for HubSupervisorState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/// (Re)start the supervisor loop.
///
/// Called from `initialize_local_sync` once the lazy modules exist. Any
/// previously spawned loop is aborted first so a re-initialisation (new
/// workstation config) replaces the old supervision targets cleanly.
pub async fn spawn(app: AppHandle) {
    let supervisor = app.state::<HubSupervisorState>();
    let mut task_guard = supervisor.task.lock().await;

    if let Some(previous) = task_guard.take() {
        previous.abort();
    }

    supervisor.set_enabled(true);

    *task_guard = Some(tauri::async_runtime::spawn(supervise(app.clone())));
    log::info!("Hub supervisor started");
}

/// Stop supervising and drop the hub role.
///
/// Used when the operator disables the local network: the loop halts and
/// the server is stopped immediately rather than waiting for the next tick.
pub async fn shutdown(app: AppHandle) {
    let supervisor = app.state::<HubSupervisorState>();
    supervisor.set_enabled(false);

    let mut task_guard = supervisor.task.lock().await;
    if let Some(handle) = task_guard.take() {
        handle.abort();
    }

    if let Err(e) = demote(&app).await {
        log::warn!("Hub supervisor shutdown demote failed: {e}");
    }
    log::info!("Hub supervisor stopped");
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

async fn supervise(app: AppHandle) {
    // First tick is deferred one interval so mDNS registration and the
    // initial peer discovery sweep have time to settle before the very
    // first election runs.
    loop {
        tokio::time::sleep(SUPERVISOR_TICK).await;

        // The loop must survive individual tick failures: a transient mDNS
        // or state error is logged and retried on the next tick.
        if let Err(e) = tick(&app).await {
            log::debug!("Hub supervisor tick skipped: {e}");
        }
    }
}

/// One supervision pass: re-elect, reconcile actual server state with the
/// election outcome, and point the sync client at the elected hub.
async fn tick(app: &AppHandle) -> Result<(), String> {
    if !app.state::<HubSupervisorState>().is_enabled() {
        demote(app).await?;
        return Ok(());
    }

    let modules = app.state::<LocalSyncModules>();
    let mdns = modules
        .mdns
        .lock()
        .await
        .clone()
        .ok_or_else(|| "local sync not initialised".to_string())?;
    let server = modules
        .server
        .lock()
        .await
        .clone()
        .ok_or_else(|| "local sync not initialised".to_string())?;
    let client = modules
        .client
        .lock()
        .await
        .clone()
        .ok_or_else(|| "local sync not initialised".to_string())?;

    let election = app.state::<HubElectionState>();
    let hub = election.run_election(&mdns).await;

    let we_are_hub = matches!(&hub, Some(info) if info.is_self)
        && election.our_hub_eligible().await;

    // Keep the sync client pointed at whoever the election chose. When we
    // are the hub there is nothing to dial — our operations are already in
    // our own queue and peers pull them from us.
    match &hub {
        Some(info) if !info.is_self => {
            let address = format!("{}:{}", info.ip_address, info.port);
            let changed = client_needs_retarget(&client, &info.workstation_id, &address).await;
            if changed {
                log::info!(
                    "Local sync following hub '{}' at {address}",
                    info.workstation_id
                );
                client.set_hub(info.workstation_id.clone(), address.clone()).await;
            }
            send_heartbeat(&client, &address).await;
        }
        _ => {
            client.clear_hub().await;
        }
    }

    let server_running = server.is_running().await;

    match (we_are_hub, server_running) {
        (true, false) => promote(app, &server, &mdns).await?,
        (false, true) => demote(app).await?,
        // Already in the desired state — nothing to do.
        _ => {}
    }

    Ok(())
}

/// Avoid re-setting an unchanged hub target every tick (each set resets the
/// failure counter and would mask real connectivity problems).
async fn client_needs_retarget(
    client: &Arc<crate::local_sync_client::LocalSyncClientState>,
    hub_id: &str,
    address: &str,
) -> bool {
    let status = client.get_status().await;
    status.current_hub_id.as_deref() != Some(hub_id)
        || status.current_hub_address.as_deref() != Some(address)
}

/// Best-effort heartbeat so the hub's peer table stays fresh. Failures are
/// logged at debug level — the next push cycle surfaces real problems.
async fn send_heartbeat(
    client: &Arc<crate::local_sync_client::LocalSyncClientState>,
    address: &str,
) {
    if let Err(e) = client.send_heartbeat(address, 0).await {
        log::debug!("Heartbeat to hub {address} failed: {e}");
    }
}

/// Start the LAN server and advertise hub ownership to peers.
async fn promote(
    app: &AppHandle,
    server: &Arc<crate::local_sync_server::LocalSyncServerState>,
    mdns: &Arc<crate::mdns_discovery::MdnsDiscoveryState>,
) -> Result<(), String> {
    log::info!("Elected as hub — starting LAN sync server");

    server
        .clone()
        .start_shared(app.clone())
        .await
        .map_err(|e| format!("failed to start hub server: {e}"))?;

    if let Err(e) = mdns.update_own_txt("isCurrentHub", "true").await {
        // Peers fall back to election convergence if the TXT update fails;
        // not fatal for the hub itself.
        log::warn!("Failed to advertise isCurrentHub=true: {e}");
    }

    Ok(())
}

/// Stop the LAN server and clear the hub advertisement.
async fn demote(app: &AppHandle) -> Result<(), String> {
    let modules = app.state::<LocalSyncModules>();

    if let Some(server) = modules.server.lock().await.clone() {
        if server.is_running().await {
            log::info!("No longer hub — stopping LAN sync server");
            server.stop().await.map_err(|e| format!("failed to stop hub server: {e}"))?;
        }
    }

    if let Some(mdns) = modules.mdns.lock().await.clone() {
        if let Err(e) = mdns.update_own_txt("isCurrentHub", "false").await {
            log::warn!("Failed to advertise isCurrentHub=false: {e}");
        }
    }

    Ok(())
}
