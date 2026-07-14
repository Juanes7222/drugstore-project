/**
 * ShortcutGroup — a group of shortcuts by context, with a section header
 * and count badge, used inside the shortcut cheatsheet.
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type {
  ShortcutBinding,
  ShortcutContext,
} from "../../../domain/assistant/assistant-types";
import { GROUP_LABEL_KEYS } from "../../../domain/assistant/shortcut-helpers";
import { ShortcutRow } from "./shortcut-row";

export interface ShortcutGroupProps {
  context: ShortcutContext;
  bindings: ShortcutBinding[];
  capturingId: string | null;
  isCustom: (commandId: string) => boolean;
  defaultKeyForCommand: (commandId: string) => string | undefined;
  onStartCapture: (commandId: string) => void;
  onCancelCapture: () => void;
  onRestoreDefault: (commandId: string) => void;
}

export const ShortcutGroup: FC<ShortcutGroupProps> = ({
  context,
  bindings,
  capturingId,
  isCustom,
  defaultKeyForCommand,
  onStartCapture,
  onCancelCapture,
  onRestoreDefault,
}) => {
  const { t } = useTranslation();

  return (
    <div role="group">
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-4 py-1.5"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--color-surface) 50%, transparent)",
        }}
      >
        <span
          className="text-caption font-semibold uppercase tracking-wider"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          }}
        >
          {t(GROUP_LABEL_KEYS[context])}
        </span>
        <span
          className="flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 font-data text-[10px] tabular-nums"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 10%, transparent)",
            color:
              "color-mix(in srgb, var(--color-ink) 50%, transparent)",
          }}
        >
          {bindings.length}
        </span>
      </div>

      {/* Group items */}
      {bindings.map((binding) => {
        const hasCustom = isCustom(binding.commandId);
        const defaultKey = defaultKeyForCommand(binding.commandId);
        const canRestore =
          hasCustom && defaultKey !== undefined && defaultKey !== binding.key;

        return (
          <ShortcutRow
            key={binding.id}
            binding={binding}
            isCapturing={capturingId === binding.commandId}
            isCustom={hasCustom}
            canRestore={canRestore}
            onStartCapture={() => onStartCapture(binding.commandId)}
            onCancelCapture={onCancelCapture}
            onRestoreDefault={() => onRestoreDefault(binding.commandId)}
          />
        );
      })}
    </div>
  );
};
