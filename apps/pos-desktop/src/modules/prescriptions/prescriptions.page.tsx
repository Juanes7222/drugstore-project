/**
 * PrescriptionsPage — capture medical prescription data for sale items that
 * require one before the payment can be confirmed.
 *
 * The form is driven by the real PrescriptionsService from modules/ which
 * validates and persists the prescription to the local database and creates
 * the corresponding SyncQueue entry (PRESCRIPTION_REGISTRATION).
 *
 * Navigation is driven by the Redux prescriptionFlow state:
 *   - Receives pendingItemId from the store
 *   - On success, advances to the next pending item (if any) or navigates
 *     back to the payment screen
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
import { OperationQueuedToast } from "@/components/common/operation-queued-toast";
import { usePrescriptionsService } from "../../infrastructure/service-context";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

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

      // Call the real PrescriptionsService.create() which validates
      // the sale item, checks for duplicates, creates the Prescription
      // record, links it to the SaleItem, and inserts a SyncQueue row.
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
      // All prescriptions resolved — go back to payment
      dispatch(clearPrescriptionFlow());
      dispatch(setActiveScreen("payment"));
    } else {
      // Advance to next item
      dispatch(resolveNextPrescriptionItem());
      resetForm();
    }
  }, [isLastItem, dispatch, resetForm]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // If no pending item, show a fallback
  if (!pendingItemId || !currentCartItem) {
    return (
      <section
        aria-label={t("prescriptions.title")}
        className="flex h-full flex-col items-center justify-center"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        <div className="pos-panel max-w-md p-pos-xl text-center">
          <p
            className="text-body"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("prescriptions.no_pending")}
          </p>
          <button
            type="button"
            onClick={() => {
              dispatch(clearPrescriptionFlow());
              dispatch(setActiveScreen("payment"));
            }}
            className="pos-button pos-button-primary mt-pos-lg"
          >
            {t("common.back")}
          </button>
        </div>
      </section>
    );
  }

  const itemsLeft = incompleteItemIds.length;

  return (
    <section
      aria-label={t("prescriptions.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <div className="px-pos-xl pt-pos-lg pb-pos-md">
        <h1
          className="pos-page-title"
          style={{ color: "var(--color-ink)" }}
        >
          {t("prescriptions.title")}
        </h1>

        {itemsLeft > 1 && (
          <p
            className="mt-pos-xs text-caption font-medium"
            style={{
              color:
                "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("prescriptions.items_left", { count: itemsLeft })}
          </p>
        )}
      </div>

      <div className="flex-1 px-pos-xl pb-pos-xl max-w-2xl">
        {/* Current item info */}
        <div className="pos-panel p-pos-md mb-pos-lg">
          <h2
            className="text-ui font-semibold mb-pos-xs"
            style={{ color: "var(--color-ink)" }}
          >
            {currentCartItem.name}
          </h2>
          <div className="flex gap-pos-md text-caption">
            <span
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("prescriptions.generic_name")}: {currentCartItem.genericName}
            </span>
            {currentCartItem.isRestricted && (
              <span className="pos-badge pos-badge-restrict">
                {t("sales.product.restricted")}
              </span>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="pos-panel p-pos-md">
          <div className="grid grid-cols-2 gap-pos-md mb-pos-md">
            <div className="col-span-2">
              <label
                htmlFor="rx-physician-name"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("prescriptions.physician_name")}{" "}
                <span style={{ color: "var(--color-urgency)" }}>*</span>
              </label>
              <input
                id="rx-physician-name"
                type="text"
                className="pos-input"
                value={physicianName}
                onChange={(e) => setPhysicianName(e.target.value)}
                disabled={isProcessing}
                required
              />
            </div>

            <div>
              <label
                htmlFor="rx-license"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("prescriptions.license_number")}{" "}
                <span style={{ color: "var(--color-urgency)" }}>*</span>
              </label>
              <input
                id="rx-license"
                type="text"
                className="pos-input"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                disabled={isProcessing}
                required
              />
            </div>

            <div>
              <label
                htmlFor="rx-date"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("prescriptions.prescription_date")}
              </label>
              <input
                id="rx-date"
                type="date"
                className="pos-input"
                value={prescriptionDate}
                onChange={(e) => setPrescriptionDate(e.target.value)}
                disabled={isProcessing}
              />
            </div>

            <div className="col-span-2">
              <label
                htmlFor="rx-patient-id"
                className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("prescriptions.patient_id")}{" "}
                <span style={{ color: "var(--color-urgency)" }}>*</span>
              </label>
              <input
                id="rx-patient-id"
                type="text"
                className="pos-input"
                placeholder="CC / CE / NIT"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                disabled={isProcessing}
                required
              />
            </div>
          </div>

          {/* Controlled substance toggle */}
          <div className="mb-pos-md">
            <label className="flex items-center gap-pos-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isControlledSubstance}
                onChange={(e) => setIsControlledSubstance(e.target.checked)}
                disabled={isProcessing}
                className="h-4 w-4"
                style={{
                  accentColor: "var(--color-restrict)",
                }}
              />
              <span
                className="text-body font-medium"
                style={{ color: "var(--color-restrict)" }}
              >
                {t("prescriptions.controlled_substance")}
              </span>
            </label>
          </div>

          {/* Conditional controlled-substance fields */}
          {isControlledSubstance && (
            <div className="grid grid-cols-2 gap-pos-md mb-pos-md p-pos-md rounded"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-restrict) 6%, white)",
                border:
                  "1px solid color-mix(in srgb, var(--color-restrict) 15%, transparent)",
              }}
            >
              <div>
                <label
                  htmlFor="rx-book-entry"
                  className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color: "var(--color-restrict)",
                  }}
                >
                  {t("prescriptions.book_entry")}{" "}
                  <span style={{ color: "var(--color-urgency)" }}>*</span>
                </label>
                <input
                  id="rx-book-entry"
                  type="text"
                  className="pos-input"
                  value={bookEntry}
                  onChange={(e) => setBookEntry(e.target.value)}
                  disabled={isProcessing}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="rx-book-page"
                  className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
                  style={{
                    color: "var(--color-restrict)",
                  }}
                >
                  {t("prescriptions.book_page")}{" "}
                  <span style={{ color: "var(--color-urgency)" }}>*</span>
                </label>
                <input
                  id="rx-book-page"
                  type="text"
                  className="pos-input"
                  value={bookPage}
                  onChange={(e) => setBookPage(e.target.value)}
                  disabled={isProcessing}
                  required
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="mb-pos-md rounded px-pos-md py-pos-sm text-body font-medium"
              role="alert"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
                color: "var(--color-urgency)",
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-pos-md pt-pos-sm">
            <button
              type="button"
              onClick={() => {
                dispatch(clearPrescriptionFlow());
                dispatch(setActiveScreen("payment"));
              }}
              disabled={isProcessing}
              className="pos-button pos-button-secondary px-pos-xl"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isProcessing || validationError !== null}
              className="pos-button pos-button-restrict px-pos-xl"
            >
              {isProcessing
                ? t("prescriptions.processing")
                : isLastItem
                  ? t("prescriptions.submit_finish")
                  : t("prescriptions.submit_next")}
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <OperationQueuedToast
            operationUuid={toast.operationUuid}
            operationType={toast.operationType}
            isVerified={toast.isVerified}
            isOnline={isOnline}
            onDismiss={handleToastDismissed}
          />
        </div>
      )}
    </section>
  );
};
