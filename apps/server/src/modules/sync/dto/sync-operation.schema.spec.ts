import {
  SyncOperationSchema,
  SyncBatchSchema,
} from './sync-operation.schema';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function buildOp(overrides: Record<string, unknown> = {}) {
  return {
    operationUuid: UUID,
    operationType: 'SALE_CONFIRMATION' as const,
    payload: {},
    payloadHash: VALID_HASH,
    sourceCreatedAt: '2024-01-01T00:00:00Z',
    clientSequence: 1,
    ...overrides,
  };
}

// ── SyncOperationSchema ──────────────────────────────────────────────────

describe('SyncOperationSchema', () => {
  it('accepts a valid operation', () => {
    const result = SyncOperationSchema.safeParse(buildOp());
    expect(result.success).toBe(true);
  });

  it('rejects unknown operationType', () => {
    const result = SyncOperationSchema.safeParse(
      buildOp({ operationType: 'UNKNOWN' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID format', () => {
    const result = SyncOperationSchema.safeParse(
      buildOp({ operationUuid: 'not-a-uuid' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty payloadHash', () => {
    const result = SyncOperationSchema.safeParse(
      buildOp({ payloadHash: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects invalid ISO datetime', () => {
    const result = SyncOperationSchema.safeParse(
      buildOp({ sourceCreatedAt: '2024/01/01' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-positive clientSequence', () => {
    const result = SyncOperationSchema.safeParse(
      buildOp({ clientSequence: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing payload field', () => {
    const { payload, ...rest } = buildOp();
    const result = SyncOperationSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ── SyncBatchSchema (array) ───────────────────────────────────────────────

describe('SyncBatchSchema', () => {
  it('accepts a non-empty array of operations', () => {
    const result = SyncBatchSchema.safeParse([buildOp()]);
    expect(result.success).toBe(true);
  });

  it('rejects empty array', () => {
    const result = SyncBatchSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('rejects wrapper object { operations: [...] }', () => {
    const result = SyncBatchSchema.safeParse({
      operations: [buildOp()],
    });
    expect(result.success).toBe(false);
  });

  it('rejects null body', () => {
    const result = SyncBatchSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects non-array body (string)', () => {
    const result = SyncBatchSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });

  it('rejects array with invalid element', () => {
    const result = SyncBatchSchema.safeParse([
      buildOp({ operationType: 'INVALID' }),
    ]);
    expect(result.success).toBe(false);
  });
});

// ── New operation types ───────────────────────────────────────────────────

describe('new operation types in SyncOperationSchema', () => {
  const newTypes = [
    'INVOICE_TRANSMISSION_RESULT',
    'PRODUCT_CREATION',
    'PRODUCT_UPDATE',
  ] as const;

  for (const t of newTypes) {
    it(`accepts ${t}`, () => {
      const result = SyncOperationSchema.safeParse(buildOp({ operationType: t }));
      expect(result.success).toBe(true);
    });
  }

  it('accepts all new types in a single batch array', () => {
    const ops = newTypes.map((t) => buildOp({ operationType: t }));
    const result = SyncBatchSchema.safeParse(ops);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
    }
  });
});

// ── Existing operation types still valid ──────────────────────────────────

describe('existing operation types in SyncOperationSchema', () => {
  const existingTypes = [
    'SALE_CONFIRMATION',
    'SHIFT_CLOSURE',
    'CLIENT_CREATION',
    'CLIENT_RETURN',
    'INVENTORY_ADJUSTMENT',
    'FISCAL_DOCUMENT_SYNC',
    'PRESCRIPTION_REGISTRATION',
    'RESOLUTION_ALLOCATION',
    'INVOICE_TRANSMISSION',
  ] as const;

  for (const t of existingTypes) {
    it(`accepts ${t}`, () => {
      const result = SyncOperationSchema.safeParse(buildOp({ operationType: t }));
      expect(result.success).toBe(true);
    });
  }
});
