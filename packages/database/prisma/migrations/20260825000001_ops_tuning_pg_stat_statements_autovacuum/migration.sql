-- Operational tuning for query monitoring and high-churn tables.
--
-- pg_stat_statements requires shared_preload_libraries=pg_stat_statements,
-- which docker-compose.dev.yml / docker-compose.prod.yml now pass to the
-- postgres container. The extension creation here is idempotent and simply
-- no-ops (with a notice) if the library is not preloaded yet.
--
-- Autovacuum reloptions target tables whose rows churn constantly:
--   SyncQueue: status flips PENDING -> COMPLETED/FAILED on every replayed
--     operation, leaving dead tuples spread across the whole table.
--   Lot: version/currentStock update on every stock movement.
-- Defaults (scale factor 0.2) delay vacuum until 20% of the table is dead,
-- which on these tables means constant bloat; per-table overrides trigger
-- vacuum far earlier. Prisma does not manage reloptions, so `migrate dev`
-- diffs will not drop them.
--
-- Like every raw-SQL migration in this repo, apply as the table-owning role
-- and keep statements idempotent.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

ALTER TABLE "SyncQueue" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE "Lot" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
