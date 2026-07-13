/**
 * Form memory service — remembers the last N values entered in each form field.
 *
 * ## Design
 * - LRU cache per (formId, fieldId) key
 * - Max 50 entries per field
 * - Persisted to localStorage
 * - Opt-out per field via user preferences store
 * - Pre-fill suggestions based on context
 *
 * ## Usage
 * ```ts
 * const fm = createFormMemoryService();
 * fm.remember('inventory-adjustment-form', 'reason', 'Producto dañado');
 * const suggestions = fm.getSuggestions('inventory-adjustment-form', 'reason');
 * // → ['Producto dañado', 'Vencimiento', ...]
 * ```
 */

import type { FormMemoryEntry } from "./assistant-types";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";
import { FormMemoryPersistenceException } from "./exceptions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES_PER_FIELD = 50;
const STORAGE_KEY = "pos-form-memory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormMemoryData {
  [formFieldKey: string]: FormMemoryEntry[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface FormMemoryService {
  /**
   * Record a value for a form field.
   * The value is added to the top of the list; duplicates are removed.
   */
  remember(formId: string, fieldId: string, value: string): void;

  /**
   * Get stored suggestions for a form field, most recent first.
   * Returns empty array if the user has opted out of auto-complete for this field.
   */
  getSuggestions(formId: string, fieldId: string): string[];

  /**
   * Check if auto-complete is enabled for this field.
   */
  isEnabled(formId: string, fieldId: string): boolean;

  /**
   * Clear all remembered values for a specific field.
   */
  clearField(formId: string, fieldId: string): void;

  /**
   * Clear all stored form memory.
   */
  clearAll(): void;

  /**
   * Export form memory data (for debugging/analytics).
   */
  exportData(): FormMemoryData;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createFormMemoryService = (): FormMemoryService => {
  return new FormMemoryServiceImpl();
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class FormMemoryServiceImpl implements FormMemoryService {
  private cache: FormMemoryData = {};

  constructor() {
    this.loadFromStorage();
  }

  remember(formId: string, fieldId: string, value: string): void {
    if (!value.trim()) return;

    const key = this.makeKey(formId, fieldId);

    if (!this.cache[key]) {
      this.cache[key] = [];
    }

    // Remove duplicate if exists
    this.cache[key] = this.cache[key].filter(
      (entry) => entry.value !== value,
    );

    // Add to front
    this.cache[key].unshift({
      value: value.trim(),
      lastUsed: Date.now(),
    });

    // Trim to max
    if (this.cache[key].length > MAX_ENTRIES_PER_FIELD) {
      this.cache[key] = this.cache[key].slice(0, MAX_ENTRIES_PER_FIELD);
    }

    this.saveToStorage();
  }

  getSuggestions(formId: string, fieldId: string): string[] {
    if (!this.isEnabled(formId, fieldId)) return [];

    const key = this.makeKey(formId, fieldId);
    const entries = this.cache[key];
    if (!entries || entries.length === 0) return [];

    return entries.map((e) => e.value);
  }

  isEnabled(formId: string, fieldId: string): boolean {
    const fieldKey = this.makeKey(formId, fieldId);
    return !useUserPreferencesStore.getState().isFormFieldOptedOut(fieldKey);
  }

  clearField(formId: string, fieldId: string): void {
    const key = this.makeKey(formId, fieldId);
    delete this.cache[key];
    this.saveToStorage();
  }

  clearAll(): void {
    this.cache = {};
    this.saveToStorage();
  }

  exportData(): FormMemoryData {
    return { ...this.cache };
  }

  private makeKey(formId: string, fieldId: string): string {
    return `${formId}::${fieldId}`;
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.cache = JSON.parse(raw) as FormMemoryData;
      }
    } catch (err) {
      throw new FormMemoryPersistenceException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
    } catch (err) {
      throw new FormMemoryPersistenceException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
