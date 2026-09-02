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
 *   pnpm dev:multi --split-view       # per-process log panes in one screen
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
 * --split-view renders one pane per process (server, system, one per
 * station) using the optional "blessed" package. It needs a real
 * interactive terminal and falls back to the normal interleaved log if
 * blessed isn't installed, the terminal isn't a TTY, or the screen fails
 * to initialize for any other reason — the dev loop is never blocked by it.
 *
 * Whatever the shutdown path (Ctrl+C, SIGTERM, an unhandled error, or the
 * server itself dying), every spawned process is signaled and awaited
 * before this script exits, so no vite/nest/tauri process is left holding
 * a port after the script ends.
 *
 * Press Ctrl+C to stop all processes gracefully; press it twice to force
 * an immediate exit.
 */

import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import net from 'node:net';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SERVER_PORT = 3000;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_PERIOD_MS = 3000;

// ── CLI arguments ──────────────────────────────────────────────────────────
const MAX_STATIONS = 8;
const DEFAULT_STATIONS = 2;
const BASE_PORT = 5173;

function parseArgs(argv) {
  const options = { stations: DEFAULT_STATIONS, desktop: false, freePorts: false, splitView: false };
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
    } else if (arg === '--split-view') {
      options.splitView = true;
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

/** Log channel a station's processes (vite, and tauri in --desktop mode) report to. */
function stationChannel(index) {
  return `station-${index}`;
}

// ── Color helpers ──────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
// ANSI codes for the plain console; kept in the same order as PALETTE_NAMES
// below so index i means "the same hue" in both rendering modes.
const PALETTE = ['\x1b[32m', '\x1b[33m', '\x1b[36m', '\x1b[35m', '\x1b[96m', '\x1b[95m', '\x1b[93m', '\x1b[92m'];
const PALETTE_NAMES = ['green', 'yellow', 'cyan', 'magenta', 'green', 'magenta', 'yellow', 'cyan'];
const COLORS = {
  server: '\x1b[34m', // blue
  meta: '\x1b[90m', // gray
};

function stationColor(index) {
  return PALETTE[(index - 1) % PALETTE.length];
}

function stationColorName(index) {
  return PALETTE_NAMES[(index - 1) % PALETTE_NAMES.length];
}

function log(color, tag, msg) {
  const p = `${color}[${tag}]${RESET}`;
  for (const line of msg.trimEnd().split('\n')) {
    console.log(`${p} ${line}`);
  }
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (str) => str.replace(ANSI_PATTERN, '');

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

/** PIDs listening on `port`. Empty when undetectable on this platform. */
async function findListenerPids(port) {
  try {
    if (process.platform === 'win32') {
      const stdout = await new Promise((res, rej) =>
        execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (e, o) => (e ? rej(e) : res(o)))
      );
      const pids = new Set();
      for (const line of stdout.split('\n')) {
        const cols = line.trim().split(/\s+/);
        // TCP  <local>  <foreign>  LISTENING  <pid>
        if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
          pids.add(Number(cols[4]));
        }
      }
      return [...pids];
    }
    const stdout = await new Promise((res, rej) =>
      execFile('lsof', ['-ti', `tcp:${port}`], (e, o) => (e ? rej(e) : res(o)))
    );
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((pid) => !Number.isNaN(pid));
  } catch {
    return [];
  }
}

function killPid(pid) {
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
async function ensurePortsFree(ports, freePortsFlag, logger) {
  const busy = [];
  for (const port of ports) {
    if (await isPortBusy(port)) busy.push(port);
  }
  if (busy.length === 0) return;

  if (!freePortsFlag) {
    logger.system('Required ports are already in use:');
    for (const port of busy) {
      const pids = await findListenerPids(port);
      const owner = pids.length > 0 ? `PID ${pids.join(', ')}` : 'unknown PID';
      logger.system(`  :${port} ← ${owner} — rerun with --free-ports to terminate it`);
    }
    await logger.dispose();
    process.exit(1);
  }

  for (const port of busy) {
    for (const pid of await findListenerPids(port)) {
      if (pid !== process.pid) {
        logger.system(`Terminating PID ${pid} holding :${port}`);
        killPid(pid);
      }
    }
  }
  await sleep(1000);

  const stillBusy = [];
  for (const port of ports) {
    if (await isPortBusy(port)) stillBusy.push(port);
  }
  if (stillBusy.length > 0) {
    logger.system(`Could not free: ${stillBusy.map((p) => `:${p}`).join(', ')} — aborting`);
    await logger.dispose();
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

// ── Logging ────────────────────────────────────────────────────────────────
/**
 * Renders every process' output interleaved on stdout, prefixed by tag —
 * the original behavior. Always available, no dependencies.
 */
class PlainLogger {
  write(_channel, tag, color, msg) {
    log(color, tag, msg);
  }

  system(msg) {
    log(COLORS.meta, 'SYSTEM', msg);
  }

  banner(lines) {
    console.log(`${COLORS.meta}══════════════════════════════════════════════════════${RESET}`);
    for (const line of lines) console.log(`${COLORS.meta}  ${line}${RESET}`);
    console.log(`${COLORS.meta}══════════════════════════════════════════════════════${RESET}`);
    console.log('');
  }

  async dispose() {}
}

/**
 * Renders one bordered, scrollable pane per channel (server, system, one
 * per station) via blessed, so each process' output stays readable instead
 * of interleaving on a single stream. Mirrors every line to a plain-text
 * log file too, since the alternate screen buffer blessed uses doesn't keep
 * terminal scrollback after it exits.
 */
class SplitLogger {
  #screen;
  #boxes = new Map();
  #logStream;
  logFilePath;

  constructor(blessed, stationCount) {
    this.#screen = blessed.screen({ smartCSR: true, title: 'dev-multi-station' });
    this.#buildLayout(blessed, stationCount);
    this.logFilePath = resolve(tmpdir(), `pharmacy-dev-session-${Date.now()}.log`);
    this.#logStream = createWriteStream(this.logFilePath, { flags: 'a' });

    this.#screen.key(['tab'], () => this.#focusNext());
    this.#screen.render();
  }

  #buildLayout(blessed, stationCount) {
    blessed.box({
      parent: this.#screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' dev-multi-station — Tab: switch pane | arrows/PgUp/PgDn: scroll | Ctrl+C: quit ',
      style: { fg: 'black', bg: 'white' },
    });

    const makeLogBox = (parent, opts, colorName) =>
      blessed.log({
        parent,
        border: { type: 'line' },
        style: { border: { fg: colorName ?? 'gray' }, label: { bold: true } },
        scrollable: true,
        alwaysScroll: true,
        mouse: true,
        keys: true,
        vi: true,
        ...opts,
      });

    this.#boxes.set(
      'server',
      makeLogBox(this.#screen, { label: ' server ', top: 1, left: 0, width: '45%', height: '70%' }, 'blue')
    );
    this.#boxes.set(
      'system',
      makeLogBox(this.#screen, { label: ' system ', top: '71%', left: 0, width: '45%', height: '29%' }, 'gray')
    );

    const stationsArea = blessed.box({ parent: this.#screen, top: 1, left: '45%', width: '55%', height: '100%-1' });
    const columns = stationCount <= 1 ? 1 : stationCount <= 4 ? 2 : 3;
    const rows = Math.ceil(stationCount / columns);
    for (let i = 0; i < stationCount; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const box = makeLogBox(
        stationsArea,
        {
          label: ` estación ${i + 1} `,
          top: `${(row * 100) / rows}%`,
          left: `${(col * 100) / columns}%`,
          width: `${100 / columns}%`,
          height: `${100 / rows}%`,
        },
        stationColorName(i + 1)
      );
      this.#boxes.set(stationChannel(i + 1), box);
    }
  }

  #focusNext() {
    const boxes = [...this.#boxes.values()];
    const currentIndex = boxes.findIndex((box) => box === this.#screen.focused);
    boxes[(currentIndex + 1) % boxes.length].focus();
    this.#screen.render();
  }

  write(channel, tag, _color, msg) {
    const box = this.#boxes.get(channel) ?? this.#boxes.get('system');
    const showTagPrefix = channel !== 'server';
    for (const line of msg.trimEnd().split('\n')) {
      box.log(showTagPrefix ? `[${tag}] ${line}` : line);
    }
    this.#screen.render();
    this.#logStream.write(`${stripAnsi(`[${tag}] ${msg.trimEnd()}`)}\n`);
  }

  system(msg) {
    this.write('system', 'SYSTEM', COLORS.meta, msg);
  }

  banner(lines) {
    for (const line of lines) this.system(line);
    this.system(`Full session log: ${this.logFilePath}`);
  }

  async dispose() {
    await new Promise((resolveClose) => this.#logStream.end(resolveClose));
    this.#screen.destroy();
  }
}

/**
 * Builds a SplitLogger when requested and actually usable, otherwise the
 * normal PlainLogger. blessed needs a real interactive terminal on both
 * ends — without one, screen setup can hang waiting on tty control codes —
 * so a non-TTY session (piped output, CI) always gets the plain logger.
 */
async function createLogger(options) {
  if (!options.splitView) return new PlainLogger();

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    log(COLORS.meta, 'SYSTEM', '--split-view needs an interactive terminal — falling back to normal logs.');
    return new PlainLogger();
  }

  try {
    const { default: blessed } = await import('blessed');
    return new SplitLogger(blessed, options.stations);
  } catch (err) {
    log(
      COLORS.meta,
      'SYSTEM',
      `--split-view needs the "blessed" package (pnpm add -D blessed). Falling back to normal logs. (${err.message})`
    );
    return new PlainLogger();
  }
}

// ── Process management ─────────────────────────────────────────────────────
const children = [];
let logger;
let shuttingDown = false;

function launch({ command, args, cwd, env, color, tag, channel, critical = false }) {
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
  proc.tag = tag;
  proc.channel = channel;
  proc.critical = critical;

  proc.stdout.on('data', (data) => logger.write(channel, tag, color, data.toString()));
  proc.stderr.on('data', (data) => logger.write(channel, tag, color, data.toString()));

  proc.on('error', (err) => {
    logger.system(`[${tag}] Failed to start: ${err.message}`);
  });

  proc.on('exit', (code) => {
    logger.system(`[${tag}] Exited with code ${code}`);
    const idx = children.indexOf(proc);
    if (idx !== -1) children.splice(idx, 1);
    if (proc.critical && code !== 0 && code !== null && !shuttingDown) {
      shutdown(`${tag} died`);
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
function killTree(proc, signal = 'SIGTERM') {
  if (proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-proc.pid, signal); } catch { proc.kill(signal); }
    }
  } catch { /* already gone */ }
}

/**
 * Signals every child, waits up to `gracePeriodMs` for them to actually
 * exit, then force-kills whatever is still alive. Returning only once every
 * process is confirmed gone (or force-killed) is what lets the caller exit
 * the main process without orphaning anything — a fire-and-forget kill
 * followed by an immediate process.exit() would race the grace-period timer.
 */
async function killAllAndWait(gracePeriodMs = SHUTDOWN_GRACE_PERIOD_MS) {
  for (const proc of children) killTree(proc, 'SIGTERM');

  const gracefulDeadline = Date.now() + gracePeriodMs;
  while (children.length > 0 && Date.now() < gracefulDeadline) {
    await sleep(100);
  }

  for (const proc of [...children]) killTree(proc, 'SIGKILL');

  // SIGKILL is unmaskable, but Node still delivers its 'exit' event
  // asynchronously — wait briefly so those exit logs land before the caller
  // tears down the logger.
  const forceKillDeadline = Date.now() + 1000;
  while (children.length > 0 && Date.now() < forceKillDeadline) {
    await sleep(50);
  }
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.system(`Shutting down (${reason})...`);
  await killAllAndWait();
  logger.system('All processes stopped.');
  await logger.dispose();
  process.exit(exitCode);
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
process.on('SIGINT', () => {
  if (shuttingDown) process.exit(1); // second Ctrl+C forces an immediate exit
  shutdown('SIGINT');
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));
}
process.on('uncaughtException', (err) => {
  logger.system(`Uncaught exception: ${err.stack ?? err.message}`);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  logger.system(`Unhandled rejection: ${reason instanceof Error ? reason.stack : reason}`);
  shutdown('unhandledRejection', 1);
});
// Last-resort synchronous safety net: only reached if the process exits
// through a path the handlers above didn't cover. Signals are synchronous,
// so this is safe to run inside the 'exit' event.
process.on('exit', () => {
  for (const proc of children) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
      } else if (!proc.killed && proc.exitCode === null) {
        process.kill(-proc.pid, 'SIGKILL');
      }
    } catch { /* already gone */ }
  }
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
          label: 'main',
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
    color: stationColor(index),
    tag: `pos${index}`,
    channel: stationChannel(index),
  });
}

async function launchDesktopStation(station, port, index) {
  const color = stationColor(index);
  try {
    await waitForPort(port, 60_000);
  } catch (err) {
    logger.system(`[pos${index}] ${err.message} — skipping Tauri window for ${station.id}`);
    return;
  }
  const overridePath = await buildTauriOverride(station, port);
  // WebView2 on Windows shares a user-data dir derived from the app
  // identifier (com.pharmacy.pos-desktop). Two concurrent windows with
  // the same identifier contend on EBWebView and one fails with
  // HRESULT 0x80070057 "parameter is incorrect" / profile-in-use.
  // Point each window at its own data dir so they can run side-by-side.
  const webviewDataDir = resolve(tmpdir(), `pharmacy-webview-${station.id}`);
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
      WEBVIEW2_USER_DATA_FOLDER: webviewDataDir,
    },
    color,
    tag: `win${index}`,
    channel: stationChannel(index),
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
const stationPorts = Array.from({ length: options.stations }, (_, i) => BASE_PORT + i);

logger = await createLogger(options);

await ensurePortsFree([SERVER_PORT, ...stationPorts], options.freePorts, logger);

const bannerLines = [
  `Multi-workstation dev environment (${options.stations} stations, ${options.desktop ? 'desktop' : 'browser'})`,
  `Server  → http://localhost:${SERVER_PORT}`,
  ...Array.from({ length: options.stations }, (_, i) => {
    const station = stationIdentity(i + 1);
    const target = options.desktop ? 'window' : `http://localhost:${BASE_PORT + i}`;
    return `POS ${i + 1}   → ${target}  (${station.id})`;
  }),
  'Note: seeded PROFESSIONAL plan allows 2 workstations; extra',
  'stations must be REJECTED at activation.',
  ...(options.desktop
    ? ['Desktop: each station compiles into its own cargo target', 'dir — first run per station is slow (full dep tree).']
    : []),
  'Ctrl+C  → stop all (twice to force)',
];
logger.banner(bannerLines);

// 1. Server
launch({
  command: 'pnpm',
  args: ['dev'],
  cwd: 'apps/server',
  env: {},
  color: COLORS.server,
  tag: 'server',
  channel: 'server',
  critical: true,
});

try {
  await waitForPort(SERVER_PORT, SERVER_READY_TIMEOUT_MS);
} catch (err) {
  logger.system(`${err.message} — continuing anyway, stations may fail to reach the API.`);
}

// 2..N POS workstations
const stationLaunches = [];
for (let i = 1; i <= options.stations; i++) {
  const station = stationIdentity(i);
  const port = BASE_PORT + (i - 1);
  launchVite(station, port, i);
  if (options.desktop) {
    stationLaunches.push(launchDesktopStation(station, port, i));
  }
  // Stagger spawns so simultaneous vite startups don't contend for fs watchers
  if (i < options.stations) {
    await sleep(250);
  }
}
// Window launches happen once their vite servers are up; don't block Ctrl+C
await Promise.allSettled(stationLaunches);
