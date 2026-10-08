/**
 * Resolves `msedgedriver`, the native WebDriver tauri-driver proxies to on
 * Windows.
 *
 * tauri-driver refuses to start without it and does not obtain it. The
 * `@wdio/tauri-service` used to handle this automatically; driving tauri-driver
 * directly (see wdio.conf.ts) means owning the step. Owning it explicitly is
 * better anyway: msedgedriver speaks the WebView2 protocol, so it must match
 * the installed WebView2 runtime exactly.
 *
 * The version is read from the machine, the matching driver is downloaded from
 * Microsoft's official CDN, and the result is cached under the app so reruns do
 * not hit the network. The path is handed to tauri-driver with
 * `--native-driver` rather than being pushed onto PATH.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), "e2e", ".artifacts", "drivers");

/**
 * Installed WebView2 runtime version, from the EdgeUpdate client registry key.
 */
function installedWebView2Version(): string | null {
  if (process.platform !== "win32") return null;

  const CLIENT_KEY = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  const keys = [
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${CLIENT_KEY}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${CLIENT_KEY}`,
    `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${CLIENT_KEY}`,
  ];

  for (const key of keys) {
    const out = spawnSync("reg", ["query", key, "/v", "pv"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    if (out.status !== 0) continue;

    const match = /\s+pv\s+REG_SZ\s+(\S+)/i.exec(out.stdout ?? "");
    if (match?.[1]) return match[1];
  }
  return null;
}

/** A driver already extracted in the cache for this exact version. */
function cachedDriver(version: string): string | null {
  const dir = path.join(CACHE_DIR, version);
  const binary = path.join(dir, "msedgedriver.exe");
  return existsSync(binary) ? binary : null;
}

/**
 * Download and extract msedgedriver for `version`.
 *
 * Extraction goes through `tar`, which ships with Windows 10+ and reads zip
 * archives, rather than `Expand-Archive` — that cmdlet lives in
 * Microsoft.PowerShell.Archive, which is absent on some Windows PowerShell
 * installs and fails only at run time. Avoiding it also keeps a zip dependency
 * out of the project for what is a Windows-only path.
 */
async function downloadDriver(version: string): Promise<string> {
  const dir = path.join(CACHE_DIR, version);
  mkdirSync(dir, { recursive: true });

  const url = `https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `could not download msedgedriver ${version} from ${url}: HTTP ${response.status}`,
    );
  }

  const zipPath = path.join(dir, "edgedriver_win64.zip");
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));

  const extract = spawnSync("tar", ["-xf", zipPath, "-C", dir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  if (extract.status !== 0) {
    throw new Error(
      `could not extract ${zipPath}: ${extract.stderr || extract.stdout}`,
    );
  }

  const binary = path.join(dir, "msedgedriver.exe");
  if (!existsSync(binary)) {
    throw new Error(
      `the archive for msedgedriver ${version} did not contain msedgedriver.exe ` +
        `(contents: ${readdirSync(dir).join(", ")})`,
    );
  }
  return binary;
}

/**
 * Absolute path to a msedgedriver matching the installed WebView2.
 *
 * Returns null on non-Windows, where tauri-driver locates the platform driver
 * on its own.
 */
export async function resolveEdgeDriverPath(): Promise<string | null> {
  if (process.platform !== "win32") return null;

  const version = installedWebView2Version();
  if (!version) {
    throw new Error(
      "could not read the installed WebView2 runtime version from the registry; " +
        "tauri-driver needs a matching msedgedriver on Windows",
    );
  }

  return cachedDriver(version) ?? downloadDriver(version);
}
