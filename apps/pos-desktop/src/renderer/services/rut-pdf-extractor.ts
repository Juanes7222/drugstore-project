/**
 * RUT PDF text extractor — thin pdf.js wrapper.
 *
 * The DIAN RUT PDF ships with a selectable text layer, so text extraction
 * (not OCR) is enough to autofill the company profile. pdf.js runs fully
 * in the webview — no server round-trip, consistent with the offline-first
 * architecture.
 *
 * Kept separate from the parser so tests can exercise the pure parser with
 * text fixtures and inject a fake extractor into the hook.
 */

import * as pdfjsLib from 'pdfjs-dist';

let workerConfigured = false;

/**
 * Extract the full text layer of a RUT PDF file.
 *
 * @throws when the file cannot be opened or has no readable text layer.
 */
export async function extractRutPdfText(file: File | Blob): Promise<string> {
  if (!workerConfigured) {
    // Vite resolves the worker asset URL at build time; the worker is
    // bundled with the app so extraction works offline.
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }
    return pages.join('\n');
  } finally {
    // Release the document's memory; the worker stays alive for reuse.
    await pdf.cleanup();
  }
}