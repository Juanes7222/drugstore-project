import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { TransmissionRouteResolver } from './transmission-route.resolver';

describe('TransmissionRouteResolver', () => {
  let resolver: TransmissionRouteResolver;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    resolver = new TransmissionRouteResolver(prisma as any);
  });

  describe('resolve', () => {
    it('returns PROVIDER when the subscription plan bills through the provider', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        plan: { billingMethod: 'PROVIDER' },
      });

      await expect(resolver.resolve('sub-test')).resolves.toBe('PROVIDER');
    });

    it('returns DIAN_DIRECT when the plan bills with the tenant certificate', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        plan: { billingMethod: 'CERTIFICATE' },
      });

      await expect(resolver.resolve('sub-test')).resolves.toBe('DIAN_DIRECT');
    });

    it('falls back to DIAN_DIRECT when the subscription does not exist', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(resolver.resolve('sub-gone')).resolves.toBe('DIAN_DIRECT');
    });

    it('falls back to DIAN_DIRECT when the subscription has no plan', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        plan: null,
      });

      await expect(resolver.resolve('sub-test')).resolves.toBe('DIAN_DIRECT');
    });

    it('falls back to DIAN_DIRECT when the subscription has no plan billing method', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        plan: {},
      });

      await expect(resolver.resolve('sub-test')).resolves.toBe('DIAN_DIRECT');
    });

    it('scopes the lookup to the given subscription id and reads only the billing method', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await resolver.resolve('sub-test');

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { id: 'sub-test' },
        select: { plan: { select: { billingMethod: true } } },
      });
    });
  });
});
