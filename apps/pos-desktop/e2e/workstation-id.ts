/**
 * The workstation identity every layer of the e2e suite agrees on.
 *
 * The DIAN consecutive is allocated per workstation, so if the app reports a
 * different id than the fixtures seeded, sale confirmation fails at fiscal
 * document generation instead of exercising the path. That keeps this value in
 * one module rather than repeated as a literal.
 *
 * Must stay in sync with:
 *   - WORKSTATION_ID in apps/server/test/pos-e2e/baseline.ts (fixtures)
 *   - VITE_WORKSTATION_ID in the `test:e2e:build` script (frontend build)
 *
 * `onPrepare` also writes this id into the Tauri app-data `workstation-id`
 * file, because the app converges toward that file on boot and would
 * otherwise take a stale machine identity from the next run onward.
 */
export const WORKSTATION_ID = "8f3a1c40-5d62-4e11-9a77-2b6d0e4f8c31";
