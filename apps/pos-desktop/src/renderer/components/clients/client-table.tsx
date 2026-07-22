/**
 * Client results table with animated rows, icon action buttons,
 * and proper empty / loading states.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion, type Variants } from "motion/react";
import {
  Pencil,
  Trash2,
  SearchX,
  Loader2,
  Users,
} from "lucide-react";
import type { ClientSearchResult } from "../../../domain/clients/clients.service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClientTableProps {
  results: ClientSearchResult[];
  isSearching: boolean;
  hasLoaded: boolean;
  onEdit: (client: ClientSearchResult) => void;
  onDelete: (clientId: string) => void;
}

// ---------------------------------------------------------------------------
// Row animation variants
// ---------------------------------------------------------------------------

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: (i as number) * 0.03,
      duration: 0.2,
      ease: "easeOut",
    },
  }),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClientTable: FC<ClientTableProps> = ({
  results,
  isSearching,
  hasLoaded,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();

  // ---- Loading state ----
  if (isSearching) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Loader2 className="size-6 animate-spin" style={{ color: "var(--color-pharma)" }} />
        <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("common.loading")}
        </p>
      </div>
    );
  }

  // ---- Empty state (never searched) ----
  if (!hasLoaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div
          className="flex size-12 items-center justify-center rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-ink) 5%, transparent)" }}
        >
          <Users className="size-6" style={{ color: "var(--color-ink-muted)" }} />
        </div>
        <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("clients.type_to_search")}
        </p>
      </div>
    );
  }

  // ---- Empty state (no results) ----
  if (results.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div
          className="flex size-12 items-center justify-center rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-urgency) 8%, transparent)" }}
        >
          <SearchX className="size-6" style={{ color: "var(--color-urgency)" }} />
        </div>
        <p className="text-body-sm font-medium" style={{ color: "var(--color-ink-muted)" }}>
          {t("clients.no_results")}
        </p>
      </div>
    );
  }

  // ---- Results ----
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr
            className="sticky top-0 z-10"
            style={{
              backgroundColor: "var(--color-panel)",
              borderBottom: "2px solid color-mix(in srgb, var(--color-pharma) 15%, transparent)",
            }}
          >
            <Th>{t("clients.full_name")}</Th>
            <Th>{t("clients.document")}</Th>
            <Th className="hidden sm:table-cell">{t("clients.email")}</Th>
            <Th className="hidden md:table-cell">{t("clients.phone")}</Th>
            <Th className="hidden lg:table-cell">{t("clients.city")}</Th>
            <Th className="text-right">{t("common.actions")}</Th>
          </tr>
        </thead>
        <tbody>
          {results.map((client, idx) => (
            <motion.tr
              key={client.id}
              custom={shouldReduceMotion ? 0 : idx}
              variants={rowVariants}
              initial="hidden"
              animate="visible"
              whileHover={{
                backgroundColor: "#F5F9F9",
                transition: { duration: 0.15 },
              }}
              className="group cursor-default"
              style={{
                borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)",
                transition: "background-color 0.15s ease",
              }}
            >
              <Td className="font-medium">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="flex size-7 items-center justify-center rounded-full text-caption font-bold"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--color-pharma) 10%, transparent)",
                      color: "var(--color-pharma)",
                    }}
                  >
                    {client.fullName.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate max-w-[160px] sm:max-w-none">
                    {client.fullName}
                  </span>
                </span>
              </Td>
              <Td>
                <span className="font-data tabular-nums inline-flex items-center gap-1 text-caption">
                  <span
                    className="rounded-sm px-1 py-0.5 font-semibold uppercase"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--color-ink) 7%, transparent)",
                      fontSize: "0.625rem",
                    }}
                  >
                    {client.identificationType}
                  </span>
                  <span className="tabular-nums">{client.identificationNumber}</span>
                </span>
              </Td>
              <Td className="hidden sm:table-cell" muted>
                {client.email ?? "—"}
              </Td>
              <Td className="hidden md:table-cell" muted>
                {client.phone ?? "—"}
              </Td>
              <Td className="hidden lg:table-cell" muted>
                {[client.municipality, client.department].filter(Boolean).join(", ") || "—"}
              </Td>
              <Td className="text-right">
                <div className="inline-flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton
                    icon={<Pencil className="size-3.5" />}
                    label={t("clients.edit")}
                    onClick={() => onEdit(client)}
                    color="var(--color-pharma)"
                  />
                  <IconButton
                    icon={<Trash2 className="size-3.5" />}
                    label={t("clients.delete")}
                    onClick={() => onDelete(client.id)}
                    color="var(--color-urgency)"
                  />
                </div>
              </Td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Table header cell. */
const Th: FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <th
    className={`px-3 py-2 text-left text-caption font-semibold uppercase tracking-wider ${className}`}
    style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
  >
    {children}
  </th>
);

/** Table data cell with optional muted styling. */
const Td: FC<{
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
}> = ({ children, className = "", muted = false }) => (
  <td
    className={`px-3 py-2.5 ${className}`}
    style={{ color: muted ? "var(--color-ink-muted)" : "var(--color-ink)" }}
  >
    {children}
  </td>
);

/** Small icon-only action button. */
const IconButton: FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color: string;
}> = ({ icon, label, onClick, color }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex size-7 items-center justify-center rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pharma"
    style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }}
    title={label}
    aria-label={label}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = "color-mix(in srgb, " + color + " 10%, transparent)";
      e.currentTarget.style.color = color;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = "transparent";
      e.currentTarget.style.color = "color-mix(in srgb, var(--color-ink) 40%, transparent)";
    }}
  >
    {icon}
  </button>
);
