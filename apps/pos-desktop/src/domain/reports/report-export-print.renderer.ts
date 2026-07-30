import { getTenantInfo } from '../configuration/local-config.store';
import type { ExportInput } from './report-export.types';
import {
  formatCell,
  formatKpiValue,
  isNumericColumn,
} from './report-export-formatters';
import { tr } from './report-export-i18n';

export function renderPrintHtml(input: ExportInput): string {
  const tenant = getTenantInfo();
  const locale = input.locale ?? 'es-CO';

  const headers = input.definition.columns
    .map(
      (column) =>
        `<th>${escapeHtml(tr(input.t, column.titleKey, column.titleKey))}</th>`,
    )
    .join('');

  const rows = input.response.rows.length
    ? input.response.rows
        .map((row) => {
          const cells = input.definition.columns
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
    : `<tr><td class="empty" colspan="${input.definition.columns.length}">${escapeHtml(
        tr(
          input.t,
          'reports.export.noData',
          'No data for the selected filters.',
        ),
      )}</td></tr>`;

  const kpis = input.response.kpis
    .map(
      (kpi) => `
        <article class="kpi-card">
          <span>${escapeHtml(
            tr(input.t, kpi.titleKey, kpi.titleKey),
          )}</span>
          <strong>${escapeHtml(
            formatKpiValue(kpi.value, locale),
          )}</strong>
        </article>
      `,
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(input.definition.code)}</title>
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

  .metadata span,
  .kpi-card span {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  h2 {
    margin: 20px 0 8px;
    font-size: 11px;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .kpi-card {
    min-height: 56px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel);
  }

  .kpi-card strong {
    color: var(--pharma);
    font-family: "JetBrains Mono", monospace;
    font-size: 16px;
  }

  table {
    width: 100%;
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
    .kpi-card,
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
    <h2 class="report-title">${escapeHtml(input.definition.code)}</h2>
    <p class="source">${escapeHtml(
      tr(
        input.t,
        'reports.export.localSource',
        'Local workstation database',
      ),
    )}</p>

    <section class="metadata">
      <div>
        <span>${escapeHtml(tr(input.t, 'reports.export.period', 'Period'))}</span>
        <strong>${escapeHtml(
          `${input.response.filters.dateFrom} — ${input.response.filters.dateTo}`,
        )}</strong>
      </div>
      <div>
        <span>${escapeHtml(
          tr(input.t, 'reports.export.generatedAt', 'Generated'),
        )}</span>
        <strong>${escapeHtml(
          new Date(input.response.generatedAt).toLocaleString(locale),
        )}</strong>
      </div>
      <div>
        <span>${escapeHtml(tr(input.t, 'reports.export.user', 'User'))}</span>
        <strong>${escapeHtml(input.userDisplayName)}</strong>
      </div>
      <div>
        <span>${escapeHtml(tr(input.t, 'reports.export.source', 'Source'))}</span>
        <strong>${escapeHtml(input.response.freshness.dataSource)}</strong>
      </div>
    </section>

    <h2>${escapeHtml(tr(input.t, 'reports.export.indicators', 'Indicators'))}</h2>
    <section class="kpis">${kpis}</section>

    <h2>${escapeHtml(tr(input.t, 'reports.export.detail', 'Detail'))}</h2>
    <table>
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#039;');
}