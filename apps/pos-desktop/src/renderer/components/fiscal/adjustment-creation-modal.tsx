/**
 * AdjustmentCreationModal — multi-step modal for creating a local operational
 * invoice adjustment (never syncs to DIAN). Manager/admin only.
 *
 * Steps:
 *   1. Select adjustment type
 *   2. Edit new value + reason
 *   3. Confirm before/after diff and submit
 */
import { type FC, useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircleIcon, ChevronLeftIcon, XIcon } from "@/components/ui/icons";
import type {
  AdjustmentType,
  OperationalInvoiceView,
} from "../../../domain/fiscal/local-adjustment.types";
import type { InvoicePayment } from "../../../domain/fiscal/fiscal-types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClientOption {
  id: string;
  name: string;
  identificationType: string;
  identificationNumber: string;
}

interface AdjustmentCreationModalProps {
  visible: boolean;
  invoiceId: string;
  invoiceStatus: string;
  operationalView: OperationalInvoiceView | null;
  allowedTypes: AdjustmentType[];
  loading: boolean;
  error: string | null;
  /** Optional client catalog for the CLIENT_CHANGE editor. */
  clients?: ClientOption[];
  /**
   * Optional list of active payment methods (id, category, name).
   * When provided, the PAYMENT_METHOD_CHANGE editor resolves the selected
   * category enum to the real PaymentMethod.id UUID instead of storing
   * the raw enum string — keeping the stored adjustment self-describing
   * and compatible with downstream shift-summary reconciliation.
   */
  paymentMethods?: Array<{ id: string; category: string; name: string }>;
  onSubmit: (
    type: AdjustmentType,
    newValue: unknown,
    reason: string,
  ) => Promise<void>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Step type
// ---------------------------------------------------------------------------

type ModalStep = "select-type" | "edit" | "confirm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADJUSTMENT_TYPE_LABEL_KEY: Record<AdjustmentType, string> = {
  PAYMENT_METHOD_CHANGE: "fiscal.adjustment_type_payment_method_change",
  INTERNAL_NOTE: "fiscal.adjustment_type_internal_note",
  CONTACT_UPDATE: "fiscal.adjustment_type_contact_update",
  CLIENT_CHANGE: "fiscal.adjustment_type_client_change",
  DELIVERY_INFO: "fiscal.adjustment_type_delivery_info",
  TAG_ADD: "fiscal.adjustment_type_tag_add",
  TAG_REMOVE: "fiscal.adjustment_type_tag_remove",
  CUSTOM_FIELD_SET: "fiscal.adjustment_type_custom_field_set",
  CUSTOM_FIELD_CLEAR: "fiscal.adjustment_type_custom_field_clear",
  REVERSAL: "fiscal.adjustment_type_reversal",
};

const TYPE_ICON = "•••";

/**
 * Build the initial newValue shape for a given adjustment type, optionally
 * pre-filling from the current operational view.
 */
function getInitialValue(
  type: AdjustmentType,
  view: OperationalInvoiceView | null,
): unknown {
  const op = view?.operational;

  switch (type) {
    case "PAYMENT_METHOD_CHANGE": {
      // Single-method override. Amount is locked to the original fiscal total
      // and never carried in the override payload — it is sourced from the
      // fiscal invoice at apply time to keep DIAN reconciliation intact.
      const current = op?.payments?.[0];
      return {
        paymentMethodId: current?.paymentMethodId ?? "",
        paymentMethodName: current?.paymentMethodName ?? "",
        category: current?.category ?? "",
        transactionReference: current?.transactionReference ?? null,
        authorizationCode: current?.authorizationCode ?? null,
        cardBrand: current?.cardBrand ?? null,
        cardLastFour: current?.cardLastFour ?? null,
      };
    }
    case "INTERNAL_NOTE":
      return "";
    case "CONTACT_UPDATE":
      return {
        email: op?.contactInfo.email ?? "",
        phone: op?.contactInfo.phone ?? "",
        address: op?.contactInfo.address ?? "",
      };
    case "CLIENT_CHANGE":
      return {
        clientId: op?.client?.clientId ?? "",
        name: op?.client?.name ?? "",
        identificationType: op?.client?.identificationType ?? "",
        identificationNumber: op?.client?.identificationNumber ?? "",
      };
    case "DELIVERY_INFO":
      return {
        notes: op?.deliveryInfo?.notes ?? "",
        address: op?.deliveryInfo?.address ?? "",
        contactName: op?.deliveryInfo?.contactName ?? "",
        contactPhone: op?.deliveryInfo?.contactPhone ?? "",
        scheduledDate: op?.deliveryInfo?.scheduledDate ?? "",
      };
    case "TAG_ADD":
      return "";
    case "TAG_REMOVE":
      return "";
    case "CUSTOM_FIELD_SET":
      return { key: "", value: "" };
    case "CUSTOM_FIELD_CLEAR":
      return { key: "" };
    default:
      return null;
  }
}

/**
 * Get the human-readable "before" value from the operational view for the
 * selected adjustment type, to show in the confirmation diff.
 */
function getBeforeValue(
  type: AdjustmentType,
  view: OperationalInvoiceView | null,
  t?: (key: string) => string,
): string {
  const op = view?.operational;
  if (!op) return "—";

  switch (type) {
    case "PAYMENT_METHOD_CHANGE": {
      const first = op.payments[0];
      if (!first) return "—";
      const total = op.payments
        .reduce(
          (acc: number, p: InvoicePayment) => acc + Number(p.amount),
          0,
        )
        .toLocaleString("es-CO", { minimumFractionDigits: 2 });
      return `${first.paymentMethodName} — $${total}`;
    }
    case "INTERNAL_NOTE":
      return "—";
    case "CONTACT_UPDATE": {
      const parts: string[] = [];
      if (op.contactInfo.email) parts.push(`${t?.("clients.email") ?? "Email"}: ${op.contactInfo.email}`);
      if (op.contactInfo.phone) parts.push(`${t?.("clients.phone") ?? "Tel"}: ${op.contactInfo.phone}`);
      if (op.contactInfo.address) parts.push(`${t?.("clients.address") ?? "Dir"}: ${op.contactInfo.address}`);
      return parts.length > 0 ? parts.join("\n") : "—";
    }
    case "CLIENT_CHANGE": {
      const client = op.client;
      const parts: string[] = [];
      if (client?.name) {
        parts.push(`${t?.("clients.full_name") ?? "Nombre"}: ${client.name}`);
      }
      if (client?.identificationType && client?.identificationNumber) {
        parts.push(
          `${t?.("clients.document") ?? "Documento"}: ${client.identificationType} ${client.identificationNumber}`,
        );
      }
      if (client?.clientId) {
        parts.push(
          `${t?.("salesHistory.adjustment.client_id_label") ?? "ID cliente"}: ${client.clientId}`,
        );
      }
      return parts.length > 0 ? parts.join("\n") : "—";
    }
    case "DELIVERY_INFO": {
      if (!op.deliveryInfo) return "—";
      const parts: string[] = [];
      if (op.deliveryInfo.address)
        parts.push(`${t?.("clients.address") ?? "Dir"}: ${op.deliveryInfo.address}`);
      if (op.deliveryInfo.contactName)
        parts.push(`${t?.("fiscal.operational_contact") ?? "Contacto"}: ${op.deliveryInfo.contactName}`);
      if (op.deliveryInfo.contactPhone)
        parts.push(`${t?.("clients.phone") ?? "Tel"}: ${op.deliveryInfo.contactPhone}`);
      if (op.deliveryInfo.notes)
        parts.push(`${t?.("fiscal.adjustment_delivery_notes") ?? "Notas"}: ${op.deliveryInfo.notes}`);
      if (op.deliveryInfo.scheduledDate)
        parts.push(
          `${t?.("fiscal.adjustment_delivery_scheduled_date") ?? "Programado"}: ${new Date(op.deliveryInfo.scheduledDate).toLocaleString("es-CO")}`,
        );
      return parts.length > 0 ? parts.join("\n") : "—";
    }
    case "TAG_ADD":
      return "—";
    case "TAG_REMOVE":
      return op.tags.length > 0 ? op.tags.join(", ") : "—";
    case "CUSTOM_FIELD_SET":
      return "—";
    case "CUSTOM_FIELD_CLEAR":
      return Object.keys(op.customFields).length > 0
        ? Object.keys(op.customFields).join(", ")
        : "—";
    default:
      return "—";
  }
}

function formatNewValueDisplay(value: unknown, t?: (key: string) => string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (
      "paymentMethodName" in obj &&
      typeof obj.paymentMethodName === "string"
    ) {
      const name = obj.paymentMethodName;
      // Show the cashier-facing name as a single readable line. The internal
      // category enum is an accounting grouping, not a second user-facing field.
      return name || "—";
    }
    // Client change: present human-readable diff
    if (
      "clientId" in obj ||
      "name" in obj ||
      "identificationType" in obj ||
      "identificationNumber" in obj
    ) {
      const client = obj as {
        clientId?: string;
        name?: string;
        identificationType?: string;
        identificationNumber?: string;
      };
      const parts: string[] = [];
      if (client.name) {
        parts.push(`${t?.("clients.full_name") ?? "Nombre"}: ${client.name}`);
      }
      if (client.identificationType && client.identificationNumber) {
        parts.push(
          `${t?.("clients.document") ?? "Documento"}: ${client.identificationType} ${client.identificationNumber}`,
        );
      }
      if (client.clientId) {
        parts.push(
          `${t?.("salesHistory.adjustment.client_id_label") ?? "ID cliente"}: ${client.clientId}`,
        );
      }
      return parts.length > 0 ? parts.join("\n") : "—";
    }
    // key-value pairs
    const entries = Object.entries(obj).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined,
    );
    if (entries.length === 0) return "—";
    return entries
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("\n");
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Sub-components — value editors per type
// ---------------------------------------------------------------------------

interface ValueEditorProps {
  type: AdjustmentType;
  value: unknown;
  onChange: (next: unknown) => void;
  operationalView: OperationalInvoiceView | null;
  clients?: ClientOption[];
}

/** Shape of a single payment-method override (no `amount` — locked to the
 *  original fiscal invoice total so DIAN reconciliation is preserved). */
interface PaymentOverrideValue {
  paymentMethodId: string;
  paymentMethodName: string;
  category: string;
  transactionReference: string | null;
  authorizationCode: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
}

/** Single-source list of payment-method categories shown in the picker.
 *  Values match the `PaymentMethodCategory` Prisma enum. */
const PAYMENT_METHOD_CATEGORY_VALUES = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "BANK_TRANSFER",
  "DIGITAL_WALLET",
  "CHECK",
  "CREDIT",
  "OTHER",
] as const;
type PaymentMethodCategoryValue = (typeof PAYMENT_METHOD_CATEGORY_VALUES)[number];

/** Which optional reference fields are meaningful for each category.
 *  CASH/CREDIT/OTHER carry no references; card methods expose card details;
 *  BANK_TRANSFER/DIGITAL_WALLET/CHECK expose a transaction reference. */
const REFERENCE_FIELDS_BY_CATEGORY: Record<
  PaymentMethodCategoryValue,
  { reference: boolean; authCode: boolean; cardBrand: boolean; cardLastFour: boolean }
> = {
  CASH: { reference: false, authCode: false, cardBrand: false, cardLastFour: false },
  DEBIT_CARD: { reference: false, authCode: true, cardBrand: true, cardLastFour: true },
  CREDIT_CARD: { reference: false, authCode: true, cardBrand: true, cardLastFour: true },
  BANK_TRANSFER: { reference: true, authCode: false, cardBrand: false, cardLastFour: false },
  DIGITAL_WALLET: { reference: true, authCode: false, cardBrand: false, cardLastFour: false },
  CHECK: { reference: true, authCode: false, cardBrand: false, cardLastFour: false },
  CREDIT: { reference: false, authCode: false, cardBrand: false, cardLastFour: false },
  OTHER: { reference: false, authCode: false, cardBrand: false, cardLastFour: false },
};

/** Editor for PAYMENT_METHOD_CHANGE — method is editable, amount is locked to
 *  the fiscal total. Reference fields are optional context for the new method. */
const PaymentEditor: FC<{
  value: PaymentOverrideValue;
  onChange: (next: PaymentOverrideValue) => void;
  /** Total amount sourced from the fiscal invoice (immutable). */
  lockedAmount: string;
  /**
   * Optional active payment methods list. When present, the category selector
   * stores the real PaymentMethod.id UUID (not the category enum string) in
   * `paymentMethodId`, keeping the stored adjustment compatible with the
   * cash-shift summary's payment-method reconciliation.
   */
  paymentMethods?: Array<{ id: string; category: string; name: string }>;
}> = ({ value, onChange, lockedAmount, paymentMethods }) => {
  const { t } = useTranslation();

  const set = useCallback(
    <K extends keyof PaymentOverrideValue>(
      key: K,
      next: PaymentOverrideValue[K],
    ) => {
      onChange({ ...value, [key]: next });
    },
    [onChange, value],
  );

  // Default display name for the currently selected category, or empty
  // string when no category is picked. Used both for the override field's
  // placeholder and to fall back when the override is cleared.
  const defaultName = value.category
    ? t(`fiscal.adjustment_payment_method_${value.category.toLowerCase()}`)
    : "";

  /** Build a category → first-active-PaymentMethod.id lookup. */
  const categoryToId = useMemo(() => {
    const map = new Map<string, string>();
    if (paymentMethods) {
      for (const pm of paymentMethods) {
        if (pm.category && !map.has(pm.category)) {
          map.set(pm.category, pm.id);
        }
      }
    }
    return map;
  }, [paymentMethods]);

  const handleCategoryChange = useCallback(
    (nextCategory: string) => {
      // Picking a category auto-fills the display name with the default
      // for that category, resets the optional override, and resolves the
      // paymentMethodId to the real PaymentMethod.id UUID when the
      // active payment-method list is available.  If the list is absent
      // (caller did not provide it), fall back to the category enum value
      // — the cash-shift service's buildPaymentMethodResolver handles
      // that case defensively.
      const resolvedId = categoryToId.get(nextCategory) ?? nextCategory;
      onChange({
        ...value,
        category: nextCategory,
        paymentMethodId: resolvedId,
        paymentMethodName: "",
      });
    },
    [categoryToId, onChange, value],
  );

  const handleOverrideChange = useCallback(
    (nextOverride: string) => {
      // Empty override reverts to the category default; non-empty override
      // is the cashier's explicit display name (e.g. "Tarjeta Visa").
      const trimmed = nextOverride.trim();
      onChange({
        ...value,
        paymentMethodName: trimmed === "" ? defaultName : nextOverride,
      });
    },
    [defaultName, onChange, value],
  );

  const refFields: {
    reference: boolean;
    authCode: boolean;
    cardBrand: boolean;
    cardLastFour: boolean;
  } =
    value.category && value.category in REFERENCE_FIELDS_BY_CATEGORY
      ? REFERENCE_FIELDS_BY_CATEGORY[
          value.category as PaymentMethodCategoryValue
        ]
      : REFERENCE_FIELDS_BY_CATEGORY.OTHER;
  const hasAnyRefField =
    refFields.reference ||
    refFields.authCode ||
    refFields.cardBrand ||
    refFields.cardLastFour;

  return (
    <div className="flex flex-col gap-3">
      {/* Single method picker — category enum drives both the internal
          accounting grouping and the auto-filled display name. */}
      <div className="flex flex-col gap-1">
        <label
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
          htmlFor="adjustment-payment-method"
        >
          {t("fiscal.adjustment_payment_method_label")}
        </label>
        <select
          id="adjustment-payment-method"
          className="pos-input text-body-sm"
          value={value.category}
          onChange={(e) => handleCategoryChange(e.target.value)}
          aria-label={t("fiscal.adjustment_payment_method_label")}
        >
          <option value="">—</option>
          {PAYMENT_METHOD_CATEGORY_VALUES.map((cat) => (
            <option key={cat} value={cat}>
              {t(`fiscal.adjustment_payment_method_${cat.toLowerCase()}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Optional specific name override — does not change the category,
          only the human-readable label (e.g. "Tarjeta Visa" vs "Tarjeta
          Mastercard" under CREDIT_CARD). */}
      <div className="flex flex-col gap-1">
        <label
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
          htmlFor="adjustment-payment-specific-name"
        >
          {t("fiscal.adjustment_payment_specific_name_label")}
        </label>
        <input
          id="adjustment-payment-specific-name"
          type="text"
          className="pos-input text-body-sm"
          value={value.paymentMethodName}
          onChange={(e) => handleOverrideChange(e.target.value)}
          placeholder={defaultName}
          aria-label={t("fiscal.adjustment_payment_specific_name_label")}
          disabled={!value.category}
        />
      </div>

      {/* Read-only amount — sourced from the original fiscal invoice total. */}
      <div
        className="flex items-center justify-between gap-2 rounded-pos px-3 py-2"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--color-pharma) 6%, white)",
          border: `1px solid color-mix(in srgb, var(--color-pharma) 20%, transparent)`,
        }}
      >
        <div className="flex flex-col">
          <span
            className="text-caption font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("fiscal.adjustment_payment_amount_readonly")}
          </span>
          <span
            className="text-caption"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
            }}
          >
            {t("fiscal.adjustment_payment_amount_locked_hint")}
          </span>
        </div>
        <span
          className="font-data tabular-nums text-ui font-semibold"
          style={{ color: "var(--color-pharma)" }}
          aria-label={t("fiscal.adjustment_payment_amount_readonly")}
        >
          $
          {Number(lockedAmount).toLocaleString("es-CO", {
            minimumFractionDigits: 2,
          })}
        </span>
      </div>

      {/* Optional reference fields — only the subset relevant to the
          selected category is shown. Hidden entirely when the category
          carries no reference data (CASH/CREDIT/OTHER). */}
      {hasAnyRefField && (
        <details
          className="rounded-pos border"
          style={{ borderColor: "color-mix(in srgb, var(--color-ink) 12%, transparent)" }}
        >
          <summary
            className="cursor-pointer px-3 py-2 text-caption font-medium"
            style={{ color: "var(--color-ink)" }}
          >
            {t("fiscal.adjustment_payment_reference_details_summary")}
          </summary>
          <div className="flex flex-col gap-2 p-3">
            {refFields.reference && (
              <label className="flex flex-col gap-1">
                <span
                  className="text-caption font-medium"
                  style={{
                    color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("fiscal.adjustment_payment_reference_label")}
                </span>
                <input
                  type="text"
                  className="pos-input text-body-sm"
                  value={value.transactionReference ?? ""}
                  onChange={(e) =>
                    set(
                      "transactionReference",
                      e.target.value === "" ? null : e.target.value,
                    )
                  }
                  aria-label={t("fiscal.adjustment_payment_reference_label")}
                />
              </label>
            )}
            {refFields.authCode && (
              <label className="flex flex-col gap-1">
                <span
                  className="text-caption font-medium"
                  style={{
                    color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("fiscal.adjustment_payment_authorization_label")}
                </span>
                <input
                  type="text"
                  className="pos-input text-body-sm"
                  value={value.authorizationCode ?? ""}
                  onChange={(e) =>
                    set(
                      "authorizationCode",
                      e.target.value === "" ? null : e.target.value,
                    )
                  }
                  aria-label={t("fiscal.adjustment_payment_authorization_label")}
                />
              </label>
            )}
            {refFields.cardBrand && (
              <label className="flex flex-col gap-1">
                <span
                  className="text-caption font-medium"
                  style={{
                    color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("fiscal.adjustment_payment_card_brand_label")}
                </span>
                <input
                  type="text"
                  className="pos-input text-body-sm"
                  value={value.cardBrand ?? ""}
                  onChange={(e) =>
                    set("cardBrand", e.target.value === "" ? null : e.target.value)
                  }
                  aria-label={t("fiscal.adjustment_payment_card_brand_label")}
                />
              </label>
            )}
            {refFields.cardLastFour && (
              <label className="flex flex-col gap-1">
                <span
                  className="text-caption font-medium"
                  style={{
                    color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                  }}
                >
                  {t("fiscal.adjustment_payment_card_last_four_label")}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  className="pos-input text-body-sm font-data tabular-nums"
                  value={value.cardLastFour ?? ""}
                  onChange={(e) =>
                    set(
                      "cardLastFour",
                      e.target.value === "" ? null : e.target.value,
                    )
                  }
                  aria-label={t("fiscal.adjustment_payment_card_last_four_label")}
                />
              </label>
            )}
          </div>
        </details>
      )}
    </div>
  );
};

/** Editor for INTERNAL_NOTE — textarea */
const NoteEditor: FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <textarea
      className="min-h-[120px] w-full rounded-pos border px-3 py-2 text-body-sm"
      style={{
        color: "var(--color-ink)",
        borderColor:
          "color-mix(in srgb, var(--color-ink) 15%, transparent)",
        backgroundColor: "var(--color-panel)",
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("fiscal.adjustment_type_internal_note")}
      placeholder={t("fiscal.adjustment_note_placeholder")}
    />
  );
};

/** Editor for CONTACT_UPDATE — email, phone, address */
const ContactEditor: FC<{
  value: { email?: string; phone?: string; address?: string };
  onChange: (v: { email?: string; phone?: string; address?: string }) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const v = value ?? {};
  const set = (field: string, val: string) =>
    onChange({ ...v, [field]: val });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("clients.email")}
        </span>
        <input
          type="email"
          className="pos-input text-body-sm"
          value={v.email ?? ""}
          onChange={(e) => set("email", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("clients.phone")}
        </span>
        <input
          type="tel"
          className="pos-input text-body-sm"
          value={v.phone ?? ""}
          onChange={(e) => set("phone", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("clients.address")}
        </span>
        <input
          type="text"
          className="pos-input text-body-sm"
          value={v.address ?? ""}
          onChange={(e) => set("address", e.target.value)}
        />
      </label>
    </div>
  );
};

/** Editor for CLIENT_CHANGE */
const ClientEditor: FC<{
  value: {
    clientId?: string;
    name?: string;
    identificationType?: string;
    identificationNumber?: string;
  };
  onChange: (
    v: {
      clientId?: string;
      name?: string;
      identificationType?: string;
      identificationNumber?: string;
    },
  ) => void;
  clients?: ClientOption[];
}> = ({ value, onChange, clients = [] }) => {
  const { t } = useTranslation();
  const v = value ?? {};
  const set = (field: string, val: string) =>
    onChange({ ...v, [field]: val });

  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.identificationNumber.toLowerCase().startsWith(q),
    );
  }, [clients, query]);

  const handleSelect = (client: ClientOption) => {
    onChange({
      clientId: client.id,
      name: client.name,
      identificationType: client.identificationType,
      identificationNumber: client.identificationNumber,
    });
    setQuery("");
    setShowResults(false);
  };

  const handleClear = () => {
    onChange({
      clientId: "",
      name: "",
      identificationType: "",
      identificationNumber: "",
    });
    setQuery("");
    setShowResults(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <p
        className="text-caption"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
        }}
      >
        {t("salesHistory.adjustment.client_change_description")}
      </p>

      {/* Client search */}
      {clients.length > 0 && (
        <div className="relative">
          <label className="flex flex-col gap-1">
            <span
              className="text-caption font-medium"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("clients.search_placeholder")}
            </span>
            <input
              type="text"
              className="pos-input text-body-sm"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder={t("clients.search_placeholder")}
              aria-label={t("clients.search_placeholder")}
              aria-expanded={showResults}
              aria-controls="client-search-results"
              aria-autocomplete="list"
            />
          </label>

          {showResults && query.length > 0 && filtered.length === 0 && (
            <div
              className="absolute z-10 mt-1 w-full rounded-pos border px-3 py-2 text-caption"
              style={{
                backgroundColor: "var(--color-panel)",
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                color: "var(--color-ink-muted)",
              }}
            >
              {t("clients.no_results")}
            </div>
          )}

          {showResults && filtered.length > 0 && (
            <ul
              id="client-search-results"
              role="listbox"
              className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-pos border py-1 shadow-pos-panel"
              style={{
                backgroundColor: "var(--color-panel)",
                borderColor:
                  "color-mix(in srgb, var(--color-ink) 10%, transparent)",
              }}
            >
              {filtered.map((client) => (
                <li key={client.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    className="w-full px-3 py-2 text-left text-body-sm transition-colors hover:bg-surface"
                    style={{
                      color: "var(--color-ink)",
                    }}
                    onClick={() => handleSelect(client)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span className="block font-medium">{client.name}</span>
                    <span
                      className="text-caption font-data tabular-nums"
                      style={{
                        color:
                          "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                      }}
                    >
                      {client.identificationType}: {client.identificationNumber}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Selected / manual fields */}
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span
            className="text-caption font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("clients.full_name")}
          </span>
          <input
            type="text"
            className="pos-input text-body-sm"
            value={v.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            aria-label={t("clients.full_name")}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span
            className="text-caption font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("clients.id_type")}
          </span>
          <select
            className="pos-input text-body-sm"
            value={v.identificationType ?? ""}
            onChange={(e) => set("identificationType", e.target.value)}
            aria-label={t("clients.id_type")}
          >
            <option value="">—</option>
            <option value="CC">{t("clients.id_type_cc")}</option>
            <option value="NIT">{t("clients.id_type_nit")}</option>
            <option value="CE">{t("clients.id_type_ce")}</option>
            <option value="PASSPORT">{t("clients.id_type_passport")}</option>
            <option value="TI">{t("clients.id_type_ti")}</option>
            <option value="PEP">{t("clients.id_type_pep")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span
            className="text-caption font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("clients.id_number")}
          </span>
          <input
            type="text"
            className="pos-input text-body-sm"
            value={v.identificationNumber ?? ""}
            onChange={(e) => set("identificationNumber", e.target.value)}
            aria-label={t("clients.id_number")}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span
            className="text-caption font-medium"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("salesHistory.adjustment.client_id_label")}{" "}
            <span
              className="font-normal"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              ({t("common.optional")})
            </span>
          </span>
          <input
            type="text"
            className="pos-input text-body-sm"
            value={v.clientId ?? ""}
            onChange={(e) => set("clientId", e.target.value)}
            aria-label={t("salesHistory.adjustment.client_id_label")}
          />
        </label>
      </div>

      {(v.name || v.identificationNumber || v.clientId) && (
        <button
          type="button"
          onClick={handleClear}
          className="self-start text-caption font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--color-error)" }}
        >
          {t("common.clear")}
        </button>
      )}
    </div>
  );
};

/** Editor for DELIVERY_INFO */
const DeliveryEditor: FC<{
  value: {
    notes?: string;
    address?: string;
    contactName?: string;
    contactPhone?: string;
    scheduledDate?: string;
  };
  onChange: (
    v: {
      notes?: string;
      address?: string;
      contactName?: string;
      contactPhone?: string;
      scheduledDate?: string;
    },
  ) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const v = value ?? {};
  const set = (field: string, val: string) =>
    onChange({ ...v, [field]: val });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_delivery_address")}
        </span>
        <input
          type="text"
          className="pos-input text-body-sm"
          value={v.address ?? ""}
          onChange={(e) => set("address", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_delivery_contact_name")}
        </span>
        <input
          type="text"
          className="pos-input text-body-sm"
          value={v.contactName ?? ""}
          onChange={(e) => set("contactName", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_delivery_contact_phone")}
        </span>
        <input
          type="tel"
          className="pos-input text-body-sm"
          value={v.contactPhone ?? ""}
          onChange={(e) => set("contactPhone", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_delivery_scheduled_date")}
        </span>
        <input
          type="datetime-local"
          className="pos-input text-body-sm"
          value={v.scheduledDate ?? ""}
          onChange={(e) => set("scheduledDate", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_delivery_notes")}
        </span>
        <textarea
          className="min-h-[80px] w-full rounded-pos border px-3 py-2 text-body-sm"
          style={{
            color: "var(--color-ink)",
            borderColor:
              "color-mix(in srgb, var(--color-ink) 15%, transparent)",
            backgroundColor: "var(--color-panel)",
          }}
          value={v.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>
    </div>
  );
};

/** Editor for TAG_ADD — simple text input */
const TagAddEditor: FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <input
      type="text"
      className="pos-input text-body-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("fiscal.adjustment_tag_add_placeholder")}
      aria-label={t("fiscal.adjustment_tag_add_aria")}
    />
  );
};

/** Editor for TAG_REMOVE — selector from existing tags */
const TagRemoveEditor: FC<{
  value: string;
  onChange: (v: string) => void;
  operationalView: OperationalInvoiceView | null;
}> = ({ value, onChange, operationalView }) => {
  const { t } = useTranslation();
  const tags = operationalView?.operational.tags ?? [];

  if (tags.length === 0) {
    return (
      <p
        className="text-caption italic"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
        }}
      >
        {t("fiscal.operational_no_tags")}
      </p>
    );
  }

  return (
    <select
      className="pos-input text-body-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("fiscal.adjustment_tag_remove_aria")}
    >
      <option value="">—</option>
      {tags.map((tag) => (
        <option key={tag} value={tag}>
          {tag}
        </option>
      ))}
    </select>
  );
};

/** Editor for CUSTOM_FIELD_SET — key + value */
const CustomFieldSetEditor: FC<{
  value: { key: string; value: string };
  onChange: (v: { key: string; value: string }) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_custom_field_key")}
        </span>
        <input
          type="text"
          className="pos-input text-body-sm"
          value={value.key}
          onChange={(e) => onChange({ ...value, key: e.target.value })}
          placeholder={t("fiscal.adjustment_custom_field_key_placeholder")}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span
          className="text-caption font-medium"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("fiscal.adjustment_custom_field_value")}
        </span>
        <input
          type="text"
          className="pos-input text-body-sm"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder={t("fiscal.adjustment_custom_field_value_placeholder")}
        />
      </label>
    </div>
  );
};

/** Editor for CUSTOM_FIELD_CLEAR — selector from existing keys */
const CustomFieldClearEditor: FC<{
  value: { key: string };
  onChange: (v: { key: string }) => void;
  operationalView: OperationalInvoiceView | null;
}> = ({ value, onChange, operationalView }) => {
  const { t } = useTranslation();
  const keys = operationalView?.operational.customFields
    ? Object.keys(operationalView.operational.customFields)
    : [];

  if (keys.length === 0) {
    return (
      <p
        className="text-caption italic"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
        }}
      >
        {t("fiscal.operational_no_custom_fields")}
      </p>
    );
  }

  return (
    <select
      className="pos-input text-body-sm"
      value={value.key}
      onChange={(e) => onChange({ key: e.target.value })}
      aria-label={t("fiscal.adjustment_custom_field_clear_aria")}
    >
      <option value="">—</option>
      {keys.map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </select>
  );
};

// ---------------------------------------------------------------------------
// ValueEditorDispatch — renders the correct editor for the selected type
// ---------------------------------------------------------------------------

const ValueEditorDispatch: FC<ValueEditorProps & { clients?: ClientOption[]; paymentMethods?: Array<{ id: string; category: string; name: string }> }> = ({
  type,
  value,
  onChange,
  operationalView,
  clients,
  paymentMethods,
}) => {
  switch (type) {
    case "PAYMENT_METHOD_CHANGE": {
      const override =
        (value as PaymentOverrideValue | undefined) ?? {
          paymentMethodId: "",
          paymentMethodName: "",
          category: "",
          transactionReference: null,
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        };
      return (
        <PaymentEditor
          value={override}
          onChange={(next) => onChange(next)}
          lockedAmount={operationalView?.fiscal.fullData.totalAmount ?? "0"}
          paymentMethods={paymentMethods}
        />
      );
    }
    case "INTERNAL_NOTE":
      return (
        <NoteEditor value={String(value ?? "")} onChange={onChange} />
      );
    case "CONTACT_UPDATE":
      return (
        <ContactEditor
          value={
            (value as {
              email?: string;
              phone?: string;
              address?: string;
            }) ?? {}
          }
          onChange={onChange}
        />
      );
    case "CLIENT_CHANGE":
      return (
        <ClientEditor
          value={
            (value as {
              clientId?: string;
              name?: string;
              identificationType?: string;
              identificationNumber?: string;
            }) ?? {}
          }
          onChange={onChange}
          clients={clients}
        />
      );
    case "DELIVERY_INFO":
      return (
        <DeliveryEditor
          value={
            (value as {
              notes?: string;
              address?: string;
              contactName?: string;
              contactPhone?: string;
              scheduledDate?: string;
            }) ?? {}
          }
          onChange={onChange}
        />
      );
    case "TAG_ADD":
      return <TagAddEditor value={String(value ?? "")} onChange={onChange} />;
    case "TAG_REMOVE":
      return (
        <TagRemoveEditor
          value={String(value ?? "")}
          onChange={onChange}
          operationalView={operationalView}
        />
      );
    case "CUSTOM_FIELD_SET":
      return (
        <CustomFieldSetEditor
          value={
            (value as { key: string; value: string }) ?? {
              key: "",
              value: "",
            }
          }
          onChange={onChange}
        />
      );
    case "CUSTOM_FIELD_CLEAR":
      return (
        <CustomFieldClearEditor
          value={(value as { key: string }) ?? { key: "" }}
          onChange={onChange}
          operationalView={operationalView}
        />
      );
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Confirmation diff sub-component
// ---------------------------------------------------------------------------

interface ConfirmationDiffProps {
  beforeValue: string;
  afterValue: string;
}

const ConfirmationDiff: FC<ConfirmationDiffProps> = ({
  beforeValue,
  afterValue,
}) => {
  const { t } = useTranslation();

  const renderDiffBlock = (label: string, content: string) => {
    const lines = content.split("\n");
    return (
      <div className="flex-1">
        <h4
          className="mb-1 text-caption font-bold uppercase tracking-wide"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 55%, transparent)",
          }}
        >
          {label}
        </h4>
        <div
          className="rounded-pos p-2 text-caption font-data"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-surface) 60%, white)",
            border: `1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {lines.length > 0 &&
            lines.map((line, i) => <div key={i}>{line || "\u00A0"}</div>)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-3">
        {renderDiffBlock(
          t("fiscal.adjustment_create_before"),
          beforeValue,
        )}
        <div
          className="flex items-center justify-center self-stretch px-1"
          aria-hidden="true"
        >
          <span
            className="text-ui font-bold rotate-90 sm:rotate-0"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 30%, transparent)",
            }}
          >
            →
          </span>
        </div>
        {renderDiffBlock(
          t("fiscal.adjustment_create_after"),
          afterValue,
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const AdjustmentCreationModal: FC<AdjustmentCreationModalProps> = ({
  visible,
  invoiceId,
  invoiceStatus,
  operationalView,
  allowedTypes,
  loading,
  error,
  clients,
  paymentMethods,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation();

  // Internal step & form state
  const [step, setStep] = useState<ModalStep>("select-type");
  const [selectedType, setSelectedType] = useState<AdjustmentType | null>(
    null,
  );
  const [newValue, setNewValue] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  /**
   * Local submitting guard — prevents double-submit even if the parent's
   * `loading` prop is stale during a re-render.
   */
  const [submitting, setSubmitting] = useState(false);

  // Reset all internal form state when modal opens — this covers the case
  // where the parent programmatically closes the modal (onSubmit success) and
  // reopens it later. Radix may not call onOpenChange(false) when the open
  // prop changes from outside, so the handleOpenChange reset alone is unreliable.
  useEffect(() => {
    if (visible) {
      setStep("select-type");
      setSelectedType(null);
      setNewValue(null);
      setReason("");
      setReasonTouched(false);
      setSubmitting(false);
    }
  }, [visible]);

  // Reset internal state when the modal closes via user interaction (X,
  // Escape, overlay click). The useEffect above handles the programmatic-
  // close-then-reopen case; this is a safety net for direct user dismissal.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Reset all internal state
        setStep("select-type");
        setSelectedType(null);
        setNewValue(null);
        setReason("");
        setSubmitting(false);
        onClose();
      }
    },
    [onClose],
  );

  // ----- Type selection -----
  const handleTypeSelect = useCallback(
    (type: AdjustmentType) => {
      setSelectedType(type);
      setNewValue(getInitialValue(type, operationalView));
      setReason("");
      setReasonTouched(false);
      setStep("edit");
    },
    [operationalView],
  );

  // ----- Edit -> Confirm -----
  const reasonValid = reason.trim().length >= 10;

  const handleContinue = useCallback(() => {
    setReasonTouched(true);
    if (!reasonValid) return;
    setStep("confirm");
  }, [reasonValid]);

  // ----- Confirm -> Submit -----
  const handleSubmit = useCallback(async () => {
    if (!selectedType || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(selectedType, newValue, reason);
    } finally {
      setSubmitting(false);
    }
  }, [selectedType, newValue, reason, onSubmit, submitting]);

  // ----- Navigate back -----
  const handleBack = useCallback(() => {
    if (step === "edit") {
      setStep("select-type");
      setSelectedType(null);
      setNewValue(null);
      setReason("");
      setReasonTouched(false);
    } else if (step === "confirm") {
      setStep("edit");
    }
  }, [step]);

  // ----- Derived -----
  const typeLabel = selectedType
    ? t(ADJUSTMENT_TYPE_LABEL_KEY[selectedType])
    : "";

  const beforeValue = useMemo(
    () => getBeforeValue(selectedType ?? "INTERNAL_NOTE", operationalView, t),
    [selectedType, operationalView, t],
  );

  const afterValue = useMemo(
    () => formatNewValueDisplay(newValue, t),
    [newValue, t],
  );

  const hasTypes = allowedTypes.length > 0;

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const renderStepIndicator = () => {
    const steps = [
      { key: "select-type", label: t("fiscal.adjustment_create_step_type") },
      { key: "edit", label: t("fiscal.adjustment_create_step_edit") },
      { key: "confirm", label: t("fiscal.adjustment_create_step_confirm") },
    ];

    return (
      <nav aria-label={t("fiscal.adjustment_create_step_progress")} className="mb-4">
        <ol className="flex flex-wrap items-center gap-1">
          {steps.map((s, idx) => {
            const isActive =
              (s.key === "select-type" && step === "select-type") ||
              (s.key === "edit" && step === "edit") ||
              (s.key === "confirm" && step === "confirm");
            const isPast =
              (s.key === "select-type" &&
                (step === "edit" || step === "confirm")) ||
              (s.key === "edit" && step === "confirm");

            return (
              <li key={s.key} className="flex items-center gap-1">
                {idx > 0 && (
                  <div
                    className="mx-1 h-px w-4"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                    }}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-caption font-semibold ${
                    isActive
                      ? ""
                      : isPast
                        ? ""
                        : ""
                  }`}
                  style={{
                    backgroundColor: isActive
                      ? "var(--color-pharma)"
                      : isPast
                        ? "color-mix(in srgb, var(--color-pharma) 12%, white)"
                        : "color-mix(in srgb, var(--color-ink) 10%, transparent)",
                    color: isActive
                      ? "white"
                      : isPast
                        ? "var(--color-pharma)"
                        : "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                  }}
                  aria-current={isActive ? "step" : undefined}
                >
                  {idx + 1}
                </span>
                <span
                  className="text-caption font-medium"
                  style={{
                    color:
                      isActive || isPast
                        ? "var(--color-ink)"
                        : "color-mix(in srgb, var(--color-ink) 40%, transparent)",
                  }}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  };

  const renderError = () => {
    if (!error) return null;
    return (
      <div
        className="mb-3 flex items-start gap-2 rounded-pos px-3 py-2 text-caption font-medium"
        style={{
          backgroundColor: "var(--color-error-container)",
          color: "var(--color-error)",
        }}
        role="alert"
      >
        <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  };

  // ==================================================================
  // Step: Select type
  // ==================================================================
  const renderSelectType = () => {
    if (!hasTypes) {
      return (
        <div className="flex flex-col items-center justify-center py-8">
          <p
            className="text-body-sm"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 40%, transparent)",
            }}
          >
            {t("fiscal.adjustment_create_no_types")}
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        <p
          className="text-caption font-medium"
          style={{
            color:
              "color-mix(in srgb, var(--color-ink) 55%, transparent)",
          }}
        >
          {t("fiscal.adjustment_create_type_label")}
        </p>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("fiscal.adjustment_create_type_label")}>
          {allowedTypes.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              className="flex items-center gap-3 rounded-pos px-3 py-2 text-left text-body-sm font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-surface) 50%, white)",
                color: "var(--color-ink)",
                border: `1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)`,
              }}
              onClick={() => handleTypeSelect(type)}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-caption font-bold"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-pharma) 10%, white)",
                  color: "var(--color-pharma)",
                }}
                aria-hidden="true"
              >
                {TYPE_ICON}
              </span>
              <span>{t(ADJUSTMENT_TYPE_LABEL_KEY[type])}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ==================================================================
  // Step: Edit value + reason
  // ==================================================================
  const renderEdit = () => {
    if (!selectedType) return null;

    return (
      <div className="flex flex-col gap-4">
        {/* Selected type label */}
        <div
          className="flex items-center gap-2 rounded-pos px-3 py-2"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-pharma) 6%, white)",
          }}
        >
          <span
            className="text-caption font-semibold"
            style={{ color: "var(--color-pharma)" }}
          >
            {typeLabel}
          </span>
        </div>

        {/* Value editor */}
        <div>
          <p
            className="mb-1 text-caption font-medium"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.adjustment_create_value_label")}
          </p>
          <ValueEditorDispatch
            type={selectedType}
            value={newValue}
            onChange={setNewValue}
            operationalView={operationalView}
            clients={clients}
            paymentMethods={paymentMethods}
          />
        </div>

        {/* Reason field */}
        <div>
          <label className="mb-1 flex items-center justify-between">
            <span
              className="text-caption font-medium"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 55%, transparent)",
              }}
            >
              {t("fiscal.adjustment_create_reason_label")}
            </span>
            <span
              className={`text-caption ${
                reason.trim().length < 10 && reasonTouched
                  ? "font-semibold"
                  : ""
              }`}
              style={{
                color:
                  reason.trim().length < 10 && reasonTouched
                    ? "var(--color-error)"
                    : "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("fiscal.adjustment_create_reason_counter", { count: reason.length })}
            </span>
          </label>
          <textarea
            className="min-h-[70px] w-full rounded-pos border px-3 py-2 text-body-sm"
            style={{
              color: "var(--color-ink)",
              borderColor:
                reason.trim().length < 10 && reasonTouched
                  ? "var(--color-error)"
                  : "color-mix(in srgb, var(--color-ink) 15%, transparent)",
              backgroundColor: "var(--color-panel)",
            }}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (!reasonTouched) setReasonTouched(true);
            }}
            onBlur={() => setReasonTouched(true)}
            placeholder={t("fiscal.adjustment_create_reason_placeholder")}
            aria-label={t("fiscal.adjustment_create_reason_label")}
            aria-invalid={
              reason.trim().length < 10 && reasonTouched ? true : undefined
            }
            aria-describedby={
              reason.trim().length < 10 && reasonTouched
                ? "reason-validation-error"
                : undefined
            }
          />
          {reason.trim().length < 10 && reasonTouched && (
            <p
              id="reason-validation-error"
              className="mt-1 text-caption font-medium"
              style={{ color: "var(--color-error)" }}
              role="alert"
            >
              {t("fiscal.adjustment_create_reason_required")}
            </p>
          )}
        </div>
      </div>
    );
  };

  // ==================================================================
  // Step: Confirmation
  // ==================================================================
  const renderConfirm = () => {
    if (!selectedType) return null;

    return (
      <div className="flex flex-col gap-4">
        {/* Summary */}
        <div
          className="rounded-pos px-3 py-2 text-body-sm"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-urgency) 6%, white)",
            borderLeft: "3px solid var(--color-urgency)",
          }}
        >
          <p className="font-semibold" style={{ color: "var(--color-ink)" }}>
            {typeLabel}
          </p>
          <p
            className="text-caption"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.adjustment_create_invoice_label")}: {invoiceId} ({invoiceStatus})
          </p>
        </div>

        {/* Before / After diff */}
        <ConfirmationDiff
          beforeValue={beforeValue}
          afterValue={afterValue}
        />

        {/* Reason */}
        <div>
          <p
            className="mb-1 text-caption font-semibold"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 55%, transparent)",
            }}
          >
            {t("fiscal.adjustment_create_reason_label")}
          </p>
          <div
            className="rounded-pos px-3 py-2 text-body-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-surface) 60%, white)",
              color: "var(--color-ink)",
            }}
          >
            {reason}
          </div>
        </div>
      </div>
    );
  };

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <Dialog.Root open={visible} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 40%, transparent)",
          }}
        />

        {/* Content */}
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-pos shadow-pos-elevated"
          style={{ backgroundColor: "var(--color-panel)" }}
          aria-describedby={undefined}
        >
          {/* ---- Header ---- */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 10%, transparent)",
            }}
          >
            <div className="flex items-center gap-2">
              {/* Back button (not on first step) */}
              {step !== "select-type" && (
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-pos transition-colors hover:opacity-70"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                  }}
                  onClick={handleBack}
                  aria-label={t("fiscal.adjustment_create_back")}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
              )}

              <Dialog.Title
                className="text-ui font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {step === "confirm"
                  ? t("fiscal.adjustment_create_confirm_title")
                  : t("fiscal.adjustment_create_modal_title")}
              </Dialog.Title>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-pos transition-colors hover:opacity-70"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
                aria-label={t("common.close")}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* ---- Body ---- */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {renderStepIndicator()}
            {renderError()}

            {step === "select-type" && renderSelectType()}
            {step === "edit" && renderEdit()}
            {step === "confirm" && renderConfirm()}
          </div>

          {/* ---- Footer ---- */}
          <div
            className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 10%, transparent)",
            }}
          >
            {(step === "edit" || step === "confirm") && (
              <button
                type="button"
                className="pos-button pos-button-secondary px-3 py-1 text-body-sm"
                onClick={handleBack}
              >
                {t("fiscal.adjustment_create_back")}
              </button>
            )}

            {step === "edit" && (
              <button
                type="button"
                className="pos-button pos-button-primary px-4 py-1 text-body-sm"
                disabled={!reasonValid}
                onClick={handleContinue}
              >
                {t("fiscal.adjustment_create_continue")}
              </button>
            )}

            {step === "confirm" && (
              <button
                type="button"
                className="pos-button pos-button-primary px-4 py-1 text-body-sm"
                disabled={loading || submitting}
                onClick={handleSubmit}
              >
                {loading || submitting
                  ? t("fiscal.adjustment_create_submitting")
                  : t("fiscal.adjustment_create_submit")}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
