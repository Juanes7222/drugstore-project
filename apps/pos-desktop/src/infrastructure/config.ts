/**
 * Centralised application configuration.
 *
 * All environment-dependent values (API base URL, feature flags, etc.) are
 * read from `import.meta.env` once and exported as typed constants.  Import
 * this module wherever you need configuration — never access `import.meta.env`
 * directly outside this file.
 *
 * ## Adding a new config key
 *
 * 1. Add the `VITE_*` variable to `.env.example` and `.env`.
 * 2. Add a typed getter here.
 * 3. Export it as a named constant.
 *
 * ## Why a module, not a class or hook
 *
 * This module is evaluated once at import time.  That is safe because the
 * values never change during the lifetime of the renderer process (Vite
 * inlines env vars at build time).  A class or React context would add
 * ceremony for zero benefit.
 */

import { resolveWorkstationId, resolveWorkstationName } from './workstation-identity';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Base URL of the NestJS backend server.
 *
 * Falls back to `"http://localhost:3000"` when the env var is not set so the
 * POS can function during local development without a `.env` file.  Production
 * builds *must* configure `VITE_API_BASE_URL` via the build pipeline or a
 * runtime `.env` file.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:3000";

// ---------------------------------------------------------------------------
// Workstation
// ---------------------------------------------------------------------------

/**
 * Local workstation identifier sent with every auth request.
 *
 * Resolution priority (see `workstation-identity.ts`):
 * 1. `VITE_WORKSTATION_ID` build-time override (used by
 *    scripts/dev-multi-station.mjs to pin deterministic ids per dev window),
 * 2. an id persisted locally on a previous run,
 * 3. a generated UUID v4, persisted on first boot — the server then
 *    auto-registers the workstation on first login (self-registration).
 *
 * The old hardcoded "ws_principal" seed fallback is gone: a fresh install
 * no longer impersonates the seeded principal terminal.
 */
export const WORKSTATION_ID: string = resolveWorkstationId({
  envWorkstationId: import.meta.env.VITE_WORKSTATION_ID as string | undefined,
}).workstationId;

/**
 * Human-readable workstation name sent with login requests for server-side
 * self-registration. Prefers `VITE_FRIENDLY_NAME`; otherwise derives a
 * stable label from the id (the OS hostname would need the Tauri os plugin,
 * which is deliberately not a dependency).
 */
export const WORKSTATION_NAME: string = resolveWorkstationName(
  WORKSTATION_ID,
  import.meta.env.VITE_FRIENDLY_NAME as string | undefined,
);

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/**
 * When `true`, render the PGlite database proof-of-concept component instead
 * of the regular POS UI (used during foundation validation only).
 */
export const DB_PROOF_ENABLED: boolean =
  import.meta.env.VITE_DB_PROOF === "1";

// ---------------------------------------------------------------------------
// Local network sync
// ---------------------------------------------------------------------------

/**
 * IP address of this workstation for local-network mDNS announcements.
 *
 * Falls back to `"127.0.0.1"` for local development.  Production deployments
 * *must* configure `VITE_HOST_IP` (or detect it at runtime) so peers can
 * reach this workstation over the LAN.
 */
export const HOST_IP: string =
  (import.meta.env.VITE_HOST_IP as string | undefined) ?? "127.0.0.1";

/**
 * Human-readable name for this workstation in the local network.
 *
 * Shown to operators when browsing peer workstations or viewing hub-election
 * info.  Falls back to `"POS Terminal"`.
 */
export const FRIENDLY_NAME: string =
  (import.meta.env.VITE_FRIENDLY_NAME as string | undefined) ?? "POS Terminal";

/**
 * Whether this workstation is eligible to act as local-sync hub.
 *
 * Set to `"false"` to exclude this workstation from hub election (e.g. for
 * back-office terminals that should not host the sync server).  Defaults to
 * `true`.
 */
export const HUB_ELIGIBLE: boolean =
  (import.meta.env.VITE_HUB_ELIGIBLE as string | undefined) !== "false";

