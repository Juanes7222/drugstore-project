/**
 * Backoffice actor lookup — resolves cashier/user and workstation display
 * data by id. Sale and CashShift carry only the userId/workstationId
 * foreign-key columns (the current schema build declares no relation
 * fields between them), so consumers join in memory through this provider.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export interface ActorSummary {
  fullName: string;
  displayName: string | null;
}

export interface WorkstationSummary {
  name: string;
  code: string;
}

@Injectable()
export class BackofficeActorLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch-load user display data keyed by id; unknown ids are simply
   * absent from the map.
   */
  async loadUsersById(userIds: string[]): Promise<Map<string, ActorSummary>> {
    const uniqueIds = [...new Set(userIds)];
    const users = uniqueIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, fullName: true, displayName: true },
        })
      : [];
    return new Map(
      users.map((user) => [
        user.id,
        { fullName: user.fullName, displayName: user.displayName },
      ]),
    );
  }

  /**
   * Batch-load workstation display data keyed by id; unknown ids are
   * simply absent from the map.
   */
  async loadWorkstationsById(
    workstationIds: string[],
  ): Promise<Map<string, WorkstationSummary>> {
    const uniqueIds = [...new Set(workstationIds)];
    const workstations = uniqueIds.length
      ? await this.prisma.workstation.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    return new Map(
      workstations.map((workstation) => [
        workstation.id,
        { name: workstation.name, code: workstation.code },
      ]),
    );
  }
}
