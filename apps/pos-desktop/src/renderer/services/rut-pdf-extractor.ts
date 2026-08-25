/**
 * RUT PDF text extractor — thin pdf.js wrapper.
 *
 * The DIAN RUT PDF ships with a selectable text layer, so text extraction
 * (not OCR) is enough to autofill the company profile. pdf.js runs fully
 * in the webview — no server round-trip, consistent with the offline-first
 * architecture.
 *
 * The raw content stream of a form does not follow the visual reading
 * order, so items are reassembled into visual lines (see buildTextLines)
 * before being handed to the parser.
 *
 * Kept separate from the parser so tests can exercise the pure parser with
 * text fixtures and inject a fake extractor into the hook.
 */

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves `?url` imports at build time and bundles the worker asset,
// so extraction works offline. A bare specifier inside new URL(...) is NOT
// rewritten by Vite and 404s at runtime.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildTextLines } from '../../domain/company/pdf-text-lines';

let workerConfigured = false;

/**
 * Extract the visually ordered text lines of a RUT PDF file.
 *
 * @throws when the file cannot be opened or has no readable text layer.
 */
export async function extractRutPdfText(file: File | Blob): Promise<string> {
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        buildTextLines(
          content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item),
        ).join('\n'),
      );
    }
    return pages.join('\n');
  } finally {
    // Release the document's memory; the worker stays alive for reuse.
    await pdf.cleanup();
  }
}