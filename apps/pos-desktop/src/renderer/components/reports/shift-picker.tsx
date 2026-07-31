/**
 * Searchable shift selector for the cash-shift close report.
 *
 * Radix Popover hosts a cmdk Command list so the cashier can type a date
 * fragment or shift state to filter instead of pasting a raw ID.  Kept
 * presentational: options arrive already labelled from the viewer.
 */

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { ChevronDownIcon } from "../ui/icons";

export interface ShiftOption {
  id: string;
  /** Human-readable label shown on the trigger and in the list. */
  label: string;
  /** Translated state chip text (e.g. "Cerrado"). */
  stateLabel: string;
  /** True when the shift ended in a forced close (urgency tint). */
  forced: boolean;
}

interface ShiftPickerProps {
  options: ShiftOption[];
  value: string;
  onChange: (shiftId: string) => void;
  loading?: boolean;
}

export const ShiftPicker: FC<ShiftPickerProps> = ({
  options,
  value,
  onChange,
  loading = false,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.id === value) ?? null;
  const triggerLabel = selected
    ? selected.label
    : loading
      ? t("reports.filters.shift_loading")
      : t("reports.filters.shift_placeholder");

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("reports.filters.shift_label")}
          className="flex w-64 items-center justify-between gap-2 rounded-md border border-border bg-white px-2 py-1 text-left text-body-sm text-ink"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          className="z-50 w-64 rounded-md border border-border bg-white shadow-md"
        >
          <Command
            shouldFilter
            className="flex flex-col"
          >
            <Command.Input
              autoFocus
              placeholder={t("reports.filters.shift_placeholder")}
              className="w-full rounded-t-md border-b border-border px-2 py-1.5 text-body-sm outline-none focus:bg-surface"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              {options.length > 0 ? (
                <Command.Empty className="px-2 py-3 text-body-sm text-muted">
                  {t("reports.filters.shift_no_results")}
                </Command.Empty>
              ) : null}
              {options.length === 0 && !loading ? (
                <p className="px-2 py-3 text-body-sm text-muted">
                  {t("reports.filters.shift_none_available")}
                </p>
              ) : null}
              {options.map((option) => (
                <Command.Item
                  key={option.id}
                  value={option.label}
                  keywords={[option.id]}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-body-sm text-ink data-[selected=true]:bg-pharma data-[selected=true]:text-white"
                >
                  <span className="truncate">{option.label}</span>
                  <span
                    className={
                      option.forced
                        ? "shrink-0 text-caption text-amber-700"
                        : "shrink-0 text-caption text-muted"
                    }
                  >
                    {option.stateLabel}
                  </span>
                </Command.Item>
              ))}
              {loading ? (
                <p className="px-2 py-3 text-body-sm text-muted">
                  {t("reports.filters.shift_loading")}
                </p>
              ) : null}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
