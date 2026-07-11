/**
 * Browser-side file download helpers.
 *
 * Creates a temporary Blob URL, triggers a download via a hidden anchor
 * element, and immediately revokes the object URL to avoid memory leaks.
 *
 * @module download
 */

/**
 * Trigger an immediate file download in the browser.
 *
 * @param content  - Raw string content (CSV, JSON, text, etc.).
 * @param filename - Suggested filename including extension.
 * @param mimeType - MIME type for the Blob (e.g. `text/csv;charset=utf-8;`).
 */
export function downloadBlob(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
