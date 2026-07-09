/**
 * Polyfill for `node:crypto` so Prisma 7 runtime and sync services can be
 * bundled by Vite in a browser / Tauri-webview environment.
 *
 * Prisma's runtime imports:
 *   - `webcrypto`     → delegate to globalThis.crypto
 *   - `randomUUID`    → delegate to globalThis.crypto.randomUUID()
 *   - `randomBytes`   → delegate to globalThis.crypto.getRandomValues()
 *   - `randomFillSync`→ delegate to globalThis.crypto.getRandomValues()
 */

const crypto = globalThis.crypto;

export const webcrypto = crypto;
export const randomUUID = (): string => crypto.randomUUID();
export const randomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
};
export const randomFillSync = (
  buffer: Uint8Array,
  offset = 0,
  size?: number,
): Uint8Array => {
  const view = size != null ? buffer.subarray(offset, offset + size) : buffer;
  crypto.getRandomValues(view);
  return buffer;
};

export default { webcrypto, randomUUID, randomBytes, randomFillSync };