/**
 * CSV serialization helpers shared by the backoffice export endpoints.
 * Pure formatting only — no data access; services map rows to string cells.
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class CsvBuilderService {
  private static readonly UTF8_BOM = '\uFEFF';
  private static readonly CELL_SPECIAL_CHARACTERS = /[",\r\n]/;

  /**
   * Escape a single cell per RFC 4180: wrap in quotes when it contains the
   * delimiter, a quote, or a line break, doubling embedded quotes.
   */
  escapeCell(value: string): string {
    if (CsvBuilderService.CELL_SPECIAL_CHARACTERS.test(value)) {
      return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
  }

  /**
   * Build the full CSV payload for an HTTP response. Rows are joined with
   * CRLF and the content is prefixed with a UTF-8 BOM so Excel renders
   * accented characters correctly.
   */
  buildCsv(
    headerRow: readonly string[],
    dataRows: readonly string[][],
  ): string {
    const lines = [headerRow, ...dataRows].map((row) =>
      row.map((cell) => this.escapeCell(cell)).join(','),
    );
    return `${CsvBuilderService.UTF8_BOM}${lines.join('\r\n')}\r\n`;
  }

  /**
   * Format a timestamp as `YYYY-MM-DD HH:mm` in UTC so exported files are
   * deterministic regardless of server locale; empty string when null.
   */
  formatDateTime(date: Date | null): string {
    if (!date) {
      return '';
    }
    const pad = (value: number): string => String(value).padStart(2, '0');
    const iso = date.toISOString();
    return `${iso.slice(0, 10)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  /**
   * File-name stamp `YYYYMMDD-HHmm` (UTC) used in Content-Disposition.
   */
  exportFileStamp(now: Date = new Date()): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return (
      `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
      `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
    );
  }
}
