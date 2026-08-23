import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { TransmissionRouteResolver } from './transmission-route.resolver';

describe('TransmissionRouteResolver', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let resolver: TransmissionRouteResolver;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    resolver = new TransmissionRouteResolver(prisma as any);
  });

  it('returns PROVIDER when the plan billingMethod is PROVIDER', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
      plan: { billingMethod: 'PROVIDER' },
    });

    await expect(resolver.resolve('sub-1')).resolves.toBe('PROVIDER');

    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      select: { plan: { select: { billingMethod: true } } },
    });
  });

  it('returns DIAN_DIRECT when the plan billingMethod is CERTIFICATE', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
      plan: { billingMethod: 'CERTIFICATE' },
    });

    await expect(resolver.resolve('sub-1')).resolves.toBe('DIAN_DIRECT');
  });

  it('returns DIAN_DIRECT for a legacy subscription without a plan', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
      plan: null,
    });

    await expect(resolver.resolve('sub-1')).resolves.toBe('DIAN_DIRECT');
  });

  it('returns DIAN_DIRECT when the subscription does not exist', async () => {
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(resolver.resolve('missing-sub')).resolves.toBe('DIAN_DIRECT');
  });
});