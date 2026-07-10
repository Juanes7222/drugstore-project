/**
 * Fiscal configuration for the POS desktop app.
 *
 * These values are environment-injected because they are workstation-specific
 * and must be configured before the terminal is used for live sales. Hardcoded
 * defaults exist only to let the app start in development; production builds
 * MUST override them.
 */

/**
 * Contingency technical key used in the provisional CUFE calculation.
 *
 * DIAN Resolución 000042 requires a "clave técnica" when generating CUFE. The
 * official DIAN-provided key is used for electronic documents transmitted
 * online. For contingency documents generated while the terminal is offline,
 * the POS uses this workstation-local contingency key instead. Each terminal
 * MUST have its own distinct value — never share a contingency key across
 * workstations, because the provisional CUFE must be unique per issuer.
 *
 * The default value below is a clearly-marked placeholder. If it is still in
 * use at startup, the app refuses to confirm sales and shows a loud error so
 * the operator cannot accidentally issue non-compliant documents.
 */
export const CONTINGENCY_TECH_KEY: string =
  (import.meta.env.VITE_CONTINGENCY_TECH_KEY as string | undefined) ??
  '00000000-0000-0000-0000-000000000000-PLACEHOLDER-CONFIGURE-ME';

/**
 * Time zone used for invoice issue timestamps, expiry calculations, and the
 * CUFE canonical date. Defaults to America/Bogota per Colombian DIAN rules.
 */
export const FISCAL_TIME_ZONE: string =
  (import.meta.env.VITE_FISCAL_TIME_ZONE as string | undefined) ??
  'America/Bogota';

/**
 * Default contingency transmission window in hours.
 *
 * DIAN generally allows 48 hours from issuance to transmit a contingency
 * document. This can be overridden per workstation via environment.
 */
export const CONTINGENCY_TRANSMISSION_WINDOW_HOURS: number = Number(
  (import.meta.env.VITE_CONTINGENCY_TRANSMISSION_WINDOW_HOURS as string | undefined) ??
    '48',
);

/**
 * Network debounce durations for automatic contingency entry/exit.
 *
 * - `ENTER_MS`: how long the browser must report offline before the terminal
 *   automatically enters contingency mode.
 * - `EXIT_MS`: how long the browser must report online before contingency mode
 *   can be cleared (after pending fiscal documents are queued).
 */
export const CONTINGENCY_NETWORK_DEBOUNCE_MS = {
  ENTER_MS: Number(
    (import.meta.env.VITE_CONTINGENCY_ENTER_DEBOUNCE_MS as string | undefined) ??
      '30000',
  ),
  EXIT_MS: Number(
    (import.meta.env.VITE_CONTINGENCY_EXIT_DEBOUNCE_MS as string | undefined) ??
      '10000',
  ),
} as const;

/**
 * Returns true when the configured contingency tech key is still the
 * placeholder and therefore invalid for live sales.
 */
export function isContingencyTechKeyPlaceholder(): boolean {
  return CONTINGENCY_TECH_KEY.includes('PLACEHOLDER');
}
