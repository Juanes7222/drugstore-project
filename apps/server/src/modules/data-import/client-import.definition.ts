import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ClientsService } from '@/modules/clients/clients.service';
import {
  CreateClientSchema,
  CreateClientDto,
} from '@/modules/clients/dto/create-client.dto';
import {
  CLIENT_IMPORT_COLUMNS,
  ClientImportRow,
  ClientImportRowSchema,
  ImportIssue,
} from '@pharmacy/shared-validation';
import { IdentificationType } from '@pharmacy/database';
import { SystemModule } from '@pharmacy/shared-types';
import {
  ImportDefinition,
  ImportExecutionContext,
  ImportRowWithNumber,
  buildAliasMap,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from './import-definition';

/**
 * Client import definition. Rows are written through ClientsService, which
 * owns the identification uniqueness rules and Habeas Data consent flow.
 */
@Injectable()
export class ClientImportDefinition implements ImportDefinition<
  ClientImportRow,
  { id: string }
> {
  readonly entityKey = 'clients';
  readonly entityLabel = 'Clients';
  readonly auditModule = SystemModule.CLIENTS;
  readonly columns = CLIENT_IMPORT_COLUMNS;
  private readonly aliasMap = buildAliasMap(CLIENT_IMPORT_COLUMNS);

  constructor(
    private prisma: PrismaService,
    private readonly clientsService: ClientsService,
  ) {}

  mapColumns(record: Record<string, unknown>): {
    data: Record<string, unknown>;
    issues: ImportIssue[];
  } {
    const data: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(record)) {
      const key = this.aliasMap.get(normalizeHeader(header));
      if (!key) continue;
      data[key] = normalizeCellValue(value);
    }
    return { data, issues: [] };
  }

  validate(
    data: Record<string, unknown>,
  ): { data: ClientImportRow } | { issues: ImportIssue[] } {
    const result = ClientImportRowSchema.safeParse(data);
    if (!result.success)
      return { issues: zodIssuesToImportIssues(result.error) };
    return { data: result.data };
  }

  async createOne(
    ctx: ImportExecutionContext,
    input: ClientImportRow,
  ): Promise<{ id: string }> {
    const dto: CreateClientDto = CreateClientSchema.parse({
      fullName: input.fullName,
      identificationType: input.identificationType,
      identificationNumber: input.identificationNumber,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      municipality: input.municipality ?? null,
      department: input.department ?? null,
      creditLimit: input.creditLimit ?? null,
    });
    const created = await this.clientsService.create(dto, ctx.userId);
    return { id: created.id };
  }

  async findConflicts(
    ctx: { subscriptionId: string },
    rows: Array<ImportRowWithNumber<ClientImportRow>>,
  ): Promise<Map<number, ImportIssue[]>> {
    const rowByKey = new Map<string, number>();
    for (const row of rows) {
      rowByKey.set(
        `${row.data.identificationType}:${row.data.identificationNumber}`,
        row.rowNumber,
      );
    }

    const existing = await this.prisma.client.findMany({
      where: {
        subscriptionId: ctx.subscriptionId,
        OR: [...rowByKey.keys()].map((key) => {
          const [identificationType, identificationNumber] = key.split(':');
          return {
            identificationType: identificationType as IdentificationType,
            identificationNumber,
          };
        }),
      },
      select: { identificationType: true, identificationNumber: true },
    });

    const conflicts = new Map<number, ImportIssue[]>();
    for (const client of existing) {
      const rowNumber = rowByKey.get(
        `${client.identificationType}:${client.identificationNumber}`,
      );
      if (rowNumber !== undefined) {
        conflicts.set(rowNumber, [
          {
            path: 'identificationNumber',
            message: `El documento ${client.identificationType} ${client.identificationNumber} ya existe en el sistema`,
          },
        ]);
      }
    }
    return conflicts;
  }
}
