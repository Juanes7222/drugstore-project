import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.POS_E2E_OWNER_DATABASE_URL ??
        "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db",
    },
  },
});

const schemes = await prisma.taxScheme.findMany({
  select: { id: true, code: true, name: true, subscriptionId: true, isActive: true },
});
console.log("taxSchemes:", JSON.stringify(schemes, null, 2));

const subs = await prisma.subscription.findMany({ select: { id: true, status: true } });
console.log("subscriptions:", JSON.stringify(subs, null, 2));

await prisma.$disconnect();
