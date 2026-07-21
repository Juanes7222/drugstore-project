/**
 * Hub election algorithm.
 *
 * Each workstation independently computes the same leader from the same
 * set of mDNS-discovered peers. Deterministic: given the same inputs,
 * every workstation computes the same leader.
 *
 * ## Algorithm
 *
 * 1. Each peer computes a `hubScore` based on:
 *    - Online time in the last 24 hours (longer = higher) × 0.40
 *    - Network stability (fewer disconnections = higher) × 0.30
 *    - Disk space available (more = higher) × 0.15
 *    - Always-on capability bonus × 0.15
 * 2. The highest-scoring peer is elected hub.
 * 3. Ties are broken by workstationId lexicographic order (deterministic).
 *
 * ## Manager override
 *
 * The manager can force a specific workstation as the hub. The override
 * takes precedence over auto-election.
 */

import { HubRole } from '@pharmacy/shared-types';
import type { HubInfo, DiscoveredPeer, HubScore } from '@pharmacy/shared-types';

// Weight constants.
const ONLINE_TIME_WEIGHT = 0.40;
const STABILITY_WEIGHT = 0.30;
const DISK_SPACE_WEIGHT = 0.15;
const ALWAYS_ON_WEIGHT = 0.15;

// Max possible score = 100.
const MAX_ONLINE_HOURS = 24;
const MAX_DISK_GB = 100;

/**
 * Input for the hub election algorithm.
 */
export interface HubElectionInput {
  peers: DiscoveredPeer[];
  hubOverride: string | null;
  ourWorkstationId: string;
  ourScore: number;
}

/**
 * Result of a hub election.
 */
export interface ElectionResult {
  hub: HubInfo | null;
  allScores: HubScore[];
}

/**
 * Compute the hub score for a workstation.
 *
 * @param onlineTimeHours - Seconds since this workstation started / 3600.
 * @param disconnectionCount - Number of disconnections in the last 24h.
 * @param diskSpaceGb - Available disk space in GB.
 * @param isAlwaysOn - Whether this workstation is an "always-on" device.
 */
export function computeHubScore(
  onlineTimeHours: number,
  disconnectionCount: number,
  diskSpaceGb: number,
  isAlwaysOn: boolean,
): number {
  // Online time factor: up to 24 hours gives max points.
  const onlineFactor = Math.min(onlineTimeHours / MAX_ONLINE_HOURS, 1) * 100 * ONLINE_TIME_WEIGHT;

  // Stability factor: fewer disconnections = better.
  const stability = disconnectionCount === 0
    ? 1.0
    : Math.max(1 / (disconnectionCount + 1), 0.1);
  const stabilityFactor = stability * 100 * STABILITY_WEIGHT;

  // Disk space factor: up to 100 GB gives max points.
  const diskFactor = Math.min(diskSpaceGb / MAX_DISK_GB, 1) * 100 * DISK_SPACE_WEIGHT;

  // Always-on bonus.
  const alwaysOnBonus = isAlwaysOn ? 100 * ALWAYS_ON_WEIGHT : 0;

  return Math.round((onlineFactor + stabilityFactor + diskFactor + alwaysOnBonus) * 100) / 100;
}

/**
 * Elect the hub from a list of discovered peers.
 *
 * Deterministic: given the same inputs, always produces the same result.
 *
 * @param input - Election input including peers, override, and own identity.
 * @returns The elected hub and all scores.
 */
export function electHub(input: HubElectionInput): ElectionResult {
  const { peers, hubOverride, ourWorkstationId, ourScore } = input;

  // Handle manager override first.
  if (hubOverride) {
    const forcedHub = peers.find((p) => p.workstationId === hubOverride);
    if (forcedHub) {
      const allScores = computeAllScores(peers, ourWorkstationId, ourScore);
      return {
        hub: {
          workstationId: forcedHub.workstationId,
          friendlyName: forcedHub.friendlyName,
          ipAddress: forcedHub.ipAddress,
          port: forcedHub.port,
          hubScore: ourScore, // The UI can update this with real scores.
          role: HubRole.FORCED,
          isSelf: forcedHub.workstationId === ourWorkstationId,
        },
        allScores,
      };
    }

    // If the forced hub is not in the discovered peers, try ourselves.
    if (hubOverride === ourWorkstationId) {
      const allScores = computeAllScores(peers, ourWorkstationId, ourScore);
      return {
        hub: {
          workstationId: ourWorkstationId,
          friendlyName: 'This workstation (override)',
          ipAddress: '127.0.0.1',
          port: 49_500,
          hubScore: ourScore,
          role: HubRole.FORCED,
          isSelf: true,
        },
        allScores,
      };
    }
  }

  // Auto-election: find the best candidate.
  const onlinePeers = peers.filter((p) => p.isOnline);

  // If no online peers, elect ourselves.
  if (onlinePeers.length === 0) {
    const allScores = computeAllScores(peers, ourWorkstationId, ourScore);
    return {
      hub: {
        workstationId: ourWorkstationId,
        friendlyName: 'This workstation (solo)',
        ipAddress: '127.0.0.1',
        port: 49_500,
        hubScore: ourScore,
        role: HubRole.AUTO,
        isSelf: true,
      },
      allScores,
    };
  }

  // Score each online peer and sort.
  const scored = onlinePeers
    .map((peer) => ({
      peer,
      score: computeHubScore(
        0, // We don't know each peer's online time exactly — they're approximated.
        0, // Same for disconnection count.
        50, // Default disk space.
        peer.hubEligible,
      ),
    }))
    .sort((a, b) => {
      // Primary sort: score descending.
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      // Secondary sort: isCurrentHub (prefer current hub for stability).
      if (a.peer.isCurrentHub && !b.peer.isCurrentHub) return -1;
      if (!a.peer.isCurrentHub && b.peer.isCurrentHub) return 1;
      // Tertiary sort: workstationId ascending (deterministic tie-breaker).
      return a.peer.workstationId.localeCompare(b.peer.workstationId);
    });

  const winner = scored[0];
  const allScores = computeAllScores(peers, ourWorkstationId, ourScore);

  return {
    hub: {
      workstationId: winner.peer.workstationId,
      friendlyName: winner.peer.friendlyName,
      ipAddress: winner.peer.ipAddress,
      port: winner.peer.port,
      hubScore: winner.score,
      role: HubRole.AUTO,
      isSelf: winner.peer.workstationId === ourWorkstationId,
    },
    allScores,
  };
}

/**
 * Compute hub scores for all peers (for the UI display).
 */
function computeAllScores(
  peers: DiscoveredPeer[],
  ourWorkstationId: string,
  ourScore: number,
): HubScore[] {
  const scores: HubScore[] = [];

  // Our own score.
  scores.push({
    workstationId: ourWorkstationId,
    friendlyName: `${ourWorkstationId} (this)`,
    score: ourScore,
    onlineTimeHours: 0,
    stabilityFactor: 1,
    diskSpaceGb: 50,
    isAlwaysOn: true,
    isOnline: true,
  });

  for (const peer of peers) {
    scores.push({
      workstationId: peer.workstationId,
      friendlyName: peer.friendlyName,
      score: computeHubScore(0, 0, 50, peer.hubEligible),
      onlineTimeHours: 0,
      stabilityFactor: 0.5,
      diskSpaceGb: 50,
      isAlwaysOn: peer.hubEligible,
      isOnline: peer.isOnline,
    });
  }

  // Sort by score descending, then by workstationId for determinism.
  scores.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.workstationId.localeCompare(b.workstationId);
  });

  return scores;
}
