/**
 * Minimal polyfill for `node:buffer` so Prisma generated client can be bundled
 * in a browser / Tauri-webview environment.
 *
 * The Prisma runtime rarely needs actual Buffer operations in a browser
 * context — this shim satisfies the import and provides the common static
 * methods that the generated code calls.
 */

export const Buffer = globalThis.Buffer ?? {
  alloc(size: number, fill?: number): Uint8Array {
    const buf = new Uint8Array(size);
    if (fill !== undefined) buf.fill(fill);
    return buf;
  },
  from(data: ArrayLike<number> | string, encoding?: string): Uint8Array {
    if (typeof data === 'string') {
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
};

export default { Buffer };