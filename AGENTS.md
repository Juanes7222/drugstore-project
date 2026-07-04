
## Coding languages and tools

- Backend: TypeScript 5.5+ (strict), NestJS 11, Prisma 6, PostgreSQL 16,
  Redis (caching), Jest for testing
- POS frontend: TypeScript 5.5+, React 18, Tauri 2 (Rust for native bindings),
  SQLite/IndexedDB for offline storage, Vitest + Playwright for testing
- Backoffice: TypeScript 5.5+, React 18, Vite, TanStack Query, Recharts,
  Material-UI, Vitest + Playwright
- Shared: pnpm 11 workspaces, Zod 4, ESLint + Prettier
- Infrastructure: Docker, GitHub Actions, PostgreSQL, optional Kubernetes

## General coding rules

All code comments must be in English. Variable and function names must be
self-explanatory. Comments explain non-obvious behavior only, never restate
what the code already says. Docstrings and function descriptions in English,
as concise as possible.

All TypeScript code adheres to strict mode (`noImplicitAny`,
`strictNullChecks`, etc.) and follows the specific rules outlined in each
agent’s prompt file. Never mix naming conventions within a file; follow the
project conventions:

- Files/directories: kebab-case
- Classes/Interfaces/Types: PascalCase
- Functions/variables: camelCase
- Constants/enums: UPPER_SNAKE_CASE
- React components: PascalCase, file name matches component name

No hardcoded strings: use enums, constants, or configuration.
Validation exclusively with Zod (no class-validator).
ES modules only; no `require()`.

## What not to do

Never commit generated code (Prisma client, dist/, .next/). Never commit
environment files (.env) or secrets. Do not modify generated Prisma files
manually — use migrations and schema.prisma only. Never bypass
authentication/authorization guards. Do not introduce new technologies
without team agreement (e.g., replacing Zod with class-validator).

## Agent-specific instructions

Agent behavior is defined in `.opencode/*.md` files. Each agent enforces
additional constraints (e.g., max function length, offline-first patterns,
accessibility standards). When working in a specific domain, follow the
corresponding agent’s rules in addition to the general rules above.