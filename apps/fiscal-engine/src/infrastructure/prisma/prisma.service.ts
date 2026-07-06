import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

/**
 * Duplicated from apps/server/src/infrastructure/prisma/prisma.service.ts
 * for isolation; promoted to a shared package if cross-app reuse grows.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prismaClient: any;

  constructor() {
    this.prismaClient = null;
  }

  private getClient(): any {
    if (!this.prismaClient) {
      const { PrismaClient } = require('@prisma/client');
      this.prismaClient = new PrismaClient();
    }
    return this.prismaClient;
  }

  get fiscalDocument(): any {
    return this.getClient().fiscalDocument;
  }

  get sale(): any {
    return this.getClient().sale;
  }

  get saleItem(): any {
    return this.getClient().saleItem;
  }

  get client(): any {
    return this.getClient().client;
  }

  get fiscalIssuerConfig(): any {
    return this.getClient().fiscalIssuerConfig;
  }

  get fiscalResolution(): any {
    return this.getClient().fiscalResolution;
  }

  async onModuleInit(): Promise<void> {
    await this.getClient().$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.getClient().$disconnect();
  }
}
