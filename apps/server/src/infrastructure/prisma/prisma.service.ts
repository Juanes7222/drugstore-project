import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private client: any;

  constructor() {
    // Lazy-load PrismaClient to avoid import errors during type checking
    this.client = null;
  }

  private getClient(): any {
    if (!this.client) {
      // Dynamic import to avoid circular dependency issues
      const { PrismaClient } = require('@prisma/client');
      this.client = new PrismaClient();
    }
    return this.client;
  }

  get user(): any {
    return this.getClient().user;
  }

  get userSession(): any {
    return this.getClient().userSession;
  }

  get auditLog(): any {
    return this.getClient().auditLog;
  }

  async onModuleInit(): Promise<void> {
    await this.getClient().$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.getClient().$disconnect();
  }
}
