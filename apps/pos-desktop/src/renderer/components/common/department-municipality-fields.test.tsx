/**
 * Component tests for DepartmentMunicipalityFields.
 *
 * Both fields render as SearchableSelect comboboxes: a text input with
 * role="combobox" whose options appear in a portal'd listbox appended to
 * document.body while the dropdown is open. Covers: accessible names,
 * municipality gating until a department is chosen, clearing an orphaned
 * municipality vs preserving one that belongs to the new department,
 * local accent-insensitive filtering with startsWith ranking,
 * catalog-backed municipality options, legacy free-text fallback options,
 * and the shared disabled state.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DepartmentMunicipalityFields,
  type DepartmentMunicipalityFieldsProps,
} from "./department-municipality-fields";
import {
  COLOMBIA_DEPARTMENTS,
  findDepartmentByName,
} from "../../utils/colombia-geo";

// i18n singleton initialized via vitest.setup.ts (Spanish by default)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<DepartmentMunicipalityFieldsProps> = {},
): DepartmentMunicipalityFieldsProps {
  return {
    department: "",
    municipality: "",
    onDepartmentChange: vi.fn(),
    onMunicipalityChange: vi.fn(),
    ...overrides,
  };
}

/** Municipality display names for a catalog department (fails loudly if absent). */
function municipalityNames(departmentName: string): string[] {
  const department = findDepartmentByName(departmentName);
  if (!department) {
    throw new Error(`Missing catalog department in fixtures: ${departmentName}`);
  }
  return department.municipalities.map((municipality) => municipality.name);
}

function setup(overrides: Partial<DepartmentMunicipalityFieldsProps> = {}) {
  const props = makeProps(overrides);
  render(<DepartmentMunicipalityFields {...props} />);

  const departmentSelect = screen.getByRole("combobox", {
    name: "Departamento",
  });
  const municipalitySelect = screen.getByRole("combobox", {
    name: "Municipio",
  });

  return { ...props, departmentSelect, municipalitySelect };
}

/**
 * Opens a combobox dropdown and returns its listbox. Options render through
 * a portal into document.body, so callers must scope option queries to the
 * returned listbox instead of `screen`.
 */
async function openListbox(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
): Promise<HTMLElement> {
  await user.click(input);
  return screen.getByRole("listbox");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DepartmentMunicipalityFields", () => {
  describe("rendering", () => {
    it("renders both fields as collapsed comboboxes with their accessible labels", () => {
      const { departmentSelect, municipalitySelect } = setup();

      expect(departmentSelect).toBeInTheDocument();
      expect(municipalitySelect).toBeInTheDocument();
      expect(departmentSelect).toHaveAccessibleName("Departamento");
      expect(municipalitySelect).toHaveAccessibleName("Municipio");
      expect(departmentSelect).toHaveAttribute("aria-expanded", "false");
      expect(municipalitySelect).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("municipality gating", () => {
    it("disables the municipality field while no department is chosen", () => {
      const { departmentSelect, municipalitySelect } = setup();

      expect(departmentSelect).toBeEnabled();
      expect(municipalitySelect).toBeDisabled();
      // Hint span has no distinct role; locate it by its stable id.
      expect(document.getElementById("municipality-needs-department")).not.toBeNull();
    });

    it("enables the municipality field once a valid department is set", () => {
      const { municipalitySelect } = setup({ department: "Antioquia" });

      expect(municipalitySelect).toBeEnabled();
      expect(document.getElementById("municipality-needs-department")).toBeNull();
    });
  });

  describe("department change", () => {
    it("emits the department display name when an option is picked", async () => {
      const user = userEvent.setup();
      const { onDepartmentChange, onMunicipalityChange, departmentSelect } =
        setup();

      const listbox = await openListbox(user, departmentSelect);
      await user.click(within(listbox).getByRole("option", { name: "Antioquia" }));

      expect(onDepartmentChange).toHaveBeenCalledWith("Antioquia");
      // An empty municipality belongs to no department, so the reset also
      // fires — a harmless no-op write of "" for the parent.
      expect(onMunicipalityChange).toHaveBeenCalledWith("");
    });

    it("clears a municipality that does not belong to the newly chosen department", async () => {
      const user = userEvent.setup();
      const {
        onDepartmentChange,
        onMunicipalityChange,
        departmentSelect,
        municipalitySelect,
      } = setup({
        department: "Bogotá D.C.",
        municipality: "Bogotá D.C.",
      });

      const listbox = await openListbox(user, departmentSelect);
      await user.click(within(listbox).getByRole("option", { name: "Antioquia" }));

      expect(onDepartmentChange).toHaveBeenCalledWith("Antioquia");
      expect(onMunicipalityChange).toHaveBeenCalledWith("");
      // Field content is parent-owned; until the parent applies the change
      // the persisted value keeps showing.
      expect(municipalitySelect).toHaveValue("Bogotá D.C.");
    });

    it("preserves a municipality that belongs to the newly chosen department", async () => {
      const user = userEvent.setup();
      // "Sabanalarga" exists in both Atlántico and Casanare, so switching
      // between them must not wipe the persisted value.
      const { onDepartmentChange, onMunicipalityChange, departmentSelect } =
        setup({
          department: "Atlántico",
          municipality: "Sabanalarga",
        });

      const listbox = await openListbox(user, departmentSelect);
      await user.click(within(listbox).getByRole("option", { name: "Casanare" }));

      expect(onDepartmentChange).toHaveBeenCalledWith("Casanare");
      expect(onMunicipalityChange).not.toHaveBeenCalled();
    });
  });

  describe("filtering", () => {
    it("matches typed queries accent-insensitively", async () => {
      const user = userEvent.setup();
      const { municipalitySelect } = setup({ department: "Antioquia" });

      await user.type(municipalitySelect, "medellin");

      const options = within(screen.getByRole("listbox")).getAllByRole("option");

      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Medellín");
    });

    it("ranks startsWith matches ahead of contains matches", async () => {
      const user = userEvent.setup();
      const { departmentSelect } = setup();

      await user.type(departmentSelect, "san");

      const optionTexts = within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent);

      // startsWith bucket first, then contains matches in catalog order
      // ("Casanare" contains "san" mid-word).
      expect(optionTexts).toEqual([
        "Santander",
        "Archipiélago de San Andrés, Providencia y Santa Catalina",
        "Casanare",
        "Norte de Santander",
      ]);
    });
  });

  describe("municipality options", () => {
    it("lists exactly the selected department's municipalities when opened", async () => {
      const user = userEvent.setup();
      const { municipalitySelect } = setup({
        department: "Antioquia",
        municipality: "Medellín",
      });

      await user.click(municipalitySelect);

      const optionTexts = within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent);

      expect(optionTexts).toEqual(municipalityNames("Antioquia"));
    });
  });

  describe("legacy free-text fallback", () => {
    it("keeps an unknown persisted department selectable as an extra option", async () => {
      const user = userEvent.setup();
      const { departmentSelect } = setup({
        department: "Departamento Inventado",
      });

      const listbox = await openListbox(user, departmentSelect);

      expect(
        within(listbox).getByRole("option", {
          name: "Departamento Inventado",
        }),
      ).toBeInTheDocument();
      expect(within(listbox).getAllByRole("option")).toHaveLength(
        // Full catalog plus the legacy free-text entry.
        COLOMBIA_DEPARTMENTS.length + 1,
      );
    });

    it("keeps an unknown persisted municipality visible as an extra option", async () => {
      const user = userEvent.setup();
      const { municipalitySelect } = setup({
        department: "Antioquia",
        municipality: "Vereda Perdida",
      });

      const listbox = await openListbox(user, municipalitySelect);

      expect(
        within(listbox).getByRole("option", {
          name: "Vereda Perdida",
        }),
      ).toBeInTheDocument();
      expect(within(listbox).getAllByRole("option")).toHaveLength(
        municipalityNames("Antioquia").length + 1,
      );
    });
  });

  describe("disabled state", () => {
    it("disables both fields when the disabled prop is set", () => {
      const { departmentSelect, municipalitySelect } = setup({
        department: "Antioquia",
        disabled: true,
      });

      expect(departmentSelect).toBeDisabled();
      expect(municipalitySelect).toBeDisabled();
    });
  });
});
