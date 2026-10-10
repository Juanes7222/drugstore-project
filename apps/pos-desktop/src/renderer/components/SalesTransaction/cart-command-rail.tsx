/**
 * Persistent command rail at the foot of the cart: F7, F8, Ctrl+Z and the
 * shortcut cheatsheet as real buttons that run the same code paths as their
 * keys, each carrying its key as a drawn chip.
 *
 * Replaces the passive keyboard-hint paragraph the cart used to print, which
 * put ten shortcuts in one muted line nobody read.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useAssistantStore } from "../../../stores/assistant.store";

interface CartCommandRailProps {
  onRepeat: () => void;
  onHold: () => void;
  onUndo: () => void;
  /** True when the cart holds lines, so the toggle reads "Apartar". */
  hasItems: boolean;
  /** False when there is nothing to hold and nothing to recall. */
  canHold: boolean;
  disabled?: boolean;
}

interface RailButton {
  key: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
}

export const CartCommandRail: FC<CartCommandRailProps> = ({
  onRepeat,
  onHold,
  onUndo,
  hasItems,
  canHold,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const openCheatsheet = useAssistantStore((s) => s.openCheatsheet);

  const buttons: RailButton[] = [
    {
      key: "F7",
      label: t("sales.cart.command_repeat"),
      onClick: onRepeat,
      disabled,
    },
    {
      key: "F8",
      label: t(
        hasItems ? "sales.cart.command_hold" : "sales.cart.command_recall",
      ),
      onClick: onHold,
      disabled: disabled || !canHold,
    },
    {
      key: "Ctrl+Z",
      label: t("sales.cart.command_undo"),
      onClick: onUndo,
      disabled,
    },
    {
      key: "?",
      label: t("sales.cart.command_shortcuts"),
      onClick: openCheatsheet,
      disabled: false,
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("sales.cart.commands_label")}
      className="pos-divider flex flex-wrap items-center gap-pos-sm py-pos-sm"
    >
      {buttons.map((button) => (
        <button
          key={button.key}
          type="button"
          onClick={button.onClick}
          disabled={button.disabled}
          className="pos-button pos-button-secondary py-pos-xs"
        >
          <kbd className="pos-kbd" aria-hidden="true">
            {button.key}
          </kbd>
          {button.label}
        </button>
      ))}
    </div>
  );
};
