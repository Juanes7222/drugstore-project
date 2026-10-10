import { UpdatePosSalesSettingsSchema } from './update-pos-sales-settings.schema';

const limits = {
  cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
  admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
  inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
  accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
  owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
  manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
};

const salesConfig = {
  priceOverridePermissions: {
    cashier: { allowed: false, requireReason: true },
    manager: { allowed: true, requireReason: true },
    inventoryAssistant: { allowed: false, requireReason: true },
    accountant: { allowed: false, requireReason: true },
  },
  priceFloor: { enabled: true, type: 'COST' as const, minMarginPercent: 0 },
  creditEnabled: true,
  defaultCreditLimitCents: 25_000_000,
};

describe('UpdatePosSalesSettingsSchema', () => {
  it('accepts either block on its own', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({ discountLimits: limits }).success,
    ).toBe(true);
    expect(
      UpdatePosSalesSettingsSchema.safeParse({ salesConfig }).success,
    ).toBe(true);
    expect(
      UpdatePosSalesSettingsSchema.safeParse({ discountLimits: limits, salesConfig })
        .success,
    ).toBe(true);
  });

  it('rejects an empty body', () => {
    // A 200 with nothing written is indistinguishable from a successful save
    // to the caller, so the no-op has to be a 400 instead.
    expect(UpdatePosSalesSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a discount limit above 100, which would authorise a negative price', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        discountLimits: { ...limits, cashier: { itemMaxPercent: 150, globalMaxPercent: 5 } },
      }).success,
    ).toBe(false);
  });

  it('rejects a negative discount limit', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        discountLimits: { ...limits, cashier: { itemMaxPercent: -1, globalMaxPercent: 5 } },
      }).success,
    ).toBe(false);
  });

  it('rejects a fractional discount limit', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        discountLimits: { ...limits, cashier: { itemMaxPercent: 10.5, globalMaxPercent: 5 } },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown discount role', () => {
    // validateItemPricing resolves an unrecognised role to "no limit", so a
    // payload inventing a role would fail OPEN — it has to be rejected instead.
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        discountLimits: { ...limits, supervisor: { itemMaxPercent: 100, globalMaxPercent: 100 } },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing role rather than defaulting it', () => {
    const { manager: _omitted, ...partial } = limits;
    expect(
      UpdatePosSalesSettingsSchema.safeParse({ discountLimits: partial }).success,
    ).toBe(false);
  });

  it('rejects an unknown price-floor type', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        salesConfig: { ...salesConfig, priceFloor: { ...salesConfig.priceFloor, type: 'WHATEVER' } },
      }).success,
    ).toBe(false);
  });

  it('rejects a negative default credit limit', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        salesConfig: { ...salesConfig, defaultCreditLimitCents: -1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a fractional default credit limit', () => {
    // Cents are the unit; a fractional value would be truncated differently by
    // each side and the two would disagree about the limit.
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        salesConfig: { ...salesConfig, defaultCreditLimitCents: 100.5 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown price-override role', () => {
    expect(
      UpdatePosSalesSettingsSchema.safeParse({
        salesConfig: {
          ...salesConfig,
          priceOverridePermissions: {
            ...salesConfig.priceOverridePermissions,
            supervisor: { allowed: true, requireReason: false },
          },
        },
      }).success,
    ).toBe(false);
  });
});