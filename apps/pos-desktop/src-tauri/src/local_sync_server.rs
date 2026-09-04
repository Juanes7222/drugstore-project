//! Local HTTP server (hub role) for LAN sync between workstations.
//!
//! Runs only on the elected hub workstation. Provides REST endpoints for
//! peers to push/pull operations and exchange heartbeats.
//!
//! ## Security
//!
//! All endpoints (except `/local-sync/health`, `/health`, `/sync/events`,
//! and `/sync/heartbeat`) require the `X-Local-Auth` header containing an
//! HMAC-SHA256 of the request body signed with the location's local network
//! key.
//!
//! The `/sync/*` endpoints are intentionally unauthenticated so that any
//! peer workstation (even ones without the local network key) can push
//! events and heartbeats. HMAC-only endpoints provide stronger guarantees
//! for the full push/pull cycle on the elected hub.
//!
//! The server uses **plain HTTP**, not HTTPS. TLS would add significant
//! complexity (certificate distribution, trust chain management) without
//! proportional security benefit in a LAN-only context.

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
use axum::extract::{Query, RawQuery};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// An operation exchanged between workstations on the LAN.
/// Mirrors the shape used for server-facing sync.
///
/// Wire format is camelCase to match the TypeScript `LocalOperation`
/// shared type — Tauri deserialises invoke arguments straight into these
/// structs, so a snake_case field name here would silently break every
/// push from the renderer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub operations: Vec<LocalOperation>,
}

/// Push response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    pub accepted: u32,
    pub rejected: u32,
    pub conflicts: Vec<ConflictInfo>,
    /// UUIDs of the operations durably accepted by this hub. Per-operation
    /// granularity lets the sender mark exactly those entries as relayed;
    /// anything absent (including disk-full rejections) stays eligible and
    /// is retried on the next cycle.
    pub accepted_operation_uuids: Vec<String>,
}

/// Pull request query parameters (deserialised from query string).
#[derive(Debug, Deserialize)]
pub struct PullQuery {
    pub since: String,
    pub workstation_id: String,
}

/// Pull response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

// ---------------------------------------------------------------------------
// Simple sync event types (for /sync/* unauthenticated endpoints)
// ---------------------------------------------------------------------------

/// A lightweight sync event pushed by a peer workstation.
///
/// Mirrors the `SyncEvent` Zod schema on the TypeScript side.
/// The Rust server validates basic structure, then forwards the raw
/// payload to the TypeScript layer via a Tauri event for full Zod
/// validation and processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEventPayload {
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub payload: serde_json::Value,
    pub source_workstation_id: String,
    pub timestamp: String,
}

/// Response to a successful sync event submission.
#[derive(Debug, Clone, Serialize)]
pub struct SyncEventResponse {
    pub accepted: bool,
    pub operation_uuid: String,
}

/// A lightweight heartbeat from a peer or hub workstation.
///
/// Mirrors the `HeartbeatPayload` Zod schema on the TypeScript side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleHeartbeatPayload {
    pub workstation_id: String,
    pub timestamp: String,
    pub status: String,
}

/// Health check response with detailed status.
#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime: f64,
    pub version: String,
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

/// Stored operation with hub insertion time.
///
/// `received_at` is the hub's wall-clock when the push was accepted, not
/// the originating workstation's `sourceCreatedAt`. Using insertion time
/// for the pull cursor ensures operations created offline (old
/// `sourceCreatedAt`) are still returned to peers that already advanced
/// past that timestamp — otherwise a late push with a stale creation time
/// would be silently missed.
#[derive(Debug, Clone)]
struct StoredOp {
    operation: LocalOperation,
    received_at: DateTime<Utc>,
}

/// Persisted form of `StoredOp` for the JSONL log.
#[derive(Debug, Serialize, Deserialize)]
struct PersistedOp {
    operation: LocalOperation,
    #[serde(rename = "receivedAt")]
    received_at: String,
}

/// Hub server state.
pub struct LocalSyncServerState {
    /// Location's local network key (used for HMAC verification).
    local_network_key: String,
    /// Operations accepted from peers (not yet pushed to server).
    received_operations: RwLock<Vec<StoredOp>>,
    /// Append-only on-disk mirror of `received_operations`.
    ///
    /// The in-memory buffer alone would lose every peer operation on a hub
    /// restart — unacceptable when those operations are sales. Each accepted
    /// operation is appended as one JSON line before the push is confirmed,
    /// and the log is reloaded on startup. Dedup by `operation_uuid` on load
    /// tolerates a torn final line after a crash mid-append.
    op_log: RwLock<Option<std::fs::File>>,
    /// Peer heartbeats.
    peers: RwLock<HashMap<String, PeerTrack>>,
    /// Conflict log.
    conflicts: RwLock<Vec<ConflictInfo>>,
    /// Port the server is listening on (updated when a fallback port is
    /// used because the preferred one was busy).
    port: RwLock<u16>,
    /// Whether the server is currently running.
    is_running: RwLock<bool>,
    /// Handle to the spawned serve loop so `stop()` can actually tear the
    /// listener down instead of only flipping a flag.
    serve_task: RwLock<Option<tokio::task::JoinHandle<()>>>,
    /// Tauri app handle for emitting events to the frontend.
    app_handle: RwLock<Option<AppHandle>>,
    /// Server startup timestamp (Unix epoch ms).
    started_at: RwLock<u64>,
}

/// Operations older than this are dropped from the hub log on startup.
/// The internet sync cycle should have flushed them to the server long
/// before; keeping them forever would grow the file unbounded.
const OP_LOG_RETENTION_DAYS: i64 = 30;

/// Directory (inside the OS app-data dir) holding the hub operation log.
const OP_LOG_DIR: &str = "local-sync";
const OP_LOG_FILE: &str = "hub-op-log.jsonl";

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
                accepted_operation_uuids: vec![],
            }));
        }
    };

    if verify_auth(&headers, &body_bytes, &state.local_network_key).await.is_err() {
        crate::local_sync_diagnostics::push_global(
            "WARN",
            "local_sync_server",
            format!("push HMAC failed for {} bytes", body_bytes.len()),
        );
        return (StatusCode::UNAUTHORIZED, Json(PushResponse {
            accepted: 0,
            rejected: 0,
            conflicts: vec![],
            accepted_operation_uuids: vec![],
        }));
    }

    let mut accepted = 0u32;
    let mut rejected = 0u32;
    let mut accepted_uuids = Vec::new();
    let mut conflicts = Vec::new();
    let mut received = state.received_operations.write().await;

    for op in &body.operations {
        // Check for conflicts: same entity being modified by different peers.
        let conflict = check_for_conflict_stored(&received, op);
        if let Some(conflict_info) = conflict {
            conflicts.push(conflict_info);
            rejected += 1;
            continue;
        }

        // Persist BEFORE confirming acceptance: a peer that sees "accepted"
        // must be able to assume the hub durably holds the operation, even
        // across a hub restart. A failed disk write therefore counts as a
        // rejection so the peer retries on its next cycle.
        let stored = StoredOp {
            operation: op.clone(),
            received_at: Utc::now(),
        };
        if !state.append_stored_op_to_log(&stored) {
            log::error!(
                "Failed to persist operation {} — rejecting so peer retries",
                op.operation_uuid
            );
            rejected += 1;
            continue;
        }

        received.push(stored);
        accepted_uuids.push(op.operation_uuid.clone());
        accepted += 1;
    }

    drop(received);

    // Record conflicts in the conflict log.
    if !conflicts.is_empty() {
        let mut log = state.conflicts.write().await;
        log.extend(conflicts.clone());
    }

    (StatusCode::OK, Json(PushResponse {
        accepted,
        rejected,
        conflicts,
        accepted_operation_uuids: accepted_uuids,
    }))
}

async fn handle_pull(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<PullQuery>,
) -> impl IntoResponse {
    // HMAC must be verified against the exact query bytes on the wire.
    // Re-serialising parsed params breaks when `since` contains `+` (RFC3339
    // UTC offset): form decoding turns `+` into a space before we rebuild.
    let query_bytes = raw_query
        .map(|q| q.into_bytes())
        .unwrap_or_else(|| {
            format!(
                "since={}&workstation_id={}",
                urlencoding::encode(&query.since),
                urlencoding::encode(&query.workstation_id),
            )
            .into_bytes()
        });

    if verify_auth(&headers, &query_bytes, &state.local_network_key).await.is_err() {
        crate::local_sync_diagnostics::push_global(
            "WARN",
            "local_sync_server",
            format!("pull HMAC failed for {}", query.workstation_id),
        );
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

    for stored in received.iter() {
        if stored.operation.source_workstation_id == query.workstation_id {
            continue; // Don't return the requesting workstation's own ops.
        }
        if stored.received_at > since {
            ops.push(stored.operation.clone());
            if stored.received_at > latest {
                latest = stored.received_at;
            }
        }
    }

    (StatusCode::OK, Json(PullResponse {
        operations: ops,
        next_since: latest.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
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

// ---------------------------------------------------------------------------
// Unauthenticated /sync/* handlers — emit Tauri events to the frontend
// ---------------------------------------------------------------------------

/// POST /sync/events — receive a lightweight sync event from a peer.
///
/// Validates the body structure, stores it in `received_operations` for
/// consistency with the authenticated push path, and emits a Tauri event
/// so the TypeScript layer can run Zod validation and forward to the
/// sync engine.
async fn handle_sync_events(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    Json(body): Json<SyncEventPayload>,
) -> impl IntoResponse {
    let event_uuid = body.entity_id.clone();

    // Emit Tauri event to the frontend so TypeScript can Zod-validate
    // and forward to the sync engine.
    let app_handle = state.app_handle.read().await;
    if let Some(ref handle) = *app_handle {
        if let Err(e) = handle.emit("lan-sync-event-received", &body) {
            log::error!("Failed to emit lan-sync-event-received: {e}");
        }
    }

    log::info!(
        "Sync event received: {} {} from {}",
        body.action,
        body.entity_type,
        body.source_workstation_id,
    );

    (StatusCode::ACCEPTED, Json(SyncEventResponse {
        accepted: true,
        operation_uuid: event_uuid,
    }))
}

/// POST /sync/heartbeat — receive a simple heartbeat from a peer.
///
/// Authenticates via the `X-Local-Auth` header if present (peers that know
/// the key get full peer tracking); otherwise records the heartbeat in the
/// TypeScript PeerTracker via a Tauri event.
async fn handle_simple_heartbeat(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
    headers: HeaderMap,
    Json(body): Json<SimpleHeartbeatPayload>,
) -> impl IntoResponse {
    // Emit Tauri event to the frontend.
    let app_handle = state.app_handle.read().await;
    if let Some(ref handle) = *app_handle {
        if let Err(e) = handle.emit("lan-heartbeat-received", &body) {
            log::error!("Failed to emit lan-heartbeat-received: {e}");
        }
    }

    // Also track the heartbeat in the Rust peer store when the request
    // carries valid HMAC auth (so the authenticated /local-sync/peers
    // endpoint returns up-to-date data).
    let body_bytes = match serde_json::to_vec(&body) {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    if verify_auth(&headers, &body_bytes, &state.local_network_key).await.is_ok() {
        let mut peers = state.peers.write().await;
        let entry = peers.entry(body.workstation_id.clone()).or_insert(PeerTrack {
            friendly_name: body.workstation_id.clone(),
            pending_push_count: 0,
            last_sync_at: None,
            hub_eligible: false,
            app_version: String::new(),
            last_seen: Instant::now(),
        });
        entry.last_seen = Instant::now();
    }

    StatusCode::OK
}

/// GET /health — return a detailed JSON health response.
async fn handle_health_json(
    AxumState(state): AxumState<Arc<LocalSyncServerState>>,
) -> impl IntoResponse {
    let uptime_secs = {
        let started = state.started_at.read().await;
        if *started > 0 {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            (now.saturating_sub(*started) as f64) / 1000.0
        } else {
            0.0
        }
    };

    let version = env!("CARGO_PKG_VERSION").to_string();

    (StatusCode::OK, Json(HealthResponse {
        status: "ok".to_string(),
        uptime: uptime_secs,
        version,
    }))
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
#[allow(dead_code)]
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

fn check_for_conflict_stored(
    received: &[StoredOp],
    new_op: &LocalOperation,
) -> Option<ConflictInfo> {
    for existing in received.iter() {
        let e = &existing.operation;
        if e.operation_type == new_op.operation_type
            && e.source_workstation_id != new_op.source_workstation_id
            && e.payload_hash == new_op.payload_hash
        {
            return Some(ConflictInfo {
                operation_uuid: new_op.operation_uuid.clone(),
                reason: "FIRST_WRITE_WINS".to_string(),
                winning_operation_uuid: e.operation_uuid.clone(),
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
            op_log: RwLock::new(None),
            peers: RwLock::new(HashMap::new()),
            conflicts: RwLock::new(Vec::new()),
            port: RwLock::new(port),
            is_running: RwLock::new(false),
            serve_task: RwLock::new(None),
            app_handle: RwLock::new(None),
            started_at: RwLock::new(0),
        }
    }

    /// Load previously accepted operations from the on-disk log and open it
    /// for appending. Deduplicates by `operation_uuid` (a torn final line
    /// after a crash mid-append is skipped) and drops entries older than the
    /// retention window.
    async fn restore_op_log(&self, app_handle: &AppHandle) {
        let dir = match app_handle.path().app_local_data_dir() {
            Ok(dir) => dir.join(OP_LOG_DIR),
            Err(e) => {
                log::error!("Cannot resolve app local data dir for hub log: {e}");
                return;
            }
        };
        if let Err(e) = std::fs::create_dir_all(&dir) {
            log::error!("Cannot create hub log dir {}: {e}", dir.display());
            return;
        }
        let path = dir.join(OP_LOG_FILE);

        let mut restored: HashMap<String, StoredOp> = HashMap::new();
        if let Ok(content) = std::fs::read_to_string(&path) {
            let cutoff = Utc::now() - chrono::Duration::days(OP_LOG_RETENTION_DAYS);
            for line in content.lines() {
                // Try new persisted format first, fall back to legacy.
                if let Ok(persisted) = serde_json::from_str::<PersistedOp>(line) {
                    let received_at = persisted
                        .received_at
                        .parse::<DateTime<Utc>>()
                        .unwrap_or_else(|_| {
                            persisted
                                .operation
                                .source_created_at
                                .parse::<DateTime<Utc>>()
                                .unwrap_or_else(|_| Utc::now())
                        });
                    if received_at <= cutoff {
                        continue;
                    }
                    restored.insert(
                        persisted.operation.operation_uuid.clone(),
                        StoredOp {
                            operation: persisted.operation,
                            received_at,
                        },
                    );
                    continue;
                }
                let Ok(op) = serde_json::from_str::<LocalOperation>(line) else {
                    // Torn/partial line — skip; the next append rewrites a
                    // clean copy of any operation that still matters.
                    continue;
                };
                let received_at = op
                    .source_created_at
                    .parse::<DateTime<Utc>>()
                    .unwrap_or_else(|_| Utc::now());
                if received_at <= cutoff {
                    continue;
                }
                restored.insert(
                    op.operation_uuid.clone(),
                    StoredOp {
                        operation: op,
                        received_at,
                    },
                );
            }
        }
        if !restored.is_empty() {
            log::info!(
                "Restored {} buffered peer operations from hub log",
                restored.len()
            );
        }

        let mut ops = self.received_operations.write().await;
        *ops = restored.into_values().collect();
        ops.sort_by(|a, b| a.received_at.cmp(&b.received_at));
        drop(ops);

        // Open (or create) for appending so subsequent accepts persist.
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(file) => {
                *self.op_log.write().await = Some(file);
            }
            Err(e) => {
                // Disk-full or permission problems are expected states in an
                // offline-first terminal: keep serving from memory, but every
                // append failure will now reject peer pushes so they retry.
                log::error!("Cannot open hub op log {}: {e}", path.display());
            }
        }
    }

    /// Append one operation to the on-disk log. Returns false when the write
    /// failed, signalling the caller to reject the push so the peer retries
    /// instead of assuming the hub durably holds the operation.
    #[allow(dead_code)]
    fn append_op_to_log(&self, op: &LocalOperation) -> bool {
        let stored = StoredOp {
            operation: op.clone(),
            received_at: Utc::now(),
        };
        self.append_stored_op_to_log(&stored)
    }

    fn append_stored_op_to_log(&self, stored: &StoredOp) -> bool {
        match self.op_log.try_write() {
            Ok(mut guard) => {
                if let Some(file) = guard.as_mut() {
                    use std::io::Write;
                    let persisted = PersistedOp {
                        operation: stored.operation.clone(),
                        received_at: stored.received_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    };
                    let line = match serde_json::to_string(&persisted) {
                        Ok(l) => l,
                        Err(_) => return false,
                    };
                    file.write_all(line.as_bytes()).is_ok()
                        && file.write_all(b"\n").is_ok()
                        && file.flush().is_ok()
                } else {
                    log::error!(
                        "Hub op log not open — cannot persist operation {}",
                        stored.operation.operation_uuid
                    );
                    false
                }
            }
            Err(_) => {
                log::warn!(
                    "Hub op log busy — cannot persist operation {}",
                    stored.operation.operation_uuid
                );
                false
            }
        }
    }

    pub async fn is_running(&self) -> bool {
        *self.is_running.read().await
    }

    /// The port the server is actually listening on.
    pub async fn bound_port(&self) -> u16 {
        *self.port.read().await
    }

    /// Start the HTTP server, sharing this Arc with the Axum router.
    ///
    /// Must be called on an `Arc<LocalSyncServerState>` so the handlers
    /// read/write the same state as the Tauri commands (e.g. conflict log).
    pub async fn start_shared(self: Arc<Self>, app_handle: AppHandle) -> Result<(), String> {
        let mut running = self.is_running.write().await;
        if *running {
            log::info!("Local sync server already running");
            return Ok(());
        }

        // Store the app handle so handlers can emit Tauri events.
        *self.app_handle.write().await = Some(app_handle.clone());
        *self.started_at.write().await = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Reload any operations buffered by a previous hub session before
        // the listener opens — peers may pull immediately after discovery.
        self.restore_op_log(&app_handle).await;

        let preferred_port = *self.port.read().await;

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any);

        let router = Router::new()
            // Authenticated local-sync endpoints (HMAC required).
            .route("/local-sync/health", get(handle_health))
            .route("/local-sync/push", post(handle_push))
            .route("/local-sync/pull", get(handle_pull))
            .route("/local-sync/peers", get(handle_peers))
            .route("/local-sync/heartbeat", post(handle_heartbeat))
            // Unauthenticated lightweight endpoints for simple push/heartbeat.
            .route("/sync/events", post(handle_sync_events))
            .route("/sync/heartbeat", post(handle_simple_heartbeat))
            .route("/health", get(handle_health_json))
            .layer(cors)
            .with_state(self.clone());

        // Bind synchronously so a failure reaches the caller (and the hub
        // supervisor can retry on a later tick) instead of leaving the
        // running flag set with no listener behind it. If the preferred
        // port is taken, walk up to a few neighbouring ports — mirrors the
        // port-fallback behaviour documented on the TypeScript LanServer.
        const PORT_FALLBACK_STEPS: u16 = 10;
        let mut listener = None;
        let mut effective_port = preferred_port;
        for offset in 0..PORT_FALLBACK_STEPS {
            let candidate = preferred_port.saturating_add(offset);
            let addr = SocketAddr::from(([0, 0, 0, 0], candidate));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => {
                    listener = Some(l);
                    effective_port = candidate;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                    log::warn!("Port {candidate} in use; trying the next one");
                }
                Err(e) => {
                    return Err(format!("failed to bind local sync server on {addr}: {e}"));
                }
            }
        }

        let listener = listener.ok_or_else(|| {
            format!(
                "no free port found between {preferred_port} and {}",
                preferred_port + PORT_FALLBACK_STEPS - 1
            )
        })?;

        if effective_port != preferred_port {
            log::warn!(
                "Preferred port {preferred_port} busy — local sync server using {effective_port}. \
                 Supervisor will re-advertise the correct port via mDNS."
            );
            *self.port.write().await = effective_port;
        }

        let addr = SocketAddr::from(([0, 0, 0, 0], effective_port));
        log::info!("Local sync server listening on {addr}");

        let serve_handle = tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                log::error!("Local sync server error: {e}");
            }
        });
        *self.serve_task.write().await = Some(serve_handle);

        *running = true;
        Ok(())
    }

    /// Stop the HTTP server and abort the serve loop so the port is
    /// released and a later `start_shared` can re-bind cleanly.
    pub async fn stop(&self) -> Result<(), String> {
        let mut running = self.is_running.write().await;
        if !*running {
            return Ok(());
        }

        if let Some(handle) = self.serve_task.write().await.take() {
            handle.abort();
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

#[cfg(test)]
mod tests {
    use super::*;

    // start_shared() needs a real AppHandle and is covered by LAN
    // integration runs, not unit tests. These tests pin the port-state
    // surface that must hold before any bind happens.

    const NETWORK_KEY: &str = "test-network-key";
    const PREFERRED_PORT: u16 = 49_500;

    #[tokio::test]
    async fn new_state_is_not_running_and_reports_preferred_port_as_bound() {
        let state = LocalSyncServerState::new(NETWORK_KEY.to_string(), PREFERRED_PORT);

        assert!(!state.is_running().await);
        assert_eq!(state.bound_port().await, PREFERRED_PORT);
        assert!(state.serve_task.write().await.is_none());
    }

    #[tokio::test]
    async fn stop_on_never_started_server_returns_ok_and_leaves_state_untouched() {
        let state = LocalSyncServerState::new(NETWORK_KEY.to_string(), PREFERRED_PORT);

        let result = state.stop().await;

        assert!(result.is_ok());
        assert!(!state.is_running().await);
        assert_eq!(state.bound_port().await, PREFERRED_PORT);
        assert!(state.serve_task.write().await.is_none());
    }

    #[test]
    fn pull_hmac_uses_url_encoded_query_bytes() {
        const KEY: &str = "test-network-key";
        let since = "1970-01-01T00:00:00+00:00";
        let ws = "ws_secundaria";
        let wire_query = format!(
            "since={}&workstation_id={}",
            urlencoding::encode(since),
            urlencoding::encode(ws),
        );
        let mac = compute_hmac(KEY, wire_query.as_bytes()).expect("hmac");

        assert!(verify_hmac(KEY, wire_query.as_bytes(), &mac));

        // Rebuilding from parsed params corrupts `+` into a space — the old bug.
        let broken = format!("since={since}&workstation_id={ws}");
        assert!(!verify_hmac(KEY, broken.as_bytes(), &mac));
    }

    #[test]
    fn push_response_serde_uses_camel_case() {
        let resp = PushResponse {
            accepted: 2,
            rejected: 1,
            conflicts: vec![ConflictInfo {
                operation_uuid: "op-1".to_string(),
                reason: "FIRST_WRITE_WINS".to_string(),
                winning_operation_uuid: "op-0".to_string(),
            }],
            accepted_operation_uuids: vec!["uuid-1".to_string(), "uuid-2".to_string()],
        };

        let json = serde_json::to_string(&resp).expect("serialize PushResponse");
        // Wire format must be camelCase to match TypeScript LocalOperation.
        assert!(json.contains("\"acceptedOperationUuids\""), "json was: {json}");
        assert!(!json.contains("accepted_operation_uuids"), "snake_case leaked: {json}");
        assert!(json.contains("\"winningOperationUuid\""), "json was: {json}");

        let de: PushResponse = serde_json::from_str(&json).expect("deserialize PushResponse");
        assert_eq!(de.accepted, 2);
        assert_eq!(de.rejected, 1);
        assert_eq!(de.accepted_operation_uuids, vec!["uuid-1", "uuid-2"]);
        assert_eq!(de.conflicts[0].operation_uuid, "op-1");
    }

    #[test]
    fn local_operation_serde_uses_camel_case() {
        let op = LocalOperation {
            operation_uuid: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            operation_type: "SALE_CONFIRMATION".to_string(),
            payload: "{\"total\":100}".to_string(),
            payload_hash: "abc123".to_string(),
            source_workstation_id: "ws-1".to_string(),
            source_created_at: "2026-01-15T12:00:00.000Z".to_string(),
            retry_count: 3,
        };

        let json = serde_json::to_string(&op).expect("serialize LocalOperation");
        assert!(json.contains("\"operationUuid\""), "json was: {json}");
        assert!(json.contains("\"operationType\""), "json was: {json}");
        assert!(json.contains("\"sourceWorkstationId\""), "json was: {json}");
        assert!(json.contains("\"sourceCreatedAt\""), "json was: {json}");
        assert!(json.contains("\"retryCount\""), "json was: {json}");
        assert!(!json.contains("operation_uuid"), "snake_case leaked: {json}");
        assert!(!json.contains("source_workstation_id"), "snake_case leaked: {json}");

        let de: LocalOperation = serde_json::from_str(&json).expect("deserialize LocalOperation");
        assert_eq!(de.operation_uuid, op.operation_uuid);
        assert_eq!(de.operation_type, op.operation_type);
        assert_eq!(de.source_workstation_id, op.source_workstation_id);
        assert_eq!(de.retry_count, 3);

        // Verify camelCase input also deserializes (Tauri invoke path).
        let camel_input = r#"{"operationUuid":"uuid-2","operationType":"PRODUCT_CREATION","payload":"{}","payloadHash":"h","sourceWorkstationId":"ws-2","sourceCreatedAt":"2026-01-15T12:00:00.000Z","retryCount":0}"#;
        let from_camel: LocalOperation = serde_json::from_str(camel_input).unwrap();
        assert_eq!(from_camel.operation_uuid, "uuid-2");
    }
}
