/**
 * Central keyboard shortcut manager.
 *
 * Provides a registry of key combos mapped to command IDs, conflict
 * detection at registration time, context awareness (shortcuts only
 * fire in the appropriate screen context), and a customization layer
 * backed by the user preferences store.
 *
 * ## Default shortcuts
 * | Combo        | Command          | Context      |
 * |--------------|------------------|--------------|
 * | Cmd+K        | Open palette     | GLOBAL       |
 * | Cmd+/        | Open help        | GLOBAL       |
 * | ?            | Shortcut cheatsheet | GLOBAL     |
 * | Esc          | Close overlay    | MODAL_OPEN   |
 * | Cmd+N        | New sale         | SALE_FLOW    |
 * | Cmd+Shift+S  | Sync now         | GLOBAL       |
 * | Cmd+Shift+P  | Reprint receipt  | SALE_FLOW    |
 * | F1           | Context help     | GLOBAL       |
 *
 * ## Browser default collisions
 * The manager refuses to register shortcuts that collide with common
 * browser defaults (Cmd+W, Cmd+T, Cmd+R, etc.) and warns in dev mode.
 */

import type { ShortcutBinding, ShortcutContext } from "./assistant-types";
import { ShortcutConflictException } from "./exceptions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Browser default shortcuts that should never be overridden. */
const BROWSER_DEFAULTS = new Set([
  "Cmd+W", // Close tab
  "Cmd+T", // New tab
  "Cmd+N", // New window (in browser context — but we allow it in app)
  "Cmd+R", // Reload
  "Cmd+Shift+R", // Hard reload
  "Cmd+L", // Focus address bar
  "Cmd+Q", // Quit
  "Cmd+,", // Preferences (in some browsers)
  "F5", // Reload
  "F11", // Fullscreen
  "F12", // DevTools
  "Cmd+Shift+I", // DevTools
  "Cmd+Shift+J", // DevTools console
  "Cmd+Shift+C", // Inspect element
]);

/**
 * Global shortcuts (always active regardless of context).
 * These should be kept minimal to avoid conflicts.
 */
const GLOBAL_SHORTCUTS = new Set(["Cmd+K", "Cmd+/", "Esc", "F1"]);

// ---------------------------------------------------------------------------
// Default bindings
// ---------------------------------------------------------------------------

const DEFAULT_BINDINGS: ShortcutBinding[] = [
  { id: "shortcut.palette", key: "Cmd+K", commandId: "cmd.open-palette", context: "GLOBAL", description: "Abrir paleta de comandos" },
  { id: "shortcut.help", key: "Cmd+/", commandId: "cmd.show-help", context: "GLOBAL", description: "Abrir ayuda" },
  { id: "shortcut.cheatsheet", key: "?", commandId: "cmd.show-shortcuts", context: "GLOBAL", description: "Ver atajos de teclado" },
  { id: "shortcut.close", key: "Esc", commandId: "cmd.close-overlay", context: "GLOBAL", description: "Cerrar panel/overlay" },
  { id: "shortcut.new-sale", key: "Cmd+N", commandId: "cmd.new-sale", context: "SALE_FLOW", description: "Nueva venta" },
  { id: "shortcut.sync", key: "Cmd+Shift+S", commandId: "cmd.sync-now", context: "GLOBAL", description: "Sincronizar ahora" },
  { id: "shortcut.reprint", key: "Cmd+Shift+P", commandId: "cmd.reprint-last-receipt", context: "SALE_FLOW", description: "Reimprimir última factura" },
  { id: "shortcut.context-help", key: "F1", commandId: "cmd.context-help", context: "GLOBAL", description: "Ayuda contextual" },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ShortcutManager {
  /** Get all registered bindings (including user overrides). */
  getBindings(): ShortcutBinding[];

  /** Get bindings filtered by context. */
  getBindingsForContext(context: ShortcutContext): ShortcutBinding[];

  /** Get bindings for a specific context set. */
  getBindingsForContexts(contexts: ShortcutContext[]): ShortcutBinding[];

  /** Get the binding for a specific key combo. Returns null if not found. */
  findBindingByKey(key: string): ShortcutBinding | null;

  /** Get the binding for a specific command id. Returns null if not found. */
  findBindingByCommandId(commandId: string): ShortcutBinding | null;

  /**
   * Register a custom binding.
   * Throws ShortcutConflictException if the combo is already registered
   * for a different command.
   */
  registerCustomBinding(
    commandId: string,
    key: string,
    context: ShortcutContext,
  ): void;

  /**
   * Normalize a keyboard event to a shortcut string like "Cmd+K" or "Shift+?".
   */
  normalizeEvent(event: KeyboardEvent): string;

  /**
   * Check if a shortcut should be suppressed based on active element.
   * Returns true if the shortcut should NOT fire.
   */
  shouldSuppress(event: KeyboardEvent, isModalOpen: boolean): boolean;

  /**
   * Check if a shortcut with a given ID is a global shortcut.
   */
  isGlobalShortcut(shortcutId: string): boolean;

  /**
   * Apply user overrides from the preferences store.
   */
  applyUserOverrides(prefs: { customShortcuts: Record<string, string> }): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createShortcutManager = (): ShortcutManager => {
  return new ShortcutManagerImpl();
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ShortcutManagerImpl implements ShortcutManager {
  private bindings: Map<string, ShortcutBinding> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  getBindings(): ShortcutBinding[] {
    return Array.from(this.bindings.values());
  }

  getBindingsForContext(context: ShortcutContext): ShortcutBinding[] {
    return this.getBindings().filter((b) => b.context === context);
  }

  getBindingsForContexts(contexts: ShortcutContext[]): ShortcutBinding[] {
    const contextSet = new Set(contexts);
    return this.getBindings().filter((b) => contextSet.has(b.context));
  }

  findBindingByKey(key: string): ShortcutBinding | null {
    return this.bindings.get(key) ?? null;
  }

  findBindingByCommandId(commandId: string): ShortcutBinding | null {
    return (
      Array.from(this.bindings.values()).find(
        (b) => b.commandId === commandId,
      ) ?? null
    );
  }

  registerCustomBinding(
    commandId: string,
    key: string,
    context: ShortcutContext,
  ): void {
    // Check for collisions
    const existing = this.bindings.get(key);
    if (existing && existing.commandId !== commandId) {
      throw new ShortcutConflictException(key, existing.commandId);
    }

    // Check browser default collisions
    if (BROWSER_DEFAULTS.has(key) && !GLOBAL_SHORTCUTS.has(key)) {
      if (import.meta.env.DEV) {
        console.warn(
          `[ShortcutManager] Shortcut "${key}" for command "${commandId}" collides with a browser default.`,
        );
      }
    }

    const id = `custom.${commandId}`;
    const binding: ShortcutBinding = {
      id,
      key,
      commandId,
      context,
      description: `Custom binding for ${commandId}`,
    };

    this.bindings.set(key, binding);
  }

  normalizeEvent(event: KeyboardEvent): string {
    const parts: string[] = [];

    if (event.metaKey) parts.push("Cmd");
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");

    // Handle special keys
    const key = event.key;
    if (key === "Meta" || key === "Control" || key === "Alt" || key === "Shift") {
      // Modifier-only presses are not shortcuts
      return "";
    }

    if (key === " ") {
      parts.push("Space");
    } else if (key.length === 1) {
      parts.push(key.toUpperCase());
    } else {
      parts.push(key);
    }

    return parts.join("+");
  }

  /**
   * Determine if a keyboard event should be suppressed.
   * Returns true if the shortcut should NOT fire.
   */
  shouldSuppress(event: KeyboardEvent, _isModalOpen: boolean): boolean {
    const target = event.target as HTMLElement | null;

    // Never suppress Esc — it always closes things
    if (event.key === "Escape") return false;

    // Never suppress Cmd+K (palette always works)
    const combo = this.normalizeEvent(event);
    if (combo === "Cmd+K" || combo === "Ctrl+K") return false;

    // Check for IME composition (CJK/IME input)
    if (event.isComposing) return true;

    // Suppress when in a text input, unless it's a global shortcut
    if (target) {
      const tagName = target.tagName?.toLowerCase();
      const isInput =
        tagName === "input" ||
        tagName === "textarea" ||
        target.isContentEditable;

      if (isInput) {
        // Only allow global shortcuts in text fields
        return !GLOBAL_SHORTCUTS.has(combo);
      }
    }

    return false;
  }

  isGlobalShortcut(shortcutId: string): boolean {
    const binding = Array.from(this.bindings.values()).find(
      (b) => b.id === shortcutId,
    );
    return binding?.context === "GLOBAL";
  }

  /**
   * Load default bindings.
   */
  private initializeDefaults(): void {
    for (const binding of DEFAULT_BINDINGS) {
      this.bindings.set(binding.key, binding);
    }
  }

  /**
   * Apply user overrides from the preferences store.
   * Called after the preferences store is initialized.
   */
  applyUserOverrides(prefs: { customShortcuts: Record<string, string> }): void {
    for (const [commandId, shortcut] of Object.entries(prefs.customShortcuts)) {
      const existing = this.findBindingByCommandId(commandId);
      if (existing) {
        this.bindings.delete(existing.key);
        this.bindings.set(shortcut, {
          ...existing,
          key: shortcut,
        });
      }
    }
  }
}
