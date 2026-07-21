//! Local sync client — runs on non-hub workstations.
//!
//! Periodically pushes pending local operations to the hub and pulls
//! operations from other workstations. Handles hub failover, back-off
//! on hub unavailability, and seamless reconnection when a new hub is
//! elected.
//!
//! The sync cycle is driven from the TypeScript side via Tauri commands;
//! this module provides the transport layer, HMAC signing, and state
//! tracking.

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::sync::RwLock;

use crate::local_sync_server::LocalOperation;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Status of the local sync client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocalSyncConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
}

/// Full status report for the local sync client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSyncStatus {
    pub connection_status: LocalSyncConnectionStatus,
    pub current_hub_id: Option<String>,
    pub current_hub_address: Option<String>,
    pub pending_push_count: u32,
    pub pending_pull_count: u32,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub backoff_until: Option<String>,
}

/// Internal sync state.
struct SyncState {
    hub_id: Option<String>,
    hub_address: Option<String>,
    last_sync_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
    backoff_until: Option<DateTime<Utc>>,
    consecutive_failures: u32,
    pulled_since: String,
}

/// The sync client state managed behind a Tauri state.
#[allow(dead_code)]
pub struct LocalSyncClientState {
    /// Location's local network key (for HMAC auth).
    local_network_key: String,
    /// Our workstation ID.
    workstation_id: String,
    /// Our friendly name.
    friendly_name: String,
    /// HTTP client for making requests.
    http_client: Client,
    /// Internal sync state.
    state: RwLock<SyncState>,
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

type HmacSha256 = Hmac<Sha256>;

/// Compute HMAC-SHA256 of `body` using `key`.
///
/// Returns an error if the key is empty or exceeds the HMAC block size
/// (64 bytes for SHA-256).
fn compute_hmac(key: &str, body: &[u8]) -> Result<String, String> {
    let mac = HmacSha256::new_from_slice(key.as_bytes())
        .map_err(|e| format!("invalid HMAC key: {e}"))?;
    let mut mac = mac;
    mac.update(body);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

impl LocalSyncClientState {
    pub fn new(local_network_key: String, workstation_id: String, friendly_name: String) -> Self {
        Self {
            local_network_key,
            workstation_id,
            friendly_name,
            http_client: Client::new(),
            state: RwLock::new(SyncState {
                hub_id: None,
                hub_address: None,
                last_sync_at: None,
                last_error: None,
                backoff_until: None,
                consecutive_failures: 0,
                pulled_since: Utc::now().to_rfc3339(),
            }),
        }
    }

    /// Get the current sync status.
    pub async fn get_status(&self) -> LocalSyncStatus {
        let state = self.state.read().await;
        LocalSyncStatus {
            connection_status: if state.hub_id.is_some() {
                LocalSyncConnectionStatus::Connected
            } else {
                LocalSyncConnectionStatus::Disconnected
            },
            current_hub_id: state.hub_id.clone(),
            current_hub_address: state.hub_address.clone(),
            pending_push_count: 0, // Updated from the push service.
            pending_pull_count: 0, // Updated from the pull service.
            last_sync_at: state.last_sync_at.map(|t| t.to_rfc3339()),
            last_error: state.last_error.clone(),
            backoff_until: state.backoff_until.map(|t| t.to_rfc3339()),
        }
    }

    /// Push local operations to the hub.
    pub async fn push_operations(
        &self,
        operations: Vec<LocalOperation>,
        hub_address: &str,
    ) -> Result<crate::local_sync_server::PushResponse, String> {
        let body = crate::local_sync_server::PushRequest {
            operations,
        };

        let body_bytes = serde_json::to_vec(&body)
            .map_err(|e| format!("serialisation error: {e}"))?;

        let hmac = compute_hmac(&self.local_network_key, &body_bytes)?;
        let url = format!("http://{}/local-sync/push", hub_address);

        let resp = self
            .http_client
            .post(&url)
            .header("X-Local-Auth", &hmac)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("push request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("hub returned {}", resp.status()));
        }

        let result: crate::local_sync_server::PushResponse = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse push response: {e}"))?;

        // Update state.
        let mut state = self.state.write().await;
        state.last_sync_at = Some(Utc::now());
        state.last_error = None;
        state.consecutive_failures = 0;

        Ok(result)
    }

    /// Pull operations from the hub.
    pub async fn pull_operations(
        &self,
        hub_address: &str,
    ) -> Result<crate::local_sync_server::PullResponse, String> {
        let since = {
            let state = self.state.read().await;
            state.pulled_since.clone()
        };

        let query_string = format!("since={}&workstation_id={}", since, self.workstation_id);
        let hmac = compute_hmac(&self.local_network_key, query_string.as_bytes())?;
        let url = format!(
            "http://{}/local-sync/pull?{}",
            hub_address, query_string
        );

        let resp = self
            .http_client
            .get(&url)
            .header("X-Local-Auth", &hmac)
            .send()
            .await
            .map_err(|e| format!("pull request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("hub returned {}", resp.status()));
        }

        let result: crate::local_sync_server::PullResponse = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse pull response: {e}"))?;

        // Update cursor.
        let mut state = self.state.write().await;
        state.pulled_since = result.next_since.clone();
        state.last_sync_at = Some(Utc::now());
        state.consecutive_failures = 0;

        Ok(result)
    }

    /// Send a heartbeat to the hub.
    pub async fn send_heartbeat(
        &self,
        hub_address: &str,
        pending_push_count: u32,
    ) -> Result<(), String> {
        let body = serde_json::json!({
            "workstation_id": self.workstation_id,
            "pending_push_count": pending_push_count,
            "last_sync_timestamp": self.state.read().await.last_sync_at.map(|t| t.to_rfc3339()),
            "hub_eligible": true,
            "app_version": "0.1.0",
        });

        let body_bytes = serde_json::to_vec(&body)
            .map_err(|e| format!("serialisation error: {e}"))?;
        let hmac = compute_hmac(&self.local_network_key, &body_bytes)?;

        let url = format!("http://{}/local-sync/heartbeat", hub_address);
        let resp = self
            .http_client
            .post(&url)
            .header("X-Local-Auth", &hmac)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("heartbeat failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("heartbeat returned {}", resp.status()));
        }
        Ok(())
    }

    /// Set the current hub address (called by the election service).
    pub async fn set_hub(&self, hub_id: String, hub_address: String) {
        let mut state = self.state.write().await;
        state.hub_id = Some(hub_id);
        state.hub_address = Some(hub_address);
        state.consecutive_failures = 0;
    }

    /// Clear the hub (called when hub goes offline).
    pub async fn clear_hub(&self) {
        let mut state = self.state.write().await;
        state.hub_id = None;
        state.hub_address = None;
    }
}

// Tauri commands are defined in commands/local_sync.rs, not here.
// This module exports the client state and API methods only.
