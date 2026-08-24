const COP_FORMATTER = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("es-CO", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat("es-CO", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Formats a decimal string (e.g. "1234.56") or number as COP currency. */
export function formatCop(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return COP_FORMATTER.format(0);
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return COP_FORMATTER.format(0);
  }
  return COP_FORMATTER.format(numeric);
}

const COP_COMPACT_FORMATTER = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Formats a decimal string or number as compact COP (e.g. "$1,2 M") for chart axes. */
export function formatCopCompact(
  value: string | number | null | undefined,
): string {
  const numeric =
    value === null || value === undefined || value === ""
      ? 0
      : typeof value === "number"
        ? value
        : Number(value);
  return COP_COMPACT_FORMATTER.format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMATTER.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATETIME_FORMATTER.format(date);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-CO").format(value);
}

/** Local yyyy-MM-dd for native date inputs. */
export function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Parses a yyyy-MM-dd native date input value into an ISO datetime at 00:00 local. */
export function dateInputToIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}
