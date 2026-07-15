import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve, join } from "path";
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "fs";

const host = process.env.TAURI_DEV_HOST;

/**
 * Resolve the PGlite dist directory from the project's node_modules.
 * Uses pnpm's nested structure first, falls back to flat node_modules.
 */
function resolvePgliteDist(): string | null {
  const candidates = [
    // pnpm store — @electric-sql+pglite@0.5.4 with PeerDependencies
    resolve(__dirname, "../../node_modules/.pnpm/@electric-sql+pglite@0.5.4/node_modules/@electric-sql/pglite/dist"),
    // pnpm store — @electric-sql+pglite@0.5.4 without PeerDependencies
    resolve(__dirname, "../../node_modules/.pnpm/@electric-sql+pglite@0.5.4/node_modules/@electric-sql/pglite/dist"),
    // flat node_modules
    resolve(__dirname, "../../node_modules/@electric-sql/pglite/dist"),
    // local node_modules (for linked packages)
    resolve(__dirname, "node_modules/@electric-sql/pglite/dist"),
  ];
  for (const p of candidates) {
    try {
      accessSync(join(p, "pglite.wasm"), constants.R_OK);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Vite plugin that serves PGlite's WASM binaries and extension tarballs at
 * the `/pglite/` URL path so that PGlite's browser fetch() backend can load
 * them during initialisation.
 *
 * PGlite expects these assets at `WASM_PREFIX = "/pglite"`.  In production
 * (Tauri build) the files are copied into the frontend dist directory by
 * the build hook.
 */
function pgliteAssetsPlugin(): Plugin {
  const pgliteDist = resolvePgliteDist();
  if (!pgliteDist) {
    console.warn(
      "[pglite-assets] Could not find PGlite dist directory. " +
      "WASM loading may fall back to the network at /pglite/... " +
      "Install @electric-sql/pglite and verify its dist/ contains pglite.wasm",
    );
    return {
      name: "pglite-assets",
      apply: "build",
    };
  }

  return {
    name: "pglite-assets",
    apply: "serve",
    configureServer(server) {
      // Serve PGlite's dist/ files at the `/pglite/` URL prefix so that
      // PGlite's fetch()-based asset loading works in dev mode.
      const extMap: Record<string, string> = {
        ".wasm": "application/wasm",
        ".tar.gz": "application/gzip",
        ".js": "application/javascript",
        ".map": "application/json",
      };

      // Diagnostic endpoint — visit http://localhost:5173/pglite/__diag
      // to verify the middleware is active and see the resolved dist path.
      server.middlewares.use("/pglite/__diag", (_req, res) => {
        const list = existsSync(pgliteDist)
          ? readdirSync(pgliteDist).filter((f) => f.endsWith('.wasm') || f.endsWith('.data'))
          : [];
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            {
              status: 'ok',
              pgliteDist,
              exists: existsSync(pgliteDist),
              wasmFiles: list.map((f) => ({
                name: f,
                size: existsSync(join(pgliteDist, f))
                  ? statSync(join(pgliteDist, f)).size
                  : -1,
              })),
            },
            null,
            2,
          ),
        );
      });

      // ---- catch-all for PGlite WASM/data files (added FIRST in the Connect
      // stack so it runs BEFORE Vite's built-in static file server) ----
      // PGlite internally uses `new URL("./pglite.wasm", import.meta.url)`
      // which resolves to a Vite node_modules path like
      //   /node_modules/.pnpm/@electric-sql+pglite@0.5.4/node_modules/.../pglite.wasm
      // Vite's static file server may serve .wasm files with base64 content
      // encoding instead of raw binary.  By inserting our handler at position
      // 0 in the Connect stack, we intercept these requests before Vite does.
      // ── Extended catch-all: intercepts ALL .wasm files at ANY URL path ──
      // PGlite's second instance (for initdb) and Prisma's engine WASM both
      // request .wasm files from various node_modules paths.  Vite's built-in
      // module transform middleware may serve .wasm files with a base64-wrapped
      // response instead of raw binary, which causes WebAssembly.Module() to
      // fail with "expected magic word 00 61 73 6d, found 41 47 46 7a" (the
      // bytes 41 47 46 7a are the base64 encoding of the WASM magic \0asm).
      //
      // By catching ALL .wasm requests at position 0 in the Connect stack we
      // guarantee raw binary content regardless of the caller's URL path.
      //
      // PGlite's data file (pglite.data) is also intercepted here because some
      // internal Emscripten data-loading paths may attempt to fetch it.
      const catchAllHandler = (req: any, res: any, next: any) => {
        if (req.method !== 'GET') return next();
        const pathname = req.url ?? '';
        const basename = pathname.split('/').pop()?.split('?')[0] ?? '';
        // Intercept W A S M files (any path, any .wasm) + pglite.data
        if (basename.endsWith('.wasm')) {
          // Try the PGlite dist first, then fall back to resolving from
          // node_modules via Vite's static server (by calling next()).
          if (basename === 'pglite.wasm' || basename === 'initdb.wasm') {
            const pgliteFilePath = join(pgliteDist, basename);
            try {
              if (existsSync(pgliteFilePath)) {
                const content = readFileSync(pgliteFilePath);
                console.log(
                  `[pglite-assets] WASM: "${pathname}" → "${basename}" (${content.length} bytes)`,
                );
                res.writeHead(200, {
                  'Content-Type': 'application/wasm',
                  'Content-Length': content.length,
                });
                res.end(content);
                return;
              }
            } catch { /* fall through to next middleware */ }
          }
          // For non-PGlite .wasm files (e.g. Prisma query engine), we need to
          // serve them as raw binary.  Vite's static server normally does this
          // correctly, but we add an extra safety header and log the request.
          console.log(
            `[pglite-assets] WASM (passthrough): "${pathname}"`,
          );
          return next();
        }
        if (basename === 'pglite.data') {
          const filePath = join(pgliteDist, basename);
          try {
            if (existsSync(filePath)) {
              const content = readFileSync(filePath);
              console.log(
                `[pglite-assets] DATA: "${pathname}" → "${basename}" (${content.length} bytes)`,
              );
              res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': content.length,
              });
              res.end(content);
              return;
            }
          } catch { /* fall through */ }
        }
        return next();
      };
      // Insert at the beginning of the Connect middleware stack so it takes
      // priority over Vite's built-in static file server for these assets.
      server.middlewares.stack.unshift({ route: '', handle: catchAllHandler });

      server.middlewares.use("/pglite", (req, res, next) => {
        // Connect calls this handler for any request starting with "/pglite".
        // req.url is the FULL path (e.g. "/pglite/pglite.wasm"), NOT stripped.
        // We strip the "/pglite/" prefix to get the relative file inside the
        // PGlite dist directory.
        const relativePath = req.url?.replace(/^\/pglite\//, "") ?? "";
        if (!relativePath) return next();
        const decodedPath = decodeURIComponent(relativePath);
        const filePath = join(pgliteDist, decodedPath);

        console.log(
          `[pglite-assets] REQ: "${req.url}" → rel: "${relativePath}" → file: "${filePath}"`,
        );

        try {
          if (!existsSync(filePath)) {
            console.warn(`[pglite-assets] NOT FOUND: ${filePath}`);
            return next();
          }
          const content = readFileSync(filePath);
          const ext = Object.keys(extMap).find((e) => decodedPath.endsWith(e));
          const contentType = ext ? extMap[ext] : "application/octet-stream";
          console.log(
            `[pglite-assets] OK: "${decodedPath}" (${content.length} bytes, ${contentType})`,
          );
          res.writeHead(200, { "Content-Type": contentType, "Content-Length": content.length });
          res.end(content);
        } catch (err) {
          console.error(`[pglite-assets] ERR: "${filePath}":`, err);
          next();
        }
      });
    },
  };
}

/**
 * Rollup/Vite plugin that copies PGlite WASM assets into the production build
 * output under `/pglite/` during `vite build`.
 */
function pgliteAssetsBuildPlugin(): Plugin {
  const pgliteDist = resolvePgliteDist();
  if (!pgliteDist) {
    return { name: "pglite-assets-build", apply: "build" };
  }

  return {
    name: "pglite-assets-build",
    apply: "build",
    async writeBundle(options) {
      const { cp } = await import("fs/promises");
      const { join } = await import("path");
      const outDir = options.dir ?? resolve(__dirname, "dist");
      const targetDir = join(outDir, "pglite");
      await cp(pgliteDist, targetDir, { recursive: true, force: true });
    },
  };
}

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), pgliteAssetsPlugin(), pgliteAssetsBuildPlugin(),

    // ---- Prisma WASM query compiler patch ----
    // Prisma 7's generated decodeBase64AsWasm() uses Node.js
    // Buffer.from(b64,'base64') via import('node:buffer'), which is unavailable
    // in the browser/Tauri webview.  This plugin rewrites that function at
    // transform time to use browser-native atob() instead, without modifying
    // the Prisma-generated file on disk.
    {
      name: "prisma-wasm-patch",
      enforce: "pre",
      transform(code: string, id: string): string | null {
        if (
          id.includes("packages/database/generated/local-client/internal/class.ts") &&
          code.includes("import('node:buffer')")
        ) {
          const original = [
            `async function decodeBase64AsWasm(wasmBase64: string): Promise<WebAssembly.Module> {`,
            `  const { Buffer } = await import('node:buffer')`,
            `  const wasmArray = Buffer.from(wasmBase64, 'base64')`,
            `  return new WebAssembly.Module(wasmArray)`,
            `}`,
          ].join('\n');
          const replacement = [
            `async function decodeBase64AsWasm(wasmBase64: string): Promise<WebAssembly.Module> {`,
            `  const binary = atob(wasmBase64);`,
            `  const bytes = new Uint8Array(binary.length);`,
            `  for (let i = 0; i < binary.length; i++) {`,
            `    bytes[i] = binary.charCodeAt(i);`,
            `  }`,
            `  return new WebAssembly.Module(bytes);`,
            `}`,
          ].join('\n');
          const patched = code.replace(original, replacement);
          if (patched !== code) {
            console.log(`[prisma-wasm-patch] Patched decodeBase64AsWasm in ${id}`);
            return patched;
          }
        }
        return null;
      },
    },

    // ---- global process polyfill injected before any module script ----
    // Patches the Tauri-injected global `process` so Emscripten (inside PGlite)
    // doesn't think it's in a Node.js environment.
    {
      name: "process-polyfill",
      apply: "serve",
      transformIndexHtml() {
        return [
          {
            tag: "script",
            children: `
(function(){
  try {
    var p = typeof process !== "undefined" ? process : undefined;
    if (p) {
      // Override versions.node — Emscripten checks this to decide
      // ENVIRONMENT_IS_NODE.  In a browser/webview it must NOT be a string.
      if (p.versions) {
        Object.defineProperty(p.versions, "node", {
          get: function() { return undefined; },
          set: function() {},
          configurable: false,
          enumerable: true,
        });
      }
      // process.binding — Emscripten NODEFS backend calls this.
      // We make it throw so Emscripten falls back to MEMFS (in-memory FS).
      if (typeof p.binding !== "function") {
        p.binding = function() { throw new Error("process.binding polyfilled"); };
      }
    }
  } catch(e) {
    // Silently ignore — if process is not available, the module-level
    // polyfills in node-polyfills.ts will handle things.
  }
})();
            `,
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],

  resolve: {
    alias: [
      // ---- workspace package aliases (exact string prefix matching) ----
      { find: "@", replacement: resolve(__dirname, "./src/renderer") },
      { find: "@infra", replacement: resolve(__dirname, "./src/infrastructure") },
      // IMPORTANT: more-specific aliases must come BEFORE less-specific ones so
      // Vite resolves e.g. @pharmacy/database/local to the correct file rather
      // than appending "/local" to the generic @pharmacy/database path.
      { find: "@pharmacy/database/local-schema", replacement: resolve(__dirname, "../../packages/database/src/local-schema.ts") },
      { find: "@pharmacy/database/local", replacement: resolve(__dirname, "../../packages/database/src/local.ts") },
      { find: "@pharmacy/database", replacement: resolve(__dirname, "../../packages/database/src/index.ts") },
      { find: "@pharmacy/shared-types", replacement: resolve(__dirname, "../../packages/shared-types/src/index.ts") },
      { find: "@pharmacy/shared-validation", replacement: resolve(__dirname, "../../packages/shared-validation/src/index.ts") },

      // ---- node:* polyfill aliases (exact string prefix matching) ----
      { find: "node:url", replacement: resolve(__dirname, "./src/renderer/dev/empty-url-polyfill.ts") },
      { find: "node:crypto", replacement: resolve(__dirname, "./src/renderer/dev/empty-crypto-polyfill.ts") },
      { find: "node:async_hooks", replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },
      { find: "node:events", replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },
      { find: "node:os", replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },
      { find: "node:module", replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },
      { find: "node:process", replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },
      { find: "node:path", replacement: resolve(__dirname, "./src/renderer/dev/path-polyfill.ts") },
      { find: "node:buffer", replacement: resolve(__dirname, "./src/renderer/dev/buffer-polyfill.ts") },
      { find: "node:fs", replacement: resolve(__dirname, "./src/renderer/dev/fs-polyfill.ts") },

      // ---- bare builtin aliases (RegExp — exact match only) ----
      // These use /^...$/ so they don't match as prefixes: e.g. `fs` must
      // NOT also match `fs/promises`.
      { find: /^path$/, replacement: resolve(__dirname, "./src/renderer/dev/path-polyfill.ts") },
      { find: /^fs$/, replacement: resolve(__dirname, "./src/renderer/dev/fs-polyfill.ts") },
      // PGlite's chunk-VVBUWNGP.js dynamically imports "fs/promises" inside
      // an `if (IN_NODE)` block that never fires in the webview.  The alias
      // exists only to satisfy Vite's module graph scanner.
      { find: /^fs\/promises$/, replacement: resolve(__dirname, "./src/renderer/dev/fs-promises-polyfill.ts") },
      // Bare `buffer` (without `node:` prefix) — some CJS deps do
      // require('buffer') instead of require('node:buffer').
      { find: /^buffer$/, replacement: resolve(__dirname, "./src/renderer/dev/buffer-polyfill.ts") },
      // Bare `module` (without `node:` prefix) — PGlite's Emscripten runtime
      // calls `createRequire` from the bare `module` builtin during WASM
      // initialisation.  We redirect it to the unified node-polyfills module
      // which provides a `createRequire` stub registered with `node:*` shims.
      { find: /^module$/, replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },
      // Bare `url` (without `node:` prefix) — Emscripten runtime calls
      // `require("url")` for `fileURLToPath` during WASM initialisation.
      { find: /^url$/, replacement: resolve(__dirname, "./src/renderer/dev/empty-url-polyfill.ts") },
      // Bare `process` (without `node:` prefix) — some deps reference
      // `process` directly rather than `node:process` (e.g. certain CJS
      // bundles that check `typeof process`).
      { find: /^process$/, replacement: resolve(__dirname, "./src/renderer/dev/node-polyfills.ts") },

      // ---- CJS npm package polyfill aliases — esbuild pre-bundling can't
      // handle these because they're deep transitive deps of excluded
      // packages (@prisma/client).  We substitute a local ESM copy here
      // instead.  String-prefix matching is fine because these are bare
      // package names that never appear as prefixes of other packages.
      { find: "postgres-array", replacement: resolve(__dirname, "./src/renderer/dev/postgres-array-polyfill.ts") },
    ],
  },

  // Exclude @prisma/client and the PGlite adapter from Vite's pre-bundling so
  // that our resolve.alias polyfills for node:url and node:crypto take effect
  // at the module level.  When Vite pre-bundles them into node_modules/.vite/
  // the alias resolution happens too late and the polyfills are not applied.
  //
  // Some CJS transitive deps of @prisma/client (postgres-array, pg-types)
  // are NOT discoverable by Vite's dependency crawler because @prisma/client
  // is excluded from crawling.  For these we use resolve.alias to substitute
  // a local ESM polyfill (see postgres-array above).  Other pg-types
  // siblings are explicitly included so esbuild converts their CJS exports.
  optimizeDeps: {
    exclude: [
      // ---- workspace packages (serve source directly) ----
      "@pharmacy/database",
      "@pharmacy/database/local",
      // ---- PGlite WASM runtime — excluded so new URL("./pglite.wasm", import.meta.url)
      // stays relative.  When pre-bundled, esbuild resolves this to an absolute pnpm
      // store path served through Vite with incorrect content encoding. ----
      "@electric-sql/pglite",
      // ---- Prisma runtime (needs node:* polyfills applied at module level) ----
      "@prisma/client",
      "pglite-prisma-adapter",
    ],
    include: [
      // pg-types & its CJS dependencies — pre-bundle for CJS→ESM interop.
      // postgres-array is NOT listed here because it has a local ESM
      // polyfill alias instead (see resolve.alias above).
      "postgres-bytea",
      "postgres-date",
      "postgres-interval",
      "pg-int8",
    ],
  },

  // Make Vite treat these workspace dependencies as not external during SSR/Tauri
  // builds so they are bundled inline rather than left as bare imports.
  ssr: {
    noExternal: [
      "@pharmacy/database",
      "@pharmacy/database/local",
    ],
  },

  // Treat .wasm files as static assets (raw binary served as-is) rather than
  // processing them through Vite's module transform pipeline which may inline
  // them as base64.  PGlite's internal worker, Prisma's WASM engine, and any
  // other .wasm fetch MUST receive raw binary for WebAssembly.compile() to work.
  assetsInclude: ['.wasm'],

  // Vite options tailored for Tauri development
  // PGlite uses Web Workers internally — 'es' format ensures correct module
  // loading and WASM instantiation in both dev and production builds.
  worker: {
    format: 'es',
  },

  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5173,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Allow Vite's dev server to serve PGlite's distribution binaries and
    // extension tarballs from node_modules so the middleware can access them.
    fs: {
      allow: [
        "..",
        // PGlite dist under pnpm store / node_modules for WASM asset serving
        resolve(__dirname, "../../node_modules"),
        // Workspace root — Prisma-generated client lives in
        // packages/database/generated/local-client/ which Vite must be
        // allowed to serve.
        searchForWorkspaceRoot(process.cwd()),
      ],
    },
  },

  // ---- Runtime global define polyfills ----
  // These are applied by esbuild (pre-bundling) and Vite (source transform)
  // to ALL processed source code, including PGlite's pre-bundled Emscripten
  // chunk.  They prevent Emscripten from using Node.js code paths in the
  // browser/webview.
  //
  // process.versions.node — Emscripten checks this to decide
  // ENVIRONMENT_IS_NODE.  Replacing it with void 0 makes both
  // ENVIRONMENT_IS_NODE and IN_NODE evaluate to false, so Emscripten uses
  // the Web/browser code paths (fetch() for WASM loading, MEMFS for the
  // virtual filesystem) instead of Node.js paths.
  //
  // process.binding — Emscripten NODEFS backend calls process.binding('fs')
  // to get native filesystem bindings.  We replace the property access so
  // the source code receives a throwing function instead of undefined.
  define: {
    "process.versions.node": "void 0",
    "process.binding": "(function(n) { throw new Error('process.binding polyfilled: ' + n); })",
  },

  // Env variables starting with TAURI_ will be exposed to tauri's source code
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: "esnext",
    // don't minify for debug builds
    minify: process.env.TAURI_DEBUG ? false : ("esbuild" as const),
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/index.ts",
        "src/**/*.types.ts",
        "src/**/*.mock.ts",
        "src/renderer/dev/**",
        "src/renderer/styles/**",
        "src/renderer/i18n/locales/**",
        "src/renderer/main.tsx",
        "src/help-content/**",
        "src-tauri/**",
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    css: true,
  },
}));
