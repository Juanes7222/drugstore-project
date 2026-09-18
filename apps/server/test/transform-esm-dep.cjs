/**
 * Jest transformer for ESM-only dependencies that get `require`d from CJS
 * packages (jose@6 is "type": "module" and jwks-rsa, a firebase-admin
 * dependency, requires it) and for the compiled ESM output of
 * packages/database (dist/**, which jest cannot parse as CommonJS).
 * jest-runtime parses those files as CommonJS and dies on the first
 * `import` token, so they are converted to CJS here.
 *
 * The repo has no @babel/preset-env / plugin-transform-modules-commonjs in
 * its dependency tree, but esbuild IS present (devDependency of the
 * pos-desktop workspace), so esbuild does the conversion.
 */
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Resolve esbuild from the pnpm store (it is not a direct dependency of
// apps/server, so a plain require would not resolve).
function resolveEsbuild() {
  // test/ → apps/server → apps → repo root → node_modules/.pnpm
  const storeDir = path.resolve(__dirname, '../../../node_modules/.pnpm');
  if (existsSync(storeDir)) {
    const dirs = readdirSync(storeDir)
      .filter((d) => d.startsWith('esbuild@'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidate = path.join(storeDir, dir, 'node_modules', 'esbuild');
      if (existsSync(candidate)) return require(candidate);
    }
  }
  throw new Error('esbuild not found for ESM dependency transformer');
}

const esbuild = resolveEsbuild();

module.exports = {
  process(sourceText, sourcePath) {
    if (process.env.JEST_ESM_TRANSFORM_DEBUG) {
      console.error(`[esm-transform] ${sourcePath}`);
    }
    const { code } = esbuild.transformSync(sourceText, {
      loader: 'js',
      format: 'cjs',
      target: 'node18',
      // import.meta is illegal in CJS output. The Prisma generated client
      // only uses import.meta.url to compute its own directory, so define
      // it per-file to the real file URL. esbuild evaluates the define
      // statically, so every occurrence sees this file's correct value.
      define: {
        'import.meta.url': JSON.stringify(pathToFileURL(sourcePath).href),
      },
    });
    return { code, map: null };
  },
};
