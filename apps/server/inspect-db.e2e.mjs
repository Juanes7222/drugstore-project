import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@pharmacy/database";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.POS_E2E_OWNER_DATABASE_URL ??
      "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db",
  }),
});

const schemes = await prisma.taxScheme.findMany({
  select: { id: true, code: true, name: true, subscriptionId: true, isActive: true },
});
console.log("taxSchemes:", JSON.stringify(schemes, null, 2));

const users = await prisma.user.findMany({
  select: { id: true, email: true, identifier: true, subscriptionId: true, role: true, status: true, isActive: true },
});
console.log("users:", JSON.stringify(users, null, 2));

await prisma.$disconnect();
