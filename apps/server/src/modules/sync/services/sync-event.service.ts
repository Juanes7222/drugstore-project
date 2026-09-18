/**
 * SyncEvent service — manages critical-event routing from server to hub/POS.
 *
 * Events are created server-side when something changes that requires
 * immediate action on the POS (product deactivation, price change, config
 * push). Workstations poll GET /sync/events/pending for unacknowledged
 * events and POST /sync/events/:id/acknowledge after applying them.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { DomainException } from '@/common/exceptions/domain.exception';

export type SyncEventType =
  | 'PRODUCT_DEACTIVATED'
  | 'PRODUCT_REACTIVATED'
  | 'PRICE_UPDATE'
  | 'CONFIG_CHANGE'
  | 'FORCED_SYNC'
  | 'INVOICE_RESULT_READY'
  | 'BACKOFFICE_ACTION';

export type SyncEventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface CreateSyncEventInput {
  eventType: SyncEventType;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  severity?: SyncEventSeverity;
  sourceWorkstationId?: string | null;
  ttlMinutes?: number;
}

export interface PendingEventResult {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | null;
  severity: string;
  createdAt: Date;
}

@Injectable()
export class SyncEventService {
  private readonly logger = new Logger(SyncEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Create a new SyncEvent for one or all workstations.
   *
   * When `sourceWorkstationId` is null the event is broadcast to every
   * workstation. When set only that workstation sees it.
   *
   * Events auto-expire after `ttlMinutes` (default 60) to prevent stale
   * notifications from accumulating.
   */
  async createEvent(input: CreateSyncEventInput): Promise<{ id: string }> {
    const { eventType, entityType, entityId, payload, severity, sourceWorkstationId, ttlMinutes } = input;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlMinutes ?? 60) * 60 * 1000);

    const event = await this.prisma.syncEvent.create({
      data: {
        subscriptionId: this.tenantContext.getSubscriptionId(),
        eventType,
        entityType,
        entityId,
        payload: (payload as any) ?? undefined,
        severity: severity ?? 'INFO',
        sourceWorkstationId: sourceWorkstationId ?? undefined,
        expiresAt,
      },
      select: { id: true },
    });

    this.logger.log(`SyncEvent created: ${eventType} on ${entityType}:${entityId} (${event.id})`);
    return { id: event.id };
  }

  /**
   * Returns non-expired events this workstation has not acknowledged yet.
   *
   * Includes both broadcast events (sourceWorkstationId = null) and
   * workstation-specific events. Ordered by createdAt ascending so the
   * POS processes oldest events first.
   *
   * Acknowledgement is per workstation: a broadcast event another terminal
   * already applied is still returned here, which is what makes a critical
   * event reach every machine in the branch.
   */
  async getPendingEvents(workstationId: string): Promise<PendingEventResult[]> {
    const now = new Date();
    const events = await this.prisma.syncEvent.findMany({
      where: {
        expiresAt: { gte: now },
        OR: [
          { sourceWorkstationId: null },
          { sourceWorkstationId: workstationId },
        ],
        acknowledgments: { none: { workstationId } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        eventType: true,
        entityType: true,
        entityId: true,
        payload: true,
        severity: true,
        createdAt: true,
      },
    });

    return events.map((e) => ({
      ...e,
      payload: e.payload as Record<string, unknown> | null,
    }));
  }

  /**
   * Records that `workstationId` applied an event.
   *
   * Idempotent per workstation: the unique (eventId, workstationId) pair turns
   * a repeated acknowledgement into a no-op, and it never affects the other
   * workstations' view of the same event.
   */
  async acknowledgeEvent(
    eventId: string,
    workstationId: string,
    acknowledgedById: string,
  ): Promise<void> {
    const existing = await this.prisma.syncEvent.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!existing) {
      throw new DomainException(
        'SYNC_EVENT_NOT_FOUND',
        `SyncEvent ${eventId} not found`,
      );
    }

    await this.prisma.syncEventAcknowledgment.upsert({
      where: { eventId_workstationId: { eventId, workstationId } },
      create: {
        subscriptionId: this.tenantContext.getSubscriptionId(),
        eventId,
        workstationId,
        acknowledgedById,
      },
      // A second acknowledgement must not move the original timestamp.
      update: {},
    });

    this.logger.log(
      `SyncEvent ${eventId} acknowledged by ${acknowledgedById} on ${workstationId}`,
    );
  }

  /**
   * Counts non-expired events that NO workstation has acknowledged yet.
   *
   * A non-zero count means a critical event has not been picked up by any
   * terminal — the signal an operator needs, since every workstation keeps its
   * own acknowledgement state.
   */
  async countPending(): Promise<number> {
    return this.prisma.syncEvent.count({
      where: {
        expiresAt: { gte: new Date() },
        acknowledgments: { none: {} },
      },
    });
  }

  /**
   * Delete expired events (housekeeping).
   */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.syncEvent.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Deleted ${result.count} expired SyncEvent(s)`);
    }
    return result.count;
  }
}
