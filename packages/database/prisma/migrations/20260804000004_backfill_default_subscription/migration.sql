-- Backfill pre-tenant rows into the default subscription. Data written before
-- the tenant migration carries no tenant value: the column was introduced with
-- a '' default in some branches, NULL in others, so both must be normalized.
-- Every table carrying the column gets the value — not only RLS-protected ones:
-- login reads "User" (no RLS) and the tenant id flows from there into the
-- request context, so unstamped rows would break the whole chain.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '_prisma%'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = pg_tables.tablename
          AND c.column_name = 'subscriptionId'
      )
  LOOP
    EXECUTE format(
      'UPDATE %I SET "subscriptionId" = %L WHERE "subscriptionId" IS NULL OR "subscriptionId" = %L',
      t,
      'sub_default',
      ''
    );
  END LOOP;
END $$;