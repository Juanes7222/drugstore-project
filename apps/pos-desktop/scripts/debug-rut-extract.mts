/**
 * Debug script: extract the text layer of a RUT PDF with pdfjs-dist
 * (legacy Node build), rebuild visual lines like the browser extractor
 * does, run the real parser and print the result.
 *
 * Usage: npx tsx scripts/debug-rut-extract.mts <path-to-pdf>
 */
import { readFileSync } from 'node:fs';
import { buildTextLines } from '../src/domain/company/pdf-text-lines';
import { parseRutPdfText } from '../src/domain/company/rut-parser';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx tsx scripts/debug-rut-extract.mts <path-to-pdf>');
  process.exit(1);
}

async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(filePath));

  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  console.log(`pages: ${pdf.numPages}`);

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = buildTextLines(content.items);
    pages.push(lines.join('\n'));
    if (process.env.DEBUG_LINES) {
      console.log(`--- PAGE ${pageNumber} LINES (${lines.length}) ---`);
      lines.forEach((line, i) => console.log(`${String(i).padStart(3)}| ${line}`));
    }
  }

  const text = pages.join('\n');
  const result = parseRutPdfText(text);
  console.log('--- PARSE RESULT ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
