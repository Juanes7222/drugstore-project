/**
 * Confirmation modal for discarding a sync entry.
 *
 * Presents a required textarea for the discard reason, with Cancel and
 * Discard buttons.  The Discard button is disabled when the reason is
 * empty or when a submission is in progress.  Clicking the overlay
 * backdrop closes the modal unless a submission is in-flight.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface DiscardEntryModalProps {
  entryId: string;
  discardReason: string;
  onDiscardReasonChange: (reason: string) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export const DiscardEntryModal: FC<DiscardEntryModalProps> = ({
  discardReason,
  onDiscardReasonChange,
  isSubmitting,
  onSubmit,
  onCancel,
  entryId: _entryId,
}) => {
  const { t } = useTranslation();

  const handleReasonChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onDiscardReasonChange(e.target.value);
    },
    [onDiscardReasonChange],
  );

  const handleSubmit = useCallback(() => {
    onSubmit();
  }, [onSubmit]);

  const handleCancel = useCallback(() => {
    if (!isSubmitting) {
      onCancel();
    }
  }, [isSubmitting, onCancel]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      // Only close when clicking the overlay itself, not the card
      if (e.target === e.currentTarget && !isSubmitting) {
        onCancel();
      }
    },
    [isSubmitting, onCancel],
  );

  const isDiscardDisabled = isSubmitting || discardReason.trim().length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-modal-title"
    >
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl">
        {/* Header */}
        <div className="border-b border-gray-100 px-5 py-4">
          <h2
            id="discard-modal-title"
            className="text-lg font-semibold text-gray-800"
          >
            {t("sync.discard_title", "Discard Sync Entry")}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t(
              "sync.discard_description",
              "This action cannot be undone. The entry will be permanently removed from the sync queue.",
            )}
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <label
            htmlFor="discard-reason"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            {t("sync.discard_reason_label", "Reason for discarding")}
            <span className="ml-1 text-red-500">*</span>
          </label>
          <textarea
            id="discard-reason"
            value={discardReason}
            onChange={handleReasonChange}
            placeholder={t(
              "sync.discard_reason_placeholder",
              "Explain why this entry is being discarded\u2026",
            )}
            rows={4}
            disabled={isSubmitting}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isDiscardDisabled}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-red-300"
          >
            {isSubmitting
              ? t("common.submitting", "Discarding\u2026")
              : t("sync.discard_button", "Discard")}
          </button>
        </div>
      </div>
    </div>
  );
};
