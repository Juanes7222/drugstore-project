import { NumberingRangeProcessor } from './numbering-range.processor';
import { DianNumberingRangeOperationException } from './exceptions/dian-numbering-range-operation.exception';
import { DomainException } from '../../common/exceptions/domain.exception';
import type { DianNumberingRange } from '@pharmacy/shared-types';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

describe('NumberingRangeProcessor', () => {
  let processor: NumberingRangeProcessor;

  const prisma = {
    fiscalIssuerConfig: { findFirst: jest.fn() },
    techProviderConfig: { findFirst: jest.fn() },
  };
  const transmission = { fetchNumberingRanges: jest.fn() };
  const secrets = { readSecret: jest.fn() };
  const routeResolver = { resolve: jest.fn().mockResolvedValue('DIAN_DIRECT') };

  const job = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'job-1',
      data: {
        subscriptionId: 'sub-1',
        requestedByUserId: 'user-1',
        workstationId: null,
        ...(overrides as any),
      },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    routeResolver.resolve.mockResolvedValue('DIAN_DIRECT');
    processor = new NumberingRangeProcessor(
      prisma as any,
      transmission as any,
      secrets as any,
      routeResolver as any,
    );
  });

  const range: DianNumberingRange = {
    resolutionNumber: '9310000085419',
    prefix: 'F002',
    fromNumber: 1,
    toNumber: 99999999,
    validFrom: '2030-01-01T00:00:00Z',
    validTo: '2032-01-01T00:00:00Z',
    technicalKey: 'FC8EAC422EBA16E22FFD8C6F94B3F40A6E38162C',
  };

  function happyPath() {
    prisma.fiscalIssuerConfig.findFirst.mockResolvedValue({
      nit: '900123456',
      verificationDigit: '3',
    });
    prisma.techProviderConfig.findFirst.mockResolvedValue({
      environment: '2',
      credentialReference: null,
    });
    secrets.readSecret.mockResolvedValue({
      certificate: Buffer.from('p12'),
      password: 'secret',
      softwareSecurityCode: 'code',
    });
    transmission.fetchNumberingRanges.mockResolvedValue([range]);
  }

  it('returns the fetched ranges on success', async () => {
    happyPath();

    await expect(processor.process(job())).resolves.toEqual({
      ok: true,
      ranges: [range],
    });

    // Both request fields carry the NIT without verification digit
    // (Annex §7.15 — own-software mode sends the same NIT twice).
    expect(transmission.fetchNumberingRanges).toHaveBeenCalledWith(
      expect.any(Buffer),
      'secret',
      '2',
      '900123456',
      '900123456',
    );
  });

  it('passes the provider credentialReference when the route is PROVIDER', async () => {
    happyPath();
    routeResolver.resolve.mockResolvedValue('PROVIDER');
    prisma.techProviderConfig.findFirst.mockResolvedValue({
      environment: '1',
      credentialReference: 'file:provider.json',
    });

    await processor.process(job());

    expect(secrets.readSecret).toHaveBeenCalledWith('sub-1', 'file:provider.json');
  });

  it('passes an empty reference when the route is DIAN_DIRECT', async () => {
    happyPath();

    await processor.process(job());

    expect(secrets.readSecret).toHaveBeenCalledWith('sub-1', '');
  });

  it.each([
    ['ISSUER_CONFIG_MISSING'],
    ['TECH_PROVIDER_CONFIG_MISSING'],
  ])('fails with %s when configuration rows are absent', async (case_) => {
    if (case_ === 'ISSUER_CONFIG_MISSING') {
      prisma.fiscalIssuerConfig.findFirst.mockResolvedValue(null);
    } else {
      prisma.fiscalIssuerConfig.findFirst.mockResolvedValue({ nit: '900123456' });
      prisma.techProviderConfig.findFirst.mockResolvedValue(null);
    }

    await expect(processor.process(job())).resolves.toMatchObject({
      ok: false,
      errorCode: case_,
    });
  });

  it.each([
    ['301', 'NOT_HABILITATED'],
    ['302', 'SOFTWARE_MISMATCH'],
    ['303', 'SOFTWARE_MISMATCH'],
    ['401', 'NOT_AUTHORIZED'],
    ['500', 'DIAN_UNAVAILABLE'],
    ['999', 'UNEXPECTED'],
  ])(
    'translates DIAN OperationCode %s into %s',
    async (operationCode, expectedErrorCode) => {
      happyPath();
      transmission.fetchNumberingRanges.mockRejectedValue(
        new DianNumberingRangeOperationException(operationCode, 'desc'),
      );

      await expect(processor.process(job())).resolves.toEqual({
        ok: false,
        errorCode: expectedErrorCode,
        message: expect.stringContaining(operationCode),
      });
    },
  );

  it('maps certificate domain exceptions to CERTIFICATE_UNUSABLE', async () => {
    happyPath();
    secrets.readSecret.mockRejectedValue(
      new DomainException(
        'FISCAL_CERTIFICATE_EXPIRED',
        'certificate expired',
        422,
      ),
    );

    await expect(processor.process(job())).resolves.toMatchObject({
      ok: false,
      errorCode: 'CERTIFICATE_UNUSABLE',
    });
  });

  it('classifies transport failures as DIAN_UNAVAILABLE', async () => {
    happyPath();
    transmission.fetchNumberingRanges.mockRejectedValue(
      new TypeError('fetch failed'),
    );

    await expect(processor.process(job())).resolves.toMatchObject({
      ok: false,
      errorCode: 'DIAN_UNAVAILABLE',
    });
  });

  it('never rejects — unknown errors come back as UNEXPECTED results', async () => {
    prisma.fiscalIssuerConfig.findFirst.mockRejectedValue(
      new Error('db exploded'),
    );

    await expect(processor.process(job())).resolves.toMatchObject({
      ok: false,
      errorCode: 'UNEXPECTED',
      message: 'db exploded',
    });
  });
});
