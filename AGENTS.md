
## Coding languages and tools

- Backend: TypeScript 6+ (strict), NestJS 11, Prisma 7, PostgreSQL 16,
  Redis (caching), Jest for testing
- POS frontend: TypeScript 6+, React 19, Tauri 2 (Rust for native bindings),
  SQLite/IndexedDB for offline storage, Vitest + Playwright for testing
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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
