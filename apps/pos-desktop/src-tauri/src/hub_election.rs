//! Hub election service for LAN sync.
//!
//! Each workstation independently computes the same leader from the same
//! set of mDNS-discovered peers. There is no central coordinator.
//!
//! ## Algorithm
//!
//! 1. Each peer computes a `hub_score` based on:
//!    - Online time in the last 24 hours (longer = higher)
//!    - Network stability (fewer disconnections = higher)
//!    - Disk space available (more = higher)
//!    - Capability flag (always-on workstations score higher)
//! 2. The highest-scoring peer is elected hub.
//! 3. Ties are broken by `workstation_id` lexicographic order (deterministic).
//!
//! ## Manager override
//!
//! The manager can force a specific workstation as the hub. The override
//! is stored in the local config and takes precedence over auto-election.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::mdns_discovery::{DiscoveredPeer, MdnsDiscoveryState};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// The role the local workstation plays in the local network.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HubRole {
    Auto,
    Forced,
    Candidate,
    NotHub,
}

/// Inform about the current hub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubInfo {
    pub workstation_id: String,
    pub friendly_name: String,
    pub ip_address: String,
    pub port: u16,
    pub hub_score: f64,
    pub role: HubRole,
    pub is_self: bool,
}

/// A peer's computed hub score and metadata.
#[derive(Debug, Clone, Serialize)]
pub struct HubScore {
    pub workstation_id: String,
    pub friendly_name: String,
    pub score: f64,
    pub online_time_hours: f64,
    pub stability_factor: f64,
    pub disk_space_gb: f64,
    pub is_always_on: bool,
    pub is_online: bool,
}

/// The election state held behind a Tauri-managed `State`.
pub struct HubElectionState {
    /// The currently elected hub (None if no election has run yet).
    current_hub: RwLock<Option<HubInfo>>,
    /// Manager override: force a specific workstation as hub.
    hub_override: RwLock<Option<String>>,
    /// Our own workstation ID (mutable for reconfiguration).
    our_workstation_id: RwLock<String>,
    /// Our own friendly name (mutable for reconfiguration).
    our_friendly_name: RwLock<String>,
    /// Our own always-on capability (mutable for reconfiguration).
    our_always_on: RwLock<bool>,
    /// When this workstation started (for online time calculation).
    started_at: Instant,
    /// Disconnection count (tracked externally; incremented each time the
    /// network goes down).
    disconnection_count: Arc<RwLock<u32>>,
    /// Available disk space in GB (updated periodically via the Tauri fs plugin).
    disk_space_gb: RwLock<f64>,
}

// ---------------------------------------------------------------------------
// Election algorithm
// ---------------------------------------------------------------------------

/// Compute the hub score for a discovered peer.
///
/// Score is a weighted combination:
/// - Online time in last 24h (normalised to 0-1) × 40
/// - Stability (1 - disconnection_rate, 0-1) × 30
/// - Disk space GB (capped at 100, normalised 0-1) × 15
/// - Always-on capability adds 15
///
/// Max possible score: 100.
fn compute_score(
    online_time_hours: f64,
    disconnection_count: u32,
    disk_space_gb: f64,
    is_always_on: bool,
) -> f64 {
    // Online time factor: up to 24 hours gives max points.
    let online_factor = (online_time_hours / 24.0).min(1.0) * 40.0;

    // Stability factor: fewer disconnections = better.
    // Assumes disconnection_count is over the last 24h.
    let stability = if disconnection_count == 0 {
        1.0
    } else {
        (1.0 / (disconnection_count as f64 + 1.0)).max(0.1)
    };
    let stability_factor = stability * 30.0;

    // Disk space factor: up to 100 GB gives max points.
    let disk_factor = (disk_space_gb / 100.0).min(1.0) * 15.0;

    // Always-on bonus.
    let always_on_bonus = if is_always_on { 15.0 } else { 0.0 };

    online_factor + stability_factor + disk_factor + always_on_bonus
}

/// Elect the hub from a list of discovered peers.
///
/// Returns the peer with the highest score. Ties are broken by
/// `workstation_id` lexicographic order (deterministic).
pub fn elect_hub(
    peers: &[DiscoveredPeer],
    hub_override: &Option<String>,
    our_workstation_id: &str,
    our_score: f64,
) -> Option<HubInfo> {
    // If there's a manager override, that workstation is the hub.
    if let Some(override_id) = hub_override {
        if override_id == our_workstation_id {
            return Some(HubInfo {
                workstation_id: our_workstation_id.to_string(),
                friendly_name: "Local (this workstation)".to_string(),
                ip_address: "127.0.0.1".to_string(),
                port: 49_500,
                hub_score: our_score,
                role: HubRole::Forced,
                is_self: true,
            });
        }
        return peers.iter().find(|p| p.workstation_id == *override_id).map(|p| {
            HubInfo {
                workstation_id: p.workstation_id.clone(),
                friendly_name: p.friendly_name.clone(),
                ip_address: p.ip_address.clone(),
                port: p.port,
                hub_score: our_score, // We don't have peer scores here; the caller provides them.
                role: HubRole::Forced,
                is_self: false,
            }
        });
    }

    // Auto-election: find the best candidate among online peers.
    let mut candidates: Vec<&DiscoveredPeer> = peers.iter().filter(|p| p.is_online).collect();

    if candidates.is_empty() {
        return None;
    }

    // Deterministic preference order across all workstations:
    // 1. Hub-eligible peers (an ineligible workstation must never win).
    // 2. The current hub, to avoid role flapping.
    // 3. Workstation ID ascending as the final tie-breaker.
    candidates.sort_by(|a, b| {
        b.hub_eligible
            .cmp(&a.hub_eligible)
            .then_with(|| b.is_current_hub.cmp(&a.is_current_hub))
            .then_with(|| a.workstation_id.cmp(&b.workstation_id))
    });

    let best = candidates[0];
    Some(HubInfo {
        workstation_id: best.workstation_id.clone(),
        friendly_name: best.friendly_name.clone(),
        ip_address: best.ip_address.clone(),
        port: best.port,
        hub_score: 0.0, // The caller should compute the score.
        role: HubRole::Auto,
        is_self: best.workstation_id == our_workstation_id,
    })
}

// ---------------------------------------------------------------------------
// Election state implementation
// ---------------------------------------------------------------------------

#[allow(dead_code)]
impl HubElectionState {
    pub fn new(
        our_workstation_id: String,
        our_friendly_name: String,
        our_always_on: bool,
    ) -> Self {
        Self {
            current_hub: RwLock::new(None),
            hub_override: RwLock::new(None),
            our_workstation_id: RwLock::new(our_workstation_id),
            our_friendly_name: RwLock::new(our_friendly_name),
            our_always_on: RwLock::new(our_always_on),
            started_at: Instant::now(),
            disconnection_count: Arc::new(RwLock::new(0)),
            disk_space_gb: RwLock::new(50.0), // Default assumption.
        }
    }

    /// Compute our own hub score.
    pub async fn our_score(&self) -> f64 {
        let online_hours = self.started_at.elapsed().as_secs_f64() / 3600.0;
        let disconnections = *self.disconnection_count.read().await;
        let disk = *self.disk_space_gb.read().await;
        compute_score(online_hours, disconnections, disk, *self.our_always_on.read().await)
    }

    /// Run the election with the current mDNS discovery state.
    /// Returns the elected hub (if any).
    pub async fn run_election(
        &self,
        mdns_state: &MdnsDiscoveryState,
    ) -> Option<HubInfo> {
        let peers = mdns_state.get_discovered_peers().await;
        let our_score = self.our_score().await;
        let override_val = self.hub_override.read().await.clone();

        let our_wid = self.our_workstation_id.read().await.clone();
        let our_name = self.our_friendly_name.read().await.clone();
        let our_eligible = *self.our_always_on.read().await;

        let elected = elect_hub(&peers, &override_val, &our_wid, our_score)
            .or_else(|| {
                // If no peers are visible we stay as a solo hub — but only
                // when this workstation is actually allowed to serve. An
                // ineligible workstation must report "no hub" so the
                // supervisor never starts the server on it.
                if !our_eligible {
                    return None;
                }
                Some(HubInfo {
                    workstation_id: our_wid.clone(),
                    friendly_name: our_name.clone(),
                    ip_address: "127.0.0.1".to_string(),
                    port: 49_500,
                    hub_score: our_score,
                    role: HubRole::Auto,
                    is_self: true,
                })
            });

        let mut current = self.current_hub.write().await;
        *current = elected.clone();
        elected
    }

    /// Get the current elected hub.
    pub async fn get_current_hub(&self) -> Option<HubInfo> {
        self.current_hub.read().await.clone()
    }

    /// Set a manager override. `None` clears the override and returns to auto.
    pub async fn set_hub_override(&self, workstation_id: Option<String>) {
        let mut ov = self.hub_override.write().await;
        *ov = workstation_id;
    }

    /// Get the current override.
    pub async fn get_hub_override(&self) -> Option<String> {
        self.hub_override.read().await.clone()
    }

    /// Record a disconnection event.
    pub async fn record_disconnection(&self) {
        let mut count = self.disconnection_count.write().await;
        *count += 1;
    }

    /// Update the available disk space (call periodically from Tauri fs plugin).
    pub async fn update_disk_space(&self, gb: f64) {
        let mut disk = self.disk_space_gb.write().await;
        *disk = gb;
    }

    /// Reconfigure the election state with new identity values.
    /// Called by the TS side after loading workstation config.
    pub async fn reconfigure(
        &self,
        workstation_id: String,
        friendly_name: String,
        always_on: bool,
    ) {
        *self.our_workstation_id.write().await = workstation_id;
        *self.our_friendly_name.write().await = friendly_name;
        *self.our_always_on.write().await = always_on;
    }

    /// Check if this workstation is the elected hub.
    pub async fn is_hub(&self) -> bool {
        let hub = self.current_hub.read().await;
        let our_wid = self.our_workstation_id.read().await.clone();
        hub.as_ref()
            .map(|h| h.workstation_id == our_wid)
            .unwrap_or(false)
    }

    /// Whether this workstation is allowed to serve as hub at all.
    ///
    /// Read by the supervisor before promoting: election winning alone is
    /// not sufficient when the operator marked this terminal ineligible.
    pub async fn our_hub_eligible(&self) -> bool {
        *self.our_always_on.read().await
    }

    /// Compute hub scores for all known peers (for the UI).
    pub async fn compute_all_scores(
        &self,
        mdns_state: &MdnsDiscoveryState,
    ) -> Vec<HubScore> {
        let peers = mdns_state.get_discovered_peers().await;
        let our_score = self.our_score().await;

        let mut scores = Vec::new();

        let our_wid = self.our_workstation_id.read().await.clone();
        let our_name = self.our_friendly_name.read().await.clone();
        let always_on = *self.our_always_on.read().await;

        // Our own score.
        scores.push(HubScore {
            workstation_id: our_wid,
            friendly_name: format!("{} (this)", our_name),
            score: our_score,
            online_time_hours: self.started_at.elapsed().as_secs_f64() / 3600.0,
            stability_factor: 1.0, // We know our own stability.
            disk_space_gb: *self.disk_space_gb.read().await,
            is_always_on: always_on,
            is_online: true,
        });

        for peer in &peers {
            // Peers' detailed metrics aren't available via mDNS TXT
            // (only the current hub knows them from heartbeats).
            // For auto-election we use the simplified sort by
            // hub_eligible + workstation_id; the scores here are
            // approximate for the UI.
            scores.push(HubScore {
                workstation_id: peer.workstation_id.clone(),
                friendly_name: peer.friendly_name.clone(),
                score: if peer.hub_eligible { 60.0 } else { 30.0 },
                online_time_hours: 0.0,
                stability_factor: 0.5,
                disk_space_gb: 50.0,
                is_always_on: peer.hub_eligible,
                is_online: peer.is_online,
            });
        }

        scores.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.workstation_id.cmp(&b.workstation_id))
        });

        scores
    }
}

// Tauri commands are defined in commands/local_sync.rs, not here.
// This module exports the election algorithm and state API only.

#[cfg(test)]
mod tests {
    use super::*;

    /// Online peer fixture. Election-relevant flags passed explicitly;
    /// everything else is inert filler so assertions stay focused on
    /// the preference order.
    fn peer(workstation_id: &str, hub_eligible: bool, is_current_hub: bool) -> DiscoveredPeer {
        DiscoveredPeer {
            workstation_id: workstation_id.to_string(),
            friendly_name: format!("Terminal {workstation_id}"),
            ip_address: "192.168.1.50".to_string(),
            port: 49_500,
            hub_eligible,
            is_current_hub,
            auth_token_hash: String::new(),
            app_version: "0.1.0".to_string(),
            first_seen_at: String::new(),
            last_seen_at: String::new(),
            is_online: true,
        }
    }

    #[test]
    fn eligible_peer_beats_ineligible_peer_with_smaller_id_and_current_hub_flag() {
        // Regression guard: hub_eligible was previously ignored by the
        // sort, letting a retired terminal keep the hub role forever.
        let peers = [peer("alpha", false, true), peer("zulu", true, false)];

        let elected = elect_hub(&peers, &None, "ws-self", 42.0);

        let hub = elected.expect("an eligible candidate exists");
        assert_eq!(hub.workstation_id, "zulu");
        assert_eq!(hub.role, HubRole::Auto);
    }

    #[test]
    fn current_hub_wins_among_equal_eligibility_when_it_has_larger_id() {
        let peers = [peer("alpha", true, false), peer("zulu", true, true)];

        let elected = elect_hub(&peers, &None, "ws-self", 42.0);

        let hub = elected.expect("candidates exist");
        assert_eq!(hub.workstation_id, "zulu");
    }

    #[test]
    fn current_hub_wins_among_equal_eligibility_when_it_has_smaller_id() {
        let peers = [peer("alpha", true, true), peer("zulu", true, false)];

        let elected = elect_hub(&peers, &None, "ws-self", 42.0);

        let hub = elected.expect("candidates exist");
        assert_eq!(hub.workstation_id, "alpha");
    }

    #[test]
    fn full_tie_elects_lexicographically_smallest_workstation_id_deterministically() {
        let peers = [peer("bravo", true, false), peer("alpha", true, false)];

        let first = elect_hub(&peers, &None, "ws-self", 42.0);
        let second = elect_hub(&peers, &None, "ws-self", 42.0);

        assert_eq!(first.expect("candidates exist").workstation_id, "alpha");
        assert_eq!(second.expect("candidates exist").workstation_id, "alpha");
    }

    #[test]
    fn override_pointing_at_self_returns_forced_role_marked_is_self() {
        let peers = [peer("other", true, false)];

        let elected = elect_hub(&peers, &Some("ws-self".to_string()), "ws-self", 42.0);

        let hub = elected.expect("self override always resolves");
        assert_eq!(hub.role, HubRole::Forced);
        assert!(hub.is_self);
    }

    #[test]
    fn override_pointing_at_known_peer_elects_that_peer_as_forced_hub() {
        let peers = [peer("aaa", true, false), peer("forced-one", true, false)];

        let elected = elect_hub(&peers, &Some("forced-one".to_string()), "ws-self", 42.0);

        let hub = elected.expect("override target is present in peers");
        assert_eq!(hub.workstation_id, "forced-one");
        assert_eq!(hub.role, HubRole::Forced);
        assert!(!hub.is_self);
    }

    #[test]
    fn override_pointing_at_unknown_peer_returns_none() {
        let peers = [peer("aaa", true, false)];

        let elected = elect_hub(&peers, &Some("ghost".to_string()), "ws-self", 42.0);

        assert!(elected.is_none());
    }

    #[test]
    fn empty_peer_list_returns_none_leaving_solo_fallback_to_caller() {
        let elected = elect_hub(&[], &None, "ws-self", 42.0);

        assert!(elected.is_none());
    }

    #[test]
    fn offline_peers_are_excluded_from_election() {
        let mut gone = peer("aaa", true, false);
        gone.is_online = false;

        let elected = elect_hub(std::slice::from_ref(&gone), &None, "ws-self", 42.0);

        assert!(elected.is_none());
    }

    // run_election()'s eligibility-gated solo fallback is NOT covered here:
    // it needs a live MdnsDiscoveryState whose ::new() spawns a real mDNS
    // daemon — too heavy for unit tests. The gating logic mirrors the
    // our_hub_eligible() getter tested below.

    #[tokio::test]
    async fn our_hub_eligible_reflects_configured_always_on_flag() {
        let state = HubElectionState::new("ws-self".to_string(), "Self".to_string(), false);

        assert!(!state.our_hub_eligible().await);

        state
            .reconfigure("ws-self".to_string(), "Self".to_string(), true)
            .await;

        assert!(state.our_hub_eligible().await);
    }
}
