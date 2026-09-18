// Single source of truth for the e2e database connection string, shared by
// test/set-env.ts (handed to each test worker) and test/global-setup.cjs
// (used to provision the schema before the suite runs).
// Must match the postgres-test service in docker-compose.test.yml.
const TEST_DATABASE_URL =
  'postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db';

module.exports = { TEST_DATABASE_URL };
