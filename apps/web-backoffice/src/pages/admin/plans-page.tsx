import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  createSaasPlan,
  deleteSaasPlan,
  fetchSaasPlans,
  updateSaasPlan,
  type PlanWritePayload,
} from "../../services/saas-admin";
import type { SaasAdminPlanRow } from "../../types/saas-admin";
import { formatCop } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { ConfirmDialog } from "../../components/common/confirm-dialog";
import { LoadingState, ErrorState } from "../../components/common/states";

// Form prices are entered in main currency units and stored as cents.
// Numeric fields use plain numbers registered with valueAsNumber so the
// resolver types stay exact.
const PLAN_FORM_SCHEMA = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(200),
  description: z.string().max(1000),
  billingMethod: z.enum(["PROVIDER", "CERTIFICATE"]),
  pricingModel: z.enum(["FLAT", "PER_LOCATION", "PER_WORKSTATION", "TIERED"]),
  basePrice: z.number().int().min(0),
  billingPeriod: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
  maxLocations: z.number().int().min(1),
  includedWorkstations: z.number().int().min(0),
  displayOrder: z.number().int().min(0),
  isActive: z.boolean(),
  isPublic: z.boolean(),
});

type PlanFormValues = z.infer<typeof PLAN_FORM_SCHEMA>;

const EMPTY_FORM: PlanFormValues = {
  code: "",
  name: "",
  description: "",
  billingMethod: "PROVIDER",
  pricingModel: "FLAT",
  basePrice: 0,
  billingPeriod: "MONTHLY",
  maxLocations: 1,
  includedWorkstations: 1,
  displayOrder: 0,
  isActive: true,
  isPublic: false,
};

function rowToForm(row: SaasAdminPlanRow): PlanFormValues {
  return {
    code: row.code,
    name: row.name,
    description: row.description ?? "",
    billingMethod: row.billingMethod ?? "PROVIDER",
    pricingModel: row.pricingModel,
    basePrice: Math.round(row.basePriceCents / 100),
    billingPeriod: row.billingPeriod,
    maxLocations: row.maxLocations ?? 1,
    includedWorkstations: row.includedWorkstations ?? 1,
    displayOrder: row.displayOrder ?? 0,
    isActive: row.isActive,
    isPublic: row.isPublic,
  };
}

function formToPayload(values: PlanFormValues): PlanWritePayload {
  return {
    code: values.code,
    name: values.name,
    description: values.description || undefined,
    billingMethod: values.billingMethod,
    pricingModel: values.pricingModel,
    basePriceCents: values.basePrice * 100,
    currency: "COP",
    billingPeriod: values.billingPeriod,
    maxLocations: values.maxLocations,
    includedWorkstations: values.includedWorkstations,
    displayOrder: values.displayOrder,
    isActive: values.isActive,
    isPublic: values.isPublic,
  };
}

type PlanDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; row: SaasAdminPlanRow }
  | { kind: "delete"; row: SaasAdminPlanRow };

export function PlansPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<PlanDialogState>({ kind: "closed" });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-plans"],
    queryFn: fetchSaasPlans,
  });

  // One form instance drives both create and edit; reset on open.
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(PLAN_FORM_SCHEMA),
    defaultValues: EMPTY_FORM,
  });

  const writeMutation = useMutation({
    mutationFn: async () => {
      const payload = formToPayload(form.getValues());
      if (dialog.kind === "edit") {
        await updateSaasPlan(dialog.row.id, payload);
      } else {
        await createSaasPlan(payload);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saas-plans"] });
      // The change-plan picker and revenue mix derive from the catalog.
      void queryClient.invalidateQueries({ queryKey: ["saas-plan-options"] });
      void queryClient.invalidateQueries({ queryKey: ["saas-revenue"] });
      setDialog({ kind: "closed" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (dialog.kind !== "delete") throw new Error("no-row");
      return deleteSaasPlan(dialog.row.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saas-plans"] });
      void queryClient.invalidateQueries({ queryKey: ["saas-plan-options"] });
      void queryClient.invalidateQueries({ queryKey: ["saas-revenue"] });
      setDialog({ kind: "closed" });
    },
  });

  const columns = useMemo<ColumnDef<SaasAdminPlanRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("saas.columns.plan"),
        accessorKey: "name",
        cell: (info) => (
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {info.getValue<string>()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {info.row.original.code}
            </Typography>
          </Box>
        ),
      },
      {
        id: "basePrice",
        header: t("saas.plans.price"),
        accessorKey: "basePriceCents",
        meta: { align: "right" },
        cell: (info) => (
          <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCop(info.getValue<number>() / 100)}
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ ml: 0.5 }}
            >
              /{t(`saas.plans.period_${info.row.original.billingPeriod}`)}
            </Typography>
          </Typography>
        ),
      },
      {
        id: "pricingModel",
        header: t("saas.plans.model"),
        accessorKey: "pricingModel",
        cell: (info) => (
          <Typography variant="caption" color="text.secondary">
            {t(`saas.plans.model_${info.getValue<string>()}`, {
              defaultValue: info.getValue<string>(),
            })}
          </Typography>
        ),
      },
      {
        id: "maxLocations",
        header: t("subscriptions.locations"),
        accessorKey: "maxLocations",
        meta: { align: "right" },
        cell: (info) => info.row.original.maxLocations ?? "—",
      },
      {
        id: "displayOrder",
        header: t("saas.plans.order"),
        accessorKey: "displayOrder",
        meta: { align: "right" },
        cell: (info) => info.row.original.displayOrder ?? 0,
      },
      {
        id: "flags",
        header: t("saas.plans.flags"),
        cell: (info) => {
          const row = info.row.original;
          return (
            <Box display="flex" gap={0.5} flexWrap="wrap">
              <Chip
                size="small"
                variant="outlined"
                color={row.isActive ? "success" : "default"}
                label={
                  row.isActive ? t("workstations.online") : t("workstations.offline")
                }
              />
              {row.isPublic ? (
                <Chip size="small" variant="outlined" label={t("saas.plans.public")} />
              ) : null}
            </Box>
          );
        },
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (info) => (
          <Box display="flex" gap={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                form.reset(rowToForm(info.row.original));
                setDialog({ kind: "edit", row: info.row.original });
              }}
            >
              {t("saas.plans.edit")}
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() => setDialog({ kind: "delete", row: info.row.original })}
            >
              {t("saas.plans.delete")}
            </Button>
          </Box>
        ),
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.plans.title")}
        subtitle={t("saas.plans.subtitle")}
        actions={
          <Button
            variant="contained"
            onClick={() => {
              form.reset(EMPTY_FORM);
              setDialog({ kind: "create" });
            }}
          >
            {t("saas.plans.create")}
          </Button>
        }
      />

      {isLoading && !data ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : data ? (
        <DataTable
          columns={columns}
          data={data}
          total={data.length}
          page={1}
          pageSize={Math.max(data.length, 1)}
          totalPages={1}
          onPageChange={() => undefined}
          getRowId={(row) => row.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          ariaLabel={t("saas.plans.title")}
        />
      ) : null}

      <Dialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        onClose={() => setDialog({ kind: "closed" })}
        aria-labelledby="plan-dialog-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="plan-dialog-title">
          {dialog.kind === "edit" ? t("saas.plans.edit") : t("saas.plans.create")}
        </DialogTitle>
        <DialogContent>
          <Box
            component="form"
            onSubmit={form.handleSubmit(() => writeMutation.mutate())}
            noValidate
          >
          <TextField
            label={t("saas.plans.fieldCode")}
            fullWidth
            margin="normal"
            {...form.register("code")}
            error={Boolean(form.formState.errors.code)}
          />
          <TextField
            label={t("saas.plans.fieldName")}
            fullWidth
            margin="normal"
            {...form.register("name")}
            error={Boolean(form.formState.errors.name)}
          />
          <TextField
            label={t("saas.plans.fieldDescription")}
            fullWidth
            margin="normal"
            multiline
            maxRows={3}
            {...form.register("description")}
          />
          <TextField
            select
            label={t("saas.plans.fieldBillingMethod")}
            fullWidth
            margin="normal"
            defaultValue="PROVIDER"
            {...form.register("billingMethod")}
          >
            <MenuItem value="PROVIDER">{t("saas.plans.method_PROVIDER")}</MenuItem>
            <MenuItem value="CERTIFICATE">{t("saas.plans.method_CERTIFICATE")}</MenuItem>
          </TextField>
          <TextField
            select
            label={t("saas.plans.fieldModel")}
            fullWidth
            margin="normal"
            defaultValue="FLAT"
            {...form.register("pricingModel")}
          >
            {(["FLAT", "PER_LOCATION", "PER_WORKSTATION", "TIERED"] as const).map(
              (model) => (
                <MenuItem key={model} value={model}>
                  {t(`saas.plans.model_${model}`)}
                </MenuItem>
              ),
            )}
          </TextField>
          <TextField
            label={t("saas.plans.fieldBasePrice")}
            type="number"
            fullWidth
            margin="normal"
            inputProps={{ min: 0 }}
            helperText={t("saas.plans.priceHint")}
            {...form.register("basePrice", { valueAsNumber: true })}
            error={Boolean(form.formState.errors.basePrice)}
          />
          <TextField
            select
            label={t("saas.plans.fieldPeriod")}
            fullWidth
            margin="normal"
            defaultValue="MONTHLY"
            {...form.register("billingPeriod")}
          >
            {(["MONTHLY", "QUARTERLY", "ANNUAL"] as const).map((period) => (
              <MenuItem key={period} value={period}>
                {t(`saas.plans.period_${period}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t("subscriptions.locations")}
            type="number"
            fullWidth
            margin="normal"
            inputProps={{ min: 1 }}
            {...form.register("maxLocations", { valueAsNumber: true })}
            error={Boolean(form.formState.errors.maxLocations)}
          />
          <TextField
            label={t("saas.plans.fieldIncludedWorkstations")}
            type="number"
            fullWidth
            margin="normal"
            inputProps={{ min: 0 }}
            {...form.register("includedWorkstations", { valueAsNumber: true })}
            error={Boolean(form.formState.errors.includedWorkstations)}
          />
          <TextField
            label={t("saas.plans.order")}
            type="number"
            fullWidth
            margin="normal"
            inputProps={{ min: 0 }}
            {...form.register("displayOrder", { valueAsNumber: true })}
            error={Boolean(form.formState.errors.displayOrder)}
          />
          <Box display="flex" gap={3} mt={2}>
            <TextField
              select
              label={t("saas.plans.flags")}
              value={form.watch("isActive") ? "active" : "inactive"}
              onChange={(event) =>
                form.setValue("isActive", event.target.value === "active")
              }
              sx={{ width: 160 }}
            >
              <MenuItem value="active">{t("workstations.online")}</MenuItem>
              <MenuItem value="inactive">{t("workstations.offline")}</MenuItem>
            </TextField>
            <TextField
              select
              label={t("saas.plans.visibility")}
              value={form.watch("isPublic") ? "public" : "private"}
              onChange={(event) =>
                form.setValue("isPublic", event.target.value === "public")
              }
              sx={{ width: 200 }}
            >
              <MenuItem value="public">{t("saas.plans.public")}</MenuItem>
              <MenuItem value="private">{t("saas.plans.private")}</MenuItem>
            </TextField>
          </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog({ kind: "closed" })}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={writeMutation.isPending}
            onClick={() => void form.handleSubmit(() => writeMutation.mutate())()}
          >
            {t("common.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={dialog.kind === "delete"}
        title={t("saas.plans.deleteTitle")}
        message={t("saas.plans.deleteMessage", {
          name: dialog.kind === "delete" ? dialog.row.name : "",
        })}
        confirmLabel={t("saas.plans.delete")}
        severity="error"
        onConfirm={() => deleteMutation.mutateAsync()}
        onClose={() => setDialog({ kind: "closed" })}
      />
    </Box>
  );
}
