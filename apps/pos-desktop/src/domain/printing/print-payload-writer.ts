/**
 * Print payload writer — writes HTML/PDF content to a temp file and
 * returns its path for use with the PrintRouter.
 *
 * ## Two execution modes
 *
 * - **Tauri mode**: delegates to the Rust `write_temp_file` command which
 *   writes to the app local data directory (`print-queue/` subfolder).
 * - **Browser / dev mode**: creates an in-memory Blob URL. The print queue
 *   will detect this file doesn't exist on the real filesystem and queue
 *   the job for later processing when a Tauri backend is available.
 *
 * Usage (inside a domain service):
 *
 * ```ts
 * import { writePrintPayload } from '../printing/print-payload-writer';
 *
 * const path = await writePrintPayload(`receipt-${saleId}.html`, htmlContent);
 * await printRouter.print(PrintJobType.SALE_RECEIPT, {
 *   payloadPath: path,
 *   payloadType: 'HTML',
 *   saleId,
 * });
 * ```
 */

/**
 * Write a print payload to a temporary file and return its absolute path.
 *
 * @param filename  A unique filename (e.g. `receipt-abc123.html`)
 * @param content   The HTML, ESC/POS, or raw content to write
 * @returns The absolute file path to pass to PrintRouter.print()
 */
export async function writePrintPayload(
  filename: string,
  content: string,
): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('write_temp_file', {
      filename,
      content,
    });
    return path;
  } catch {
    // Fallback for browser dev mode or test environment
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return url;
  }
}
