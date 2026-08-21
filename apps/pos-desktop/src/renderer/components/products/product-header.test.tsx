/**
 * Component tests for ProductHeader: the import button renders only when the
 * optional onImport prop is provided (the page gates it by role), while the
 * back and create buttons are always present.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductHeader } from "./product-header";

const renderHeader = (props: Partial<Parameters<typeof ProductHeader>[0]> = {}) => {
  const defaults = {
    isOnline: true,
    onBack: vi.fn(),
    onCreateNew: vi.fn(),
  };
  render(<ProductHeader {...defaults} {...props} />);
};

describe("ProductHeader", () => {
  it("renders the import button when onImport is provided", () => {
    const onImport = vi.fn();
    renderHeader({ onImport });

    const button = screen.getByRole("button", { name: "Importar CSV/Excel" });
    expect(button).toBeInTheDocument();
  });

  it("hides the import button when onImport is omitted", () => {
    renderHeader({});

    expect(
      screen.queryByRole("button", { name: "Importar CSV/Excel" }),
    ).not.toBeInTheDocument();
  });

  it("triggers onImport when the import button is clicked", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onImport });

    await user.click(screen.getByRole("button", { name: "Importar CSV/Excel" }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("keeps the back and create buttons available without onImport", () => {
    renderHeader({});

    expect(
      screen.getByRole("button", { name: /Volver|Back/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo producto" })).toBeInTheDocument();
  });
});