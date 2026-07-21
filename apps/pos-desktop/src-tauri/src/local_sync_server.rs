//! Local HTTP server (hub role) for LAN sync between workstations.
//!
//! Runs only on the elected hub workstation. Provides REST endpoints for
//! peers to push/pull operations and exchange heartbeats.
//!
//! ## Security
//!
//! All endpoints (except `/local-sync/health`) require the
//! `X-Local-Auth` header containing an HMAC-SHA256 of the request body
//! signed with the location's local network key.
//!
//! The server uses **plain HTTP**, not HTTPS. TLS would add significant
//! complexity (certificate distribution, trust chain management) without
//! proportional security benefit in a LAN-only context where the HMAC
//! already authenticates every request. An attacker on the LAN can see
//! that a sync is happening but cannot forge operations.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::State as AxumState,
    http::{Method, StatusCode, HeaderMap},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::AppHandle;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// An operation exchanged between workstations on the LAN.
/// Mirrors the shape used for server-facing sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalOperation {
    pub operation_uuid: String,
    pub operation_type: String,
    pub payload: String,
    pub payload_hash: String,
    pub source_workstation_id: String,
    pub source_created_at: String,
    pub retry_count: u32,
}

/// Push request body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRequest {
    pub operations: Vec<LocalOperation>,
}

/// Push response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResponse {
    pub accepted: u32,
    pub rejected: u32,
    pub conflicts: Vec<ConflictInfo>,
}

/// Pull request query parameters (deserialised from query string).
#[derive(Debug, Deserialize)]
pub struct PullQuery {
    pub since: String,
    pub workstation_id: String,
}

/// Pull response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    pub operations: Vec<LocalOperation>,
    pub next_since: String,
}

/// Heartbeat payload from a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatPayload {
    pub workstation_id: String,
    pub pending_push_count: u32,
    pub last_sync_timestamp: Option<String>,
    pub hub_eligible: bool,
    pub app_version: String,
}

/// A conflict that occurred during push.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub operation_uuid: String,
    pub reason: String,
    pub winning_operation_uuid: String,
}

/// Peer heartbeat state tracked by the hub.
#[derive(Debug, Clone, Serialize)]
pub struct PeerHeartbeat {
    pub workstation_id: String,
    pub friendly_name: String,
    pub pending_push_count: u32,
    pub last_sync_at: String,
    pub hub_eligible: bool,
    pub app_version: String,
    pub last_seen_at: String,
    pub is_connected: bool,
}

/// Internal peer tracker state.
struct PeerTrack {
    friendly_name: String,
    pending_push_count: u32,
    last_sync_at: Option<DateTime<Utc>>,
    hub_eligible: bool,
    app_version: String,
    last_seen: Instant,
}

/// Hub server state.
pub struct LocalSyncServerState {
    /// Location's local network key (used for HMAC verification).
    local_network_key: String,
    /// Operations accepted from peers (not yet pushed to server).
    received_operations: RwLock<Vec<LocalOperation>>,
    /// Peer heartbeats.
    peers: RwLock<HashMap<String, PeerTrack>>,
    /// Conflict log.
    conflicts: RwLock<Vec<ConflictInfo>>,
    /// Port the server is listening on.
    port: u16,
    /// Whether the server is currently running.
    is_running: RwLock<bool>,
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

type HmacSha256 = Hmac<Sha256>;

fn compute_hmac(key: &str, body: &[u8]) -> Result<String, String> {
    let mac = HmacSha256::new_from_slice(key.as_bytes())
        .map_err(|e| format!("invalid HMAC key: {e}"))?;
    let mut mac = mac;
    mac.update(body);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn verify_hmac(key: &str, body: &[u8], expected_hex: &str) -> bool {
    match compute_hmac(key, body) {
        Ok(computed) => computed == expected_hex,
        Err(_) => false,
    }
}

/// Extract the HMAC from request headers and verify it against the body.
async fn verify_auth(
    headers: &HeaderMap,
    body: &[u8],
    key: &str,
) -> Result<(), StatusCode> {
    let auth_header = headers
        .get("x-local-auth")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if !verify_hmac(key, body, auth_header) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Axum handlers
// ---------------------------------------------------------------------------

async fn handle_health() -> impl IntoResponse {
    StatusCode::OK
}

async fn handle_push(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    headers: HeaderMap,
    Json(body): Json<PushRequest>,
) -> impl IntoResponse {
    let body_bytes = match serde_json::to_vec(&body) {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Json(PushResponse {
                accepted: 0,
                rejected: 0,
                conflicts: vec![],
            }));
        }
    };

    if verify_auth(&headers, &body_bytes, &state.local_network_key).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(PushResponse {
            accepted: 0,
            rejected: 0,
            conflicts: vec![],
        }));
    }

    let mut accepted = 0u32;
    let mut conflicts = Vec::new();
    let mut received = state.received_operations.write().await;

    for op in &body.operations {
        // Check for conflicts: same entity being modified by different peers.
        let conflict = check_for_conflict(&received, op);
        if let Some(conflict_info) = conflict {
            conflicts.push(conflict_info);
            continue;
        }

        received.push(op.clone());
        accepted += 1;
    }

    let rejected = body.operations.len() as u32 - accepted;

    // Record conflicts in the conflict log.
    if !conflicts.is_empty() {
        let mut log = state.conflicts.write().await;
        log.extend(conflicts.clone());
    }

    (StatusCode::OK, Json(PushResponse {
        accepted,
        rejected,
        conflicts,
    }))
}

async fn handle_pull(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<PullQuery>,
) -> impl IntoResponse {
    // For GET requests, the HMAC is computed over the query string.
    let query_bytes = format!(
        "since={}&workstation_id={}",
        query.since, query.workstation_id
    )
    .into_bytes();

    if verify_auth(&headers, &query_bytes, &state.local_network_key).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(PullResponse {
            operations: vec![],
            next_since: query.since.clone(),
        }));
    }

    let received = state.received_operations.read().await;
    let since: DateTime<Utc> = match query.since.parse() {
        Ok(t) => t,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Json(PullResponse {
                operations: vec![],
                next_since: query.since,
            }));
        }
    };

    let mut latest = since;
    let mut ops = Vec::new();

    for op in received.iter() {
        if op.source_workstation_id == query.workstation_id {
            continue; // Don't return the requesting workstation's own ops.
        }
        if let Ok(ts) = op.source_created_at.parse::<DateTime<Utc>>() {
            if ts > since {
                ops.push(op.clone());
                if ts > latest {
                    latest = ts;
                }
            }
        }
    }

    (StatusCode::OK, Json(PullResponse {
        operations: ops,
        next_since: latest.to_rfc3339(),
    }))
}

async fn handle_peers(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Auth check using an empty body = HMAC of empty string.
    if verify_auth(&headers, b"", &state.local_network_key).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(Vec::<PeerHeartbeat>::new()));
    }

    let peers = state.peers.read().await;
    let now = Instant::now();
    let now_ts: DateTime<Utc> = Utc::now();
    let timeout = std::time::Duration::from_secs(90);

    let result: Vec<PeerHeartbeat> = peers
        .iter()
        .map(|(id, track)| {
            let elapsed = now - track.last_seen;
            PeerHeartbeat {
                workstation_id: id.clone(),
                friendly_name: track.friendly_name.clone(),
                pending_push_count: track.pending_push_count,
                last_sync_at: track
                    .last_sync_at
                    .map(|t| t.to_rfc3339())
                    .unwrap_or_default(),
                hub_eligible: track.hub_eligible,
                app_version: track.app_version.clone(),
                last_seen_at: (now_ts - chrono::Duration::seconds(elapsed.as_secs() as i64))
                    .to_rfc3339(),
                is_connected: elapsed < timeout,
            }
        })
        .collect();

    (StatusCode::OK, Json(result))
}

async fn handle_heartbeat(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    headers: HeaderMap,
    Json(body): Json<HeartbeatPayload>,
) -> impl IntoResponse {
    let body_bytes = match serde_json::to_vec(&body) {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST,
    };

    if verify_auth(&headers, &body_bytes, &state.local_network_key).await.is_err() {
        return StatusCode::UNAUTHORIZED;
    }

    let mut peers = state.peers.write().await;
    let app_version = body.app_version.clone();
    let entry = peers.entry(body.workstation_id.clone()).or_insert(PeerTrack {
        friendly_name: body.workstation_id.clone(),
        pending_push_count: body.pending_push_count,
        last_sync_at: body
            .last_sync_timestamp
            .as_ref()
            .and_then(|s| s.parse().ok()),
        hub_eligible: body.hub_eligible,
        app_version: app_version.clone(),
        last_seen: Instant::now(),
    });

    entry.pending_push_count = body.pending_push_count;
    entry.hub_eligible = body.hub_eligible;
    entry.app_version = app_version;
    if let Some(ts) = body.last_sync_timestamp {
        if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
            entry.last_sync_at = Some(dt);
        }
    }
    entry.last_seen = Instant::now();

    StatusCode::OK
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/// Checks whether a new operation conflicts with already-received operations.
///
/// Follows first-write-wins: the operation that arrived first is applied;
/// subsequent operations targeting the same entity are rejected.
fn check_for_conflict(
    received: &[LocalOperation],
    new_op: &LocalOperation,
) -> Option<ConflictInfo> {
    // Two operations conflict if they have the same operation_type AND
    // target the same entity (same payload identifying fields).
    // This is a simplified check — the TypeScript domain layer has the
    // full merge logic.
    for existing in received.iter() {
        if existing.operation_type == new_op.operation_type
            && existing.source_workstation_id != new_op.source_workstation_id
            && existing.payload_hash == new_op.payload_hash
        {
            return Some(ConflictInfo {
                operation_uuid: new_op.operation_uuid.clone(),
                reason: "FIRST_WRITE_WINS".to_string(),
                winning_operation_uuid: existing.operation_uuid.clone(),
            });
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

impl LocalSyncServerState {
    pub fn new(local_network_key: String, port: u16) -> Self {
        Self {
            local_network_key,
            received_operations: RwLock::new(Vec::new()),
            peers: RwLock::new(HashMap::new()),
            conflicts: RwLock::new(Vec::new()),
            port,
            is_running: RwLock::new(false),
        }
    }

    pub async fn is_running(&self) -> bool {
        *self.is_running.read().await
    }

    /// Start the HTTP server, sharing this Arc with the Axum router.
    ///
    /// Must be called on an `Arc<LocalSyncServerState>` so the handlers
    /// read/write the same state as the Tauri commands (e.g. conflict log).
    pub async fn start_shared(self: Arc<Self>, _app_handle: AppHandle) -> Result<(), String> {
        let mut running = self.is_running.write().await;
        if *running {
            log::info!("Local sync server already running on port {}", self.port);
            return Ok(());
        }

        let port = self.port;
        let state: Arc<LocalSyncServerState> = self.clone();

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any);

        let app = Router::new()
            .route("/local-sync/health", get(handle_health))
            .route("/local-sync/push", post(handle_push))
            .route("/local-sync/pull", get(handle_pull))
            .route("/local-sync/peers", get(handle_peers))
            .route("/local-sync/heartbeat", post(handle_heartbeat))
            .layer(cors)
            .with_state(state);

        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        log::info!("Starting local sync server on {addr}");

        tokio::spawn(async move {
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to bind local sync server: {e}");
                    return;
                }
            };

            axum::serve(listener, app)
                .await
                .unwrap_or_else(|e| log::error!("Local sync server error: {e}"));
        });

        *running = true;
        Ok(())
    }

    /// Stop the HTTP server (mark as not running; the actual listener stops
    /// when the tokio task handle is dropped).
    pub async fn stop(&self) -> Result<(), String> {
        let mut running = self.is_running.write().await;
        if !*running {
            return Ok(());
        }
        *running = false;
        log::info!("Local sync server stopped");
        Ok(())
    }

    /// Get the list of conflicts recorded since the server started.
    pub async fn get_conflicts(&self) -> Vec<ConflictInfo> {
        self.conflicts.read().await.clone()
    }

    /// Get the count of received (un-pushed) operations.
    pub async fn received_operation_count(&self) -> usize {
        self.received_operations.read().await.len()
    }
}

// Tauri commands are defined in commands/local_sync.rs, not here.
// This module exports the state and API methods only.
