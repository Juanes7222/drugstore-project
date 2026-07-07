/**
 * Format a date string as a short, locale-aware label (e.g., 15/07/26).
 */
import i18n from "i18next";

export const formatShortDate = (dateString: string): string => {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat(i18n.language, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};
