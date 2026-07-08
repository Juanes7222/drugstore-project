/**
 * Local client management service for the POS desktop app.
 *
 * Provides search and offline-first creation of clients directly in the
 * local PGlite database.  New clients are recorded as SyncQueue entries
 * (operationType: CLIENT_CREATION) so the server can replay the creation
 * once connectivity is restored.
 *
 * ## Architecture notes
 *
 * ### Offline-first creation
 * Clients are created locally first, then synced to the server.  The local
 * create and the SyncQueue insert happen inside the same Prisma transaction
 * so that a locally visible client is never created without a corresponding
 * sync entry.
 *
 * ### Search
 * Search queries the local `Client` table by document number or partial
 * name match (case-insensitive).  The local cache is kept current by
 * `ClientPullService` running as part of the periodic sync cycle.
 */
import { PrismaClient, Prisma } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface CreateClientInput {
  fullName: string;
  identificationType: string;
  identificationNumber: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  municipality?: string | null;
  department?: string | null;
}

export interface ClientSearchResult {
  id: string;
  fullName: string;
  identificationType: string;
  identificationNumber: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  municipality: string | null;
  department: string | null;
  classificationId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createClientsService = (
  prisma: PrismaClient,
  auth: AuthService,
): ClientsService => {
  return new ClientsService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ClientsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Search clients by document number or partial name match.
   *
   * Requires CASHIER or ADMIN role.
   * Returns results directly from the local database — no network call.
   *
   * @param query  Search term.  When the term is a non-empty string the
   *               method searches `identificationNumber` (prefix match) and
   *               `fullName` (case-insensitive contains).  Empty or absent
   *               queries return recently-updated clients (limit 50).
   */
  async search(query?: string): Promise<ClientSearchResult[]> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    if (!query || query.trim().length === 0) {
      const clients = await this.prisma.client.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      return clients as unknown as ClientSearchResult[];
    }

    const trimmed = query.trim();
    const isDocNumber = /^\d+$/.test(trimmed);

    const where: Prisma.ClientWhereInput = isDocNumber
      ? { identificationNumber: { startsWith: trimmed } }
      : { fullName: { contains: trimmed, mode: 'insensitive' } };

    const clients = await this.prisma.client.findMany({
      where: { ...where, isActive: true },
      orderBy: { fullName: 'asc' },
      take: 50,
    });

    return clients as unknown as ClientSearchResult[];
  }

  /**
   * Create a client locally and enqueue a CLIENT_CREATION sync operation.
   *
   * Requires CASHIER or ADMIN role.
   *
   * Both the local insert and the SyncQueue row are written inside a single
   * Prisma transaction so that the client is never visible locally without
   * a corresponding queue entry that the server will process.
   *
   * @returns The newly created client record.
   */
  async create(input: CreateClientInput): Promise<ClientSearchResult> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);
    const clientId = globalThis.crypto.randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          id: clientId,
          fullName: input.fullName,
          identificationType: input.identificationType as any,
          identificationNumber: input.identificationNumber,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          municipality: input.municipality ?? null,
          department: input.department ?? null,
          isActive: true,
          createdById: session.userId,
          dataSubjectRequestStatus: 'NONE',
        },
      });

      await this.createSyncQueueEntry(tx, client, input, session);

      return client as unknown as ClientSearchResult;
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build and insert a SyncQueue row for a newly created client.
   *
   * The payload contains the full `createClientDto` that the server-side
   * `sync-operation-dispatcher` needs to replay the creation, plus the
   * client UUID in `metadata.localClientId` so the server preserves the
   * same ID and can resolve relational integrity for future sync operations.
   */
  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    client: { id: string },
    input: CreateClientInput,
    session: { userId: string; workstationId: string },
  ): Promise<void> {
    const createdAt = new Date();

    const payloadObj = {
      createClientDto: {
        fullName: input.fullName,
        identificationType: input.identificationType as string,
        identificationNumber: input.identificationNumber,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        municipality: input.municipality ?? null,
        department: input.department ?? null,
      },
      userId: session.userId,
      metadata: {
        localClientId: client.id,
        workstationId: session.workstationId,
        createdAt: createdAt.toISOString(),
      },
    };

    const payload = JSON.stringify(payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadSize = payloadBytes.length;
    const payloadHash = await this.computePayloadHash(payload);
    const operationUuid = globalThis.crypto.randomUUID();

    // Get the next sequential clientSequence per workstation
    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType: 'CLIENT_CREATION',
        payload,
        payloadHash,
        payloadSize,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt: createdAt,
        clientSequence,
      },
    });
  }

  /**
   * Compute a SHA-256 hex digest of a string payload.
   *
   * Uses the Web Crypto API (SubtleCrypto), matching the server's
   * `computePayloadHash` in `sync.service.ts`.
   */
  private async computePayloadHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
