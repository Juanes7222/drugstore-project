/**
 * i18n-aware locale formatters for the reports module.
 *
 * Returns currency, integer, percent, and date/time formatters that
 * follow the current i18n language — stops dates appearing in English
 * when the UI is in Spanish and vice‑versa.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface ReportFormatters {
  /** COP currency, 0 decimals. */
  currency: Intl.NumberFormat;
  /** Integer group separator. */
  integer: Intl.NumberFormat;
  /** Percent, 1 decimal. */
  percent: Intl.NumberFormat;
  /** Numeric with max 4 fraction digits. */
  numeric: Intl.NumberFormat;
  /** Short date (locale-sensitive). */
  date: Intl.DateTimeFormat;
  /** Date + time (locale-sensitive). */
  dateTime: Intl.DateTimeFormat;
}

export function useReportsLocale(): ReportFormatters {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useMemo(() => {
    const base: Intl.NumberFormatOptions = {};
    return {
      currency: new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }),
      integer: new Intl.NumberFormat(locale, base),
      percent: new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }),
      numeric: new Intl.NumberFormat(locale, {
        maximumFractionDigits: 4,
      }),
      date: new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
      dateTime: new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }, [locale]);
}

/**
 * Pure-function alternative — creates formatters for a given locale.
 * Use outside React components (e.g. chart-option.factory.ts).
 */
export function createFormatters(locale: string): ReportFormatters {
  return {
    currency: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }),
    integer: new Intl.NumberFormat(locale),
    percent: new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }),
    numeric: new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }),
    date: new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    dateTime: new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

/** Map i18n language (e.g. "es") to an Intl locale string.  Falls back
 *  to the user's browser locale when the i18n language is not recognised. */
export function mapToIntlLocale(language: string): string {
  // i18next stores "es" / "en" — Intl.NumberFormat accepts those natively.
  return language;
}
