#!/usr/bin/env node

/**
 * dev-multi-station.mjs
 *
 * Launches three processes in parallel for multi-workstation testing:
 *   1. NestJS server (port 3000)
 *   2. POS workstation 1 — ws_principal (Vite port 5173)
 *   3. POS workstation 2 — ws_secundaria (Vite port 5174)
 *
 * Press Ctrl+C to stop all processes gracefully.
 *
 * Usage:
 *   node scripts/dev-multi-station.mjs
 *   pnpm dev:multi
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Color helpers ──────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const COLORS = {
  server: '\x1b[34m', // blue
  pos1:   '\x1b[32m', // green
  pos2:   '\x1b[33m', // yellow
  meta:   '\x1b[35m', // magenta
};

function prefix(color, tag) {
  return `${color}[${tag}]${RESET}`;
}

function log(color, tag, msg) {
  const p = prefix(color, tag);
  for (const line of msg.trimEnd().split('\n')) {
    console.log(`${p} ${line}`);
  }
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
  });

  proc.stdout.on('data', (data) => {
    log(color, tag, data.toString());
  });
  proc.stderr.on('data', (data) => {
    log(color, tag, data.toString());
  });

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

function killAll() {
  for (const proc of children) {
    if (!proc.killed) {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }
  }
  // Force kill after 3 seconds
  setTimeout(() => {
    for (const proc of children) {
      if (!proc.killed) {
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

// ── Launch services ────────────────────────────────────────────────────────
console.log(`${COLORS.meta}══════════════════════════════════════════════════════${RESET}`);
console.log(`${COLORS.meta}  Multi-workstation dev environment                ${RESET}`);
console.log(`${COLORS.meta}  Server  → http://localhost:3000                  ${RESET}`);
console.log(`${COLORS.meta}  POS 1   → http://localhost:5173  (ws_principal) ${RESET}`);
console.log(`${COLORS.meta}  POS 2   → http://localhost:5174  (ws_secundaria)${RESET}`);
console.log(`${COLORS.meta}  Ctrl+C  → stop all                              ${RESET}`);
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
await new Promise((r) => setTimeout(r, 2000));

// 2. POS 1 — ws_principal (default, port 5173)
launch({
  command: 'pnpm',
  args: ['dev'],
  cwd: 'apps/pos-desktop',
  env: {
    VITE_WORKSTATION_ID: 'ws_principal',
    VITE_FRIENDLY_NAME: 'Caja Principal',
  },
  color: COLORS.pos1,
  tag: 'pos1',
});

// 3. POS 2 — ws_secundaria (port 5174)
launch({
  command: 'pnpm',
  args: ['dev', '--', '--port', '5174'],
  cwd: 'apps/pos-desktop',
  env: {
    VITE_WORKSTATION_ID: 'ws_secundaria',
    VITE_FRIENDLY_NAME: 'Caja Secundaria',
  },
  color: COLORS.pos2,
  tag: 'pos2',
});
