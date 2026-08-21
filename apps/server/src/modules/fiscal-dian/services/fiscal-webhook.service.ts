import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { FiscalProvider } from '@pharmacy/shared-types';
import { TECH_PROVIDER_CONFIG_ID } from '../constants/fiscal-singleton-ids';
import { WebhookSignatureVerifier } from './webhook-signature.verifier';
import { WebhookEventNormalizer } from './webhook-event.normalizer';
import { EnvSecretResolver } from './env-secret.resolver';

export interface WebhookIngestResult {
  accepted: boolean;
  eventId: string | null;
  reason?: string;
}

/**
 * Intake pipeline for fiscal-provider webhooks:
 * 1. resolves the tenant from the URL (the HMAC secret is per-subscription,
 *    so a forged subscriptionId still fails signature verification)
 * 2. verifies the provider signature over the raw body
 * 3. persists the raw payload as an immutable FiscalWebhookEvent
 * 4. correlates the event to a FiscalDocument via (providerType, providerTrackId)
 * 5. enqueues a webhook-event job for apps/fiscal-engine, which owns the
 *    document state machine
 *
 * The endpoint answers fast (202/400); all real work happens in the engine.
 */
@Injectable()
export class FiscalWebhookService {
  private readonly logger = new Logger(FiscalWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly verifier: WebhookSignatureVerifier,
    private readonly normalizer: WebhookEventNormalizer,
    private readonly secrets: EnvSecretResolver,
    @InjectQueue('fiscal-webhook-events') private readonly queue: Queue,
  ) {}

  async ingest(params: {
    subscriptionId: string;
    provider: FiscalProvider;
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
    payload: Record<string, unknown>;
  }): Promise<WebhookIngestResult> {
    const { subscriptionId, provider, rawBody, headers, payload } = params;

    const config = await this.prisma.withTenant(subscriptionId, async (tx) =>
      tx.techProviderConfig.findUnique({
        where: { id: TECH_PROVIDER_CONFIG_ID },
        select: {
          subscriptionId: true,
          webhookSecretReference: true,
          providerType: true,
        },
      }),
    );

    if (!config || config.providerType !== provider) {
      return {
        accepted: false,
        eventId: null,
        reason: `No ${provider} provider configuration for this subscription`,
      };
    }
    if (!config.webhookSecretReference) {
      return {
        accepted: false,
        eventId: null,
        reason: 'Webhook secret is not configured for this subscription',
      };
    }

    let webhookSecret: string;
    try {
      webhookSecret = this.secrets.resolve(config.webhookSecretReference);
    } catch (error) {
      this.logger.error(
        `Cannot resolve webhook secret for ${subscriptionId}: ${(error as Error).message}`,
      );
      return {
        accepted: false,
        eventId: null,
        reason: 'Webhook secret unavailable',
      };
    }

    const signatureValid = this.verifier.verify({
      provider,
      rawBody,
      headers,
      webhookSecret,
    });

    const eventId = randomUUID();
    let fiscalDocumentId: string | null = null;

    await this.prisma.withTenant(subscriptionId, async (tx) => {
      const normalized = this.normalizer.normalize(provider, payload);

      if (normalized?.providerTrackId) {
        const doc = await tx.fiscalDocument.findFirst({
          where: {
            subscriptionId,
            providerType: provider,
            providerTrackId: normalized.providerTrackId,
          },
          select: { id: true },
        });
        fiscalDocumentId = doc?.id ?? null;
      }

      try {
        await tx.fiscalWebhookEvent.create({
          data: {
            id: eventId,
            subscriptionId,
            provider,
            providerEventId: normalized?.providerEventId ?? null,
            eventType: normalized?.eventType ?? null,
            fiscalDocumentId,
            rawPayload: payload as object,
            signatureValid,
            outcome: normalized?.outcome ?? null,
            cufe: normalized?.cufe ?? null,
            signedXml: normalized?.signedXml ?? null,
            responseCode: normalized?.responseCode ?? null,
            responseMessage: normalized?.responseMessage ?? null,
            status: signatureValid
              ? normalized
                ? 'RECEIVED'
                : 'FAILED'
              : 'REJECTED',
          },
        });
      } catch (error) {
        // P2002 duplicate (provider, providerEventId) — the provider retried
        // an event we already ingested. Idempotent success.
        if ((error as { code?: string }).code === 'P2002') {
          this.logger.log(
            `Duplicate webhook event ignored (${provider} ${normalized?.providerEventId ?? 'no-id'})`,
          );
          return;
        }
        throw error;
      }

      if (signatureValid && normalized && fiscalDocumentId) {
        this.tenantContext.registerAfterCommit(async () => {
          await this.queue.add('webhook-event', { eventId });
        });
      }
    });

    if (!signatureValid) {
      return {
        accepted: false,
        eventId,
        reason: 'Webhook signature verification failed',
      };
    }
    if (!fiscalDocumentId) {
      return {
        accepted: true,
        eventId,
        reason: 'Event recorded but no matching fiscal document found',
      };
    }

    return { accepted: true, eventId };
  }
}
