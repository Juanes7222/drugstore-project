/**
 * Touch-friendly numeric keypad for PIN entry.
 *
 * Features:
 * - Large touch targets for dirty screens (80×64px)
 * - Physical keyboard support via a hidden <input type="tel">
 *   (auto-focused on mount, captures digit, Backspace, Enter)
 * - Show/hide toggle: dots by default, actual digits when visible
 * - Auto-submit on reaching minLength with a short pause, or on maxLength
 * - Range 4–6 digits per server policy
 */
import {
  type FC,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";

interface PinKeypadProps {
  minLength?: number;
  maxLength?: number;
  onComplete: (pin: string) => void;
  onCancel?: () => void;
  error?: string | null;
  isLoading?: boolean;
  shuffle?: boolean;
  label?: string;
}

export const PinKeypad: FC<PinKeypadProps> = ({
  minLength = 4,
  maxLength = 6,
  onComplete,
  onCancel,
  error = null,
  isLoading = false,
  shuffle = false,
  label,
}) => {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [keys, setKeys] = useState<string[]>([
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    "", "0", "⌫",
  ]);

  // ── Shuffle (optional) ──────────────────────────────────────────

  useEffect(() => {
    if (shuffle) {
      const numbers = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
      for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
      }
      setKeys([...numbers, "", "0", "⌫"]);
    }
  }, [shuffle]);

  // ── Always keep the hidden input focused ────────────────────────
  // Buttons use onPointerDown(e).preventDefault() so they never steal
  // focus from the hidden input. This avoids aggressive onBlur hacks.

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // ── PIN entry logic ─────────────────────────────────────────────

  const appendDigit = useCallback(
    (digit: string) => {
      if (isLoading || pin.length >= maxLength) return;
      setActiveIndex(pin.length);
      const newPin = pin + digit;
      setPin(newPin);
      setTimeout(() => setActiveIndex(null), 180);

      // Auto-submit when PIN hits the maximum length
      if (newPin.length === maxLength) {
        setTimeout(() => onComplete(newPin), 180);
      }
    },
    [pin, maxLength, onComplete, isLoading],
  );

  const deleteLast = useCallback(() => {
    if (isLoading || pin.length === 0) return;
    const idx = pin.length - 1;
    setDeletingIndex(idx);
    setPin((prev) => prev.slice(0, -1));
    setTimeout(() => setDeletingIndex(null), 250);
  }, [pin, isLoading]);

  const clearAll = useCallback(() => {
    if (isLoading) return;
    setPin("");
  }, [isLoading]);

  // ── Keyboard handler (physical keyboard via hidden input) ───────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isLoading) return;

      if (e.key === "Enter") {
        e.preventDefault();
        if (pin.length >= minLength) onComplete(pin);
        return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        deleteLast();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        clearAll();
        return;
      }

      // Digit keys (including Numpad)
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
        return;
      }
    },
    [isLoading, pin, minLength, onComplete, deleteLast, clearAll, appendDigit],
  );

  // ── On-screen keypad click handler ──────────────────────────────

  const handleKeyPress = useCallback(
    (key: string) => {
      if (isLoading) return;

      if (key === "⌫") {
        deleteLast();
      } else if (key === "" || key === " ") {
        return;
      } else {
        appendDigit(key);
      }

      // Re-focus the hidden input after any button click
      focusInput();
    },
    [isLoading, deleteLast, appendDigit, focusInput],
  );

  const handleSubmit = useCallback(() => {
    if (pin.length >= minLength && !isLoading) {
      onComplete(pin);
      focusInput();
    }
  }, [pin, minLength, onComplete, isLoading, focusInput]);

  // ── Focus management: re-focus input when anything happens ──────

  useEffect(() => {
    // Focus on mount
    inputRef.current?.focus();
  }, []);

  // Re-focus when the keypad re-renders (e.g. after error)
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Hidden input for physical keyboard capture */}
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Re-focus after small delay unless loading
          // (buttons use onPointerDown(e).preventDefault() so they
          //  never steal focus; this covers edge cases like the
          //  browser's auto-fill popup)
          if (!isLoading) {
            setTimeout(focusInput, 50);
          }
        }}
        className="sr-only"
        aria-label={t("auth.pin_label")}
        value=""
        readOnly
      />

      {/* Label */}
      <label
        className="text-body font-medium select-none"
        style={{ color: "var(--color-ink)" }}
      >
        {label ?? t("auth.pin_label")}
      </label>

      {/* PIN display — dots with toggle */}
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          setVisible(!visible);
          focusInput();
        }}
        className="flex items-center justify-center gap-2.5 w-full max-w-[280px] py-3 px-4 select-none"
        style={{
          background: "var(--color-surface-variant)",
          borderRadius: "var(--radius-md)",
          minHeight: 56,
          border: error
            ? "1.5px solid #D32F2F"
            : "1.5px solid transparent",
          transition: "border-color 0.15s",
          cursor: "pointer",
        }}
        aria-label={
          visible
            ? t("auth.hide_pin_aria")
            : t("auth.show_pin_aria")
        }
      >
        {/* Digit slots — always visible like a password field */}
        <div className="flex items-center gap-2.5">
          {Array.from({ length: maxLength }).map((_, i) => {
            const filled = i < pin.length;
            const isActive = activeIndex === i;
            const isDeleting = deletingIndex === i;

            if (visible && filled) {
              return (
                <motion.span
                  key={`d-${i}`}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="font-bold text-center tabular-nums"
                  style={{
                    fontSize: "1.5rem",
                    width: 28,
                    color: "var(--color-pharma)",
                    fontVariantNumeric: "tabular-nums",
                    display: "inline-block",
                  }}
                >
                  {pin[i]}
                </motion.span>
              );
            }

            // ── Dot — plain element, no motion ──
            // Empty = hollow ring. Filled = solid teal circle.
            // CSS transition handles smooth fill/unfill.
            const dotBg = filled ? "var(--color-pharma)" : "transparent";
            const dotBd = filled ? "var(--color-pharma)" : "var(--color-border)";
            const dotXf = isDeleting ? "scale(0.3)" : isActive ? "scale(1.35)" : "scale(1)";
            const dotOp = isDeleting ? 0.4 : 1;
            return (
              <div
                key={`dot-${i}`}
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  backgroundColor: dotBg,
                  borderStyle: "solid",
                  borderWidth: "2px",
                  borderColor: dotBd,
                  transform: dotXf,
                  opacity: dotOp,
                  transition:
                    "background-color 0.2s, border-color 0.2s, transform 0.15s, opacity 0.15s",
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>

        {/* Show/Hide label */}
        <span
          className="text-caption font-medium ml-2"
          style={{ color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}
        >
          {visible ? t("auth.hide_pin") : t("auth.show_pin")}
        </span>
      </button>

      {/* Error */}
      <AnimatePresence mode="wait">
        {error && (
          <motion.p
            key="pin-error"
            className="text-body-sm text-center select-none"
            style={{ color: "#D32F2F" }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Numeric keypad grid */}
      <div
        className="grid grid-cols-3 gap-3 select-none"
        style={{ maxWidth: 280 }}
        role="group"
        aria-label={t("auth.numeric_keypad_aria")}
      >
        {keys.map((key, i) => {
          if (key === "") {
            return <div key={i} style={{ width: 80, height: 64 }} />;
          }

          const isDelete = key === "⌫";
          return (
            <motion.button
              key={`${key}-${i}`}
              type="button"
              disabled={isLoading}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => handleKeyPress(key)}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.04 }}
              transition={{ type: "spring", duration: 0.2, bounce: 0.2 }}
              style={{
                width: 80,
                height: 64,
                fontSize: isDelete ? 20 : 26,
                fontWeight: 600,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-surface)",
                color: isDelete
                  ? "var(--color-ink-muted)"
                  : "var(--color-ink)",
                cursor: isLoading ? "not-allowed" : "pointer",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: isLoading ? 0.4 : 1,
                transition: "background-color 0.1s, border-color 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor =
                    "var(--color-surface-variant)";
                  e.currentTarget.style.borderColor =
                    "var(--color-pharma)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor =
                    "var(--color-surface)";
                  e.currentTarget.style.borderColor =
                    "var(--color-border)";
                }
              }}
              aria-label={
                isDelete ? t("auth.delete_key_aria") : key
              }
            >
              {isDelete ? "⌫" : key}
            </motion.button>
          );
        })}
      </div>

      {/* Submit button */}
      <motion.button
        type="button"
        disabled={pin.length < minLength || isLoading}
        onPointerDown={(e) => e.preventDefault()}
        onClick={handleSubmit}
        className="pos-button pos-button--primary"
        whileTap={pin.length >= minLength && !isLoading ? { scale: 0.97 } : undefined}
        style={{
          width: "100%",
          maxWidth: 280,
          opacity: pin.length < minLength || isLoading ? 0.5 : 1,
        }}
      >
        {isLoading
          ? t("auth.verifying_pin")
          : t("auth.submit_pin")}
      </motion.button>

      {/* Cancel */}
      {onCancel && (
        <motion.button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            onCancel();
          }}
          className="pos-button pos-button--ghost"
          whileTap={{ scale: 0.97 }}
          disabled={isLoading}
        >
          {t("auth.cancel_pin")}
        </motion.button>
      )}
    </div>
  );
};
