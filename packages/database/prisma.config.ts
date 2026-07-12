import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Point to the directory so Prisma 7 recursively discovers all *.prisma
  // files inside (schema.prisma at the root + models/*.prisma).
  // Override with --schema=<path> when generating a different target.
  schema: "./prisma/schema",
  migrations: {
    path: "./prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/pharmacy",
  },
});
