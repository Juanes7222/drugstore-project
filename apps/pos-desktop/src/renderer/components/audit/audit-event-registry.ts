/**
 * Single source of truth for audit event configuration.
 *
 * Each event entry drives: category color, lucide icon, translation label key,
 * and filter-dropdown visibility. Adding a new event type means adding ONE
 * entry below — the card component and filter bar derive everything from this.
 *
 * Design per design-system.md: Audit — Timeline View section.
 *
 * @module audit-event-registry
 */

import {
  LogIn,
  LogOut,
  Shield,
  Package,
  AlertTriangle,
  UserPlus,
  UserX,
  Lock,
  KeyRound,
  Network,
  DollarSign,
  Receipt,
  FileText,
  ShoppingCart,
  Printer,
  ClipboardList,
  TrendingUp,
  TrendingDown,
  Ban,
  Undo2,
  Check,
  CheckCheck,
  Plus,
  Minus,
  Calendar,
  Unlock,
  ArrowLeft,
  Edit,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visual category that determines the left-border color. */
export type EventCategory =
  | 'auth'         // Pharma Teal — trust, normal operations
  | 'failure'      // Error Red — login failures, account locks
  | 'security'     // Restrict Violet — role changes, step-up, password resets
  | 'users'        // Sync Slate — user creation, disable
  | 'inventory'    // Urgency Amber — stock movements, adjustments
  | 'network'      // Network Blue — local sync, hub elections, conflicts
  | 'cashShift'    // Cash Green — shift open/close, cash counts
  | 'sale'         // Sale Teal — sale confirm/annul
  | 'client'       // Client Slate — client CRUD, returns
  | 'prescription' // Prescription Purple — RX registration
  | 'purchase'     // Purchase Orange — PO, reception
  | 'fiscal'       // Fiscal Blue — DIAN invoice, contingency
  | 'default';     // Border gray — unknown/unclassified events

/** Module filter value this event belongs to. */
export type EventModule =
  | 'AUTH_USERS'
  | 'INVENTORY'
  | 'CASH_SHIFT'
  | 'SALES'
  | 'CLIENTS'
  | 'PRESCRIPTIONS'
  | 'PURCHASES'
  | 'FISCAL'
  | 'SYNC';

/** Full config for one audit event type. */
export interface AuditEventConfig {
  /** The raw action string from the server (e.g. "AUTH_LOGIN_SUCCESS"). */
  readonly action: string;
  /** i18n key for the event's human-readable label (e.g. "audit_events.AUTH_LOGIN_SUCCESS"). */
  readonly labelKey: string;
  /** Visual category drives color, background tint, grouping. */
  readonly category: EventCategory;
  /** Lucide icon name string — resolved to component by {@link resolveIcon}. */
  readonly icon: string;
  /** Which module filter this event belongs to. */
  readonly module?: EventModule;
  /** When false, excluded from the event-type filter dropdown. Default true. */
  readonly showInFilter?: boolean;
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

export interface CategoryMeta {
  /** 3px-left border color (hex). */
  readonly color: string;
  /** Background tint: security events get a subtle violet tint. */
  readonly sensitive?: boolean;
}

/**
 * Metadata per category. Colors map to design-system.md palette.
 * `sensitive: true` events get a subtle background tint on the card.
 */
export const CATEGORY_META: Readonly<Record<EventCategory, CategoryMeta>> = {
  auth:         { color: '#0B6E6B' },
  failure:      { color: '#D32F2F' },
  security:     { color: '#5B3E96', sensitive: true },
  users:        { color: '#4A6572' },
  inventory:    { color: '#E8780A' },
  network:      { color: '#1565C0' },
  cashShift:    { color: '#2E7D32' }, // Green — money handling
  sale:         { color: '#00897B' }, // Dark teal — transactions
  client:       { color: '#546E7A' }, // Blue-grey — client mgmt
  prescription: { color: '#7B1FA2' }, // Purple — regulated
  purchase:     { color: '#E65100' }, // Deep orange — procurement
  fiscal:       { color: '#0D47A1' }, // Dark blue — DIAN
  default:      { color: '#D4D2CC' },
};

// ---------------------------------------------------------------------------
// Event configurations — SINGLE SOURCE OF TRUTH
// ---------------------------------------------------------------------------

/**
 * Every known audit event type in one place.
 * Add a new event here and it automatically gets:
 * - The correct category color on timeline cards
 * - The correct lucide icon
 * - An entry in the event-type filter dropdown (unless showInFilter: false)
 * - A fallback translation key (audit_events.<ACTION>)
 */
export const AUDIT_EVENT_CONFIGS: Readonly<Record<string, AuditEventConfig>> = {
  // ── Auth ──────────────────────────────────────────────────────────
  AUTH_LOGIN_SUCCESS: {
    action: 'AUTH_LOGIN_SUCCESS',
    labelKey: 'audit_events.AUTH_LOGIN_SUCCESS',
    category: 'auth',
    icon: 'LogIn',
    module: 'AUTH_USERS',
  },
  AUTH_LOGIN_FAILURE: {
    action: 'AUTH_LOGIN_FAILURE',
    labelKey: 'audit_events.AUTH_LOGIN_FAILURE',
    category: 'failure',
    icon: 'AlertTriangle',
    module: 'AUTH_USERS',
  },
  AUTH_LOGOUT: {
    action: 'AUTH_LOGOUT',
    labelKey: 'audit_events.AUTH_LOGOUT',
    category: 'auth',
    icon: 'LogOut',
    module: 'AUTH_USERS',
  },
  ACCESS: {
    action: 'ACCESS',
    labelKey: 'audit_events.ACCESS',
    category: 'auth',
    icon: 'KeyRound',
    module: 'AUTH_USERS',
  },

  // ── Security ──────────────────────────────────────────────────────
  STEP_UP_AUTHORIZED: {
    action: 'STEP_UP_AUTHORIZED',
    labelKey: 'audit_events.STEP_UP_AUTHORIZED',
    category: 'security',
    icon: 'Shield',
    module: 'AUTH_USERS',
  },
  USER_ROLE_CHANGED: {
    action: 'USER_ROLE_CHANGED',
    labelKey: 'audit_events.USER_ROLE_CHANGED',
    category: 'security',
    icon: 'UserPlus',
    module: 'AUTH_USERS',
  },
  SESSION_REVOKED: {
    action: 'SESSION_REVOKED',
    labelKey: 'audit_events.SESSION_REVOKED',
    category: 'security',
    icon: 'Lock',
    module: 'AUTH_USERS',
  },
  AUTH_PASSWORD_CHANGED: {
    action: 'AUTH_PASSWORD_CHANGED',
    labelKey: 'audit_events.AUTH_PASSWORD_CHANGED',
    category: 'security',
    icon: 'Lock',
    module: 'AUTH_USERS',
  },
  AUTH_PIN_RESET: {
    action: 'AUTH_PIN_RESET',
    labelKey: 'audit_events.AUTH_PIN_RESET',
    category: 'security',
    icon: 'KeyRound',
    module: 'AUTH_USERS',
  },
  ACCOUNT_LOCKED: {
    action: 'ACCOUNT_LOCKED',
    labelKey: 'audit_events.ACCOUNT_LOCKED',
    category: 'failure',
    icon: 'Lock',
    module: 'AUTH_USERS',
  },

  // ── Users ─────────────────────────────────────────────────────────
  USER_CREATED: {
    action: 'USER_CREATED',
    labelKey: 'audit_events.USER_CREATED',
    category: 'users',
    icon: 'UserPlus',
    module: 'AUTH_USERS',
  },
  USER_DISABLED: {
    action: 'USER_DISABLED',
    labelKey: 'audit_events.USER_DISABLED',
    category: 'users',
    icon: 'UserX',
    module: 'AUTH_USERS',
  },

  // ── Inventory ─────────────────────────────────────────────────────
  INVENTORY_PURCHASE_RECEIPT: {
    action: 'INVENTORY_PURCHASE_RECEIPT',
    labelKey: 'audit_events.INVENTORY_PURCHASE_RECEIPT',
    category: 'inventory',
    icon: 'Package',
    module: 'INVENTORY',
  },
  INVENTORY_SALE: {
    action: 'INVENTORY_SALE',
    labelKey: 'audit_events.INVENTORY_SALE',
    category: 'inventory',
    icon: 'ShoppingCart',
    module: 'INVENTORY',
  },
  INVENTORY_ADJUSTMENT_POSITIVE: {
    action: 'INVENTORY_ADJUSTMENT_POSITIVE',
    labelKey: 'audit_events.INVENTORY_ADJUSTMENT_POSITIVE',
    category: 'inventory',
    icon: 'TrendingUp',
    module: 'INVENTORY',
  },
  INVENTORY_ADJUSTMENT_NEGATIVE: {
    action: 'INVENTORY_ADJUSTMENT_NEGATIVE',
    labelKey: 'audit_events.INVENTORY_ADJUSTMENT_NEGATIVE',
    category: 'inventory',
    icon: 'TrendingDown',
    module: 'INVENTORY',
  },
  INVENTORY_CLIENT_RETURN: {
    action: 'INVENTORY_CLIENT_RETURN',
    labelKey: 'audit_events.INVENTORY_CLIENT_RETURN',
    category: 'inventory',
    icon: 'Undo2',
    module: 'INVENTORY',
  },
  INVENTORY_SUPPLIER_RETURN: {
    action: 'INVENTORY_SUPPLIER_RETURN',
    labelKey: 'audit_events.INVENTORY_SUPPLIER_RETURN',
    category: 'inventory',
    icon: 'ArrowLeft',
    module: 'INVENTORY',
  },
  INVENTORY_ADMIN_BLOCK: {
    action: 'INVENTORY_ADMIN_BLOCK',
    labelKey: 'audit_events.INVENTORY_ADMIN_BLOCK',
    category: 'inventory',
    icon: 'Ban',
    module: 'INVENTORY',
  },
  INVENTORY_ADMIN_UNBLOCK: {
    action: 'INVENTORY_ADMIN_UNBLOCK',
    labelKey: 'audit_events.INVENTORY_ADMIN_UNBLOCK',
    category: 'inventory',
    icon: 'Unlock',
    module: 'INVENTORY',
  },
  INVENTORY_AUTO_EXPIRATION: {
    action: 'INVENTORY_AUTO_EXPIRATION',
    labelKey: 'audit_events.INVENTORY_AUTO_EXPIRATION',
    category: 'inventory',
    icon: 'Calendar',
    module: 'INVENTORY',
  },
  INVENTORY_PHYSICAL_COUNT: {
    action: 'INVENTORY_PHYSICAL_COUNT',
    labelKey: 'audit_events.INVENTORY_PHYSICAL_COUNT',
    category: 'inventory',
    icon: 'ClipboardList',
    module: 'INVENTORY',
  },
  INVENTORY_INITIAL_STOCK: {
    action: 'INVENTORY_INITIAL_STOCK',
    labelKey: 'audit_events.INVENTORY_INITIAL_STOCK',
    category: 'inventory',
    icon: 'Package',
    module: 'INVENTORY',
  },

  // ── Local Network ─────────────────────────────────────────────────
  LOCAL_SYNC_HUB_ELECTION: {
    action: 'LOCAL_SYNC_HUB_ELECTION',
    labelKey: 'audit_events.LOCAL_SYNC_HUB_ELECTION',
    category: 'network',
    icon: 'Network',
    module: 'SYNC',
  },
  LOCAL_SYNC_CONFLICT: {
    action: 'LOCAL_SYNC_CONFLICT',
    labelKey: 'audit_events.LOCAL_SYNC_CONFLICT',
    category: 'network',
    icon: 'AlertTriangle',
    module: 'SYNC',
  },
  LOCAL_SYNC_PUSH: {
    action: 'LOCAL_SYNC_PUSH',
    labelKey: 'audit_events.LOCAL_SYNC_PUSH',
    category: 'network',
    icon: 'Network',
    module: 'SYNC',
  },
  LOCAL_SYNC_PULL: {
    action: 'LOCAL_SYNC_PULL',
    labelKey: 'audit_events.LOCAL_SYNC_PULL',
    category: 'network',
    icon: 'Network',
    module: 'SYNC',
  },

  // ── Cash Shift ──────────────────────────────────────────────
  CASH_SHIFT_OPENED: {
    action: 'CASH_SHIFT_OPENED',
    labelKey: 'audit_events.CASH_SHIFT_OPENED',
    category: 'cashShift',
    icon: 'DollarSign',
    module: 'CASH_SHIFT',
  },
  CASH_SHIFT_CLOSED: {
    action: 'CASH_SHIFT_CLOSED',
    labelKey: 'audit_events.CASH_SHIFT_CLOSED',
    category: 'cashShift',
    icon: 'DollarSign',
    module: 'CASH_SHIFT',
  },
  CASH_SHIFT_FORCED_CLOSE: {
    action: 'CASH_SHIFT_FORCED_CLOSE',
    labelKey: 'audit_events.CASH_SHIFT_FORCED_CLOSE',
    category: 'cashShift',
    icon: 'AlertTriangle',
    module: 'CASH_SHIFT',
  },
  CASH_COUNT_PARTIAL: {
    action: 'CASH_COUNT_PARTIAL',
    labelKey: 'audit_events.CASH_COUNT_PARTIAL',
    category: 'cashShift',
    icon: 'ClipboardList',
    module: 'CASH_SHIFT',
  },

  // ── Sales ───────────────────────────────────────────────────
  SALE_CONFIRMED: {
    action: 'SALE_CONFIRMED',
    labelKey: 'audit_events.SALE_CONFIRMED',
    category: 'sale',
    icon: 'Receipt',
    module: 'SALES',
  },
  SALE_ANNULLED: {
    action: 'SALE_ANNULLED',
    labelKey: 'audit_events.SALE_ANNULLED',
    category: 'sale',
    icon: 'Receipt',
    module: 'SALES',
  },

  // ── Clients ─────────────────────────────────────────────────
  CLIENT_CREATED: {
    action: 'CLIENT_CREATED',
    labelKey: 'audit_events.CLIENT_CREATED',
    category: 'client',
    icon: 'UserPlus',
    module: 'CLIENTS',
  },
  CLIENT_UPDATED: {
    action: 'CLIENT_UPDATED',
    labelKey: 'audit_events.CLIENT_UPDATED',
    category: 'client',
    icon: 'UserPlus',
    module: 'CLIENTS',
  },
  CLIENT_DEACTIVATED: {
    action: 'CLIENT_DEACTIVATED',
    labelKey: 'audit_events.CLIENT_DEACTIVATED',
    category: 'client',
    icon: 'UserX',
    module: 'CLIENTS',
  },
  CLIENT_RETURN_CONFIRMED: {
    action: 'CLIENT_RETURN_CONFIRMED',
    labelKey: 'audit_events.CLIENT_RETURN_CONFIRMED',
    category: 'client',
    icon: 'FileText',
    module: 'CLIENTS',
  },

  // ── Prescriptions ───────────────────────────────────────────
  PRESCRIPTION_REGISTERED: {
    action: 'PRESCRIPTION_REGISTERED',
    labelKey: 'audit_events.PRESCRIPTION_REGISTERED',
    category: 'prescription',
    icon: 'FileText',
    module: 'PRESCRIPTIONS',
  },

  // ── Offline Auth ─────────────────────────────────────────────
  OFFLINE_LOGIN: {
    action: 'OFFLINE_LOGIN',
    labelKey: 'audit_events.OFFLINE_LOGIN',
    category: 'auth',
    icon: 'LogIn',
    module: 'AUTH_USERS',
  },
  OFFLINE_SESSION_BLESSED: {
    action: 'OFFLINE_SESSION_BLESSED',
    labelKey: 'audit_events.OFFLINE_SESSION_BLESSED',
    category: 'auth',
    icon: 'Shield',
    module: 'AUTH_USERS',
  },
  OFFLINE_SESSION_REJECTED: {
    action: 'OFFLINE_SESSION_REJECTED',
    labelKey: 'audit_events.OFFLINE_SESSION_REJECTED',
    category: 'failure',
    icon: 'Lock',
    module: 'AUTH_USERS',
  },

  // ── Inventory Adjustments ───────────────────────────────────
  INVENTORY_ADJUSTMENT_CREATED: {
    action: 'INVENTORY_ADJUSTMENT_CREATED',
    labelKey: 'audit_events.INVENTORY_ADJUSTMENT_CREATED',
    category: 'inventory',
    icon: 'Edit',
    module: 'INVENTORY',
  },
  INVENTORY_ADJUSTMENT_APPLIED: {
    action: 'INVENTORY_ADJUSTMENT_APPLIED',
    labelKey: 'audit_events.INVENTORY_ADJUSTMENT_APPLIED',
    category: 'inventory',
    icon: 'Check',
    module: 'INVENTORY',
  },
  INVENTORY_ADJUSTMENT_APPROVED: {
    action: 'INVENTORY_ADJUSTMENT_APPROVED',
    labelKey: 'audit_events.INVENTORY_ADJUSTMENT_APPROVED',
    category: 'inventory',
    icon: 'CheckCheck',
    module: 'INVENTORY',
  },
  INVENTORY_ADJUSTMENT_REJECTED: {
    action: 'INVENTORY_ADJUSTMENT_REJECTED',
    labelKey: 'audit_events.INVENTORY_ADJUSTMENT_REJECTED',
    category: 'inventory',
    icon: 'X',
    module: 'INVENTORY',
  },

  // ── Purchases ───────────────────────────────────────────────
  PURCHASE_ORDER_CREATED: {
    action: 'PURCHASE_ORDER_CREATED',
    labelKey: 'audit_events.PURCHASE_ORDER_CREATED',
    category: 'purchase',
    icon: 'ShoppingCart',
    module: 'PURCHASES',
  },
  PURCHASE_RECEPTION_CONFIRMED: {
    action: 'PURCHASE_RECEPTION_CONFIRMED',
    labelKey: 'audit_events.PURCHASE_RECEPTION_CONFIRMED',
    category: 'purchase',
    icon: 'Package',
    module: 'PURCHASES',
  },

  // ── Fiscal ──────────────────────────────────────────────────
  FISCAL_INVOICE_EMITTED: {
    action: 'FISCAL_INVOICE_EMITTED',
    labelKey: 'audit_events.FISCAL_INVOICE_EMITTED',
    category: 'fiscal',
    icon: 'Receipt',
    module: 'FISCAL',
  },
  FISCAL_CONTINGENCY_ACTIVATED: {
    action: 'FISCAL_CONTINGENCY_ACTIVATED',
    labelKey: 'audit_events.FISCAL_CONTINGENCY_ACTIVATED',
    category: 'fiscal',
    icon: 'AlertTriangle',
    module: 'FISCAL',
  },
  FISCAL_TRANSMISSION_FAILED: {
    action: 'FISCAL_TRANSMISSION_FAILED',
    labelKey: 'audit_events.FISCAL_TRANSMISSION_FAILED',
    category: 'failure',
    icon: 'AlertTriangle',
    module: 'FISCAL',
  },
};

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/**
 * Icon name → LucideIcon component resolver.
 * Centralised so the registry is the only place with lucide icon imports.
 */
const ICON_RESOLVER: Readonly<Record<string, LucideIcon>> = {
  LogIn,
  LogOut,
  Shield,
  Package,
  AlertTriangle,
  UserPlus,
  UserX,
  Lock,
  KeyRound,
  Network,
  DollarSign,
  Receipt,
  FileText,
  ShoppingCart,
  Printer,
  ClipboardList,
  TrendingUp,
  TrendingDown,
  Ban,
  Undo2,
  Check,
  CheckCheck,
  Plus,
  Minus,
  Calendar,
  Unlock,
  ArrowLeft,
  Edit,
  X,
};

const FALLBACK_ICON: LucideIcon = Package;

/** Resolve a config icon name to a LucideIcon component. */
export function resolveIcon(iconName: string): LucideIcon {
  return ICON_RESOLVER[iconName] ?? FALLBACK_ICON;
}

/**
 * Get the full config for an action string.
 * Unknown actions get a sensible fallback so the UI never breaks.
 */
export function getEventConfig(action: string): AuditEventConfig {
  return AUDIT_EVENT_CONFIGS[action] ?? {
    action,
    labelKey: `audit_events.${action}`,
    category: 'default',
    icon: 'Package',
    module: undefined,
  };
}

/** Shorthand — get the category color for an action. */
export function getCategoryColor(action: string): string {
  const config = getEventConfig(action);
  return CATEGORY_META[config.category].color;
}

/** Shorthand — is this action a sensitive (security) event? */
export function getIsSensitive(action: string): boolean {
  const config = getEventConfig(action);
  return CATEGORY_META[config.category].sensitive ?? false;
}

// ---------------------------------------------------------------------------
// Filter dropdown options (derived from config, sorted by labelKey)
// ---------------------------------------------------------------------------

/**
 * Event-type filter options, sorted by their translation label.
 * Consumers prepend an "All events" placeholder as needed.
 */
export const EVENT_FILTER_OPTIONS: ReadonlyArray<AuditEventConfig> =
  Object.values(AUDIT_EVENT_CONFIGS)
    .filter((c) => c.showInFilter !== false)
    .sort((a, b) => a.labelKey.localeCompare(b.labelKey));
