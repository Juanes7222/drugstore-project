/**
 * Harness for the tenant configuration the POS reads at runtime.
 *
 * The configuration screen can only write what it can express, and it always
 * writes the version the POS read. Three consequences, and this module exists
 * for all three:
 *
 *   1. a change made by ANOTHER admin has to reach the POS, and that only
 *      happens on the scheduler's tick — up to five minutes away;
 *   2. a policy has to be able to change UNDER a sale that is already built,
 *      to reach the enforcement that lives in the service instead of in the
 *      dialog;
 *   3. the version guard has to be able to fire, which needs two writers.
 *
 * `putServerTenantConfig` writes through the API as the signed-in user;
 * `forceTenantConfigSync` pulls the server's version into the POS through the
 * app's own "Sincronizar ahora" button, and `readTenantConfigStore` reads
 * what the POS ended up with.
 */

import { browser } from "@wdio/globals";
import { clickButtonByExactText, openScreen, waitVisible } from "./helpers";
import { fetchServerTenantConfig } from "./server-state";

/**
 * The API the POS is built against (`VITE_API_BASE_URL` in the e2e build, and
 * the port `real-backend.ts` starts the server on).
 */
const API_BASE_URL = "http://localhost:3000";

/** The localStorage key the tenant-config store persists itself under. */
const TENANT_CONFIG_STORE_KEY = "pharmacy_tenant_config";

/**
 * Access tokens the harness obtained, per identifier.
 *
 * The POS keeps its token in memory, so the harness cannot borrow it: it
 * logs in as its own session. The token is cached because every login is a
 * session, and the server evicts the oldest one when the role's session
 * limit is reached.
 */
const apiTokens = new Map<string, { token: string; at: number }>();

/** The access token lives 15 minutes; re-login well before that. */
const API_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Log in as `identifier` and keep the access token.
 *
 * The login deliberately does NOT send a workstation id: the server falls
 * back to the shared WEB_ADMIN virtual workstation, so the session it opens
 * is not the POS's own — a login on the POS's workstation would rotate the
 * POS's token and break the app mid-spec.
 */
async function apiToken(identifier: string, password: string): Promise<string> {
  const cached = apiTokens.get(identifier);
  if (cached && Date.now() - cached.at < API_TOKEN_TTL_MS) {
    return cached.token;
  }

  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      secret: password,
      sessionType: "PASSWORD",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `login as ${identifier} failed with ${response.status}: ` +
        `${await response.text()}`,
    );
  }

  const body = (await response.json()) as { accessToken?: string };
  if (!body.accessToken) {
    throw new Error(`login as ${identifier} returned no access token`);
  }

  apiTokens.set(identifier, { token: body.accessToken, at: Date.now() });
  return body.accessToken;
}

export interface TenantConfigStoreSnapshot {
  /** The version the POS holds; what it sends as `expectedConfigVersion`. */
  configVersion: number;
  /** When the POS last hydrated its store from the server. */
  lastSyncedAt: string | null;
  /** The stored configuration, as the server returned it. */
  config: Record<string, unknown> | null;
  /** The computed effective configuration the POS actually applies. */
  effectiveConfig: Record<string, unknown> | null;
}

export interface ServerTenantConfigWrite {
  status: number;
  body: string;
}

/**
 * Write the tenant configuration straight through the API, bypassing the
 * configuration screen.
 *
 * The version sent is the one the SERVER currently holds, read straight from
 * the database: the POS's own copy can be stale, and a stale version would
 * turn every call into a 409 instead of the write the spec asked for.
 *
 * The response is returned as-is — a 403 or a 409 is a RESULT the spec
 * asserts on, not an error to throw.
 */
export async function putServerTenantConfig(
  patch: Record<string, unknown>,
  account: { identifier: string; password: string },
): Promise<ServerTenantConfigWrite> {
  const current = await fetchServerTenantConfig();
  const expectedConfigVersion = current?.configVersion ?? 0;

  const send = async (token: string): Promise<ServerTenantConfigWrite> => {
    const response = await fetch(`${API_BASE_URL}/tenant-config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...patch,
        expectedConfigVersion,
      }),
    });
    return { status: response.status, body: await response.text() };
  };

  let token = await apiToken(account.identifier, account.password);
  let result = await send(token);
  if (result.status === 401) {
    // The cached token expired mid-run: drop it and log in again.
    apiTokens.delete(account.identifier);
    token = await apiToken(account.identifier, account.password);
    result = await send(token);
  }
  return result;
}

/**
 * Write a number into a configuration field with ONE write.
 *
 * The configuration screen saves on every keystroke, and `setInputValue`
 * clears the field before typing it: the clear fires its own change event,
 * and these fields turn an empty value into 0 (`raw === '' ? 0 : Number(raw)`).
 * So a plain fill writes TWICE — first 0 ("no limit"), then the real number —
 * and the two PUTs race the optimistic-concurrency guard.
 *
 * The native setter fires a single change event with the whole value, which
 * is what the house helper does in its repair path.
 */
export async function setConfigNumber(
  selector: string,
  value: number,
): Promise<void> {
  await waitVisible(selector, 20, 1_000, `configuration field ${selector}`);

  await browser.execute(
    (sel: string, text: string) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (!el) throw new Error(`no ${sel} on the configuration page`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    String(value),
  );
}

/**
 * What the POS currently holds as its tenant configuration.
 *
 * The store persists itself to `localStorage`, so this is what the running
 * POS would apply — the only way to tell "the server changed" from "the POS
 * knows about it".
 */
export async function readTenantConfigStore(): Promise<TenantConfigStoreSnapshot> {
  const raw = await browser.execute(
    (key: string) => window.localStorage.getItem(key),
    TENANT_CONFIG_STORE_KEY,
  );

  const empty: TenantConfigStoreSnapshot = {
    configVersion: 0,
    lastSyncedAt: null,
    config: null,
    effectiveConfig: null,
  };
  if (typeof raw !== "string" || raw === "") return empty;

  let parsed: { state?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
  } catch {
    return empty;
  }

  const state = parsed.state ?? {};
  return {
    configVersion: Number(state.configVersion ?? 0),
    lastSyncedAt: (state.lastSyncedAt as string | null) ?? null,
    config: (state.config as Record<string, unknown> | null) ?? null,
    effectiveConfig:
      (state.effectiveConfig as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Run a sync cycle now and wait until the POS has hydrated the tenant config
 * the server holds.
 *
 * The app's own "Sincronizar ahora" button is the trigger: its cycle pulls
 * the tenant config as step 0.5, the same call the five-minute tick makes.
 *
 * The wait is on the store's `lastSyncedAt` moving, because that is what the
 * pull sets — and on the version, when the caller knows which one it expects.
 */
export async function forceTenantConfigSync(
  expect: { configVersion?: number; timeoutMs?: number } = {},
): Promise<TenantConfigStoreSnapshot> {
  const timeoutMs = expect.timeoutMs ?? 90_000;
  const before = await readTenantConfigStore();

  await openScreen("Salud de Sinc.");
  await clickButtonByExactText("Sincronizar ahora");

  const deadline = Date.now() + timeoutMs;
  let last = before;
  while (Date.now() < deadline) {
    last = await readTenantConfigStore();
    const pulled = last.lastSyncedAt !== before.lastSyncedAt;
    const versionMatches =
      expect.configVersion === undefined ||
      last.configVersion === expect.configVersion;
    if (pulled && versionMatches) return last;
    await browser.pause(1_000);
  }

  throw new Error(
    `the POS never pulled the tenant configuration within ${timeoutMs}ms ` +
      `(expected version ${expect.configVersion}, store holds ` +
      `${last.configVersion}, lastSyncedAt ${last.lastSyncedAt})`,
  );
}
