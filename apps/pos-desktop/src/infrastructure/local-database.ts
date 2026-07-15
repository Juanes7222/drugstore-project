/**
 * Singleton accessor for the local PGlite-based Prisma Client.
 *
 * Architecture
 * ------------
 * PGlite (an in-process PostgreSQL implemented in WASM) runs inside the
 * Tauri webview itself — no sidecar, no separate process.  Persistence is
 * provided by IndexedDB, keyed to the Tauri app-local-data directory so
 * the database survives app restarts and is automatically cleaned up when
 * the OS uninstalls the app.
 *
 * Two modes
 * ---------
 * - **Dev mode** (inside the Vite browser dev-server): PGlite runs in-memory,
 *   accessed directly with SQL queries — no Prisma.  The Prisma runtime
 *   depends on Node built-ins that the browser cannot provide, so we bypass
 *   it entirely for development.
 * - **Tauri mode** (inside the webview of a built app): PrismaClient is
 *   available (because the Tauri webview runs in a real Chromium/WebKit
 *   context where our polyfills apply) and all domain services work
 *   through the full type-safe Prisma API.
 *
 * Schema-upgrade-on-existing-install is deliberately unsolved here; see
 * README in this module for the open question.
 */

import { PGlite } from '@electric-sql/pglite';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';

/**
 * Detect whether the app is running inside a Tauri webview.
 * Outside Tauri (e.g. browser dev server) we fall back to an in-memory PGlite
 * database so the UI is still navigable during development.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Resolve the OS app-local-data directory used by Tauri.
 * Returns an empty string outside Tauri so callers can detect the environment.
 */
export async function getAppLocalDataDir(): Promise<string> {
  if (!isTauri()) return '';
  const { appLocalDataDir } = await import('@tauri-apps/api/path');
  return appLocalDataDir();
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let instance: { client: PGlite; prisma: unknown } | null = null;
let initPromise: Promise<{ client: PGlite; prisma: unknown }> | null = null;

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the given table exists in the public schema.
 */
async function tableExists(client: PGlite, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = $1
     ) AS exists`,
    [tableName],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Apply the full local-schema DDL.  Runs inside a single multi-statement
 * execution; PGlite treats them as one implicit transaction.
 */
async function applySchema(client: PGlite): Promise<void> {
  // Discard the leading "CREATE SCHEMA IF NOT EXISTS "public";" —
  // PGlite 0.5+ already has a "public" schema.
  const sql = LOCAL_SCHEMA_SQL
    .replace(/^--\s*CreateSchema[\s\S]*?CREATE SCHEMA IF NOT EXISTS "public";\s*/m, '')
    .trim();

  if (!sql) return;

  await client.exec(sql);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the singleton local-database handle, initialising it on first call.
 *
 * Safe to call concurrently — concurrent callers share a single initialisation
 * promise.  Returns the same `{ client, prisma }` object for the lifetime of
 * the webview.
 *
 * In a Tauri webview the returned `prisma` is a full PrismaClient instance
 * that domain services use directly.  In the browser dev-server `prisma` is
 * a bare-PGlite wrapper with a subset of the PrismaClient API so the UI
 * remains navigable during development.
 */
/**
 * Fetch PGlite WASM and data files from the `/pglite/` path served by the
 * Vite dev-server middleware (dev) or from the copied dist/pglite/ directory
 * (Tauri production build).
 *
 * PGlite normally resolves these files relative to its own module URL via
 * `new URL('./pglite.wasm', import.meta.url)`.  In Tauri's custom protocol
 * environment this URL resolution can fail, or the file may be served with
 * a wrong content type.  Providing the compiled modules explicitly bypasses
 * the URL-resolution path entirely.
 */
async function loadPgliteAssets(): Promise<{
  pgliteWasmModule: WebAssembly.Module;
  initdbWasmModule: WebAssembly.Module;
  fsBundle: Blob;
}> {
  /**
   * Fetch a URL and return the raw ArrayBuffer, throwing on non-OK responses
   * with a message that includes the HTTP status and the first bytes of the
   * body so we can diagnose content-type mismatches.
   */
  async function fetchBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}` +
          ` (Content-Type: ${response.headers.get('content-type') ?? 'none'})`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await response.arrayBuffer();
    const preview = Array.from(new Uint8Array(buffer.slice(0, 8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(
      `[local-database] Fetched ${url}: ${buffer.byteLength} bytes,` +
        ` Content-Type: ${contentType}, magic: 0x${preview}`,
    );
    return buffer;
  }

  // Fetch raw buffers first, then compile.  This gives us a chance to inspect
  // the response before WebAssembly.compileStreaming fails on bad content.
  const [pgliteWasmBuffer, initdbWasmBuffer, fsBundleResponse] = await Promise.all([
    fetchBuffer('/pglite/pglite.wasm'),
    fetchBuffer('/pglite/initdb.wasm'),
    fetch('/pglite/pglite.data').then((r) => {
      if (!r.ok)
        throw new Error(
          `Failed to fetch /pglite/pglite.data: ${r.status} ${r.statusText}`,
        );
      return r.blob();
    }),
  ]);

  const pgliteWasmModule = await WebAssembly.compile(pgliteWasmBuffer);
  const initdbWasmModule = await WebAssembly.compile(initdbWasmBuffer);
  const fsBundle = fsBundleResponse;

  return { pgliteWasmModule, initdbWasmModule, fsBundle };
}

export async function getLocalDatabase(): Promise<{
  client: PGlite;
  prisma: unknown;
}> {
  if (instance) return instance;

  if (!initPromise) {
    initPromise = (async () => {
      let client: PGlite;

      // ---- Step 0: install fetch monkey-patch for PGlite asset requests ----
      // PGlite's internal Emscripten runtime and WASM loader use `fetch()` to
      // load .wasm and .data files from URLs relative to `import.meta.url`.
      // In Tauri's webview with Vite dev server, those URLs go through Vite's
      // static-file middleware which may serve .wasm files with a base64-wrapped
      // response instead of raw binary (because Vite's module transform can
      // rewrite .wasm imports).  Our Vite catch-all middleware runs *after*
      // Vite's static server in the Connect stack and never sees these requests.
      //
      // This patch intercepts any fetch whose URL ends with a PGlite asset
      // filename and redirects it to our known-good `/pglite/` URL prefix,
      // which is served with correct binary content by the Vite middleware.
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        const filename = url.split('/').pop()?.split('?')[0] ?? '';
        if (
          filename === 'pglite.wasm' ||
          filename === 'initdb.wasm' ||
          filename === 'pglite.data'
        ) {
          const mappedUrl = `/pglite/${filename}`;
          // eslint-disable-next-line no-console
          console.log(
            `[local-database] fetch redirect: "${url}" → "${mappedUrl}"`,
          );
          return originalFetch(mappedUrl, init);
        }
        return originalFetch(input, init);
      };

      // ---- Step 1: load WASM assets via fetch ----
      // eslint-disable-next-line no-console
      console.log('[local-database] Loading PGlite WASM assets...');
      let pgliteWasmModule: WebAssembly.Module;
      let initdbWasmModule: WebAssembly.Module;
      let fsBundle: Blob;
      try {
        const assets = await loadPgliteAssets();
        pgliteWasmModule = assets.pgliteWasmModule;
        initdbWasmModule = assets.initdbWasmModule;
        fsBundle = assets.fsBundle;
      } catch (assetsError) {
        console.error(
          '[local-database] FAILED to load PGlite WASM assets:',
          assetsError,
        );
        throw assetsError;
      }

      // ---- Step 2: create PGlite instance with pre-compiled modules ----
      // Install a one-shot handler to catch async errors thrown from inside
      // PGlite's internal initdb worker flow that aren't surfaced through the
      // returned promise (e.g. unhandled rejections in Emscripten's WASM init).
      const onRejection = (event: PromiseRejectionEvent) => {
        console.error(
          '[local-database] UNHANDLED REJECTION during PGlite init:',
          event.reason?.constructor?.name ?? typeof event.reason,
          event.reason,
        );
        if (event.reason?.stack) console.error('[local-database] Stack:', event.reason.stack);
        if (event.reason?.cause) console.error('[local-database] Cause:', event.reason.cause);
      };
      window.addEventListener('unhandledrejection', onRejection);
      try {
        if (isTauri()) {
          // Tauri environment: persist via PGlite's IdbFs (IndexedDB-backed
          // filesystem) using an `idb://` prefix.  Bare filesystem paths
          // (e.g. `C:\Users\...`) cause PGlite to select its NodeFS backend,
          // which requires real OS filesystem access unavailable in the
          // webview and triggers crashes via fs.lstat / fs.lstatSync.
          // See: https://github.com/electric-sql/pglite/issues/...
          // relaxedDurability: false ensures PGlite flushes storage on commit,
          // matching the durability expectations of an offline-first POS.
          //
          // Provide explicit WASM modules to avoid URL-resolution failures in
          // Tauri's custom-protocol webview.
          // eslint-disable-next-line no-console
          console.log('[local-database] Creating PGlite (Tauri mode: idb://pglite-data)...');
          client = await PGlite.create('idb://pglite-data', {
            relaxedDurability: false,
            pgliteWasmModule,
            initdbWasmModule,
            fsBundle,
          });
          console.log('[local-database] PGlite created successfully.');
        } else {
          // Browser / dev-server environment: use an ephemeral in-memory database.
          // Logged so developers know the data will not survive a page refresh.
          // eslint-disable-next-line no-console
          console.info('[local-database] Outside Tauri — using in-memory PGlite.');
          client = await PGlite.create('memory://', {
            pgliteWasmModule,
            initdbWasmModule,
            fsBundle,
          });
        }
        window.removeEventListener('unhandledrejection', onRejection);
      } catch (pgliteError) {
        window.removeEventListener('unhandledrejection', onRejection);
        console.error(
          '[local-database] FAILED to create PGlite instance:',
          pgliteError?.constructor?.name ?? typeof pgliteError,
          pgliteError,
        );
        if (pgliteError instanceof Error) {
          console.error('[local-database]   message:', pgliteError.message);
          console.error('[local-database]   stack:', pgliteError.stack);
          if ((pgliteError as any).cause) console.error('[local-database]   cause:', (pgliteError as any).cause);
        }
        throw pgliteError;
      }

      // Check whether this is a fresh database
      const isEmpty = !(await tableExists(client, 'Client'));

      if (isEmpty) {
        await applySchema(client);
      }

      let prisma: unknown;

      if (isTauri()) {
        // Tauri mode: full PrismaClient with pglite-prisma-adapter (Prisma
        // runtime is available because Tauri's Chromium webview supports our
        // polyfills).
        const { PrismaPGlite } = await import('pglite-prisma-adapter');
        const { PrismaClient } = await import('@pharmacy/database/local');
        const adapter = new PrismaPGlite(client);
        const pc = new PrismaClient({ adapter });
        await pc.$connect();
        prisma = pc;
      } else {
        // Dev mode: return a thin compatibility wrapper so consuming services
        // that expect a PrismaClient don't crash at import time.
        prisma = createDevPrismaWrapper(client);
      }

      instance = { client, prisma };
      return instance;
    })();
  }

  return initPromise;
}

/**
 * Tear down the local database — close PGlite and Prisma, reset the
 * singleton.  Useful in tests and after a full sync reset.
 */
export async function closeLocalDatabase(): Promise<void> {
  if (instance) {
    if (isTauri()) {
      const pc = instance.prisma as { $disconnect: () => Promise<void> };
      await pc.$disconnect();
    }
    await instance.client.close();
    instance = null;
  }
  initPromise = null;
}

// ---------------------------------------------------------------------------
// Dev-mode PrismaClient shim
// ---------------------------------------------------------------------------

/**
 * Create a minimal shim that looks like a PrismaClient well enough for domain
 * services to construct (they only store the reference) without actually
 * importing the Prisma runtime.
 *
 * In dev mode, domain services can initialise but will fail at runtime if
 * they try to use prisma.  This is acceptable because the dev server is
 * used primarily for UI development, not full offline POS transactions.
 */
function createDevPrismaWrapper(client: PGlite): unknown {
  // Return a proxy that logs a warning on first property access.
  let warned = false;
  return new Proxy(
    { _client: client },
    {
      get(target, prop) {
        if (prop === '$connect') return () => Promise.resolve();
        if (prop === '$disconnect') return () => Promise.resolve();
        if (prop === '$on') return () => undefined;
        if (prop === '$extends') return () => target;
        if (prop === 'constructor') return Object;
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        if (!warned) {
          warned = true;
          console.warn(
            '[local-database] Dev-mode PrismaClient shim in use. ' +
            'Property "%s" was accessed but no Prisma models are available. ' +
            'Run `tauri dev` or build for full functionality.',
            String(prop),
          );
        }
        return undefined;
      },
    },
  );
}