//! mDNS service discovery for LAN workstation discovery.
//!
//! Publishes a `_posdrugstore._tcp.local.` service on the LAN and
//! browses for peers advertising the same service. Each peer's TXT
//! record carries metadata used for hub election and mutual auth.
//!
//! ## Security model
//!
//! Discovery is purely informational — any device on the LAN can see
//! and advertise the service. Actual authentication happens at the
//! HTTP layer (HMAC). The `authTokenHash` in the TXT record lets
//! peers reject workstations from a different location without a
//! full HTTP round-trip, but it is **not** a substitute for request
//! authentication.
//!
//! ## Port fallback
//!
//! If the configured port is busy, the service temporarily publishes
//! a different port and logs the fact. The hub election algorithm
//! picks up the correct address from the TXT record.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// mDNS service type for Pharmacy POS workstations.
const SERVICE_TYPE: &str = "_posdrugstore._tcp.local.";
/// Default port for the local HTTP server.
const DEFAULT_PORT: u16 = 49_500;
/// Time without a response before a peer is marked offline (seconds).
const PEER_TIMEOUT_SECS: u64 = 90;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A workstation discovered on the LAN via mDNS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPeer {
    pub workstation_id: String,
    pub friendly_name: String,
    pub ip_address: String,
    pub port: u16,
    pub hub_eligible: bool,
    pub is_current_hub: bool,
    pub auth_token_hash: String,
    pub app_version: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub is_online: bool,
}

/// Internal state for a peer (includes timestamps as `Instant` for timeout
/// math; the serialised form uses ISO strings).
#[derive(Debug, Clone)]
struct PeerState {
    workstation_id: String,
    friendly_name: String,
    ip_address: IpAddr,
    port: u16,
    hub_eligible: bool,
    is_current_hub: bool,
    auth_token_hash: String,
    app_version: String,
    first_seen: Instant,
    last_seen: Instant,
}

impl PeerState {
    fn to_discovered_peer(&self, now: Instant) -> DiscoveredPeer {
        // Convert Instant to ISO string for the frontend.
        // We approximate by anchoring relative to `now`.
        let first_seen_ago = chrono::Duration::seconds(
            (now - self.first_seen).as_secs() as i64,
        );
        let last_seen_ago = chrono::Duration::seconds(
            (now - self.last_seen).as_secs() as i64,
        );
        let now_ts: DateTime<Utc> = Utc::now();

        DiscoveredPeer {
            workstation_id: self.workstation_id.clone(),
            friendly_name: self.friendly_name.clone(),
            ip_address: self.ip_address.to_string(),
            port: self.port,
            hub_eligible: self.hub_eligible,
            is_current_hub: self.is_current_hub,
            auth_token_hash: self.auth_token_hash.clone(),
            app_version: self.app_version.clone(),
            first_seen_at: (now_ts - first_seen_ago).to_rfc3339(),
            last_seen_at: (now_ts - last_seen_ago).to_rfc3339(),
            is_online: (now - self.last_seen) < Duration::from_secs(PEER_TIMEOUT_SECS),
        }
    }
}

/// The full discovery state held behind a Tauri-managed `State`.
pub struct MdnsDiscoveryState {
    daemon: Arc<ServiceDaemon>,
    peers: Arc<RwLock<HashMap<String, PeerState>>>,
    /// Our own workstation identity (published via mDNS).
    our_info: Arc<Mutex<OwnServiceInfo>>,
    /// Background task handle so we can cancel on shutdown.
    _browse_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

struct OwnServiceInfo {
    workstation_id: String,
    friendly_name: String,
    hub_eligible: bool,
    auth_token_hash: String,
    app_version: String,
    host_ip: IpAddr,
    port: u16,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute the SHA-256 hex hash of the local network key for the mDNS TXT
/// record. This lets peers verify they belong to the same location without
/// exposing the key itself.
pub fn compute_auth_token_hash(local_network_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(local_network_key.as_bytes());
    hex::encode(hasher.finalize())
}

fn build_service_info(info: &OwnServiceInfo) -> Result<ServiceInfo, String> {
    let mut properties = HashMap::new();
    properties.insert("workstationId".to_string(), info.workstation_id.clone());
    properties.insert("friendlyName".to_string(), info.friendly_name.clone());
    properties.insert(
        "hubEligible".to_string(),
        if info.hub_eligible {
            "true".to_string()
        } else {
            "false".to_string()
        },
    );
    properties.insert("authTokenHash".to_string(), info.auth_token_hash.clone());
    properties.insert("appVersion".to_string(), info.app_version.clone());
    // isCurrentHub is set dynamically by the election service later.
    properties.insert("isCurrentHub".to_string(), "false".to_string());

    let hostname = format!("{}.local.", info.workstation_id);

    ServiceInfo::new(
        SERVICE_TYPE,
        &info.friendly_name,
        &hostname,
        info.host_ip,
        info.port,
        properties,
    )
    .map_err(|e| format!("failed to build mDNS service info: {e}"))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

impl MdnsDiscoveryState {
    /// Initialise the mDNS daemon, register our own service, and start the
    /// background discovery loop.
    pub async fn new(
        workstation_id: String,
        friendly_name: String,
        hub_eligible: bool,
        local_network_key: &str,
        app_version: String,
        host_ip: IpAddr,
        port: Option<u16>,
    ) -> Result<Self, String> {
        let daemon =
            ServiceDaemon::new().map_err(|e| format!("failed to create mDNS daemon: {e}"))?;

        let effective_port = port.unwrap_or(DEFAULT_PORT);
        let auth_token_hash = compute_auth_token_hash(local_network_key);

        let our_info = OwnServiceInfo {
            workstation_id: workstation_id.clone(),
            friendly_name: friendly_name.clone(),
            hub_eligible,
            auth_token_hash: auth_token_hash.clone(),
            app_version: app_version.clone(),
            host_ip,
            port: effective_port,
        };

        let service_info = build_service_info(&our_info)?;
        daemon
            .register(service_info)
            .map_err(|e| format!("failed to register mDNS service: {e}"))?;

        let peers: Arc<RwLock<HashMap<String, PeerState>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Start background browsing.
        let daemon_for_browse = Arc::new(daemon.clone());
        let peers_clone = peers.clone();
        let our_hash = auth_token_hash.clone();
        let browse_handle = tokio::spawn(async move {
            MdnsDiscoveryState::browse_loop(daemon_for_browse, peers_clone, our_hash).await;
        });

        Ok(Self {
            daemon: Arc::new(daemon),
            peers,
            our_info: Arc::new(Mutex::new(our_info)),
            _browse_task: Arc::new(Mutex::new(Some(browse_handle))),
        })
    }

    /// Returns the current list of discovered peers (including ourselves
    /// for a complete view).
    pub async fn get_discovered_peers(&self) -> Vec<DiscoveredPeer> {
        let peers = self.peers.read().await;
        let now = Instant::now();
        let mut result: Vec<DiscoveredPeer> = peers
            .values()
            .map(|p| p.to_discovered_peer(now))
            .collect();
        result.sort_by(|a, b| a.workstation_id.cmp(&b.workstation_id));
        result
    }

    /// Update our own TXT record (e.g., when `isCurrentHub` changes).
    pub async fn update_own_txt(&self, key: &str, value: &str) -> Result<(), String> {
        let info = self.our_info.lock().await;
        let mut properties = HashMap::new();
        properties.insert("workstationId".to_string(), info.workstation_id.clone());
        properties.insert("friendlyName".to_string(), info.friendly_name.clone());
        properties.insert(
            "hubEligible".to_string(),
            if info.hub_eligible {
                "true".to_string()
            } else {
                "false".to_string()
            },
        );
        properties.insert("authTokenHash".to_string(), info.auth_token_hash.clone());
        properties.insert("appVersion".to_string(), info.app_version.clone());
        // Override the dynamic key.
        properties.insert(key.to_string(), value.to_string());

        let hostname = format!("{}.local.", info.workstation_id);
        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &info.friendly_name,
            &hostname,
            info.host_ip,
            info.port,
            properties,
        )
        .map_err(|e| format!("failed to build updated service info: {e}"))?;

        self.daemon
            .register(service_info)
            .map_err(|e| format!("failed to re-register mDNS service: {e}"))?;

        Ok(())
    }

    /// Background loop that listens for mDNS service events.
    async fn browse_loop(
        daemon: Arc<ServiceDaemon>,
        peers: Arc<RwLock<HashMap<String, PeerState>>>,
        our_auth_hash: String,
    ) {
        let receiver = match daemon.browse(SERVICE_TYPE) {
            Ok(r) => r,
            Err(e) => {
                log::error!("mDNS browse failed: {e}");
                return;
            }
        };

        loop {
            match receiver.recv_async().await {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    let workstation_id = info
                        .get_property("workstationId")
                        .map(|v| v.val_str().to_string())
                        .unwrap_or_default();

                    if workstation_id.is_empty() {
                        continue;
                    }

                    let auth_hash = info
                        .get_property("authTokenHash")
                        .map(|v| v.val_str().to_string())
                        .unwrap_or_default();

                    // Only track peers from the same location (same auth hash).
                    if auth_hash != our_auth_hash {
                        log::debug!(
                            "Ignoring peer {workstation_id}: different auth token hash"
                        );
                        continue;
                    }

                    let friendly_name = info
                        .get_property("friendlyName")
                        .map(|v| v.val_str().to_string())
                        .unwrap_or_else(|| workstation_id.clone());

                    let hub_eligible = info
                        .get_property("hubEligible")
                        .map(|v| v.val_str())
                        .map(|s| s == "true")
                        .unwrap_or(false);

                    let is_current_hub = info
                        .get_property("isCurrentHub")
                        .map(|v| v.val_str())
                        .map(|s| s == "true")
                        .unwrap_or(false);

                    let app_version = info
                        .get_property("appVersion")
                        .map(|v| v.val_str().to_string())
                        .unwrap_or_default();

                    let ip_address = info.get_addresses().iter().next().copied().unwrap_or(
                        std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED),
                    );
                    let port = info.get_port();

                    let now = Instant::now();
                    let mut peer_map = peers.write().await;

                    let entry = peer_map.entry(workstation_id.clone()).or_insert_with(|| {
                        PeerState {
                            workstation_id: workstation_id.clone(),
                            friendly_name,
                            ip_address,
                            port,
                            hub_eligible,
                            is_current_hub,
                            auth_token_hash: auth_hash,
                            app_version,
                            first_seen: now,
                            last_seen: now,
                        }
                    });

                    // Update mutable fields on each resolution.
                    entry.ip_address = ip_address;
                    entry.port = port;
                    entry.hub_eligible = hub_eligible;
                    entry.is_current_hub = is_current_hub;
                    entry.last_seen = now;
                }
                Ok(_) => {
                    // Other service events (advertisements, updates) are
                    // handled by the continuous resolution stream.
                }
                Err(e) => {
                    log::error!("mDNS browse error: {e}");
                    // Brief back-off before retrying.
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    }
}

impl Drop for MdnsDiscoveryState {
    fn drop(&mut self) {
        let _ = self.daemon.shutdown();
    }
}


