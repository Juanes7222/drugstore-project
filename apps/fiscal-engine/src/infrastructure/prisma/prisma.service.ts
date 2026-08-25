import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@pharmacy/database';
import { PrismaPg } from '@prisma/adapter-pg';

// Worker process: BullMQ job concurrency determines how many connections are
// held at once. The pg default (max 10) is generous for a worker; keep it
// explicit so deployments can tune it without code changes.
const DEFAULT_DB_POOL_MAX = 10;

function resolveDbPoolMax(): number {
  const raw = Number(process.env.DB_POOL_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DB_POOL_MAX;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: resolveDbPoolMax(),
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
