/**
 * Component tests for FormMemoryAutocomplete.
 *
 * Covers: dropdown appearance on focus, selection fills form field,
 * opt-out behavior, empty suggestions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormMemoryAutocomplete } from "./form-memory-autocomplete";
import "@/i18n";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFormMemoryService = {
  getSuggestions: vi.fn(),
  remember: vi.fn(),
};

vi.mock("../../../domain/assistant/form-memory.service", () => ({
  createFormMemoryService: () => mockFormMemoryService,
}));

const mockUserPrefsStore = vi.fn();

vi.mock("../../../stores/user-preferences.store", () => ({
  useUserPreferencesStore: (selector: unknown) =>
    mockUserPrefsStore(selector),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubPrefs = (overrides: Record<string, unknown> = {}) => {
  const defaults = {
    optOutFormField: vi.fn(),
    isFormFieldOptedOut: vi.fn().mockReturnValue(false),
  };
  mockUserPrefsStore.mockImplementation(
    (selector: (s: typeof defaults) => unknown) =>
      selector({ ...defaults, ...overrides }),
  );
};

const defaultProps = {
  formId: "test-form",
  fieldId: "reason",
  value: "",
  onSelect: vi.fn(),
  children: <input type="text" aria-label="Input de prueba" />,
  maxSuggestions: 8,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("FormMemoryAutocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPrefs();
    mockFormMemoryService.getSuggestions.mockReturnValue([
      "Devolución",
      "Dañado",
      "Vencido",
    ]);
  });

  it("renders children (the input)", () => {
    render(<FormMemoryAutocomplete {...defaultProps} />);

    expect(
      screen.getByLabelText("Input de prueba"),
    ).toBeInTheDocument();
  });

  it("shows dropdown on input focus when suggestions exist", () => {
    render(<FormMemoryAutocomplete {...defaultProps} />);

    const input = screen.getByLabelText("Input de prueba");
    fireEvent.focus(input);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Devolución")).toBeInTheDocument();
    expect(screen.getByText("Dañado")).toBeInTheDocument();
    expect(screen.getByText("Vencido")).toBeInTheDocument();
  });

  it("does not show dropdown when fewer than 2 suggestions match", () => {
    mockFormMemoryService.getSuggestions.mockReturnValue(["Único valor"]);

    render(<FormMemoryAutocomplete {...defaultProps} />);
    fireEvent.focus(screen.getByLabelText("Input de prueba"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("calls onSelect when a suggestion is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FormMemoryAutocomplete {...defaultProps} onSelect={onSelect} />,
    );

    fireEvent.focus(screen.getByLabelText("Input de prueba"));
    fireEvent.click(screen.getByText("Devolución"));

    expect(onSelect).toHaveBeenCalledWith("Devolución");
    expect(mockFormMemoryService.remember).toHaveBeenCalledWith(
      "test-form",
      "reason",
      "Devolución",
    );
  });

  it("shows opt-out link and calls optOutFormField when clicked", () => {
    const optOutFormField = vi.fn();
    stubPrefs({
      optOutFormField,
      isFormFieldOptedOut: vi.fn().mockReturnValue(false),
    });
    mockFormMemoryService.getSuggestions.mockReturnValue([
      "Opción A",
      "Opción B",
      "Opción C",
    ]);

    render(<FormMemoryAutocomplete {...defaultProps} />);
    fireEvent.focus(screen.getByLabelText("Input de prueba"));

    fireEvent.click(screen.getByText("No mostrar sugerencias"));
    expect(optOutFormField).toHaveBeenCalledWith("test-form::reason");
  });

  it("does not show dropdown when field is opted out", () => {
    stubPrefs({
      isFormFieldOptedOut: vi.fn().mockReturnValue(true),
    });
    mockFormMemoryService.getSuggestions.mockReturnValue([
      "Opción A",
      "Opción B",
      "Opción C",
    ]);

    render(<FormMemoryAutocomplete {...defaultProps} />);
    fireEvent.focus(screen.getByLabelText("Input de prueba"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside click (mousedown)", () => {
    render(<FormMemoryAutocomplete {...defaultProps} />);

    act(() => {
      fireEvent.focusIn(screen.getByLabelText("Input de prueba"));
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Click outside the container to close the dropdown
    act(() => {
      fireEvent.mouseDown(document.body);
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
