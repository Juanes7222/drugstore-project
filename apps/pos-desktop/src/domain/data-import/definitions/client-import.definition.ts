/**
 * Client import definition — reuses the shared CLIENT_IMPORT_COLUMNS and
 * ClientImportRowSchema from @pharmacy/shared-validation and writes rows
 * through the local ClientsService, which owns the identification
 * uniqueness rules and the CLIENT_CREATION sync entry.
 */

import type { PrismaClient } from "@pharmacy/database/local";
import {
  CLIENT_IMPORT_COLUMNS,
  ClientImportRowSchema,
  type ClientImportRow,
  type ImportIssue,
} from "@pharmacy/shared-validation";
import type { ClientsService } from "../../clients/clients.service";
import {
  buildAliasMap,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from "../import-common";
import type { ImportRowWithNumber } from "./import-definition";
import type { ImportDefinition } from "./import-definition";

function clientIdentityKey(
  identificationType: string,
  identificationNumber: string,
): string {
  return `${identificationType}:${identificationNumber}`;
}

/**
 * Client import definition. Rows are written through ClientsService, which
 * owns the identification uniqueness rules and Habeas Data consent flow.
 */
export class ClientImportDefinition implements ImportDefinition<
  ClientImportRow,
  { id: string }
> {
  readonly entityKey = "clients" as const;
  readonly entityLabel = "Clients";
  readonly columns = CLIENT_IMPORT_COLUMNS;
  private readonly aliasMap = buildAliasMap(CLIENT_IMPORT_COLUMNS);

  constructor(
    private readonly prisma: PrismaClient,
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

  async createOne(input: ClientImportRow): Promise<{ id: string }> {
    const created = await this.clientsService.create({
      fullName: input.fullName,
      identificationType: input.identificationType,
      identificationNumber: input.identificationNumber,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      municipality: input.municipality ?? null,
      department: input.department ?? null,
      // Explicit null (not undefined): an omitted credit limit disables
      // credit for the imported client, matching the server import flow
      // instead of falling back to the tenant default.
      creditLimit: input.creditLimit ?? null,
    });
    return { id: created.id };
  }

  async findConflicts(
    rows: Array<ImportRowWithNumber<ClientImportRow>>,
  ): Promise<Map<number, ImportIssue[]>> {
    const conflicts = new Map<number, ImportIssue[]>();
    const firstRowByIdentity = new Map<string, number>();

    // Duplicates inside the file itself: the first occurrence wins, later
    // rows are flagged so the operator can decide before executing.
    for (const row of rows) {
      const key = clientIdentityKey(
        row.data.identificationType,
        row.data.identificationNumber,
      );
      const existingRow = firstRowByIdentity.get(key);
      if (existingRow !== undefined) {
        conflicts.set(row.rowNumber, [
          {
            path: "identificationNumber",
            message: `El documento ${row.data.identificationType} ${row.data.identificationNumber} se repite en el archivo (fila ${existingRow})`,
          },
        ]);
      } else {
        firstRowByIdentity.set(key, row.rowNumber);
      }
    }

    // Conflicts against existing local clients.
    const existing = await this.prisma.client.findMany({
      where: {
        OR: [...firstRowByIdentity.keys()].map((key) => {
          const [identificationType, identificationNumber] = key.split(":");
          return {
            identificationType: identificationType as never,
            identificationNumber,
          };
        }),
      },
      select: { identificationType: true, identificationNumber: true },
    });
    for (const client of existing) {
      const key = clientIdentityKey(
        client.identificationType as string,
        client.identificationNumber,
      );
      const rowNumber = firstRowByIdentity.get(key);
      if (rowNumber !== undefined) {
        conflicts.set(rowNumber, [
          {
            path: "identificationNumber",
            message: `El documento ${client.identificationType} ${client.identificationNumber} ya existe en el sistema`,
          },
        ]);
      }
    }

    return conflicts;
  }
}
