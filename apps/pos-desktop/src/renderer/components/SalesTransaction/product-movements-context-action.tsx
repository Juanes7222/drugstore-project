/**
 * ProductMovementsContextAction — right-click "view movement history"
 * action shared by the sales screen (product search results and cart lines).
 *
 * The parent owns the right-click target state and passes it in; this
 * component renders the context menu at the pointer position and, when the
 * action is chosen, opens the shared ProductMovementHistoryModal. Rendering
 * nothing when no target is set keeps the cost at the call sites minimal.
 *
 * @category Component
 */
import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ProductMovementHistoryModal } from "../products/product-movement-history-modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The product a context menu was opened for. */
export interface MovementsTarget {
  productId: string;
  productName: string;
}

interface ProductMovementsContextActionProps {
  /** Current right-click target, or null when no menu is open. */
  target: MovementsTarget | null;
  /** Pointer position (client coords) where the menu should appear. */
  position: { x: number; y: number } | null;
  /** Clear the target — called on close, click-away, and Escape. */
  onClear: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ProductMovementsContextAction: FC<ProductMovementsContextActionProps> = ({
  target,
  position,
  onClear,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Clamp the menu inside the viewport once mounted.
  useEffect(() => {
    if (!target || !position || !menuRef.current) return;
    const menu = menuRef.current;
    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(position.x, innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(position.y, innerHeight - rect.height - 8)}px`;
  }, [target, position]);

  // Click-away and Escape close the menu.
  useEffect(() => {
    if (!target) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClear();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClear();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [target, onClear]);

  const handleOpenHistory = useCallback(() => {
    setIsModalOpen(true);
    onClear();
  }, [onClear]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  if (!target) return null;

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("product_movements.context_menu_label")}
          className="fixed z-50 min-w-[12rem] rounded-pos py-1 shadow-pos-elevated"
          style={{
            left: position?.x ?? 0,
            top: position?.y ?? 0,
            backgroundColor: "var(--color-panel)",
            border: "1px solid color-mix(in srgb, var(--color-ink) 12%, transparent)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenHistory}
            className="w-full px-pos-md py-pos-xs text-left text-body-sm transition-colors hover:opacity-80"
            style={{ color: "var(--color-ink)" }}
          >
            {t("product_movements.context_action")}
          </button>
        </div>,
        document.body,
      )}

      <ProductMovementHistoryModal
        visible={isModalOpen}
        productId={target.productId}
        productName={target.productName}
        onClose={handleCloseModal}
      />
    </>
  );
};
