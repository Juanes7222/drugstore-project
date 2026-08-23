import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Which transmission party a subscription's documents go through:
 *   PROVIDER    — our system transmits (server-side tech-provider
 *                 credentials, referenced by TechProviderConfig.credentialReference).
 *   DIAN_DIRECT — the tenant's own DIAN certificate is used (the
 *                 FiscalCertificate uploaded in the POS).
 */
export type TransmissionRoute = 'PROVIDER' | 'DIAN_DIRECT';

/**
 * Derives the transmission route from the subscription's plan billingMethod.
 * CERTIFICATE plans and any subscription without a resolvable plan (legacy
 * or missing rows) fall back to DIAN_DIRECT — the historical behavior.
 */
@Injectable()
export class TransmissionRouteResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(subscriptionId: string): Promise<TransmissionRoute> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { plan: { select: { billingMethod: true } } },
    });
    return subscription?.plan?.billingMethod === 'PROVIDER'
      ? 'PROVIDER'
      : 'DIAN_DIRECT';
  }
}