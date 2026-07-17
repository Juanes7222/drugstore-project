/**
 * StatsCard — a single KPI card for the Home dashboard.
 *
 * Shows a label, a value (optionally in the data/mono face for numbers),
 * an optional icon, and a subtle description. Designed for the
 * "Resumen del día" section.
 */
import { type FC } from "react";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  /** Translation key or direct label text */
  label: string;
  /** The primary value to display (e.g. "$45.200", "12") */
  value: string;
  /** Optional lucide icon rendered above the value */
  icon?: LucideIcon;
  /** Optional description / secondary text */
  description?: string;
  /** Use the JetBrains Mono data face for the value (prices, counts) */
  numeric?: boolean;
  /** Optional extra className */
  className?: string;
}

export const StatsCard: FC<StatsCardProps> = ({
  label,
  value,
  icon: Icon,
  description,
  numeric = false,
  className = "",
}) => {
  return (
    <div
      className={`pos-panel flex flex-col gap-pos-xs p-pos-lg ${className}`}
    >
      <div className="flex items-center gap-pos-sm">
        {Icon && (
          <Icon
            size={16}
            strokeWidth={1.5}
            className="shrink-0"
            style={{ color: "var(--color-ink-muted)" }}
            aria-hidden="true"
          />
        )}
        <span
          className="text-caption font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {label}
        </span>
      </div>

      <span
        className={`${numeric ? "font-data" : ""} text-price font-bold tabular-nums`}
        style={{ color: "var(--color-ink)" }}
      >
        {value}
      </span>

      {description && (
        <span
          className="text-caption"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {description}
        </span>
      )}
    </div>
  );
};
