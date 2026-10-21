/**
 * Polyfill for the `SharedArrayBuffer` global.
 *
 * `SharedArrayBuffer` only exists in cross-origin isolated contexts. The
 * packaged Tauri app is served from the custom protocol without COOP/COEP
 * headers, so the global is undefined there and every
 * `instanceof SharedArrayBuffer` check throws a ReferenceError.
 *
 * Prisma's raw-query serializer runs exactly that check on every value it
 * serialises, which breaks every parameterized `$queryRaw*` call — e.g. the
 * client's sales history in the client detail dialog.
 *
 * Aliasing the global to ArrayBuffer makes those checks work. Nothing in the
 * app needs actually shared memory (jsPDF ships the same fallback).
 */

export function ensureSharedArrayBuffer(): void {
  if (typeof (globalThis as any).SharedArrayBuffer === "undefined") {
    (globalThis as any).SharedArrayBuffer = ArrayBuffer;
  }
}

ensureSharedArrayBuffer();
