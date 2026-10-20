import { api } from "./api";
import type {
  PublishUpdateMetadata,
  UpdateTelemetrySummary,
  UpdateVersionDetail,
  UpdateVersionRow,
} from "../types/updates";

// ---------------------------------------------------------------------------
// Platform-owner endpoints for the POS auto-update system. The server
// enforces the SAAS_ADMIN role on every route.
// ---------------------------------------------------------------------------

export async function fetchUpdateVersions(): Promise<UpdateVersionRow[]> {
  const { data } = await api.get<UpdateVersionRow[]>("/admin/updates/versions");
  return data;
}

export async function fetchUpdateVersion(
  id: string,
): Promise<UpdateVersionDetail> {
  const { data } = await api.get<UpdateVersionDetail>(
    `/admin/updates/versions/${id}`,
  );
  return data;
}

/**
 * Publish a new version: the installer as the `binary` file and the release
 * metadata as a JSON `metadata` field.
 */
export async function publishUpdateVersion(
  file: File,
  metadata: PublishUpdateMetadata,
): Promise<UpdateVersionRow> {
  const form = new FormData();
  form.append("binary", file);
  form.append("metadata", JSON.stringify(metadata));

  const { data } = await api.post<UpdateVersionRow>(
    "/admin/updates/versions",
    form,
  );
  return data;
}

export async function activateUpdateVersion(id: string): Promise<void> {
  await api.post(`/admin/updates/versions/${id}/activate`);
}

export async function pauseUpdateVersion(
  id: string,
  reason?: string,
): Promise<void> {
  await api.post(`/admin/updates/versions/${id}/pause`, { reason });
}

export async function resumeUpdateVersion(id: string): Promise<void> {
  await api.post(`/admin/updates/versions/${id}/resume`);
}

export async function rollbackUpdateVersion(id: string): Promise<void> {
  await api.post(`/admin/updates/versions/${id}/rollback`);
}

export async function fetchUpdateTelemetrySummary(): Promise<UpdateTelemetrySummary> {
  const { data } = await api.get<UpdateTelemetrySummary>(
    "/admin/updates/telemetry/summary",
  );
  return data;
}
