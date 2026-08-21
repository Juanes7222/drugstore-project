import {
  BadRequestException,
  Controller,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { FiscalProvider } from '@pharmacy/shared-types';
import { FiscalWebhookService } from '../services/fiscal-webhook.service';

const WEBHOOK_PROVIDERS: readonly FiscalProvider[] = [
  FiscalProvider.ALANUBE,
  FiscalProvider.DATAICO,
];

/**
 * Public inbound endpoint for fiscal-provider webhooks. No JWT guard —
 * authenticity comes from the provider's signature over the raw body,
 * verified against the per-subscription webhook secret. The subscription
 * id is part of the URL so the provider does not need to know a tenant
 * secret; a forged id still fails signature verification.
 */
@Controller('fiscal-dian/webhooks')
export class FiscalWebhooksController {
  constructor(private readonly service: FiscalWebhookService) {}

  @Post(':subscriptionId/:provider')
  async handle(
    @Param('subscriptionId') subscriptionId: string,
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ): Promise<{ accepted: boolean; eventId: string | null }> {
    if (!WEBHOOK_PROVIDERS.includes(provider as FiscalProvider)) {
      throw new BadRequestException(
        `Unsupported webhook provider "${provider}"`,
      );
    }

    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}), 'utf-8');
    const payload = (req.body ?? {}) as Record<string, unknown>;

    const result = await this.service.ingest({
      subscriptionId,
      provider: provider as FiscalProvider,
      rawBody,
      headers,
      payload,
    });

    if (!result.accepted) {
      throw new BadRequestException(
        result.reason ?? 'Webhook was rejected by the intake pipeline',
      );
    }

    return { accepted: true, eventId: result.eventId };
  }
}
