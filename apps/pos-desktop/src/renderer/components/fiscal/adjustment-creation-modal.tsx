/**
 * AdjustmentCreationModal — multi-step modal for creating a local operational
 * invoice adjustment (never syncs to DIAN). Manager/admin only.
 *
 * Steps:
 *   1. Select adjustment type
 *   2. Edit new value + reason
 *   3. Confirm before/after diff and submit
 */
import { type FC, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ChevronLeft, AlertCircle } from "lucide-react";
import type {
  AdjustmentType,
  OperationalInvoiceView,
} from "../../../domain/fiscal/local-adjustment.types";
import type { InvoicePayment } from "../../../domain/fiscal/fiscal-types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AdjustmentCreationModalProps {
  visible: boolean;
  invoiceId: string;
  invoiceStatus: string;
  operationalView: OperationalInvoiceView | null;
  allowedTypes: AdjustmentType[];
  loading: boolean;
  error: string | null;
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
  PAYMENT_SPLIT_CHANGE: "fiscal.adjustment_type_payment_split_change",
  INTERNAL_NOTE: "fiscal.adjustment_type_internal_note",
  CONTACT_UPDATE: "fiscal.adjustment_type_contact_update",
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
    case "PAYMENT_METHOD_CHANGE":
    case "PAYMENT_SPLIT_CHANGE":
      return {
        payments: op?.payments ?? [],
      };
    case "INTERNAL_NOTE":
      return "";
    case "CONTACT_UPDATE":
      return {
        email: op?.contactInfo.email ?? "",
        phone: op?.contactInfo.phone ?? "",
        address: op?.contactInfo.address ?? "",
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
): string {
  const op = view?.operational;
  if (!op) return "—";

  switch (type) {
    case "PAYMENT_METHOD_CHANGE":
    case "PAYMENT_SPLIT_CHANGE":
      return op.payments
        .map(
          (p: InvoicePayment) =>
            `${p.paymentMethodName}: $${Number(p.amount).toLocaleString("es-CO", { minimumFractionDigits: 2 })}`,
        )
        .join("\n");
    case "INTERNAL_NOTE":
      return "—";
    case "CONTACT_UPDATE": {
      const parts: string[] = [];
      if (op.contactInfo.email) parts.push(`Email: ${op.contactInfo.email}`);
      if (op.contactInfo.phone) parts.push(`Tel: ${op.contactInfo.phone}`);
      if (op.contactInfo.address) parts.push(`Dir: ${op.contactInfo.address}`);
      return parts.length > 0 ? parts.join("\n") : "—";
    }
    case "DELIVERY_INFO": {
      if (!op.deliveryInfo) return "—";
      const parts: string[] = [];
      if (op.deliveryInfo.address)
        parts.push(`Dir: ${op.deliveryInfo.address}`);
      if (op.deliveryInfo.contactName)
        parts.push(`Contacto: ${op.deliveryInfo.contactName}`);
      if (op.deliveryInfo.contactPhone)
        parts.push(`Tel: ${op.deliveryInfo.contactPhone}`);
      if (op.deliveryInfo.notes)
        parts.push(`Notas: ${op.deliveryInfo.notes}`);
      if (op.deliveryInfo.scheduledDate)
        parts.push(
          `Programado: ${new Date(op.deliveryInfo.scheduledDate).toLocaleString("es-CO")}`,
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

function formatNewValueDisplay(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ("payments" in obj && Array.isArray(obj.payments)) {
      return (obj.payments as InvoicePayment[])
        .map(
          (p) =>
            `${p.paymentMethodName}: $${Number(p.amount).toLocaleString("es-CO", { minimumFractionDigits: 2 })}`,
        )
        .join("\n");
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
}

/** Editor for PAYMENT_METHOD_CHANGE / PAYMENT_SPLIT_CHANGE — editable amounts */
const PaymentEditor: FC<{
  payments: InvoicePayment[];
  onChange: (payments: InvoicePayment[]) => void;
}> = ({ payments, onChange }) => {
  const { t } = useTranslation();

  const handleAmountChange = useCallback(
    (index: number, raw: string) => {
      const next = payments.map((p, i) =>
        i === index ? { ...p, amount: raw } : p,
      );
      onChange(next);
    },
    [payments, onChange],
  );

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-caption"
        role="table"
        aria-label={t("fiscal.operational_payments_title")}
      >
        <thead>
          <tr
            className="text-left"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            <th scope="col" className="pb-1 pr-2 font-medium">
              {t("fiscal.detail_payment_method")}
            </th>
            <th scope="col" className="pb-1 pl-2 text-right font-medium">
              {t("fiscal.detail_payment_amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {payments.map((pmt, idx) => (
            <tr key={`${pmt.paymentMethodId}-${idx}`}>
              <td
                className="py-1 pr-2 font-medium"
                style={{ color: "var(--color-ink)" }}
              >
                {pmt.paymentMethodName}
              </td>
              <td className="py-1 pl-2">
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-28 rounded-pos border px-2 py-1 text-right font-data tabular-nums text-body-sm"
                  style={{
                    color: "var(--color-ink)",
                    borderColor:
                      "color-mix(in srgb, var(--color-ink) 15%, transparent)",
                    backgroundColor: "var(--color-panel)",
                  }}
                  value={pmt.amount}
                  onChange={(e) => handleAmountChange(idx, e.target.value)}
                  aria-label={`${t("fiscal.detail_payment_amount")} — ${pmt.paymentMethodName}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {payments.length === 0 && (
        <p
          className="py-2 text-center text-caption"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
          }}
        >
          {t("fiscal.detail_payment_method")}
        </p>
      )}
    </div>
  );
};

/** Editor for INTERNAL_NOTE — textarea */
const NoteEditor: FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
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
    aria-label="Nota interna"
    placeholder="Escriba la nota aquí..."
  />
);

/** Editor for CONTACT_UPDATE — email, phone, address */
const ContactEditor: FC<{
  value: { email?: string; phone?: string; address?: string };
  onChange: (v: { email?: string; phone?: string; address?: string }) => void;
}> = ({ value, onChange }) => {
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
          Email
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
          Teléfono
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
          Dirección
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
          Dirección de entrega
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
          Nombre de contacto
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
          Teléfono de contacto
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
          Fecha programada
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
          Notas de entrega
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
}> = ({ value, onChange }) => (
  <input
    type="text"
    className="pos-input text-body-sm"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder="Nombre de la etiqueta"
    aria-label="Nueva etiqueta"
  />
);

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
      aria-label="Seleccionar etiqueta a remover"
    >
      <option value="">— Seleccionar —</option>
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
}> = ({ value, onChange }) => (
  <div className="flex flex-col gap-2">
    <label className="flex flex-col gap-1">
      <span
        className="text-caption font-medium"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
        }}
      >
        Clave
      </span>
      <input
        type="text"
        className="pos-input text-body-sm"
        value={value.key}
        onChange={(e) => onChange({ ...value, key: e.target.value })}
        placeholder="Nombre del campo"
      />
    </label>
    <label className="flex flex-col gap-1">
      <span
        className="text-caption font-medium"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
        }}
      >
        Valor
      </span>
      <input
        type="text"
        className="pos-input text-body-sm"
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder="Valor del campo"
      />
    </label>
  </div>
);

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
      aria-label="Seleccionar campo a eliminar"
    >
      <option value="">— Seleccionar —</option>
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

const ValueEditorDispatch: FC<ValueEditorProps> = ({
  type,
  value,
  onChange,
  operationalView,
}) => {
  switch (type) {
    case "PAYMENT_METHOD_CHANGE":
    case "PAYMENT_SPLIT_CHANGE":
      return (
        <PaymentEditor
          payments={
            (value as { payments: InvoicePayment[] } | undefined)
              ?.payments ?? []
          }
          onChange={(payments) => onChange({ payments })}
        />
      );
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
      <div className="flex gap-3">
        {renderDiffBlock(
          t("fiscal.adjustment_create_before"),
          beforeValue,
        )}
        <div
          className="flex items-center self-stretch px-1"
          aria-hidden="true"
        >
          <span
            className="text-ui font-bold"
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

  // Reset internal state when the modal opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Reset all internal state
        setStep("select-type");
        setSelectedType(null);
        setNewValue(null);
        setReason("");
        setReasonTouched(false);
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
    if (!selectedType) return;
    await onSubmit(selectedType, newValue, reason);
  }, [selectedType, newValue, reason, onSubmit]);

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
    () => getBeforeValue(selectedType ?? "INTERNAL_NOTE", operationalView),
    [selectedType, operationalView],
  );

  const afterValue = useMemo(
    () => formatNewValueDisplay(newValue),
    [newValue],
  );

  const hasTypes = allowedTypes.length > 0;

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const renderStepIndicator = () => {
    const steps = [
      { key: "select-type", label: "Tipo" },
      { key: "edit", label: "Editar" },
      { key: "confirm", label: "Confirmar" },
    ];

    return (
      <nav aria-label="Progreso" className="mb-4">
        <ol className="flex items-center gap-1">
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
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
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
              {reason.length}/10 min
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
            placeholder="Describa el motivo del ajuste (mín. 10 caracteres)"
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
            Factura: {invoiceId} ({invoiceStatus})
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
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-pos shadow-pos-elevated"
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
                  <ChevronLeft className="h-4 w-4" />
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
                <X className="h-4 w-4" />
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
            className="flex items-center justify-end gap-2 border-t px-4 py-3"
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
                disabled={loading}
                onClick={handleSubmit}
              >
                {loading
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
