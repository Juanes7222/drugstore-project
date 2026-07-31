/**
 * ShiftPicker — searchable shift selector for the cash-shift close report.
 *
 * Radix Popover renders its content in a portal attached to document.body,
 * so assertions on the open list use the default `screen` queries (which
 * search the whole document, portals included).
 */
import { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShiftPicker, type ShiftOption } from "./shift-picker";
import es from "../../i18n/locales/es.json";
import en from "../../i18n/locales/en.json";

const filtersEs = es.reports.filters;
const filtersEn = en.reports.filters;

const makeOption = (overrides: Partial<ShiftOption> = {}): ShiftOption => ({
  id: "shift-1",
  label: "01/07/2026, 08:00 - 01/07/2026, 17:30",
  stateLabel: es.cash_shift.state_closed,
  forced: false,
  ...overrides,
});

const renderPicker = (
  props: Partial<ComponentProps<typeof ShiftPicker>> = {},
) =>
  render(
    <ShiftPicker options={[]} value="" onChange={vi.fn()} {...props} />,
  );

const openPicker = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: filtersEs.shift_label }));
  return user;
};

describe("ShiftPicker", () => {
  it("shows the placeholder on the trigger when no shift is selected", () => {
    renderPicker();

    const trigger = screen.getByRole("button", { name: filtersEs.shift_label });
    expect(trigger).toHaveTextContent(filtersEs.shift_placeholder);
  });

  it("shows the selected option's label on the trigger", () => {
    const option = makeOption({
      id: "shift-2",
      label: "02/07/2026, 08:00 - 02/07/2026, 17:30",
    });

    renderPicker({ options: [option], value: "shift-2" });

    expect(
      screen.getByRole("button", { name: filtersEs.shift_label }),
    ).toHaveTextContent(option.label);
  });

  it("shows the loading text on the trigger while shifts load", () => {
    renderPicker({ loading: true });

    expect(
      screen.getByRole("button", { name: filtersEs.shift_label }),
    ).toHaveTextContent(filtersEs.shift_loading);
  });

  it("lists every option with its state chip once the popover opens", async () => {
    const closed = makeOption();
    const forced = makeOption({
      id: "shift-2",
      label: "02/07/2026, 08:00 - 02/07/2026, 17:30",
      stateLabel: es.cash_shift.state_forced_close,
      forced: true,
    });

    renderPicker({ options: [closed, forced] });
    await openPicker();

    expect(screen.getByText(closed.label)).toBeVisible();
    expect(screen.getByText(forced.label)).toBeVisible();
    expect(screen.getByText(es.cash_shift.state_closed)).toBeVisible();
    expect(screen.getByText(es.cash_shift.state_forced_close)).toBeVisible();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      filtersEs.shift_placeholder,
    );
  });

  it("filters the list to options whose label matches the typed text", async () => {
    // cmdk 1.1.1 filters with fuzzy subsequence scoring, so the query must
    // contain a character the other label lacks ("9" only appears in the
    // matching option's close time).
    const other = makeOption();
    const matching = makeOption({
      id: "shift-2",
      label: "01/07/2026, 08:00 - 02/07/2026, 19:45",
    });

    renderPicker({ options: [other, matching] });
    const user = await openPicker();

    await user.type(screen.getByRole("combobox"), "19:45");

    expect(screen.getByText(matching.label)).toBeVisible();
    expect(screen.queryByText(other.label)).not.toBeInTheDocument();
  });

  it("filters the list by the shift id keyword", async () => {
    const first = makeOption();
    const second = makeOption({
      id: "shift-2",
      label: "02/07/2026, 08:00 - 02/07/2026, 17:30",
    });

    renderPicker({ options: [first, second] });
    const user = await openPicker();

    await user.type(screen.getByRole("combobox"), "shift-2");

    expect(screen.getByText(second.label)).toBeVisible();
    expect(screen.queryByText(first.label)).not.toBeInTheDocument();
  });

  it("selecting an option calls onChange with its id and closes the popover", async () => {
    const option = makeOption();
    const onChange = vi.fn();

    renderPicker({ options: [option], onChange });
    const user = await openPicker();

    await user.click(screen.getByText(option.label));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("shift-1");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("styles forced options with the amber chip and regular options with the muted chip", async () => {
    const options = [
      makeOption(),
      makeOption({
        id: "shift-2",
        label: "02/07/2026, 08:00 - 02/07/2026, 17:30",
        stateLabel: es.cash_shift.state_forced_close,
        forced: true,
      }),
    ];

    renderPicker({ options });
    await openPicker();

    expect(screen.getByText(es.cash_shift.state_forced_close)).toHaveClass(
      "text-amber-700",
    );
    expect(screen.getByText(es.cash_shift.state_closed)).toHaveClass(
      "text-muted",
    );
  });

  it("shows the none-available message when there are no options and nothing is loading", async () => {
    renderPicker({ options: [] });
    await openPicker();

    expect(screen.getByText(filtersEs.shift_none_available)).toBeVisible();
  });

  it("shows the loading message inside the list while loading, without the none-available message", async () => {
    renderPicker({ options: [], loading: true });
    await openPicker();

    // The loading text appears on the trigger too; the listbox copy is
    // the one this behavior covers.
    expect(
      within(screen.getByRole("listbox")).getByText(filtersEs.shift_loading),
    ).toBeVisible();
    expect(
      screen.queryByText(filtersEs.shift_none_available),
    ).not.toBeInTheDocument();
  });
});

describe("i18n contract for the shift selector keys", () => {
  it("translates reports.filters.shift_label in both locales", () => {
    expect(typeof filtersEs.shift_label).toBe("string");
    expect(filtersEs.shift_label.length).toBeGreaterThan(0);
    expect(typeof filtersEn.shift_label).toBe("string");
    expect(filtersEn.shift_label.length).toBeGreaterThan(0);
  });

  it("translates reports.filters.shift_placeholder in both locales", () => {
    expect(typeof filtersEs.shift_placeholder).toBe("string");
    expect(filtersEs.shift_placeholder.length).toBeGreaterThan(0);
    expect(typeof filtersEn.shift_placeholder).toBe("string");
    expect(filtersEn.shift_placeholder.length).toBeGreaterThan(0);
  });

  it("translates reports.filters.shift_no_results in both locales", () => {
    expect(typeof filtersEs.shift_no_results).toBe("string");
    expect(filtersEs.shift_no_results.length).toBeGreaterThan(0);
    expect(typeof filtersEn.shift_no_results).toBe("string");
    expect(filtersEn.shift_no_results.length).toBeGreaterThan(0);
  });

  it("translates reports.filters.shift_loading in both locales", () => {
    expect(typeof filtersEs.shift_loading).toBe("string");
    expect(filtersEs.shift_loading.length).toBeGreaterThan(0);
    expect(typeof filtersEn.shift_loading).toBe("string");
    expect(filtersEn.shift_loading.length).toBeGreaterThan(0);
  });

  it("translates reports.filters.shift_none_available in both locales", () => {
    expect(typeof filtersEs.shift_none_available).toBe("string");
    expect(filtersEs.shift_none_available.length).toBeGreaterThan(0);
    expect(typeof filtersEn.shift_none_available).toBe("string");
    expect(filtersEn.shift_none_available.length).toBeGreaterThan(0);
  });

  it("translates cash_shift.state_forced_close in both locales", () => {
    expect(typeof es.cash_shift.state_forced_close).toBe("string");
    expect(es.cash_shift.state_forced_close.length).toBeGreaterThan(0);
    expect(typeof en.cash_shift.state_forced_close).toBe("string");
    expect(en.cash_shift.state_forced_close.length).toBeGreaterThan(0);
  });
});
