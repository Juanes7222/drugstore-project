/**
 * Native save-file dialog via Tauri.
 *
 * When the app runs inside a Tauri webview, opens the OS save dialog
 * and writes the exported content to the user-chosen path.  Falls back
 * to a standard browser download when not in Tauri (dev mode, web).
 *
 * ## Usage
 *
 * ```ts
 * const saved = await saveFileWithDialog({
 *   content: csvString,       // string or ArrayBuffer
 *   filename: 'report.csv',   // suggested name
 *   mimeType: 'text/csv;charset=utf-8;',
 *   filters: [{ name: 'CSV', extensions: ['csv'] }],
 * });
 * if (saved) toast.success(`Guardado en ${saved}`);
 * ```
 */

import type { DialogFilter } from '@tauri-apps/plugin-dialog';

// ---------------------------------------------------------------------------
// Lazy imports — only loaded when actually used (i.e. in Tauri context)
// ---------------------------------------------------------------------------

let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null;
let tauriCore: typeof import('@tauri-apps/api/core') | null = null;

async function ensureTauriImports(): Promise<boolean> {
  if (tauriDialog && tauriCore) return true;
  try {
    tauriDialog = await import('@tauri-apps/plugin-dialog');
    tauriCore = await import('@tauri-apps/api/core');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Browser fallback
// ---------------------------------------------------------------------------

function browserDownload(
  content: string | ArrayBuffer,
  filename: string,
  mimeType: string,
): void {
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: mimeType })
      : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Base64 encoding helpers
// ---------------------------------------------------------------------------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data:…;base64, prefix.
      resolve(result.split(',', 2)[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function contentToBase64(content: string | ArrayBuffer): Promise<string> {
  if (typeof content === 'string') {
    return btoa(unescape(encodeURIComponent(content)));
  }
  const blob = new Blob([content]);
  return blobToBase64(blob);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SaveDialogOptions {
  content: string | ArrayBuffer;
  filename: string;
  mimeType: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  /** Title for the native save dialog (desktop only). */
  title?: string;
}

/**
 * Show a native save dialog and write the exported content to the
 * chosen path.  Returns the saved file path, or `null` if the user
 * cancelled the dialog.
 *
 * When not running in a Tauri context, falls back to a browser download
 * (no return path).
 */
export async function saveFileWithDialog(
  options: SaveDialogOptions,
): Promise<string | null> {
  const isTauri = await ensureTauriImports();
  if (!isTauri) {
    browserDownload(options.content, options.filename, options.mimeType);
    return null;
  }

  // 1. Map internal filter shape to Tauri's DialogFilter.
  const filters: DialogFilter[] = (options.filters ?? []).map((f) => ({
    name: f.name,
    extensions: f.extensions,
  }));

  // 2. Open native save dialog.
  const filePath = await tauriDialog!.save({
    title: options.title,
    defaultPath: options.filename,
    filters: filters.length > 0 ? filters : undefined,
  });
  if (!filePath) return null; // user cancelled

  // 3. Encode content as base64.
  const contentBase64 = await contentToBase64(options.content);

  // 4. Write via Tauri command.
  const saved = await tauriCore!.invoke<string>('write_report_export', {
    filePath,
    contentBase64,
  });

  return saved;
}
