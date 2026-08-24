import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { XIcon } from "../icons/app-icons";
import { StatusChip } from "./status-chip";
import { ErrorState } from "./states";
import { fetchSaleDetail } from "../../services/backoffice";
import type { SaleDetail } from "../../types/backoffice";
import { formatCop, formatDateTime } from "../../utils/format";

interface SaleDetailDrawerProps {
  open: boolean;
  saleId: string | null;
  onClose: () => void;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <Box display="flex" justifyContent="space-between" gap={2} py={0.5}>
      <Typography variant="caption" color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ textAlign: "right" }}>
        {value}
      </Typography>
    </Box>
  );
}

function TotalsRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <Box display="flex" justifyContent="space-between" py={0.5}>
      <Typography variant={strong ? "body1" : "body2"} color={strong ? "text.primary" : "text.secondary"}>
        {label}
      </Typography>
      <Typography
        variant={strong ? "body1" : "body2"}
        fontWeight={strong ? 800 : 500}
        sx={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/** Right-side drawer with the full sale receipt: meta, items, totals. */
export function SaleDetailDrawer({ open, saleId, onClose }: SaleDetailDrawerProps) {
  const { t } = useTranslation();
  const enabled = open && saleId !== null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["sale", saleId],
    queryFn: () => fetchSaleDetail(saleId as string),
    enabled,
  });

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 440 } } }}
    >
      <Box
        role="dialog"
        aria-label={t("sales.detailTitle")}
        sx={{ p: 3, display: "flex", flexDirection: "column", height: "100%" }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" component="h2" fontWeight={700}>
            {t("sales.detailTitle")}
          </Typography>
          <IconButton onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={20} />
          </IconButton>
        </Box>

        {isLoading || !data ? (
          <LoadingBody isError={isError && enabled} onRetry={() => void refetch()} />
        ) : (
          <Receipt data={data} />
        )}
      </Box>
    </Drawer>
  );
}

function LoadingBody({
  isError,
  onRetry,
}: {
  isError: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return <ErrorState onRetry={onRetry} />;
  }
  return (
    <Box aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} variant="text" sx={{ fontSize: "0.9rem" }} width={`${45 + ((i * 23) % 45)}%`} />
      ))}
    </Box>
  );
}

function Receipt({ data }: { data: SaleDetail }) {
  const { t } = useTranslation();

  return (
    <>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography component="p" m={0} fontWeight={800} fontSize={24} letterSpacing="-0.02em">
          #{data.localNumber}
        </Typography>
        <StatusChip value={data.operationalState} kind="sale" />
      </Box>

      <Box mb={2}>
        <MetaRow label={t("sales.internalNumber")} value={data.internalNumber ?? "—"} />
        <MetaRow label={t("sales.confirmedAt")} value={formatDateTime(data.confirmedAt)} />
        {data.annulledAt ? (
          <>
            <MetaRow label={t("sales.annulledAt")} value={formatDateTime(data.annulledAt)} />
            <MetaRow
              label={t("sales.annulmentReason")}
              value={data.annulmentReason ?? "—"}
            />
          </>
        ) : null}
        <MetaRow label={t("sales.client")} value={data.clientNameSnapshot ?? "—"} />
        <MetaRow
          label={t("sales.user")}
          value={data.user.displayName ?? data.user.fullName}
        />
        <MetaRow
          label={t("sales.workstation")}
          value={`${data.workstation.name} (${data.workstation.code})`}
        />
      </Box>

      <Divider />

      {/* Items read like a printed receipt: name + qty × price, line total right. */}
      <Typography
        variant="overline"
        component="h3"
        color="text.secondary"
        sx={{ mt: 1.5 }}
      >
        {t("sales.itemsCountSub", { count: data.items.length })}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, overflowY: "auto", flexGrow: 1 }}>
        {data.items.map((item) => (
          <Box component="li" key={item.id} py={1}>
            <Box display="flex" justifyContent="space-between" gap={2}>
              <Typography variant="body2" fontWeight={600} sx={{ minWidth: 0 }}>
                {item.productName}
              </Typography>
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
              >
                {formatCop(item.lineTotal)}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block">
              {t("sales.qtyUnitLine", {
                count: item.quantity,
                price: formatCop(item.unitPrice),
              })}
            </Typography>
          </Box>
        ))}
      </Box>

      <Divider />

      <Box mt={2}>
        <TotalsRow label={t("sales.subtotal")} value={formatCop(data.subtotal)} />
        <TotalsRow label={t("sales.discount")} value={`−${formatCop(data.totalDiscount)}`} />
        <TotalsRow label={t("sales.tax")} value={formatCop(data.totalTax)} />
        <Box mt={1}>
          <TotalsRow label={t("sales.total")} value={formatCop(data.totalAmount)} strong />
        </Box>
      </Box>
    </>
  );
}
