/**
 * Source-format dispatch — resolves the format from the file and delegates
 * to the matching parser. Mirrors the server's ImportSourceAdapter wiring.
 */

import { detectImportFormat, type ImportSourceFormat } from "../import-common";
import type { ParsedImportTable } from "../import.types";
import { parseCsv } from "./csv.parser";
import { parseExcel } from "./excel.parser";
import { parseJson } from "./json.parser";

/** Parse any supported import file into a header-keyed table. */
export async function parseImportFile(
  fileName: string,
  data: ArrayBuffer,
): Promise<{ format: ImportSourceFormat; table: ParsedImportTable }> {
  const format = detectImportFormat(fileName, data);
  const table =
    format === "CSV"
      ? await parseCsv(data)
      : format === "XLSX"
        ? await parseExcel(data)
        : await parseJson(data);
  return { format, table };
}
