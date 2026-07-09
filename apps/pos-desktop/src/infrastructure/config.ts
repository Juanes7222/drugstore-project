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
// Feature flags
// ---------------------------------------------------------------------------

/**
 * When `true`, render the PGlite database proof-of-concept component instead
 * of the regular POS UI (used during foundation validation only).
 */
export const DB_PROOF_ENABLED: boolean =
  import.meta.env.VITE_DB_PROOF === "1";
