/**
 * Shift close report HTML generator.
 *
 * Produces a printable HTML document formatted for 80mm thermal printers,
 * summarizing the shift's open/close times, cashier, expected vs. declared
 * amounts per payment method, and the final difference.
 */

/**
 * Input data for the shift close report.
 */
export interface ShiftCloseReportData {
  shiftId: string;
  workstationId: string;
  cashierName: string;
  openedAt: Date;
  closedAt: Date;
  openingBalance: string;
  expectedClosingAmount: string;
  actualClosingAmount: string;
  closingDifference: string;
  closingNotes: string | null;
  paymentMethodCounts: Array<{
    methodName: string;
    isCash: boolean;
    expectedAmount: string;
    declaredAmount: string;
    difference: string;
  }>;
}

/**
 * Generate a printable shift close report HTML document.
 */
export function generateShiftCloseHtml(data: ShiftCloseReportData): string {
  const formattedOpen = formatDate(data.openedAt);
  const formattedClose = formatDate(data.closedAt);

  const methodRows = data.paymentMethodCounts
    .map(
      (pm) => `
    <tr>
      <td>${escapeHtml(pm.methodName)}</td>
      <td class="right">$ ${formatMoney(pm.expectedAmount)}</td>
      <td class="right">$ ${formatMoney(pm.declaredAmount)}</td>
      <td class="right ${Number(pm.difference) < 0 ? 'negative' : ''}">$ ${formatMoney(pm.difference)}</td>
    </tr>`,
    )
    .join('');

  const differenceClass = Number(data.closingDifference) < 0 ? 'negative' : '';
  const differenceSign = Number(data.closingDifference) < 0 ? '' : '+';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cierre de Turno ${escapeHtml(data.shiftId.slice(0, 8))}</title>
<style>
  @page { margin: 0; size: 80mm auto; }
  @media print { html, body { width: 80mm; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10px;
    line-height: 1.3;
    color: #000;
    background: #fff;
    width: 72mm;
    padding: 2mm;
  }
  .header { text-align: center; margin-bottom: 3mm; }
  .header h1 { font-size: 14px; font-weight: bold; }
  .header .sub { font-size: 9px; color: #555; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1mm 0; text-align: left; }
  td.right, th.right { text-align: right; }
  .total { font-weight: bold; border-top: 1px solid #000; }
  .negative { color: #c00; }
  .footer { text-align: center; font-size: 8px; color: #888; margin-top: 3mm; }
</style>
</head>
<body>
<div class="header">
  <h1>CIERRE DE TURNO</h1>
  <div class="sub">${escapeHtml(data.workstationId)}</div>
  <div class="sub">Cajero: ${escapeHtml(data.cashierName)}</div>
</div>

<div class="sep"></div>

<div class="row"><span>Apertura:</span><span>${formattedOpen}</span></div>
<div class="row"><span>Cierre:</span><span>${formattedClose}</span></div>
<div class="row"><span>Fondo inicial:</span><span class="right">$ ${formatMoney(data.openingBalance)}</span></div>

<div class="sep"></div>

<table>
  <thead>
    <tr>
      <th>Método</th>
      <th class="right">Esperado</th>
      <th class="right">Declarado</th>
      <th class="right">Diferencia</th>
    </tr>
  </thead>
  <tbody>
    ${methodRows}
  </tbody>
</table>

<div class="sep"></div>

<div class="row total"><span>TOTAL ESPERADO:</span><span>$ ${formatMoney(data.expectedClosingAmount)}</span></div>
<div class="row total"><span>TOTAL DECLARADO:</span><span>$ ${formatMoney(data.actualClosingAmount)}</span></div>
<div class="row total ${differenceClass}"><span>DIFERENCIA:</span><span>${differenceSign}$ ${formatMoney(Math.abs(Number(data.closingDifference)).toFixed(2))}</span></div>

${
  data.closingNotes
    ? `<div class="sep"></div><div class="row"><span>Notas:</span></div><div>${escapeHtml(data.closingNotes)}</div>`
    : ''
}

<div class="sep"></div>
<div class="footer">
  Generado: ${new Date().toLocaleString('es-CO')}<br>
  ID: ${escapeHtml(data.shiftId.slice(0, 8))}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatMoney(value: string): string {
  const num = Number(value);
  return num.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
