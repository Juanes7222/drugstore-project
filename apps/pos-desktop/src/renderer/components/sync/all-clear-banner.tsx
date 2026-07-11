/**
 * Green success banner indicating no sync failures detected.
 *
 * Shown when the failure breakdown is empty but there is sync activity,
 * to reassure the user that everything is operating normally.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";

export const AllClearBanner: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-sm">
      <svg
        className="h-5 w-5 flex-shrink-0 text-green-600"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
      <p className="text-sm font-medium text-green-800">
        {t(
          "sync.all_clear",
          "\u2713 All operations completed successfully. No failures detected.",
        )}
      </p>
    </div>
  );
};
