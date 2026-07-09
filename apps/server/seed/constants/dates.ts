const NOW = new Date();
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const TWO_YEARS_FROM_NOW = new Date(NOW.getFullYear() + 2, NOW.getMonth(), NOW.getDate());
const ONE_MONTH_AGO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
const SIX_MONTHS_AGO = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000);
const TAX_EFFECTIVE_DATE = new Date('2025-01-01');
const COMMON_PRICE_DATE = new Date('2025-06-01');

export { COMMON_PRICE_DATE, NOW, ONE_MONTH_AGO, SIX_MONTHS_AGO, TAX_EFFECTIVE_DATE, TWO_YEARS_FROM_NOW, YESTERDAY };