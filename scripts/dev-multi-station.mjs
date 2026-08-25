#!/usr/bin/env node

/**
 * dev-multi-station.mjs
 *
 * Launches one NestJS server plus N POS workstation dev environments for
 * multi-workstation testing.
 *
 * Usage:
 *   pnpm dev:multi                    # server + 2 browser stations (default)
 *   pnpm dev:multi --stations=4       # server + 4 stations
 *   pnpm dev:multi --desktop          # open each station as a Tauri window
 *   pnpm dev:multi --desktop --stations=3
 *   pnpm dev:multi --free-ports       # terminate whatever holds the ports
 *
 * Workstation ids map to rows seeded by apps/server/seed (workstation.ts):
 *   station 1 → ws_principal   (Caja Principal)   port 5173
 *   station 2 → ws_secundaria  (Caja Secundaria)  port 5174
 *   station 3 → ws_tercera     (Caja Tercera)     port 5175
 *   ...beyond the seeded four fall back to generated ids (ws_station_05…).
 *
 * Plan-restriction note: the seeded subscription uses the PROFESSIONAL plan
 * (maxWorkstationsPerLocation = 2) and already has 2 active activations, so
 * stations 3+ are expected to be rejected at activation with
 * WORKSTATION_LIMIT_EXCEEDED. That rejection is the behavior under test.
 *
 * Press Ctrl+C to stop all processes gracefully.
 */

import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SERVER_PORT = 3000;

// ── CLI arguments ──────────────────────────────────────────────────────────
const MAX_STATIONS = 8;
const DEFAULT_STATIONS = 2;
const BASE_PORT = 5173;

function parseArgs(argv) {
  const options = { stations: DEFAULT_STATIONS, desktop: false, freePorts: false };
  for (const arg of argv) {
    if (arg.startsWith('--stations=')) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_STATIONS) {
        console.error(`--stations must be an integer between 1 and ${MAX_STATIONS} (got "${arg}")`);
        process.exit(1);
      }
      options.stations = value;
    } else if (arg === '--desktop') {
      options.desktop = true;
    } else if (arg === '--free-ports') {
      options.freePorts = true;
    } else {
      console.error(`Unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  return options;
}

// Seeded identities first, generated ones after — keeps ids stable for the
// common cases while still allowing stress runs past the seeded set.
const SEEDED_STATIONS = [
  { id: 'ws_principal', name: 'Caja Principal' },
  { id: 'ws_secundaria', name: 'Caja Secundaria' },
  { id: 'ws_tercera', name: 'Caja Tercera' },
  { id: 'ws_cuarta', name: 'Caja Cuarta' },
];

function stationIdentity(index) {
  if (index <= SEEDED_STATIONS.length) {
    return SEEDED_STATIONS[index - 1];
  }
  const num = String(index).padStart(2, '0');
  return { id: `ws_station_${num}`, name: `Estación ${num}` };
}

// ── Color helpers ──────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const PALETTE = ['\x1b[32m', '\x1b[33m', '\x1b[36m', '\x1b[35m', '\x1b[96m', '\x1b[95m', '\x1b[93m', '\x1b[92m'];
const COLORS = {
  server: '\x1b[34m', // blue
  meta: '\x1b[90m', // gray
};

function log(color, tag, msg) {
  const p = `${color}[${tag}]${RESET}`;
  for (const line of msg.trimEnd().split('\n')) {
    console.log(`${p} ${line}`);
  }
}

// ── Port helpers ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Probe one bind attempt. Only EADDRINUSE/EACCES mean "occupied"; any other
 * failure (IPv6 unavailable, permission quirks) must NOT be read as busy —
 * treating it so produced false "port in use" aborts on startup.
 */
function probeBind(host, port) {
  return new Promise((resolveProbe) => {
    const srv = net.createServer();
    srv.once('error', (err) => {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? '';
      resolveProbe(code === 'EADDRINUSE' || code === 'EACCES' ? 'busy' : 'error');
    });
    srv.once('listening', () => srv.close(() => resolveProbe('free')));
    srv.listen(port, host);
  });
}

async function isPortBusy(port) {
  // A listener on either stack makes the port unusable for our purposes;
  // probe errors are treated as free (see probeBind).
  const [v4, v6] = await Promise.all([probeBind('127.0.0.1', port), probeBind('::', port)]);
  return v4 === 'busy' || v6 === 'busy';
}

/** PID listening on `port`, or null when undetectable on this platform. */
async function findListenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const stdout = await new Promise((res, rej) =>
        execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (e, o) => (e ? rej(e) : res(o)))
      );
      for (const line of stdout.split('\n')) {
        const cols = line.trim().split(/\s+/);
        // TCP  <local>  <foreign>  LISTENING  <pid>
        if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
          return Number(cols[4]);
        }
      }
      return null;
    }
    const stdout = await new Promise((res, rej) =>
      execFile('lsof', ['-ti', `tcp:${port}`], (e, o) => (e ? rej(e) : res(o)))
    );
    return Number(stdout.trim().split('\n')[0]) || null;
  } catch {
    return null;
  }
}

function killPidTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}

/**
 * Abort unless every needed port is free, or free them with --free-ports.
 * Stale orphaned dev servers were repeatedly biting this workflow (they hold
 * 5173/3000 after an aborted session), so surface them BEFORE launching
 * instead of failing later with a bare EADDRINUSE from vite/nest.
 */
async function ensurePortsFree(ports, freePortsFlag) {
  const busy = [];
  for (const port of ports) {
    if (await isPortBusy(port)) busy.push(port);
  }
  if (busy.length === 0) return;

  if (!freePortsFlag) {
    log(COLORS.meta, 'PORTS', 'Required ports are already in use:');
    for (const port of busy) {
      const pid = await findListenerPid(port);
      log(COLORS.meta, 'PORTS', `  :${port} ← PID ${pid ?? 'unknown'} — rerun with --free-ports to terminate it`);
    }
    process.exit(1);
  }

  for (const port of busy) {
    const pid = await findListenerPid(port);
    if (pid && pid !== process.pid) {
      log(COLORS.meta, 'PORTS', `Terminating PID ${pid} holding :${port}`);
      killPidTree(pid);
    }
  }
  await sleep(1000);

  const stillBusy = [];
  for (const port of ports) {
    if (await isPortBusy(port)) stillBusy.push(port);
  }
  if (stillBusy.length > 0) {
    log(COLORS.meta, 'PORTS', `Could not free: ${stillBusy.map((p) => `:${p}`).join(', ')} — aborting`);
    process.exit(1);
  }
}

/** Resolves once something accepts TCP connections on `port`. */
function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const attempt = () => {
      const socket = net.connect({ port });
      socket.once('connect', () => {
        socket.destroy();
        resolveWait();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          rejectWait(new Error(`Timed out waiting for :${port}`));
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
}

// ── Process management ─────────────────────────────────────────────────────
const children = [];

function launch({ command, args, cwd, env, color, tag }) {
  const proc = spawn(command, args, {
    cwd: resolve(ROOT, cwd),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
    // Own process group on POSIX so the negative-pid kill in killTree()
    // reaches the whole tree; Windows uses taskkill /T instead.
    detached: process.platform !== 'win32',
  });

  proc.stdout.on('data', (data) => log(color, tag, data.toString()));
  proc.stderr.on('data', (data) => log(color, tag, data.toString()));

  proc.on('error', (err) => {
    log(COLORS.meta, 'ERROR', `[${tag}] Failed to start: ${err.message}`);
  });

  proc.on('exit', (code) => {
    log(COLORS.meta, 'EXIT', `[${tag}] Exited with code ${code}`);
    const idx = children.indexOf(proc);
    if (idx !== -1) children.splice(idx, 1);
    // If the server dies, take everything down
    if (tag === 'server' && code !== 0 && code !== null) {
      log(COLORS.meta, 'SHUTDOWN', 'Server died — stopping all processes');
      killAll();
    }
  });

  children.push(proc);
  return proc;
}

/**
 * Kill a spawned process AND its whole child tree.
 *
 * With shell:true the direct child is a shell (cmd.exe on Windows), so
 * proc.kill() only terminates the shell and orphans the underlying
 * vite/nest/node processes — they then hold ports 5173+ and break the next
 * launch. taskkill /T walks the tree on Windows; on POSIX we signal the
 * negative pid (process group), which requires detached spawning.
 */
function killTree(proc) {
  if (proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
    }
  } catch { /* already gone */ }
}

function killAll() {
  for (const proc of children) killTree(proc);
  // Force kill after 3 seconds
  setTimeout(() => {
    for (const proc of children) {
      if (!proc.killed && proc.exitCode === null) {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }
  }, 3000);
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
process.on('SIGINT', () => {
  log(COLORS.meta, 'SIGINT', 'Shutting down...');
  killAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

// ── Desktop mode (Tauri) ───────────────────────────────────────────────────
/**
 * Write a per-station Tauri config override and return its path.
 *
 * tauri.conf.json hardcodes devUrl :5173, which only fits one station. The
 * CLI's --config flag deep-merges this override over the base config: each
 * window points at ITS OWN already-running vite instance, and the nested
 * beforeDevCommand becomes a no-op (we spawned vite ourselves with the
 * station's VITE_WORKSTATION_ID — the env must reach the SERVING process).
 */
async function buildTauriOverride(station, port) {
  const overridePath = resolve(tmpdir(), `pharmacy-dev-${station.id}.tauri.json`);
  const config = {
    build: {
      devUrl: `http://localhost:${port}`,
      // No-op: the vite dev server for this station is already managed by
      // this script; letting tauri spawn its own would race on port 5173.
      beforeDevCommand: 'node -e ""',
    },
    app: {
      windows: [
        {
          title: `Pharmacy POS — ${station.name}`,
          width: 1440,
          height: 900,
          minWidth: 1024,
          minHeight: 700,
          resizable: true,
          fullscreen: false,
        },
      ],
    },
  };
  await writeFile(overridePath, JSON.stringify(config, null, 2));
  return overridePath;
}

/**
 * Spawned as `pnpm exec vite …` rather than `pnpm dev -- --port …`: pnpm 11
 * forwards the literal `--` token to the underlying command, vite ignores
 * every flag after a bare `--`, and all stations then bind the default port
 * 5173 — the first one wins, the rest die with "Port 5173 is already in use".
 */
function launchVite(station, port, index) {
  launch({
    command: 'pnpm',
    args: ['exec', 'vite', '--port', String(port), '--strictPort'],
    cwd: 'apps/pos-desktop',
    env: {
      VITE_WORKSTATION_ID: station.id,
      VITE_FRIENDLY_NAME: station.name,
    },
    color: PALETTE[(index - 1) % PALETTE.length],
    tag: `pos${index}`,
  });
}

async function launchDesktopStation(station, port, index) {
  const color = PALETTE[(index - 1) % PALETTE.length];
  try {
    await waitForPort(port, 60_000);
  } catch (err) {
    log(COLORS.meta, `pos${index}`, `${err.message} — skipping Tauri window for ${station.id}`);
    return;
  }
  const overridePath = await buildTauriOverride(station, port);
  launch({
    command: 'pnpm',
    // `exec` (not the package script) keeps arg-forwarding predictable.
    args: ['exec', 'tauri', 'dev', '--config', overridePath],
    cwd: 'apps/pos-desktop',
    env: {
      VITE_WORKSTATION_ID: station.id,
      VITE_FRIENDLY_NAME: station.name,
      // Per-station cargo target dir. All stations share src-tauri/target by
      // default, so whichever instance links second tries to overwrite
      // target/debug/pos-desktop.exe while the first instance's exe is still
      // RUNNING — Windows refuses to remove a running image ("Acceso denegado,
      // os error 5") and the build dies. The devUrl is baked into the binary
      // at compile time, so sharing one exe across stations isn't an option.
      // Trade-off: first build per station compiles the full dep tree again.
      CARGO_TARGET_DIR: resolve(ROOT, 'apps/pos-desktop/src-tauri', `.target-${station.id}`),
    },
    color,
    tag: `win${index}`,
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
const stationPorts = Array.from({ length: options.stations }, (_, i) => BASE_PORT + i);

await ensurePortsFree([SERVER_PORT, ...stationPorts], options.freePorts);

console.log(`${COLORS.meta}══════════════════════════════════════════════════════${RESET}`);
console.log(`${COLORS.meta}  Multi-workstation dev environment (${options.stations} stations, ${options.desktop ? 'desktop' : 'browser'})`);
console.log(`${COLORS.meta}  Server  → http://localhost:${SERVER_PORT}`);
for (let i = 1; i <= options.stations; i++) {
  const station = stationIdentity(i);
  console.log(`${COLORS.meta}  POS ${i}   → ${options.desktop ? `window` : `http://localhost:${BASE_PORT + i - 1}`}  (${station.id})`);
}
console.log(`${COLORS.meta}  Note: seeded PROFESSIONAL plan allows 2 workstations; extra`);
console.log(`${COLORS.meta}  stations must be REJECTED at activation.`);
if (options.desktop) {
  console.log(`${COLORS.meta}  Desktop: each station compiles into its own cargo target`);
  console.log(`${COLORS.meta}  dir — first run per station is slow (full dep tree).`);
}
console.log(`${COLORS.meta}  Ctrl+C  → stop all`);
console.log(`${COLORS.meta}══════════════════════════════════════════════════════${RESET}`);
console.log('');

// 1. Server
launch({
  command: 'pnpm',
  args: ['dev'],
  cwd: 'apps/server',
  env: {},
  color: COLORS.server,
  tag: 'server',
});

// Small delay so server starts first
await sleep(2000);

// 2..N POS workstations
const stationLaunches = [];
for (let i = 1; i <= options.stations; i++) {
  const station = stationIdentity(i);
  const port = BASE_PORT + (i - 1);
  launchVite(station, port, i);
  stationLaunches.push(launchDesktopStation(station, port, i));
  // Stagger spawns so simultaneous vite startups don't contend for fs watchers
  if (i < options.stations) {
    await sleep(250);
  }
}
// Window launches happen once their vite servers are up; don't block Ctrl+C
await Promise.allSettled(stationLaunches);
