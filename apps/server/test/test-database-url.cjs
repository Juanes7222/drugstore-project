// Single source of truth for the e2e database connection strings, shared by
// test/set-env.ts (handed to each test worker) and test/global-setup.cjs
// (used to provision the schema before the suite runs).
// Must match the postgres-test service in docker-compose.test.yml.
//
// Two URLs on purpose. TEST_DATABASE_URL is the container superuser: specs and
// global-setup seed fixtures and apply migrations with it, which needs BYPASSRLS
// because a fixture write has no tenant behind it. TEST_APP_DATABASE_URL is the
// role the NestJS server connects as in production, and it is what the app under
// test gets, so every e2e request exercises row level security exactly as
// production does. The suite used to hand the app the superuser URL, which meant
// no other spec could observe a missing policy or a query that forgot the tenant.
const TEST_DATABASE_URL =
  'postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db';
const TEST_APP_DATABASE_URL =
  'postgresql://pharmacy_app:pharmacy_app@localhost:5433/pharmacy_test_db';

module.exports = { TEST_DATABASE_URL, TEST_APP_DATABASE_URL };
