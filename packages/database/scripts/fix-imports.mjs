// Fix extensionless relative imports in Prisma-generated .ts files so they compile to valid ESM .js output.
// Prisma 7 generates:   import { X } from './enums'
// We transform to:      import { X } from './enums.js'

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'generated', 'client');

const rxSingle = /(from\s+'(\.[^']*)')(?!\s*;)/g;
const rxDouble = /(from\s+"(\.[^"]*)")(?!\s*;)/g;

function needsFix(path) {
  return !path.endsWith('.js') && !path.endsWith('.ts') && !path.endsWith('.json') && !path.endsWith('.node');
}

const isWindows = process.platform === 'win32';

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (extname(full) === '.ts') {
      let src = readFileSync(full, 'utf-8');
      let changed = false;
      let result = src.replace(rxSingle, (match, fromExpr, importPath) => {
        if (needsFix(importPath)) { changed = true; return match + '.js'; }
        return match;
      });
      result = result.replace(rxDouble, (match, fromExpr, importPath) => {
        if (needsFix(importPath)) { changed = true; return match + '.js'; }
        return match;
      });
      if (changed) {
        writeFileSync(full, result, 'utf-8');
        console.log('Fixed:', full.substring(SRC.length + 1));
      }
    }
  }
}

walk(SRC);
console.log('Done.');
