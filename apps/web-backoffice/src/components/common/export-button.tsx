import { useState } from "react";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import { DownloadIcon } from "../icons/app-icons";
import { downloadCsvExport } from "../../services/backoffice";

interface ExportButtonProps {
  /** Endpoint returning the CSV attachment, e.g. "/backoffice/sales/export". */
  path: string;
  /** Active filters forwarded as query params (page's typed filter object). */
  params: object;
  /** Fallback file name without extension. */
  fallbackName: string;
}

/**
 * Triggers a CSV export download; renders its own error feedback so pages
 * only need to pass path + filters.
 */
export function ExportButton({
  path,
  params,
  fallbackName,
}: ExportButtonProps) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadCsvExport(path, params, fallbackName);
    } catch {
      setFailed(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<DownloadIcon fontSize="small" />}
        onClick={() => void handleExport()}
        disabled={exporting}
      >
        {t("common.exportCsv")}
      </Button>
      <Snackbar
        open={failed}
        autoHideDuration={6000}
        onClose={() => setFailed(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="error"
          variant="filled"
          onClose={() => setFailed(false)}
        >
          {t("common.exportError")}
        </Alert>
      </Snackbar>
    </>
  );
}
