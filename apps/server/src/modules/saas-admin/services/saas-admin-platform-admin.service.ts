/**
 * SaaS-admin platform-admin visibility — read-only listing of users carrying
 * the isPlatformAdmin flag. There is deliberately NO write endpoint here: the
 * flag stays script-granted (packages/database's set-platform-admin script)
 * by design, so grant/revoke remains an auditable, out-of-band operator
 * action rather than a surface another SAAS_ADMIN could call.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/** One row of GET /saas-admin/platform-admins. */
export interface SaasAdminPlatformAdminRow {
  userId: string;
  email: string | null;
  username: string | null;
  fullName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

@Injectable()
export class SaasAdminPlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every platform admin, sorted by email ascending (NULL emails last,
   * Postgres ASC default). No tenant data is joined — this is a directory
   * of operators only, so unlike per-customer reads it writes no ACCESS
   * audit row.
   */
  async getPlatformAdmins(): Promise<SaasAdminPlatformAdminRow[]> {
    const admins = await this.prisma.user.findMany({
      where: { isPlatformAdmin: true },
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    return admins.map((admin) => ({
      userId: admin.id,
      email: admin.email,
      username: admin.username,
      fullName: admin.fullName,
      role: admin.role,
      status: admin.status,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
    }));
  }
}
