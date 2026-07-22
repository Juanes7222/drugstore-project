/**
 * Helpers for the user management page.
 *
 * @category Utilities
 */

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "text-green-700 bg-green-100",
  LOCKED: "text-red-700 bg-red-100",
};

export function statusClass(status: string): string {
  return STATUS_CLASSES[status] ?? "text-gray-500 bg-gray-100";
}

export function formatLastLogin(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
}
