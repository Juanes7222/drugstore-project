import { z } from 'zod';

/**
 * Write schema for the POS sales-settings pair.
 *
 * Both blocks land in `SystemConfig` as `valueType: 'OBJECT'` blobs, which means
 * the server would otherwise store whatever it was handed and only sanitise it
 * on the way out. Validating on the way in is what stops a bad value becoming
 * the configuration every workstation boots with.
 *
 * Percentages are bounded 0–100 rather than merely non-negative: these are
 * discount ceilings, so anything above 100 would authorise a negative price.
 *
 * Every object is `.strict()`. Zod's default for an unrecognised key is to
 * strip it, which turns a typo'd or invented field into a silent partial write
 * that returns 200: the caller believes a role's limit was saved, the server
 * stored nothing for it, and the two disagree until the next boot sync
 * overwrites the local copy. Rejecting is the only honest answer for a config
 * write.
 */

const RoleDiscountLimitSchema = z
  .object({
    itemMaxPercent: z.number().int().min(0).max(100),
    globalMaxPercent: z.number().int().min(0).max(100),
  })
  .strict();

/**
 * Roles are listed explicitly rather than accepted as a record.
 *
 * An open record would let a payload invent roles the domain has no rules for —
 * and `validateItemPricing` resolves an unknown role to "no limit", which fails
 * open. A payload naming a role that does not exist is a 400, not a silent
 * permission grant.
 */
export const DiscountLimitsSchema = z
  .object({
    cashier: RoleDiscountLimitSchema,
    admin: RoleDiscountLimitSchema,
    inventoryAssistant: RoleDiscountLimitSchema,
    accountant: RoleDiscountLimitSchema,
    owner: RoleDiscountLimitSchema,
    manager: RoleDiscountLimitSchema,
  })
  .strict();

const RolePriceOverrideSchema = z
  .object({
    allowed: z.boolean(),
    requireReason: z.boolean(),
  })
  .strict();

const PriceOverridePermissionsSchema = z
  .object({
    cashier: RolePriceOverrideSchema,
    manager: RolePriceOverrideSchema,
    inventoryAssistant: RolePriceOverrideSchema,
    accountant: RolePriceOverrideSchema,
  })
  .strict();

const PriceFloorSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(['COST', 'COST_PLUS_MARGIN']),
    minMarginPercent: z.number().min(0).max(100),
  })
  .strict();

export const SalesConfigWriteSchema = z
  .object({
    priceOverridePermissions: PriceOverridePermissionsSchema,
    priceFloor: PriceFloorSchema,
    creditEnabled: z.boolean(),
    defaultCreditLimitCents: z.number().int().min(0),
  })
  .strict();

export const UpdatePosSalesSettingsSchema = z
  .object({
    discountLimits: DiscountLimitsSchema.optional(),
    salesConfig: SalesConfigWriteSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.discountLimits !== undefined || value.salesConfig !== undefined,
    {
      message:
        'Provide at least one of discountLimits or salesConfig — an empty body would be a silent no-op the caller cannot distinguish from success.',
    },
  );

export type UpdatePosSalesSettingsDto = z.infer<
  typeof UpdatePosSalesSettingsSchema
>;