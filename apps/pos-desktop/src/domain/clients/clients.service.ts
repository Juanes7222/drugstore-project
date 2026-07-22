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
import { createClientPullService } from './client-pull.service';
import { API_BASE_URL } from '../../infrastructure/config';
import { useLocalSessionStore } from '../auth/local-session.store';
import { DomainError } from '../../common/domain-error';

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
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input shape for both create and update operations.
 * All fields mirror the `Client` model; optional fields are nullable.
 */
export type UpdateClientInput = CreateClientInput;

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

  /**
   * Pull clients from the server into the local database.
   *
   * Uses the current session's access token for authentication.  Safe to
   * call when offline — returns early without throwing.
   *
   * @returns The number of clients now in the local database after the pull.
   */
  async pullFromServer(): Promise<number> {
    const session = useLocalSessionStore.getState().session;
    const accessToken = session?.accessToken;

    const pullService = createClientPullService(this.prisma, {
      baseUrl: API_BASE_URL,
      accessToken,
    });

    await pullService.pullClients();

    return this.prisma.client.count();
  }

  /**
   * Fetch a single client by ID.
   *
   * Requires CASHIER or ADMIN role.
   * Returns the raw database record or `null` when not found.
   */
  async getById(id: string): Promise<ClientSearchResult | null> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const client = await this.prisma.client.findUnique({ where: { id } });
    return (client as ClientSearchResult | null) ?? null;
  }

  /**
   * Update a client locally and enqueue a CLIENT_UPDATE sync operation.
   *
   * Requires CASHIER or ADMIN role.
   * Both the local update and the SyncQueue row are written inside a single
   * Prisma transaction so the change is never visible locally without a
   * corresponding queue entry for the server.
   *
   * @returns The updated client record.
   * @throws {AppError} when the client does not exist.
   */
  async update(id: string, input: UpdateClientInput): Promise<ClientSearchResult> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.client.findUnique({ where: { id } });
      if (!existing) {
        throw new DomainError('CLIENT_NOT_FOUND', `Client not found: ${id}`);
      }

      const client = await tx.client.update({
        where: { id },
        data: {
          fullName: input.fullName,
          identificationType: input.identificationType as any,
          identificationNumber: input.identificationNumber,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          municipality: input.municipality ?? null,
          department: input.department ?? null,
          updatedById: session.userId,
        },
      });

      await this.enqueueUpdateSync(tx, client, input, session);

      return client as unknown as ClientSearchResult;
    });
  }

  /**
   * Soft-delete (deactivate) a client locally and enqueue a
   * CLIENT_DEACTIVATE sync operation.
   *
   * Requires CASHIER or ADMIN role.
   * Sets `isActive` to `false` so the client no longer appears in searches
   * but the record is preserved for historical integrity.
   *
   * @returns The deactivated client record.
   * @throws {DomainError} when the client does not exist or is already inactive.
   */
  async deactivate(id: string): Promise<ClientSearchResult> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.client.findUnique({ where: { id } });
      if (!existing) {
        throw new DomainError('CLIENT_NOT_FOUND', `Client not found: ${id}`);
      }
      if (!existing.isActive) {
        throw new DomainError('CLIENT_ALREADY_INACTIVE', `Client is already inactive: ${id}`);
      }

      const client = await tx.client.update({
        where: { id },
        data: {
          isActive: false,
          updatedById: session.userId,
        },
      });

      await this.enqueueDeactivateSync(tx, client, session);

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

    await this.insertSyncQueueRow(tx, 'CLIENT_CREATION', payloadObj, session, createdAt);
  }

  /**
   * Build and insert a SyncQueue row for a client update.
   *
   * The payload mirrors the shape the server expects from
   * `CLIENT_UPDATE` operations.
   */
  private async enqueueUpdateSync(
    tx: Prisma.TransactionClient,
    client: { id: string },
    input: CreateClientInput,
    session: { userId: string; workstationId: string },
  ): Promise<void> {
    const createdAt = new Date();

    const payloadObj = {
      updateClientDto: {
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

    await this.insertSyncQueueRow(tx, 'CLIENT_UPDATE', payloadObj, session, createdAt);
  }

  /**
   * Build and insert a SyncQueue row for a client deactivation.
   *
   * The payload is minimal — the server only needs the client ID and
   * the user who performed the deactivation to replay the soft-delete.
   */
  private async enqueueDeactivateSync(
    tx: Prisma.TransactionClient,
    client: { id: string },
    session: { userId: string; workstationId: string },
  ): Promise<void> {
    const createdAt = new Date();

    const payloadObj = {
      deactivateClientDto: {
        clientId: client.id,
      },
      userId: session.userId,
      metadata: {
        localClientId: client.id,
        workstationId: session.workstationId,
        createdAt: createdAt.toISOString(),
      },
    };

    await this.insertSyncQueueRow(tx, 'CLIENT_DEACTIVATE', payloadObj, session, createdAt);
  }

  /**
   * Shared helper — insert a generic SyncQueue row inside a transaction.
   */
  private async insertSyncQueueRow(
    tx: Prisma.TransactionClient,
    operationType: string,
    payloadObj: Record<string, unknown>,
    session: { workstationId: string },
    createdAt: Date,
  ): Promise<void> {
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
        operationType: operationType as any,
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
