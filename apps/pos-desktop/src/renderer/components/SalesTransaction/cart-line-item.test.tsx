/**
 * Component tests for CartLineItem.
 *
 * Covers the amendment treatment of a cart line: the struck-through catalog
 * price an overridden unit price leaves behind, the cases where there is
 * nothing to strike, the discount term, and the mouse-reachable inline
 * editors.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaleType } from "@pharmacy/shared-types";
import type { CartItem } from "@/store/slices/sales-types";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import type { LocalSession } from "../../../domain/auth/local-session.store";
import { CartLineItem } from "./cart-line-item";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "line-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  invimaCertificate: "INVIMA-2019M-001234",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L24056",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 620_000,
  overrideUnitPriceCents: null,
  originalUnitPriceCents: null,
  discountPercentage: null,
  costCents: 3_000,
  taxPercentage: 19,
  quantity: 1,
  commissionType: null,
  commissionValue: null,
  commissionStartsAt: null,
  commissionEndsAt: null,
  ...overrides,
});

interface Handlers {
  onUpdateQuantity: Mock<(id: string, quantity: number) => void>;
  onRemove: Mock<(id: string) => void>;
  onUpdatePrice: Mock<(id: string, unitPriceCents: number) => void>;
  onUpdateDiscount: Mock<
    (id: string, discountPercentage: number | null) => void
  >;
}

const renderLine = (
  item: CartItem,
  props: Partial<Handlers> = {},
): Handlers => {
  const callbacks: Handlers = {
    onUpdateQuantity: vi.fn(),
    onRemove: vi.fn(),
    onUpdatePrice: vi.fn(),
    onUpdateDiscount: vi.fn(),
    ...props,
  };

  render(
    <ul>
      <CartLineItem
        item={item}
        onUpdateQuantity={callbacks.onUpdateQuantity}
        onRemove={callbacks.onRemove}
        onUpdatePrice={callbacks.onUpdatePrice}
        onUpdateDiscount={callbacks.onUpdateDiscount}
      />
    </ul>,
  );

  return callbacks;
};

/** The struck-through catalog figure, which the component marks `pos-superseded`. */
const supersededFigure = (): HTMLElement | null =>
  document.querySelector(".pos-superseded");

/**
 * The "Eliminar"-labelled control rendering the given glyph. The remove `×`
 * and the quantity stepper `−` share an accessible name — an accessibility
 * smell in the component, reported rather than fixed here — so tests select
 * between them by the glyph they render.
 */
const controlByGlyph = (glyph: string): HTMLElement =>
  screen
    .getAllByRole("button", { name: "Eliminar" })
    .find((button) => button.textContent === glyph) as HTMLElement;

const sessionFor = (role: string): LocalSession => ({
  userId: "u-001",
  username: "cajero",
  fullName: "Juan Pérez",
  displayName: "Juan Pérez",
  role,
  subscriptionId: null,
  workstationId: "ws-1",
  accessToken: "",
  refreshToken: "",
  sessionId: "s-1",
  sessionTrust: "SERVER_VERIFIED",
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CartLineItem", () => {
  beforeEach(() => {
    // OWNER can override prices, so the live price renders as an editor
    // button; the role-gated case below overrides this explicitly.
    useLocalSessionStore.getState().setSession(sessionFor("OWNER"));
  });

  describe("amendment strike-through", () => {
    it("strikes the catalog figure when the price was overridden below it", () => {
      renderLine(
        baseItem({
          unitPriceCents: 500_000,
          originalUnitPriceCents: 620_000,
          overrideUnitPriceCents: 500_000,
        }),
      );

      // 620_000 cents = "$ 6.200", struck; 500_000 cents = "$ 5.000", live.
      expect(supersededFigure()).toHaveTextContent("$ 6.200");
      expect(
        screen.getByRole("button", { name: "Editar precio" }),
      ).toHaveTextContent("$ 5.000");
    });

    it("strikes the catalog figure when the price was overridden above it", () => {
      renderLine(
        baseItem({
          unitPriceCents: 800_000,
          originalUnitPriceCents: 620_000,
          overrideUnitPriceCents: 800_000,
        }),
      );

      expect(supersededFigure()).toHaveTextContent("$ 6.200");
    });

    it("announces the superseded figure for assistive tech", () => {
      renderLine(
        baseItem({
          unitPriceCents: 500_000,
          originalUnitPriceCents: 620_000,
          overrideUnitPriceCents: 500_000,
        }),
      );

      // A strikethrough carries no meaning in the accessibility tree, so the
      // superseded amount is announced explicitly rather than read as a
      // second, competing price.
      expect(screen.getByText("Precio original $ 6.200")).toBeInTheDocument();
    });

    it("marks the row as amended so the amendment is legible from structure", () => {
      renderLine(
        baseItem({
          unitPriceCents: 500_000,
          originalUnitPriceCents: 620_000,
          overrideUnitPriceCents: 500_000,
        }),
      );

      expect(screen.getByRole("listitem")).toHaveAttribute(
        "data-amended",
        "true",
      );
    });
  });

  describe("no strike when there is nothing to strike", () => {
    it("renders no superseded figure when the baseline is null", () => {
      renderLine(baseItem({ originalUnitPriceCents: null }));

      expect(supersededFigure()).toBeNull();
    });

    it("renders no superseded figure when the override was typed back to the catalog price", () => {
      renderLine(
        baseItem({
          unitPriceCents: 620_000,
          originalUnitPriceCents: 620_000,
          overrideUnitPriceCents: 620_000,
        }),
      );

      expect(supersededFigure()).toBeNull();
    });

    it("does not mark an untouched line as amended", () => {
      renderLine(baseItem({ originalUnitPriceCents: 620_000 }));

      expect(screen.getByRole("listitem")).toHaveAttribute(
        "data-amended",
        "false",
      );
    });
  });

  describe("legacy held carts", () => {
    // Held carts persisted before `originalUnitPriceCents` existed come back
    // from localStorage with the key absent, not null. A null-only check
    // would let `undefined` through and print "$ NaN" on the line.
    const legacyItem = (): CartItem =>
      ({
        ...baseItem({
          unitPriceCents: 500_000,
          overrideUnitPriceCents: 500_000,
        }),
        originalUnitPriceCents: undefined,
      }) as unknown as CartItem;

    it("does not print NaN when the baseline key is absent", () => {
      const { container } = render(
        <ul>
          <CartLineItem
            item={legacyItem()}
            onUpdateQuantity={vi.fn()}
            onRemove={vi.fn()}
            onUpdatePrice={vi.fn()}
            onUpdateDiscount={vi.fn()}
          />
        </ul>,
      );

      expect(container.textContent).not.toMatch(/NaN/);
    });

    it("does not strike anything when the baseline key is absent", () => {
      renderLine(legacyItem());

      expect(supersededFigure()).toBeNull();
    });
  });

  describe("discount term", () => {
    it("renders the discount percentage and amount when a discount is set", () => {
      // gross 620_000 − 10% = 62_000 cents off → "$ 620"
      renderLine(baseItem({ discountPercentage: 10 }));

      const editor = screen.getByRole("button", { name: "Editar descuento" });
      expect(editor).toHaveTextContent("−10%");
      expect(editor).toHaveTextContent("−$ 620");
    });

    it("amends the line on a discount alone without striking a price", () => {
      // The unit price itself was never touched, so there is no superseded
      // figure — the amendment is carried by the discount term alone.
      renderLine(
        baseItem({
          discountPercentage: 10,
          unitPriceCents: 620_000,
          originalUnitPriceCents: 620_000,
          overrideUnitPriceCents: null,
        }),
      );

      expect(screen.getByRole("listitem")).toHaveAttribute(
        "data-amended",
        "true",
      );
      expect(supersededFigure()).toBeNull();
    });

    it("shows an em-dash placeholder and no discount when no discount is set", () => {
      renderLine(baseItem());

      expect(
        screen.getByRole("button", { name: "Editar descuento" }),
      ).toHaveTextContent("—");
      expect(screen.getByRole("listitem")).toHaveAttribute(
        "data-amended",
        "false",
      );
    });
  });

  describe("mouse-only editing", () => {
    // The discount editor was briefly orphaned during the redesign, leaving
    // mouse users with no way to edit a discount at all.
    it("opens the discount editor when the discount term is clicked", async () => {
      const user = userEvent.setup();
      renderLine(baseItem());

      await user.click(
        screen.getByRole("button", { name: "Editar descuento" }),
      );

      expect(
        screen.getByRole("spinbutton", { name: "Editar descuento" }),
      ).toBeVisible();
    });

    it("opens the price editor when the live price is clicked", async () => {
      const user = userEvent.setup();
      useLocalSessionStore.getState().setSession(sessionFor("OWNER"));
      renderLine(baseItem());

      await user.click(screen.getByRole("button", { name: "Editar precio" }));

      expect(
        screen.getByRole("spinbutton", { name: "Editar precio" }),
      ).toBeVisible();
    });

    it("dispatches the discount typed into the editor on Enter", async () => {
      const user = userEvent.setup();
      const callbacks = renderLine(baseItem());

      await user.click(
        screen.getByRole("button", { name: "Editar descuento" }),
      );
      await user.clear(
        screen.getByRole("spinbutton", { name: "Editar descuento" }),
      );
      await user.type(
        screen.getByRole("spinbutton", { name: "Editar descuento" }),
        "15",
      );
      await user.keyboard("{Enter}");

      expect(callbacks.onUpdateDiscount).toHaveBeenCalledWith("line-1", 15);
    });

    it("dispatches a null discount when the editor is emptied", async () => {
      const user = userEvent.setup();
      const callbacks = renderLine(baseItem({ discountPercentage: 20 }));

      await user.click(
        screen.getByRole("button", { name: "Editar descuento" }),
      );
      await user.clear(
        screen.getByRole("spinbutton", { name: "Editar descuento" }),
      );
      await user.keyboard("{Enter}");

      expect(callbacks.onUpdateDiscount).toHaveBeenCalledWith("line-1", null);
    });

    it("dispatches the overridden price on Enter", async () => {
      const user = userEvent.setup();
      useLocalSessionStore.getState().setSession(sessionFor("OWNER"));
      const callbacks = renderLine(baseItem());

      await user.click(screen.getByRole("button", { name: "Editar precio" }));
      await user.clear(
        screen.getByRole("spinbutton", { name: "Editar precio" }),
      );
      await user.type(
        screen.getByRole("spinbutton", { name: "Editar precio" }),
        "5000",
      );
      await user.keyboard("{Enter}");

      expect(callbacks.onUpdatePrice).toHaveBeenCalledWith("line-1", 500_000);
    });

    it("does not offer the price editor to a role that cannot override prices", () => {
      useLocalSessionStore.getState().setSession(sessionFor("CASHIER"));
      renderLine(baseItem());

      expect(
        screen.queryByRole("button", { name: "Editar precio" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("quantity stepper", () => {
    it("dispatches a decrement when the − stepper is clicked", async () => {
      const user = userEvent.setup();
      const callbacks = renderLine(baseItem({ quantity: 3 }));

      await user.click(controlByGlyph("−"));

      expect(callbacks.onUpdateQuantity).toHaveBeenCalledWith("line-1", 2);
    });

    it("dispatches an increment when the + stepper is clicked", async () => {
      const user = userEvent.setup();
      const callbacks = renderLine(baseItem({ quantity: 3 }));

      await user.click(screen.getByRole("button", { name: "Agregar" }));

      expect(callbacks.onUpdateQuantity).toHaveBeenCalledWith("line-1", 4);
    });

    it("dispatches a removal when the × button is clicked", async () => {
      const user = userEvent.setup();
      const callbacks = renderLine(baseItem());

      await user.click(controlByGlyph("×"));

      expect(callbacks.onRemove).toHaveBeenCalledWith("line-1");
    });
  });

  describe("line identity", () => {
    it("renders the product name, lot code, and expiry", () => {
      renderLine(baseItem());

      expect(screen.getByText("Acetaminofén 500mg")).toBeVisible();
      expect(screen.getByText("L24056")).toBeVisible();
    });

    it("marks the line as the current one when it is selected", () => {
      render(
        <ul>
          <CartLineItem
            item={baseItem()}
            isSelected
            onUpdateQuantity={vi.fn()}
            onRemove={vi.fn()}
            onUpdatePrice={vi.fn()}
            onUpdateDiscount={vi.fn()}
          />
        </ul>,
      );

      expect(screen.getByRole("listitem")).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    it("shows the restricted badge for a restricted product", () => {
      renderLine(baseItem({ isRestricted: true }));

      expect(screen.getByText("VENTA RESTRINGIDA")).toBeVisible();
    });
  });
});
