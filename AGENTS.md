# AGENTS.md

## Project overview

This is a large TypeScript monorepo managed with pnpm workspaces.

The repository contains a NestJS backend and a Tauri/React desktop POS
application, with shared packages and infrastructure tooling.

Prefer understanding the existing architecture and conventions before making
changes. Reuse existing abstractions and patterns instead of introducing
parallel implementations.

## Coding languages and tools

* Backend: TypeScript 6+ (strict), NestJS 11, Prisma 7, PostgreSQL 16,
  Redis, Jest
* POS frontend: TypeScript 6+, React 19, Tauri 2, Rust for native bindings,
  SQLite/IndexedDB for offline storage, Vitest, Playwright
* Shared: pnpm 11 workspaces, Zod 4, ESLint, Prettier
* Infrastructure: Docker, GitHub Actions, PostgreSQL, optional Kubernetes

## General coding rules

All TypeScript code must use strict mode, including `noImplicitAny`,
`strictNullChecks`, and the other strict compiler checks.

All code comments must be in English.

Comments must explain only non-obvious behavior. Do not add comments that
merely restate what the code already expresses.

Docstrings and function descriptions must be in concise English.

Prefer self-explanatory names over comments.

Follow Clean Code principles. Keep functions focused, minimize unnecessary
abstraction, and avoid duplication when an existing abstraction already solves
the problem.

Use the existing project architecture and conventions before introducing new
patterns.

Never mix naming conventions within a file.

Naming conventions:

* Files and directories: kebab-case
* Classes, interfaces, and types: PascalCase
* Functions and variables: camelCase
* Constants and enum members: UPPER_SNAKE_CASE
* React components: PascalCase
* React component filenames must match the component name

Use ES modules exclusively. Never use `require()`.

Validation must use Zod. Do not introduce `class-validator`.

Avoid hardcoded strings when the value represents a reusable domain concept,
configuration value, route, event name, permission, status, or other
cross-cutting value. Prefer existing enums, constants, schemas, or
configuration.

Do not create abstractions solely to satisfy stylistic preferences. An
abstraction must reduce duplication, isolate a meaningful boundary, or
represent a real domain concept.

## Repository exploration

This is a large monorepo. Minimize unnecessary source retrieval, context
usage, and repeated searches.

Before reading or searching large portions of the repository, determine the
smallest relevant scope.

Prefer structural and semantic navigation through graphify before performing
broad textual searches.

Do not perform repository-wide `rg`, `grep`, `find`, or equivalent searches as
the default exploration strategy.

First identify the relevant package, module, symbol, or dependency chain.
Then inspect only the files necessary to answer the question or implement the
change.

Use textual search primarily for exact textual matching rather than as the
default method for understanding code structure.

When graphify identifies the relevant code area, continue from that scoped
result instead of restarting exploration from the repository root.

## graphify

This repository uses `graphify` as the primary codebase navigation and
dependency-analysis tool.

The repository may be large enough that unrestricted source searches consume
significant context and increase exploration cost. Agents should therefore
prefer graphify's scoped graph results whenever the task involves understanding
code structure, symbols, modules, dependencies, or relationships.

Graphify is always available for codebase navigation. The `/graphify` command
explicitly requests the graphify workflow; it is not required merely to allow
graphify to be used.

### Mandatory graphify workflow

When `graphify-out/graph.json` exists, use graphify before broad codebase
searches.

For codebase questions, use the appropriate operation:

* `graphify query "<question>"` for semantic questions and locating relevant
  parts of the codebase
* `graphify explain "<concept>"` for a specific symbol, concept, module, or
  architectural area
* `graphify path "<A>" "<B>"` for relationships, dependencies, and paths
  between two symbols or concepts

Start with the smallest query capable of narrowing the problem.

Inspect the files and symbols returned by graphify directly. Do not scan the
entire repository when graphify has already identified the relevant scope.

### Exploration priority

Use this general priority order:

1. `graphify query`
2. `graphify explain`
3. `graphify path`
4. `graphify-out/wiki/index.md`
5. targeted source-file reads
6. targeted `rg` or `grep`
7. broad repository-wide searches only when necessary

The exact graphify operation should depend on the question. Do not use
`graphify path` merely because it appears later in the list if `query` or
`explain` is the appropriate operation.

### When textual search is appropriate

Graphify does not replace textual search.

Use targeted `rg`, `grep`, or equivalent tools when:

* an exact string or literal must be located;
* an error message must be found;
* a configuration key must be located;
* an environment variable must be located;
* a URL, route string, SQL fragment, or other literal must be verified;
* generated or non-code files are involved;
* graphify does not expose the required information;
* the task explicitly requires verifying every textual occurrence.

When textual search is required, constrain it to the smallest relevant
directory or set of files discovered through graphify whenever possible.

Do not search the entire repository merely because an exact search is easier.

### Graphify wiki and reports

If `graphify-out/wiki/index.md` exists, use it for broad architectural
navigation before opening large numbers of source files.

Read `graphify-out/GRAPH_REPORT.md` only when:

* performing broad architectural analysis;
* reviewing the overall graph structure;
* graphify queries do not provide sufficient context;
* the task explicitly concerns graph-wide structure.

Do not read the full graph report for a focused implementation task.

### Dirty graph output

Dirty `graphify-out/` files are expected during incremental development.

Do not skip graphify merely because graph output is dirty.

Skip graphify only when:

* the task specifically concerns stale, broken, or incorrect graph output; or
* the user explicitly instructs the agent not to use graphify.

If graphify appears inconsistent with the source tree, verify the relevant
source files and determine whether the graph is stale before relying on its
results.

### Keeping graphify current

After modifying source code, run:

`graphify update .`

This keeps `graphify-out/` synchronized with the current codebase.

The update is AST-only and does not require an API call.

Run the update after meaningful source changes rather than repeatedly after
every individual edit.

### `/graphify`

When the user explicitly types `/graphify`, use the installed graphify skill
or project graphify instructions before performing any other codebase
operation.

Follow the graphify skill's instructions as the authoritative procedure for
that command.

## Agent-specific instructions

Agent behavior is defined in `.opencode/*.md`.

When working in a specific domain, follow the corresponding agent's rules in
addition to this document.

Agent-specific instructions do not override project-wide security,
architecture, or correctness requirements unless explicitly stated by the
project configuration.

Before making domain-specific changes, identify the applicable agent
instructions when they are relevant to the task.

Examples of domain-specific constraints may include:

* backend architecture;
* database and Prisma rules;
* frontend and React patterns;
* Tauri/Rust integration;
* offline-first behavior;
* accessibility;
* testing;
* infrastructure;
* security.

## Architecture and existing code

Prefer modifying an existing implementation over creating a parallel one when
the existing implementation can reasonably support the requirement.

Before introducing a new service, utility, hook, repository, provider, or
shared abstraction, search the relevant graph scope for an existing
implementation.

Do not duplicate business logic across frontend, backend, or shared packages
when the project already has an appropriate shared abstraction.

Respect package boundaries in the pnpm workspace.

Do not introduce circular dependencies.

Keep domain logic in the appropriate domain/application layer rather than
leaking business rules into controllers, UI components, infrastructure, or
database-specific code.

Do not bypass established application boundaries merely because a direct
implementation is shorter.

## Backend rules

Backend code uses NestJS and Prisma.

Follow the existing NestJS module structure and dependency-injection patterns.

Keep controllers focused on transport concerns. Business logic belongs in the
appropriate service or domain layer.

Keep database access behind the established application/data-access boundary
when one exists.

Use Prisma according to the existing project conventions.

Do not manually modify generated Prisma client files.

Schema changes must be made through `schema.prisma` and Prisma migrations.

Do not modify an existing migration to repair an already-applied database
migration. Create a new migration when the database has already advanced.

Respect PostgreSQL semantics and existing transaction boundaries.

Use Redis only according to existing caching and invalidation patterns. Do not
introduce caching merely to avoid a database query without understanding
consistency requirements.

Authentication and authorization must remain enforced through the existing
guards, policies, permissions, and service-level checks.

Never trust identifiers supplied by the client as proof of authorization.

Authorization must be based on the authenticated principal and the
resource-level permissions applicable to that principal.

## Frontend rules

The POS frontend uses React, TypeScript, and Tauri.

Keep React components focused on presentation and interaction.

Do not place substantial business logic directly inside UI components when it
belongs in a service, hook, domain module, or shared abstraction.

Respect the application's offline-first architecture.

Do not assume network availability for functionality that is required to work
offline.

Do not introduce online-only behavior into an offline workflow without
explicitly handling synchronization and failure states.

For Tauri integrations, keep native functionality behind the established
Tauri command/interface boundaries.

Do not access native functionality directly from arbitrary React components
when an existing abstraction is available.

## Data validation

Use Zod for runtime validation.

Validate data at system boundaries, including external input, API payloads,
configuration, persisted data, and other untrusted sources where applicable.

Do not duplicate validation logic unnecessarily.

Reuse existing Zod schemas when the same domain contract already exists.

Do not replace Zod with `class-validator`.

## Error handling

Do not silently swallow errors.

Errors must preserve enough context to diagnose the failure without exposing
secrets or sensitive information.

Do not use generic catch-and-ignore patterns.

Follow the existing application's error types, exception filters, logging
conventions, and API error format.

Do not expose internal stack traces, database details, credentials, tokens, or
other sensitive implementation details to clients.

## Security

Never bypass authentication or authorization guards.

Never treat client-controlled identifiers as authorization credentials.

Validate all untrusted input.

Do not log passwords, tokens, API keys, secrets, credentials, or other
sensitive data.

Never commit secrets or credentials.

Do not weaken security controls merely to make tests or development easier.

If a security-sensitive change is necessary, preserve the existing security
boundary and verify both the authorized and unauthorized paths.

## Configuration and environment

Do not commit `.env` files, credentials, private keys, or other secrets.

Do not hardcode secrets or environment-specific credentials.

Use the existing configuration mechanism.

When adding a configuration value, update the appropriate example or
documentation file if the project convention requires it.

Do not silently introduce new environment variables when an existing
configuration value already represents the same concept.

## Database and generated files

Never commit generated artifacts unless the repository explicitly requires
them.

Do not commit:

* generated Prisma clients;
* `dist/`;
* `.next/`;
* temporary build output;
* local databases;
* environment files;
* secrets.

Never manually modify generated Prisma files.

For Prisma changes:

1. Modify `schema.prisma`.
2. Generate the appropriate migration.
3. Regenerate generated artifacts using the project's normal command.
4. Verify the resulting application behavior.

Follow the repository's existing Prisma migration workflow rather than
inventing a new one.

## Testing

Every behavior change should have appropriate test coverage.

Prefer the smallest relevant test suite during development.

Run targeted tests first, then broader validation when appropriate.

For backend changes, prefer the relevant Jest tests before running the entire
test suite.

For frontend changes, use the appropriate Vitest and/or Playwright tests.

Do not weaken or delete tests merely to make a change pass.

When fixing a bug, prefer adding a regression test that reproduces the
original failure.

## Formatting and linting

Follow the repository's ESLint and Prettier configuration.

Do not introduce formatting conventions that conflict with the existing
configuration.

Prefer running the relevant lint and formatting checks on changed packages
rather than unnecessarily processing the entire monorepo.

## Dependency management

Use pnpm for workspace dependency management.

Before adding a dependency, verify that an existing project dependency or
standard library capability cannot solve the problem.

Do not introduce a new dependency for trivial functionality.

Do not replace an existing dependency or framework without a concrete
technical reason.

Do not introduce new technologies without team agreement.

Examples include replacing Zod with `class-validator`, introducing another
ORM, replacing the existing test framework, or adding another state-management
framework without an architectural reason.

## What not to do

Never commit generated code such as Prisma client output, `dist/`, or
`.next/`.

Never commit environment files or secrets.

Never manually modify generated Prisma files.

Never bypass authentication or authorization guards.

Never use client-controlled identifiers as proof of authorization.

Never introduce `class-validator`.

Never use `require()`.

Never introduce new technologies without team agreement.

Never perform broad repository searches when a scoped graphify query or
targeted search can answer the question.

Never read large numbers of unrelated files merely to gain context.

Never rewrite working architecture solely for stylistic preference.

Never make unrelated refactors while implementing a focused change.

## Change discipline

Keep changes narrowly scoped to the user's request.

Before modifying a file, understand its role and the relevant dependencies.

Prefer the smallest change that correctly solves the problem.

Do not mix unrelated refactors, formatting changes, dependency upgrades, or
architectural changes into a focused task.

Preserve existing behavior unless the task explicitly requires changing it.

When changing behavior that affects multiple packages, trace the dependency
chain before editing and verify affected consumers afterward.

## Validation workflow

After implementing a change:

1. Review the modified files and the resulting diff.
2. Run the most relevant targeted tests.
3. Run linting or type checking relevant to the changed packages.
4. Run broader validation when the change crosses package or architectural
   boundaries.
5. Run `graphify update .` after meaningful source changes.
6. Re-check the graph when the change affects dependencies, module boundaries,
   or architecture.

Do not claim that tests, builds, migrations, or other validation passed unless
they were actually executed.

If validation cannot be executed, state what was not verified.

## Final response

When reporting completed work, summarize:

* what changed;
* which relevant tests or checks were run;
* any validation that could not be performed;
* any remaining concerns or follow-up work.

Do not claim behavior that was not verified.

Keep the final response concise and focused on the actual change.
