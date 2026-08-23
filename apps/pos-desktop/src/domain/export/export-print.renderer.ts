/**
 * Print renderer for generic export documents.
 *
 * Self-contained HTML document (same visual language as the report print
 * output) opened in a new window and sent to the printer.
 */

import {
  formatCell,
  isNumericColumn,
  resolveColumnHeader,
  tr,
} from '../../common/export';
import { getTenantInfo } from '../configuration/local-config.store';
import type { ExportDocument } from './export.types';

export function renderPrintHtml(document: ExportDocument): string {
  const tenant = getTenantInfo();
  const locale = document.locale ?? 'es-CO';

  const headers = document.columns
    .map(
      (column) =>
        `<th>${escapeHtml(resolveColumnHeader(column, document.t))}</th>`,
    )
    .join('');

  const rows = document.rows.length
    ? document.rows
        .map((row) => {
          const cells = document.columns
            .map((column) => {
              const className = isNumericColumn(column) ? 'numeric' : '';

              return `<td class="${className}">${escapeHtml(
                formatCell(row, column, locale),
              )}</td>`;
            })
            .join('');

          return `<tr>${cells}</tr>`;
        })
        .join('')
    : `<tr><td class="empty" colspan="${document.columns.length}">${escapeHtml(
        tr(document.t, 'export.noData', 'No hay datos para exportar.'),
      )}</td></tr>`;

  const metadata = buildMetadataHtml(document);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(tr(document.t, document.titleKey, document.titleFallback))}</title>
<style>
  :root {
    --pharma: #0B6E6B;
    --sync: #4A6572;
    --surface: #F9F6F0;
    --panel: #FFFFFF;
    --ink: #171614;
    --muted: #8B8A87;
    --border: #D4D2CC;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    color: var(--ink);
    background: var(--surface);
    font-family: Inter, Arial, sans-serif;
    font-size: 11px;
  }

  .header {
    padding: 18px 28px 16px;
    color: var(--panel);
    background: var(--pharma);
    border-bottom: 2px solid var(--sync);
  }

  .header h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .identity {
    margin-top: 5px;
    font-size: 9px;
    opacity: 0.9;
  }

  main {
    padding: 20px 28px 28px;
  }

  .report-title {
    margin: 0;
    font-size: 16px;
  }

  .source {
    margin: 4px 0 14px;
    color: var(--muted);
    font-size: 9px;
  }

  .metadata {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--border);
  }

  .metadata div {
    padding: 10px 12px;
    background: var(--panel);
  }

  .metadata span {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  table {
    width: 100%;
    margin-top: 14px;
    border: 1px solid var(--border);
    border-collapse: separate;
    border-spacing: 0;
    border-radius: 4px;
    overflow: hidden;
    background: var(--panel);
    font-size: 9px;
  }

  th {
    padding: 8px 7px;
    color: var(--panel);
    background: var(--pharma);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: left;
    text-transform: uppercase;
  }

  td {
    padding: 7px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  tbody tr:nth-child(even) {
    background: var(--surface);
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .numeric {
    text-align: right;
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    padding: 20px;
    color: var(--muted);
    text-align: center;
  }

  @media print {
    body {
      background: var(--panel);
    }

    main {
      padding: 16px;
    }

    .header,
    th,
    .metadata,
    tbody tr:nth-child(even) {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
  <header class="header">
    <h1>${escapeHtml(tenant.name)}</h1>
    <div class="identity">${escapeHtml(
      [tenant.nit ? `NIT ${tenant.nit}` : '', tenant.address ?? '']
        .filter(Boolean)
        .join(' · '),
    )}</div>
  </header>

  <main>
    <h2 class="report-title">${escapeHtml(
      tr(document.t, document.titleKey, document.titleFallback),
    )}</h2>
    ${
      document.subtitleKey && document.subtitleFallback
        ? `<p class="source">${escapeHtml(
            tr(document.t, document.subtitleKey, document.subtitleFallback),
          )}</p>`
        : ''
    }

    <section class="metadata">${metadata}</section>

    <table>
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function buildMetadataHtml(document: ExportDocument): string {
  const blocks: Array<[label: string, value: string]> = [
    [
      tr(document.t, 'export.meta.generatedAt', 'Generado'),
      new Date(document.generatedAt ?? Date.now()).toLocaleString(
        document.locale ?? 'es-CO',
      ),
    ],
    [
      tr(document.t, 'export.meta.user', 'Usuario'),
      document.userDisplayName ?? '—',
    ],
  ];

  for (const [labelKey, labelFallback, value] of document.metadata ?? []) {
    blocks.push([tr(document.t, labelKey, labelFallback), value]);
  }

  return blocks
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#039;');
}