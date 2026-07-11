/**
 * Prescriptions page — thin wiring container.
 *
 * Owns all form state, validation, and submission orchestration for medical
 * prescription capture during checkout.  Presentational sub-components are
 * imported from sibling files so this file stays focused on wiring, not
 * markup.
 *
 * Navigation is driven by the Redux prescriptionFlow state:
 *   - Receives pendingItemId from the store
 *   - On success, advances to the next pending item (if any) or navigates
 *     back to the payment screen
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPrescriptionFlow,
  resolveNextPrescriptionItem,
  setActiveScreen,
  selectPrescriptionFlow,
} from "@/store/slices/ui-slice";
import { selectCartItems } from "@/store/slices/sales-slice";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { usePrescriptionsService } from "../common/service-context";

// ── Presentational components (provided by frontend-pos) ────────────────
import { PrescriptionsNoPending } from "./prescriptions-no-pending";
import { PrescriptionsHeader } from "./prescriptions-header";
import { PrescriptionItemInfo } from "./prescription-item-info";
import { PrescriptionForm } from "./prescription-form";
import { PrescriptionsToast } from "./prescriptions-toast";

// ── Page component ──────────────────────────────────────────────────────

export const PrescriptionsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const prescriptionsService = usePrescriptionsService();

  const { pendingItemId, incompleteItemIds } =
    useAppSelector(selectPrescriptionFlow);
  const cartItems = useAppSelector(selectCartItems);

  const currentCartItem = useMemo(
    () => cartItems.find((item) => item.id === pendingItemId),
    [cartItems, pendingItemId],
  );

  // Form fields
  const [physicianName, setPhysicianName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [prescriptionDate, setPrescriptionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [patientId, setPatientId] = useState("");
  const [isControlledSubstance, setIsControlledSubstance] = useState(false);
  const [bookEntry, setBookEntry] = useState("");
  const [bookPage, setBookPage] = useState("");

  // State
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    operationUuid: string;
    operationType: string;
    isVerified: boolean;
  } | null>(null);

  const isLastItem = incompleteItemIds.length <= 1;

  // ── Validation ──────────────────────────────────────────────────────

  const validationError = useMemo((): string | null => {
    if (!physicianName.trim()) {
      return t("prescriptions.physician_required");
    }
    if (!licenseNumber.trim()) {
      return t("prescriptions.license_required");
    }
    if (!patientId.trim()) {
      return t("prescriptions.patient_id_required");
    }
    if (isControlledSubstance) {
      if (!bookEntry.trim()) {
        return t("prescriptions.book_entry_required");
      }
      if (!bookPage.trim()) {
        return t("prescriptions.book_page_required");
      }
    }
    return null;
  }, [physicianName, licenseNumber, patientId, isControlledSubstance, bookEntry, bookPage, t]);

  // ── Handlers ────────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setPhysicianName("");
    setLicenseNumber("");
    setPrescriptionDate(new Date().toISOString().slice(0, 10));
    setPatientId("");
    setIsControlledSubstance(false);
    setBookEntry("");
    setBookPage("");
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const validationMsg = validationError;
    if (validationMsg) {
      setError(validationMsg);
      return;
    }

    if (!pendingItemId) {
      setError(t("prescriptions.submit_error"));
      return;
    }

    setError(null);

    try {
      setIsProcessing(true);

      await prescriptionsService.create({
        saleItemId: pendingItemId,
        prescriberName: physicianName.trim(),
        prescriptionNumber: licenseNumber.trim(),
        prescriptionDate,
        patientIdNumber: patientId.trim(),
        isControlledSubstance,
        controlledSubstanceBookEntry:
          isControlledSubstance ? bookEntry.trim() : undefined,
        controlledSubstanceBookPage:
          isControlledSubstance ? bookPage.trim() : undefined,
      });

      setIsProcessing(false);

      setToast({
        operationUuid: pendingItemId,
        operationType: "PRESCRIPTION_REGISTRATION",
        isVerified: true,
      });
    } catch (err) {
      setIsProcessing(false);
      setError(
        err instanceof Error ? err.message : t("prescriptions.submit_error"),
      );
    }
  }, [
    validationError,
    prescriptionsService,
    pendingItemId,
    physicianName,
    licenseNumber,
    prescriptionDate,
    patientId,
    isControlledSubstance,
    bookEntry,
    bookPage,
    t,
  ]);

  const handleToastDismissed = useCallback(() => {
    setToast(null);

    if (isLastItem) {
      dispatch(clearPrescriptionFlow());
      dispatch(setActiveScreen("payment"));
    } else {
      dispatch(resolveNextPrescriptionItem());
      resetForm();
    }
  }, [isLastItem, dispatch, resetForm]);

  // ── Render ─────────────────────────────────────────────────────────

  if (!pendingItemId || !currentCartItem) {
    return <PrescriptionsNoPending />;
  }

  return (
    <section
      aria-label={t("prescriptions.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <PrescriptionsHeader
        itemsLeft={incompleteItemIds.length}
      />

      <div className="flex-1 px-pos-xl pb-pos-xl max-w-2xl">
        {currentCartItem && (
          <PrescriptionItemInfo item={currentCartItem} />
        )}

        <PrescriptionForm
          physicianName={physicianName}
          onPhysicianNameChange={setPhysicianName}
          licenseNumber={licenseNumber}
          onLicenseNumberChange={setLicenseNumber}
          prescriptionDate={prescriptionDate}
          onPrescriptionDateChange={setPrescriptionDate}
          patientId={patientId}
          onPatientIdChange={setPatientId}
          isControlledSubstance={isControlledSubstance}
          onIsControlledSubstanceChange={setIsControlledSubstance}
          bookEntry={bookEntry}
          onBookEntryChange={setBookEntry}
          bookPage={bookPage}
          onBookPageChange={setBookPage}
          error={error}
          isProcessing={isProcessing}
          canSubmit={validationError === null}
          isLastItem={isLastItem}
          onSubmit={handleSubmit}
          onCancel={() => {
            dispatch(clearPrescriptionFlow());
            dispatch(setActiveScreen("payment"));
          }}
        />
      </div>

      {toast && (
        <PrescriptionsToast
          operationUuid={toast.operationUuid}
          operationType={toast.operationType}
          isVerified={toast.isVerified}
          isOnline={isOnline}
          onDismiss={handleToastDismissed}
        />
      )}
    </section>
  );
};
