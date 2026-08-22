/**
 * Inline input for keyboard quick edits on the selected cart line.
 *
 * Renders on the selected row with a mode prefix (× quantity, % discount,
 * = price) and autofocuses + selects the draft on mount so the cashier can
 * type over it. Enter commits, Escape cancels. Calls onDone when the editor
 * closes (commit or cancel) so the parent can refocus the search input and
 * the scanner flow never stalls.
 */
import {
  type FC,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import {
  type LineQuickEdit as LineQuickEditState,
  type LineQuickEditMode,
} from "../../hooks/use-sales-keyboard";

interface LineQuickEditProps {
  quickEdit: LineQuickEditState;
  onDraftChange: (draft: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Called after the edit closes (commit or cancel) so the parent can refocus the search input. */
  onDone: () => void;
}

const MODE_PREFIX: Record<LineQuickEditMode, string> = {
  quantity: "×",
  discount: "%",
  price: "=",
};

const MODE_INPUT_MODE: Record<LineQuickEditMode, "numeric" | "decimal"> = {
  quantity: "numeric",
  discount: "decimal",
  price: "decimal",
};

export const LineQuickEdit: FC<LineQuickEditProps> = ({
  quickEdit,
  onDraftChange,
  onCommit,
  onCancel,
  onDone,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const ariaLabel =
    quickEdit.mode === "quantity"
      ? t("sales.cart.editQuantity")
      : quickEdit.mode === "discount"
        ? t("sales.cart.editDiscount")
        : t("sales.cart.editPrice");

  // Autofocus and select the draft so typing replaces it immediately.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Refocus the search input whenever the editor unmounts — after commit,
  // cancel, or selection change — so scanning can continue without a mouse.
  useEffect(() => {
    return () => {
      onDone();
    };
  }, [onDone]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [onCommit, onCancel],
  );

  return (
    <div className="flex flex-col items-start gap-pos-xs">
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-data text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-pharma) 70%, transparent)",
          }}
        >
          {MODE_PREFIX[quickEdit.mode]}
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode={MODE_INPUT_MODE[quickEdit.mode]}
          className="pos-input w-40 pl-6 font-data tabular-nums"
          value={quickEdit.draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
          aria-invalid={quickEdit.error !== null}
        />
      </div>
      {quickEdit.error !== null && (
        <p
          className="text-caption leading-tight max-w-64 text-left"
          style={{ color: "var(--color-danger)" }}
          role="alert"
        >
          {quickEdit.error}
        </p>
      )}
    </div>
  );
};