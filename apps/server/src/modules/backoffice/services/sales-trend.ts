/**
 * Sales trend bucketing — pure helpers that group confirmed sales into
 * local-calendar-day buckets. Shared by the tenant backoffice dashboard
 * and the saas-admin per-customer dashboard so both surfaces bucket
 * sales identically.
 */

import { Prisma } from '@pharmacy/database';

/** Minimal sale projection needed for bucketing. */
export interface TrendSale {
  confirmedAt: Date | null;
  totalAmount: Prisma.Decimal;
}

export interface SalesTrendDay {
  /** Local calendar day, YYYY-MM-DD */
  date: string;
  count: number;
  /** Decimal string, e.g. "0" or "1234.56" */
  totalAmount: string;
}

/** Local YYYY-MM-DD; toISOString would shift the day near UTC offsets. */
export function formatLocalDate(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${dayOfMonth}`;
}

/**
 * Zero-filled one-row-per-day series, oldest first. Each sale is bucketed
 * by its own local-day midnight (not UTC), matching the startOfLocalDay
 * convention used to build `dayStarts`; sales outside the given days are
 * dropped.
 */
export function buildSalesTrendDays(
  sales: TrendSale[],
  dayStarts: Date[],
): SalesTrendDay[] {
  const counts = dayStarts.map(() => 0);
  const amounts = dayStarts.map(() => new Prisma.Decimal(0));
  const bucketIndexByMidnight = new Map(
    dayStarts.map((start, index) => [start.getTime(), index]),
  );

  for (const sale of sales) {
    if (sale.confirmedAt === null) continue;
    const saleDayMidnight = new Date(sale.confirmedAt);
    saleDayMidnight.setHours(0, 0, 0, 0);
    const bucketIndex = bucketIndexByMidnight.get(saleDayMidnight.getTime());
    if (bucketIndex === undefined) continue;
    counts[bucketIndex] += 1;
    amounts[bucketIndex] = amounts[bucketIndex].plus(sale.totalAmount);
  }

  return dayStarts.map((start, index) => ({
    date: formatLocalDate(start),
    count: counts[index],
    totalAmount: amounts[index].toString(),
  }));
}
