/**
 * Opens an external URL in the system browser.
 *
 * Uses the Tauri shell plugin (`shell:allow-open`) inside the desktop app;
 * falls back to a plain window.open when running in a plain browser (Vite
 * dev) or when the shell bridge is unavailable.
 */

/**
 * Open `url` with the OS default handler. Returns false when no browser
 * could be opened (e.g. popup blocked in a dev browser).
 */
export const openExternalUrl = async (url: string): Promise<boolean> => {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return true;
  } catch {
    // Non-Tauri environment (plain-browser dev) or shell bridge failure.
    const opened = window.open(url, '_blank');
    return opened !== null;
  }
};