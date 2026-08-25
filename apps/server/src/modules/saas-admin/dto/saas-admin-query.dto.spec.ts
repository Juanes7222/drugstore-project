import { describe, it, expect } from '@jest/globals';
import { ZodError } from 'zod';
import {
  AccessAuditQuerySchema,
  CustomerSalesQuerySchema,
  CustomersQuerySchema,
  FraudAlertsQuerySchema,
  PlatformOverviewQuerySchema,
  ResolveFraudAlertBodySchema,
  TrialsEndingQuerySchema,
} from './saas-admin-query.dto';

describe('CustomersQuerySchema', () => {
  it('coerces numeric query-string pagination values', () => {
    const result = CustomersQuerySchema.parse({ page: '3', pageSize: '25' });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(25);
  });

  it('leaves page and pageSize optional', () => {
    const result = CustomersQuerySchema.parse({});

    expect(result.page).toBeUndefined();
    expect(result.pageSize).toBeUndefined();
  });

  it('rejects a page below 1', () => {
    expect(() => CustomersQuerySchema.parse({ page: '0' })).toThrow(ZodError);
  });

  it('rejects a pageSize above 100', () => {
    expect(() => CustomersQuerySchema.parse({ pageSize: '101' })).toThrow(
      ZodError,
    );
  });

  it('accepts a pageSize of exactly 100', () => {
    expect(CustomersQuerySchema.parse({ pageSize: '100' }).pageSize).toBe(100);
  });

  it('rejects a fractional page', () => {
    expect(() => CustomersQuerySchema.parse({ page: '1.5' })).toThrow(ZodError);
  });

  it('rejects an empty search query', () => {
    expect(() => CustomersQuerySchema.parse({ query: '' })).toThrow(ZodError);
  });
});

describe('CustomerSalesQuerySchema', () => {
  it('accepts parseable from/to dates', () => {
    const result = CustomerSalesQuerySchema.parse({
      from: '2026-08-01',
      to: '2026-08-24T12:00:00.000Z',
      state: 'CONFIRMED',
    });

    expect(result.from).toBe('2026-08-01');
    expect(result.to).toBe('2026-08-24T12:00:00.000Z');
    expect(result.state).toBe('CONFIRMED');
  });

  it('rejects an unparseable from date', () => {
    expect(() =>
      CustomerSalesQuerySchema.parse({ from: 'not-a-date' }),
    ).toThrow(ZodError);
  });
});

describe('FraudAlertsQuerySchema', () => {
  it.each(['OPEN', 'INVESTIGATING', 'DISMISSED', 'CONFIRMED_FRAUD'])(
    'accepts persisted fraud status %s',
    (status) => {
      expect(FraudAlertsQuerySchema.parse({ status }).status).toBe(status);
    },
  );

  it('accepts ALL as a filter value', () => {
    expect(FraudAlertsQuerySchema.parse({ status: 'ALL' }).status).toBe('ALL');
  });

  it('leaves status optional so the service can default to the unresolved queue', () => {
    expect(FraudAlertsQuerySchema.parse({}).status).toBeUndefined();
  });

  it('rejects a status outside the persisted enum plus ALL', () => {
    expect(() =>
      FraudAlertsQuerySchema.parse({ status: 'RESOLVED' }),
    ).toThrow(ZodError);
  });
});

describe('AccessAuditQuerySchema', () => {
  it('coerces and bounds pagination like the other listings', () => {
    const result = AccessAuditQuerySchema.parse({ page: '2', pageSize: '50' });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(() => AccessAuditQuerySchema.parse({ pageSize: '999' })).toThrow(
      ZodError,
    );
  });
});

describe('TrialsEndingQuerySchema', () => {
  it('defaults to 14 days when omitted', () => {
    expect(TrialsEndingQuerySchema.parse({}).days).toBe(14);
  });

  it('coerces a query-string day count', () => {
    expect(TrialsEndingQuerySchema.parse({ days: '7' }).days).toBe(7);
  });

  it('accepts the inclusive range boundaries 1 and 90', () => {
    expect(TrialsEndingQuerySchema.parse({ days: '1' }).days).toBe(1);
    expect(TrialsEndingQuerySchema.parse({ days: '90' }).days).toBe(90);
  });

  it('rejects days above the 90-day ceiling instead of clamping', () => {
    expect(() => TrialsEndingQuerySchema.parse({ days: '91' })).toThrow(
      ZodError,
    );
  });

  it('rejects days below 1 instead of clamping', () => {
    expect(() => TrialsEndingQuerySchema.parse({ days: '0' })).toThrow(
      ZodError,
    );
  });

  it('rejects a fractional or non-numeric day count', () => {
    expect(() => TrialsEndingQuerySchema.parse({ days: '2.5' })).toThrow(
      ZodError,
    );
    expect(() => TrialsEndingQuerySchema.parse({ days: 'soon' })).toThrow(
      ZodError,
    );
  });
});

describe('ResolveFraudAlertBodySchema', () => {
  it('leaves note optional', () => {
    expect(ResolveFraudAlertBodySchema.parse({}).note).toBeUndefined();
  });

  it('rejects an empty note', () => {
    expect(() => ResolveFraudAlertBodySchema.parse({ note: '' })).toThrow(
      ZodError,
    );
  });

  it('rejects a note beyond 2000 characters', () => {
    expect(() =>
      ResolveFraudAlertBodySchema.parse({ note: 'x'.repeat(2001) }),
    ).toThrow(ZodError);
  });
});

describe('PlatformOverviewQuerySchema', () => {
  it('parses an empty query and passes unknown keys through', () => {
    const result = PlatformOverviewQuerySchema.parse({ utm: 'console' });

    expect(result.utm).toBe('console');
  });
});
