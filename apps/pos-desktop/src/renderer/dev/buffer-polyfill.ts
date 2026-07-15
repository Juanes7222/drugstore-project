/**
 * Polyfill for `node:buffer` so Prisma generated client can be bundled in a
 * browser / Tauri-webview environment.
 *
 * Prisma 7.8.0's generated local client calls Buffer.from(wasmBase64, 'base64')
 * to decode the WASM query compiler.  This polyfill provides a browser-native
 * implementation using atob() for base64 decoding, plus a fallback for plain
 * string encoding with TextEncoder.
 *
 * Also sets globalThis.Buffer so code that references Buffer as a global
 * (e.g. the Prisma runtime's internal pg client) does not throw.
 *
 * NOTE: This resolves at compile-time via Vite's resolve.alias for
 *       `node:buffer` → buffer-polyfill.ts in the existing vite.config.ts.
 */

// ---------- polyfill object ----------

const bufferShim = {
  alloc(size: number, fill?: number): Uint8Array {
    const buf = new Uint8Array(size);
    if (fill !== undefined) buf.fill(fill);
    return buf;
  },
  from(data: ArrayLike<number> | string, encoding?: string): Uint8Array {
    if (typeof data === 'string') {
      if (encoding === 'base64') {
        // Browser-native base64 decoding.  atob() returns a raw ASCII string;
        // we convert each char to its byte value in a Uint8Array.
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
      return new TextEncoder().encode(data);
    }
    return new Uint8Array(data);
  },
  isBuffer(_obj: unknown): boolean {
    return false;
  },
  byteLength(str: string, _encoding?: string): number {
    return new TextEncoder().encode(str).length;
  },
} as const;

// ---------- set global ----------

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as Record<string, unknown>).Buffer = bufferShim;
}

// ---------- named export (for `import { Buffer } from "node:buffer"`) ----------

export const Buffer = globalThis.Buffer as typeof bufferShim;

// ---------- default export (for namespace imports) ----------

export default { Buffer };
