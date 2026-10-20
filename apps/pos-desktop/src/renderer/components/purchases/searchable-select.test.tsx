/**
 * Component tests for SearchableSelect.
 *
 * The combobox drives every type-ahead in the app (products, suppliers,
 * purchase orders).  Its `onSearch` callback hits the local database, so
 * it must not fire once per keystroke — the parents render a list, and
 * the database has a single connection.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchableSelect, TYPE_AHEAD_DEBOUNCE_MS, type SearchableSelectOption } from "./searchable-select";

const option = (id: string, label: string): SearchableSelectOption => ({
  id,
  label,
});

const renderSelect = (
  props: Partial<React.ComponentProps<typeof SearchableSelect>> = {},
) => {
  const onSearch = vi.fn();
  const onSelect = vi.fn();
  render(
    <SearchableSelect
      options={[]}
      onSearch={onSearch}
      onSelect={onSelect}
      selectedId={null}
      placeholder="Buscar producto"
      {...props}
    />,
  );
  return { onSearch, onSelect };
};

const input = () => screen.getByRole("combobox");

describe("SearchableSelect", () => {
  describe("SS-01: debounced search", () => {
    it("issues a single search for a burst of keystrokes", async () => {
      const { onSearch } = renderSelect({ debounceMs: TYPE_AHEAD_DEBOUNCE_MS });

      fireEvent.change(input(), { target: { value: "a" } });
      fireEvent.change(input(), { target: { value: "ac" } });
      fireEvent.change(input(), { target: { value: "ace" } });

      // Nothing hits the database until the burst settles.
      expect(onSearch).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(onSearch).toHaveBeenCalledTimes(1);
      });
      expect(onSearch).toHaveBeenCalledWith("ace");
    });

    it("cancels a pending search when an option is selected", async () => {
      const { onSearch } = renderSelect({
        options: [option("p-1", "Acetaminofén 500mg")],
        debounceMs: TYPE_AHEAD_DEBOUNCE_MS,
      });

      fireEvent.change(input(), { target: { value: "acet" } });

      const listboxOption = screen.getByRole("option", {
        name: /Acetaminofén/,
      });
      fireEvent.mouseDown(listboxOption);

      await waitFor(() => {
        expect(onSearch).not.toHaveBeenCalled();
      });
    });

    it("searches immediately when no debounce is requested", () => {
      // Comboboxes that filter an in-memory list must not be delayed.
      const { onSearch } = renderSelect();

      fireEvent.change(input(), { target: { value: "a" } });
      fireEvent.change(input(), { target: { value: "ac" } });

      expect(onSearch).toHaveBeenCalledTimes(2);
      expect(onSearch).toHaveBeenLastCalledWith("ac");
    });
  });

  describe("SS-02: selection", () => {
    it("reports the selected option", async () => {
      const { onSelect } = renderSelect({
        options: [option("p-1", "Acetaminofén 500mg")],
      });

      fireEvent.change(input(), { target: { value: "acet" } });

      const listboxOption = screen.getByRole("option", {
        name: /Acetaminofén/,
      });
      fireEvent.mouseDown(listboxOption);

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "p-1" }),
      );
    });
  });
});
