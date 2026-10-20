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
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  activateUpdateVersion,
  fetchUpdateTelemetrySummary,
  fetchUpdateVersions,
  pauseUpdateVersion,
  publishUpdateVersion,
  resumeUpdateVersion,
  rollbackUpdateVersion,
} from "../../services/updates";
import type {
  UpdateTelemetrySummary,
  UpdateVersionRow,
} from "../../types/updates";
import { formatDateTime, formatNumber } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { ConfirmDialog } from "../../components/common/confirm-dialog";
import { toast } from "../../components/common/toaster";
import { LoadingState, ErrorState } from "../../components/common/states";

const PUBLISH_FORM_SCHEMA = z.object({
  version: z.string().min(1).max(40),
  channel: z.enum(["STABLE", "BETA"]),
  updateType: z.enum(["CRITICAL", "MANDATORY", "OPTIONAL", "HOTFIX"]),
  rolloutStrategy: z.enum(["PHASED", "INSTANT"]),
  releaseNotes: z.string().max(2000),
});

type PublishFormValues = z.infer<typeof PUBLISH_FORM_SCHEMA>;

const EMPTY_FORM: PublishFormValues = {
  version: "",
  channel: "STABLE",
  updateType: "OPTIONAL",
  rolloutStrategy: "PHASED",
  releaseNotes: "",
};

const CHANNELS: PublishFormValues["channel"][] = ["STABLE", "BETA"];
const UPDATE_TYPES: PublishFormValues["updateType"][] = [
  "CRITICAL",
  "MANDATORY",
  "OPTIONAL",
  "HOTFIX",
];
const ROLLOUT_STRATEGIES: PublishFormValues["rolloutStrategy"][] = [
  "PHASED",
  "INSTANT",
];

const STATE_COLOR: Record<string, "default" | "primary" | "warning" | "error" | "success"> = {
  DRAFT: "default",
  ROLLING_OUT: "primary",
  PAUSED: "warning",
  FULLY_DEPLOYED: "success",
  ROLLED_BACK: "error",
};

type PendingAction = { kind: "activate" | "pause" | "resume" | "rollback"; row: UpdateVersionRow };

/** Publish and roll out new versions of the POS desktop app. */
export function UpdatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [publishOpen, setPublishOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-update-versions"],
    queryFn: fetchUpdateVersions,
  });

  const { data: summary } = useQuery({
    queryKey: ["admin-update-telemetry"],
    queryFn: fetchUpdateTelemetrySummary,
  });

  const form = useForm<PublishFormValues>({
    resolver: zodResolver(PUBLISH_FORM_SCHEMA),
    defaultValues: EMPTY_FORM,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-update-versions"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-update-telemetry"] });
  };

  const publishMutation = useMutation({
    mutationFn: async (values: PublishFormValues) => {
      if (!file) throw new Error("no-file");
      return publishUpdateVersion(file, values);
    },
    onSuccess: () => {
      toast.success(t("saas.updates.published"));
      setPublishOpen(false);
      setFile(null);
      form.reset(EMPTY_FORM);
      invalidate();
    },
    onError: () => toast.error(t("saas.updates.publishFailed")),
  });

  const actionMutation = useMutation({
    mutationFn: async (action: PendingAction) => {
      switch (action.kind) {
        case "activate":
          return activateUpdateVersion(action.row.id);
        case "pause":
          return pauseUpdateVersion(action.row.id);
        case "resume":
          return resumeUpdateVersion(action.row.id);
        case "rollback":
          return rollbackUpdateVersion(action.row.id);
      }
    },
    onSuccess: (_data, action) => {
      const messages = {
        activate: "saas.updates.activated",
        pause: "saas.updates.paused",
        resume: "saas.updates.resumed",
        rollback: "saas.updates.rolledBack",
      } as const;
      toast.success(t(messages[action.kind]));
      setPending(null);
      invalidate();
    },
    onError: () => {
      toast.error(t("saas.updates.actionFailed"));
      setPending(null);
    },
  });

  const columns = useMemo<ColumnDef<UpdateVersionRow, unknown>[]>(
    () => [
      {
        id: "version",
        header: t("saas.updates.columns.version"),
        accessorKey: "version",
        cell: (info) => (
          <Typography variant="body2" fontWeight={600}>
            {info.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: "channel",
        header: t("saas.updates.columns.channel"),
        accessorKey: "channel",
        cell: (info) => (
          <Chip
            size="small"
            variant="outlined"
            label={info.getValue<string>()}
          />
        ),
      },
      {
        id: "updateType",
        header: t("saas.updates.columns.type"),
        accessorKey: "updateType",
        cell: (info) => (
          <Typography variant="body2">
            {t(`saas.updates.type_${info.getValue<string>()}`)}
          </Typography>
        ),
      },
      {
        id: "state",
        header: t("saas.updates.columns.state"),
        accessorKey: "state",
        cell: (info) => {
          const state = info.getValue<string>();
          return (
            <Chip
              size="small"
              color={STATE_COLOR[state] ?? "default"}
              label={t(`saas.updates.state_${state}`)}
            />
          );
        },
      },
      {
        id: "rolloutStrategy",
        header: t("saas.updates.columns.rollout"),
        accessorKey: "rolloutStrategy",
        cell: (info) => (
          <Typography variant="body2">
            {t(`saas.updates.strategy_${info.getValue<string>()}`)}
          </Typography>
        ),
      },
      {
        id: "fileSize",
        header: t("saas.updates.columns.size"),
        meta: { align: "right" },
        accessorKey: "fileSize",
        cell: (info) => (
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {`${(info.getValue<number>() / (1024 * 1024)).toFixed(1)} MB`}
          </Typography>
        ),
      },
      {
        id: "releaseDate",
        header: t("saas.updates.columns.released"),
        accessorKey: "releaseDate",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "actions",
        header: t("common.actions"),
        cell: (info) => {
          const row = info.row.original;
          return (
            <Stack direction="row" spacing={0.5} flexWrap="wrap">
              {row.state === "DRAFT" ? (
                <Button
                  size="small"
                  onClick={() => setPending({ kind: "activate", row })}
                >
                  {t("saas.updates.activate")}
                </Button>
              ) : null}
              {row.isActive && !row.isPaused ? (
                <Button
                  size="small"
                  onClick={() => setPending({ kind: "pause", row })}
                >
                  {t("saas.updates.pause")}
                </Button>
              ) : null}
              {row.isPaused ? (
                <Button
                  size="small"
                  onClick={() => setPending({ kind: "resume", row })}
                >
                  {t("saas.updates.resume")}
                </Button>
              ) : null}
              {row.state !== "ROLLED_BACK" ? (
                <Button
                  size="small"
                  color="error"
                  onClick={() => setPending({ kind: "rollback", row })}
                >
                  {t("saas.updates.rollback")}
                </Button>
              ) : null}
            </Stack>
          );
        },
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.updates.title")}
        subtitle={t("saas.updates.subtitle")}
        actions={
          <Button variant="contained" onClick={() => setPublishOpen(true)}>
            {t("saas.updates.publish")}
          </Button>
        }
      />

      <TelemetrySummary summary={summary} />

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
          emptyMessage={t("saas.updates.empty")}
          ariaLabel={t("saas.updates.title")}
        />
      ) : null}

      <Dialog open={publishOpen} onClose={() => setPublishOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("saas.updates.publishTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Button component="label" variant="outlined">
              {file ? file.name : t("saas.updates.file")}
              <input
                hidden
                type="file"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              {t("saas.updates.fileHint")}
            </Typography>

            <TextField
              label={t("saas.updates.version")}
              size="small"
              fullWidth
              {...form.register("version")}
              error={Boolean(form.formState.errors.version)}
              helperText={form.formState.errors.version?.message}
            />

            <TextField
              select
              label={t("saas.updates.channel")}
              size="small"
              fullWidth
              {...form.register("channel")}
            >
              {CHANNELS.map((channel) => (
                <MenuItem key={channel} value={channel}>
                  {channel}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label={t("saas.updates.type")}
              size="small"
              fullWidth
              {...form.register("updateType")}
            >
              {UPDATE_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {t(`saas.updates.type_${type}`)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label={t("saas.updates.strategy")}
              size="small"
              fullWidth
              {...form.register("rolloutStrategy")}
            >
              {ROLLOUT_STRATEGIES.map((strategy) => (
                <MenuItem key={strategy} value={strategy}>
                  {t(`saas.updates.strategy_${strategy}`)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label={t("saas.updates.notes")}
              size="small"
              fullWidth
              multiline
              minRows={3}
              {...form.register("releaseNotes")}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={!file || publishMutation.isPending}
            onClick={() => form.handleSubmit((values) => publishMutation.mutate(values))()}
          >
            {t("saas.updates.publishAction")}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending
            ? t(`saas.updates.confirm_${pending.kind}_title`)
            : ""
        }
        message={
          pending
            ? t(`saas.updates.confirm_${pending.kind}_message`, {
                version: pending.row.version,
              })
            : ""
        }
        onConfirm={() => {
          if (pending) actionMutation.mutate(pending);
        }}
        onClose={() => setPending(null)}
      />
    </Box>
  );
}

function TelemetrySummary({ summary }: { summary?: UpdateTelemetrySummary }) {
  const { t } = useTranslation();
  if (!summary) return null;

  const cards = [
    { label: t("saas.updates.installs"), value: formatNumber(summary.successCount) },
    { label: t("saas.updates.failures"), value: formatNumber(summary.failureCount) },
    { label: t("saas.updates.rollbacks"), value: formatNumber(summary.rollbackCount) },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {t("saas.updates.telemetryTitle")}
      </Typography>
      <Stack direction="row" spacing={4}>
        {cards.map((card) => (
          <Box key={card.label}>
            <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {card.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {card.label}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
