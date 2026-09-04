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
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};

use crate::local_sync_diagnostics::push_global;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// mDNS service type for Pharmacy POS workstations.
const SERVICE_TYPE: &str = "_posdrugstore._tcp.local.";
/// Default port for the local HTTP server.
const DEFAULT_PORT: u16 = 49_500;
/// Time without a response before a peer is marked offline (seconds).
const PEER_TIMEOUT_SECS: u64 = 90;
/// File heartbeat interval for same-machine multi-instance discovery.
/// 1s for fast convergence in same-PC tests (was 5s, caused 10s split-brain).
const FILE_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
/// Directory (inside app_local_data_dir/local-sync) for file heartbeats.
const FILE_HEARTBEAT_SUBDIR: &str = "local-sync/heartbeats";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A workstation discovered on the LAN via mDNS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
            first_seen_at: (now_ts - first_seen_ago)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            last_seen_at: (now_ts - last_seen_ago)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            is_online: (now - self.last_seen) < Duration::from_secs(PEER_TIMEOUT_SECS),
        }
    }
}

/// The full discovery state held behind a Tauri-managed `State`.
pub struct MdnsDiscoveryState {
    daemon: Option<Arc<ServiceDaemon>>,
    peers: Arc<RwLock<HashMap<String, PeerState>>>,
    /// File-based peers for same-machine multi-instance fallback (when mDNS
    /// is blocked by firewall or two processes contend on 5353).
    file_peers: Arc<RwLock<HashMap<String, PeerState>>>,
    /// Directory for file heartbeats (None when AppHandle not available).
    heartbeat_dir: Option<PathBuf>,
    /// Whether we currently advertise as hub (mirrored in file heartbeats).
    own_is_current_hub: Arc<Mutex<bool>>,
    /// Our own workstation identity (published via mDNS).
    our_info: Arc<Mutex<OwnServiceInfo>>,
    /// Background task handles so we can cancel on shutdown.
    _browse_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    _file_heartbeat_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
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

/// Best-effort detection of an address usable for LAN announcements.
///
/// The frontend defaults `host_ip` to 127.0.0.1 (or an empty value) when
/// `VITE_HOST_IP` is not configured. Advertising loopback over mDNS makes
/// every peer resolve the hub to *its own* loopback, so cross-workstation
/// sync silently fails. A UDP `connect` performs a routing-table lookup
/// without emitting any packet, which yields the interface address a real
/// connection would use — it works offline as long as a default route to
/// the LAN exists. When detection is impossible (no route at all) the
/// caller-provided address is kept unchanged.
pub async fn resolve_advertisable_ip(reported: IpAddr) -> IpAddr {
    if !reported.is_loopback() && !reported.is_unspecified() {
        return reported;
    }

    let bind_addr: &str = if reported.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" };
    let detected = async {
        let socket = tokio::net::UdpSocket::bind(bind_addr).await.ok()?;
        socket.connect("8.8.8.8:80").await.ok()?;
        socket.local_addr().ok().map(|addr| addr.ip())
    }
    .await;

    match detected {
        Some(ip) if !ip.is_loopback() && !ip.is_unspecified() => {
            log::info!("Detected LAN address {ip} for mDNS announcement");
            ip
        }
        _ => {
            log::warn!(
                "Could not detect a LAN address; falling back to {reported}. \
                 Configure VITE_HOST_IP so peers can reach this workstation."
            );
            reported
        }
    }
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
        Self::new_with_dir(
            workstation_id,
            friendly_name,
            hub_eligible,
            local_network_key,
            app_version,
            host_ip,
            port,
            None,
        )
        .await
    }

    /// Internal constructor that also takes an optional app-data dir for the
    /// file-based heartbeat fallback used by same-PC multi-instance tests.
    pub async fn new_with_dir(
        workstation_id: String,
        friendly_name: String,
        hub_eligible: bool,
        local_network_key: &str,
        app_version: String,
        host_ip: IpAddr,
        port: Option<u16>,
        app_data_dir: Option<PathBuf>,
    ) -> Result<Self, String> {
        push_global(
            "INFO",
            "mdns_discovery",
            format!(
                "new_with_dir ws={} friendly={} eligible={} ip={} port={:?} hb_dir={:?}",
                workstation_id, friendly_name, hub_eligible, host_ip, port, app_data_dir
            ),
        );
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

        // Try to create the mDNS daemon, but do not fail the whole
        // initialisation if the second instance on the same PC cannot bind
        // to 5353 — file heartbeats still let the two windows discover each
        // other and the solo-hub fallback keeps one hub alive.
        let daemon: Option<Arc<ServiceDaemon>> = match ServiceDaemon::new() {
            Ok(d) => {
                let service_info = build_service_info(&our_info)?;
                d.register(service_info)
                    .map_err(|e| format!("failed to register mDNS service: {e}"))?;
                push_global(
                    "INFO",
                    "mdns_discovery",
                    format!("mDNS daemon registered on {}:{}", host_ip, effective_port),
                );
                Some(Arc::new(d))
            }
            Err(e) => {
                let msg = format!(
                    "mDNS daemon unavailable ({}). Falling back to file heartbeats",
                    e
                );
                log::warn!("{}", msg);
                push_global("WARN", "mdns_discovery", msg);
                None
            }
        };

        let peers: Arc<RwLock<HashMap<String, PeerState>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let file_peers: Arc<RwLock<HashMap<String, PeerState>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let heartbeat_dir = app_data_dir.map(|p| p.join(FILE_HEARTBEAT_SUBDIR));
        let own_is_current_hub = Arc::new(Mutex::new(false));

        // Start background mDNS browsing if we have a daemon.
        let browse_handle = if let Some(ref d) = daemon {
            let daemon_for_browse = d.clone();
            let peers_clone = peers.clone();
            let our_hash = auth_token_hash.clone();
            Some(tokio::spawn(async move {
                MdnsDiscoveryState::browse_loop(daemon_for_browse, peers_clone, our_hash).await;
            }))
        } else {
            None
        };

        // Shared identity for both the main state and the file heartbeat writer.
        let our_info_arc = Arc::new(Mutex::new(our_info));

        // File-based heartbeat for same-machine instances.
        let file_heartbeat_task = if let Some(ref dir) = heartbeat_dir {
            let dir_clone = dir.clone();
            let ws_id = workstation_id.clone();
            let f_name = friendly_name.clone();
            let is_hub_flag = own_is_current_hub.clone();
            let our_info_clone = our_info_arc.clone();
            let file_peers_clone = file_peers.clone();
            let auth_hash_clone = auth_token_hash.clone();
            let ver_clone = app_version.clone();
            Some(tokio::spawn(async move {
                Self::file_heartbeat_loop(
                    dir_clone,
                    ws_id,
                    f_name,
                    our_info_clone,
                    is_hub_flag,
                    file_peers_clone,
                    auth_hash_clone,
                    ver_clone,
                )
                .await;
            }))
        } else {
            None
        };

        Ok(Self {
            daemon,
            peers,
            file_peers,
            heartbeat_dir,
            own_is_current_hub,
            our_info: our_info_arc,
            _browse_task: Arc::new(Mutex::new(browse_handle)),
            _file_heartbeat_task: Arc::new(Mutex::new(file_heartbeat_task)),
        })
    }

    /// Returns the current list of discovered peers (including ourselves
    /// for a complete view). Merges mDNS peers with file-based heartbeats so
    /// two windows on the same PC discover each other even when the OS
    /// firewall blocks multicast or the second daemon cannot bind to 5353.
    pub async fn get_discovered_peers(&self) -> Vec<DiscoveredPeer> {
        let now = Instant::now();
        let mdns_peers = self.peers.read().await;
        let file_peers = self.file_peers.read().await;

        // Merge, file peers win on newer last_seen.
        let mut merged: HashMap<String, PeerState> = HashMap::new();
        for (id, state) in mdns_peers.iter() {
            merged.insert(id.clone(), state.clone());
        }
        for (id, state) in file_peers.iter() {
            merged
                .entry(id.clone())
                .and_modify(|existing| {
                    if state.last_seen > existing.last_seen {
                        *existing = state.clone();
                    }
                })
                .or_insert_with(|| state.clone());
        }

        let mut result: Vec<DiscoveredPeer> = merged
            .values()
            .map(|p| p.to_discovered_peer(now))
            .collect();
        result.sort_by(|a, b| a.workstation_id.cmp(&b.workstation_id));
        for peer in &result {
            push_global(
                "INFO",
                "mdns_discovery",
                format!(
                    "peer {} is_online={} lastSeenAt={} is_hub={} port={}",
                    peer.workstation_id, peer.is_online, peer.last_seen_at, peer.is_current_hub, peer.port
                ),
            );
        }
        push_global(
            "INFO",
            "mdns_discovery",
            format!(
                "get_discovered_peers mdns={} file={} merged={}",
                mdns_peers.len(),
                file_peers.len(),
                result.len()
            ),
        );
        result
    }

    pub async fn mdns_peer_count(&self) -> usize {
        self.peers.read().await.len()
    }

    pub async fn file_peer_count(&self) -> usize {
        self.file_peers.read().await.len()
    }

    pub async fn is_daemon_available(&self) -> bool {
        self.daemon.is_some()
    }

    pub async fn heartbeat_dir_string(&self) -> Option<String> {
        self.heartbeat_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
    }

    pub async fn host_ip_string(&self) -> String {
        self.our_info.lock().await.host_ip.to_string()
    }

    pub async fn port_value(&self) -> u16 {
        self.our_info.lock().await.port
    }

    pub async fn workstation_id(&self) -> String {
        self.our_info.lock().await.workstation_id.clone()
    }

    /// Reconfigure an existing discovery state without recreating the
    /// daemon or file heartbeat tasks. Used to make `initialize_local_sync`
    /// idempotent when React StrictMode mounts the initializer twice.
    pub async fn reconfigure(
        &self,
        workstation_id: String,
        friendly_name: String,
        hub_eligible: bool,
        local_network_key: &str,
        host_ip: IpAddr,
        port: Option<u16>,
    ) -> Result<(), String> {
        let mut info = self.our_info.lock().await;
        info.workstation_id = workstation_id;
        info.friendly_name = friendly_name;
        info.hub_eligible = hub_eligible;
        info.auth_token_hash = compute_auth_token_hash(local_network_key);
        info.host_ip = host_ip;
        if let Some(p) = port {
            info.port = p;
        }
        drop(info);
        push_global(
            "INFO",
            "mdns_discovery",
            "reconfigure: updated existing discovery state".to_string(),
        );
        Ok(())
    }

    /// Update the port we advertise when the HTTP server fell back to an
    /// adjacent port because the preferred one was busy (two instances on one
    /// host during multi-window dev). The peer's pull address comes straight
    /// from this TXT record, so a stale port makes the hub unreachable.
    pub async fn update_port(&self, new_port: u16) -> Result<(), String> {
        let mut info = self.our_info.lock().await;
        if info.port == new_port {
            return Ok(());
        }
        info.port = new_port;
        let workstation_id = info.workstation_id.clone();
        let friendly_name = info.friendly_name.clone();
        let hub_eligible = info.hub_eligible;
        let auth_token_hash = info.auth_token_hash.clone();
        let app_version = info.app_version.clone();
        let host_ip = info.host_ip;
        drop(info);

        let is_current = *self.own_is_current_hub.lock().await;
        let mut properties = HashMap::new();
        properties.insert("workstationId".to_string(), workstation_id.clone());
        properties.insert("friendlyName".to_string(), friendly_name.clone());
        properties.insert(
            "hubEligible".to_string(),
            if hub_eligible {
                "true".to_string()
            } else {
                "false".to_string()
            },
        );
        properties.insert("authTokenHash".to_string(), auth_token_hash);
        properties.insert("appVersion".to_string(), app_version);
        properties.insert(
            "isCurrentHub".to_string(),
            if is_current { "true" } else { "false" }.to_string(),
        );

        let hostname = format!("{workstation_id}.local.");
        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &friendly_name,
            &hostname,
            host_ip,
            new_port,
            properties,
        )
        .map_err(|e| format!("failed to build service info for new port: {e}"))?;

        if let Some(ref daemon) = self.daemon {
            daemon
                .register(service_info)
                .map_err(|e| format!("failed to re-register mDNS service on new port: {e}"))?;
            log::info!("mDNS re-registered on fallback port {new_port}");
        } else {
            log::info!("Updated advertised port to {new_port} (file heartbeat only, mDNS unavailable)");
        }
        Ok(())
    }

    /// Update our own TXT record (e.g., when `isCurrentHub` changes).
    pub async fn update_own_txt(&self, key: &str, value: &str) -> Result<(), String> {
        if key == "isCurrentHub" {
            let mut flag = self.own_is_current_hub.lock().await;
            *flag = value == "true";
        }
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

        if let Some(ref daemon) = self.daemon {
            daemon
                .register(service_info)
                .map_err(|e| format!("failed to re-register mDNS service: {e}"))?;
        } else {
            log::debug!("Skipped mDNS re-register for {key}={value} (daemon unavailable, file heartbeat will carry it)");
        }

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
                    let msg = format!("mDNS browse error: {e} (channel closed, file heartbeat will keep same-PC discovery alive)");
                    log::warn!("{}", msg);
                    push_global("WARN", "mdns_discovery", msg);
                    // Don't spin on a dead channel — the daemon was likely dropped
                    // during reconfigure (StrictMode double-mount). File heartbeat
                    // covers same-PC, and the next `new_with_dir` will spawn a fresh
                    // browse_loop. Just exit this task.
                    return;
                }
            }
        }
    }

    /// File-based heartbeat loop for same-PC multi-instance discovery.
    ///
    /// Each window writes its own `heartbeat-<workstationId>.json` every
    /// 5 s and scans the shared directory for other heartbeats. This lets two
    /// `cargo tauri dev` windows on one machine see each other even when the
    /// OS firewall blocks mDNS multicast or the second daemon cannot bind to
    /// 5353. The file format mirrors the mDNS TXT record so the election
    /// algorithm treats both sources identically.
    async fn file_heartbeat_loop(
        dir: PathBuf,
        workstation_id: String,
        friendly_name: String,
        our_info: Arc<Mutex<OwnServiceInfo>>,
        is_current_hub: Arc<Mutex<bool>>,
        file_peers: Arc<RwLock<HashMap<String, PeerState>>>,
        auth_token_hash: String,
        app_version: String,
    ) {
        let _ = tokio::fs::create_dir_all(&dir).await;
        log::info!("File heartbeat active at {:?} for {}", dir, workstation_id);
        let own_path = dir.join(format!("heartbeat-{}.json", workstation_id));

        loop {
            // Build payload from current identity (IP/port may change after
            // LAN detection or when the hub server falls back to another port).
            let info = our_info.lock().await;
            let port = info.port;
            let hub_eligible = info.hub_eligible;
            let host_ip = info.host_ip;
            drop(info);
            let is_hub = *is_current_hub.lock().await;

            let payload = serde_json::json!({
                "workstationId": workstation_id,
                "friendlyName": friendly_name,
                "ipAddress": host_ip.to_string(),
                "port": port,
                "hubEligible": hub_eligible,
                "isCurrentHub": is_hub,
                "authTokenHash": auth_token_hash,
                "appVersion": app_version,
                "lastSeenAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            });

            if let Ok(text) = serde_json::to_string(&payload) {
                let _ = tokio::fs::write(&own_path, text).await;
            }

            push_global(
                "INFO",
                "file_heartbeat",
                format!("tick write {} port={} is_hub={}", workstation_id, port, is_hub),
            );
            // Scan for other heartbeats.
            let mut scanned: HashMap<String, PeerState> = HashMap::new();
            let mut files_seen: Vec<String> = Vec::new();
            if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    files_seen.push(path.to_string_lossy().to_string());
                    if path == own_path {
                        continue;
                    }
                    if path.extension().and_then(|s| s.to_str()) != Some("json") {
                        continue;
                    }
                    let Ok(content) = tokio::fs::read_to_string(&path).await else {
                        continue;
                    };
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
                        continue;
                    };
                    let ws_id = value
                        .get("workstationId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if ws_id.is_empty() {
                        push_global("WARN", "file_heartbeat", format!("skip {}: empty workstationId", path.display()));
                        continue;
                    }
                    if ws_id == workstation_id {
                        // own file, already skipped via path check, but keep for safety
                        continue;
                    }
                    let hash = value
                        .get("authTokenHash")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    // Same-machine file heartbeats are implicitly same
                    // location — do not filter by hash. A race on first
                    // key generation would otherwise make two windows
                    // mutually invisible forever.
                    let last_seen_str = value
                        .get("lastSeenAt")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let Ok(last_seen_dt) = last_seen_str.parse::<DateTime<Utc>>() else {
                        push_global(
                            "WARN",
                            "file_heartbeat",
                            format!("skip {}: bad lastSeenAt {:?}", path.display(), last_seen_str),
                        );
                        continue;
                    };
                    let age = Utc::now() - last_seen_dt;
                    if age.num_seconds() > PEER_TIMEOUT_SECS as i64 {
                        push_global(
                            "INFO",
                            "file_heartbeat",
                            format!("prune stale {} age {}s", path.display(), age.num_seconds()),
                        );
                        let _ = tokio::fs::remove_file(&path).await;
                        continue;
                    }
                    if age.num_seconds() < -5 {
                        push_global(
                            "WARN",
                            "file_heartbeat",
                            format!("future timestamp {} age {}s", path.display(), age.num_seconds()),
                        );
                    }
                    let friendly = value
                        .get("friendlyName")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&ws_id)
                        .to_string();
                    let ip_str = value
                        .get("ipAddress")
                        .and_then(|v| v.as_str())
                        .unwrap_or("127.0.0.1");
                    let ip: IpAddr = ip_str.parse().unwrap_or(IpAddr::V4(
                        std::net::Ipv4Addr::new(127, 0, 0, 1),
                    ));
                    let port_val = value
                        .get("port")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(DEFAULT_PORT as u64)
                        as u16;
                    let hub_elig = value
                        .get("hubEligible")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let is_cur = value
                        .get("isCurrentHub")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let app_ver = value
                        .get("appVersion")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0.1.0")
                        .to_string();

                    let age_secs = age.num_seconds().max(0) as u64;
                    scanned.insert(
                        ws_id.clone(),
                        PeerState {
                            workstation_id: ws_id.clone(),
                            friendly_name: friendly.clone(),
                            ip_address: ip,
                            port: port_val,
                            hub_eligible: hub_elig,
                            is_current_hub: is_cur,
                            auth_token_hash: hash.clone(),
                            app_version: app_ver.clone(),
                            first_seen: Instant::now()
                                - Duration::from_secs(age_secs),
                            last_seen: Instant::now(),
                        },
                    );
                    push_global(
                        "INFO",
                        "file_heartbeat",
                        format!(
                            "found peer {} {}:{} eligible={} is_hub={} age={}s",
                            ws_id, ip, port_val, hub_elig, is_cur, age.num_seconds()
                        ),
                    );
                }
                push_global(
                    "INFO",
                    "file_heartbeat",
                    format!(
                        "scan dir={:?} files_seen={:?} peers_found={}",
                        dir, files_seen, scanned.len()
                    ),
                );
            } else {
                push_global(
                    "WARN",
                    "file_heartbeat",
                    format!("read_dir failed for {:?}", dir),
                );
            }

            let scanned_len = scanned.len();
            {
                let mut guard = file_peers.write().await;
                *guard = scanned;
            }
            push_global(
                "INFO",
                "file_heartbeat",
                format!("tick done file_peers={} merged will be computed on next get_discovered_peers", scanned_len),
            );

            tokio::time::sleep(FILE_HEARTBEAT_INTERVAL).await;
        }
    }
}

impl Drop for MdnsDiscoveryState {
    fn drop(&mut self) {
        if let Some(ref daemon) = self.daemon {
            let _ = daemon.shutdown();
        }
        // Abort background tasks that would otherwise keep writing the same
        // heartbeat file with stale `isCurrentHub` after re-initialisation.
        if let Ok(mut guard) = self._browse_task.try_lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }
        if let Ok(mut guard) = self._file_heartbeat_task.try_lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }
    }
}


