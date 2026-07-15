/**
 * Runtime polyfill for `fs/promises` in a browser / Tauri-webview context.
 *
 * PGlite 0.5.x imports `fs/promises` inside an `if (IN_NODE)` block.  When
 * IN_NODE evaluates to true (which can happen if the Tauri / Vite runtime
 * provides a global `process` object with `versions.node`), PGlite calls
 * `readFile(path)` to load its WASM binaries instead of using `fetch()`.
 *
 * This polyfill proxies those calls through `fetch()` so the app survives
 * regardless of the IN_NODE flag.  The `path` argument is expected to be a
 * URL path (e.g. `/pglite/amcheck.tar.gz`) that the Vite dev server or the
 * Tauri asset resolver can serve.
 */

export async function readFile(
  path: string,
  _options?: { encoding?: string } | string | null,
): Promise<Uint8Array<ArrayBufferLike>> {
  // In a Tauri webview, the WASM asset paths use POSIX-style paths starting
  // with "/pglite/..."  which can be fetched from the page origin.
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `fs.promises.readFile polyfill: fetch('${path}') returned ${response.status} ${response.statusText}. ` +
        `To fix, ensure the PGlite WASM assets are served at the expected path.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export default { readFile };
