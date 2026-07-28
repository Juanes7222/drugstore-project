// ---------------------------------------------------------------------------
// Default plan definitions (seed data)
//
// These are the plans available for pharmacy subscriptions. The server reads
// this file to seed the Plan table. Prices are in Colombian pesos (COP).
//
// Plan tiers:
//   Starter   — Farmacia básica (1 local, 1 puesto)
//   Professional — Farmacia profesional (hasta 3 locales)
//   Enterprise   — Cadena de farmacias (ilimitado)
// ---------------------------------------------------------------------------

import { PlanFeature, PricingModel, BillingPeriod } from './licensing-enums';

export interface PlanSeedDefinition {
  code: string;
  name: string;
  description: string;
  pricingModel: PricingModel;
  basePriceCents: number;
  currency: string;
  billingPeriod: BillingPeriod;
  maxLocations: number;
  maxWorkstationsPerLocation: number;
  includedWorkstations: number;
  extraWorkstationPriceCents: number | null;
  features: PlanFeature[];
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
}

/**
 * Default plans for the pharmacy SaaS.
 *
 * Prices are monthly in COP cents.
 *   Starter:      $ 99,000 COP/mes
 *   Professional: $199,000 COP/mes
 *   Enterprise:   $399,000 COP/mes
 *
 * All plans include OFFLINE_MODE since Colombian internet is unreliable.
 */
export const DEFAULT_PLANS: PlanSeedDefinition[] = [
  {
    code: 'STARTER',
    name: 'Farmacia Básica',
    description:
      'Para farmacias independientes que necesitan un sistema POS confiable con operación offline.',
    pricingModel: PricingModel.FLAT,
    basePriceCents: 99_000_00, // $99,000 COP
    currency: 'COP',
    billingPeriod: BillingPeriod.MONTHLY,
    maxLocations: 1,
    maxWorkstationsPerLocation: 1,
    includedWorkstations: 1,
    extraWorkstationPriceCents: null,
    features: [
      PlanFeature.OFFLINE_MODE,
      PlanFeature.FISCAL_PRINTING,
      PlanFeature.INVENTORY_MANAGEMENT,
    ],
    displayOrder: 1,
    isActive: true,
    isPublic: true,
  },
  {
    code: 'PROFESSIONAL',
    name: 'Farmacia Profesional',
    description:
      'Para farmacias con múltiples sucursales que requieren reportes avanzados, manejo de recetas médicas y sincronización entre terminales.',
    pricingModel: PricingModel.PER_LOCATION,
    basePriceCents: 199_000_00, // $199,000 COP
    currency: 'COP',
    billingPeriod: BillingPeriod.MONTHLY,
    maxLocations: 3,
    maxWorkstationsPerLocation: 2,
    includedWorkstations: 2,
    extraWorkstationPriceCents: 50_000_00, // $50,000 COP per extra workstation
    features: [
      PlanFeature.OFFLINE_MODE,
      PlanFeature.MULTI_LOCATION,
      PlanFeature.MULTI_TERMINAL_SYNC,
      PlanFeature.ADVANCED_REPORTS,
      PlanFeature.INVENTORY_MANAGEMENT,
      PlanFeature.PRESCRIPTION_MANAGEMENT,
      PlanFeature.FISCAL_PRINTING,
      PlanFeature.LABEL_PRINTING,
      PlanFeature.CUSTOMER_DISPLAY,
    ],
    displayOrder: 2,
    isActive: true,
    isPublic: true,
  },
  {
    code: 'ENTERPRISE',
    name: 'Cadena de Farmacias',
    description:
      'Para cadenas de farmacias que necesitan gestión ilimitada de sucursales, integraciones personalizadas, soporte prioritario y respaldo automatizado.',
    pricingModel: PricingModel.PER_LOCATION,
    basePriceCents: 399_000_00, // $399,000 COP
    currency: 'COP',
    billingPeriod: BillingPeriod.MONTHLY,
    maxLocations: 999, // effectively unlimited
    maxWorkstationsPerLocation: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 40_000_00, // $40,000 COP per extra workstation
    features: [
      PlanFeature.OFFLINE_MODE,
      PlanFeature.MULTI_LOCATION,
      PlanFeature.UNLIMITED_LOCATIONS,
      PlanFeature.MULTI_TERMINAL_SYNC,
      PlanFeature.ADVANCED_REPORTS,
      PlanFeature.INVENTORY_MANAGEMENT,
      PlanFeature.PRESCRIPTION_MANAGEMENT,
      PlanFeature.FISCAL_PRINTING,
      PlanFeature.LABEL_PRINTING,
      PlanFeature.CUSTOMER_DISPLAY,
      PlanFeature.PRIORITY_SUPPORT,
      PlanFeature.API_ACCESS,
      PlanFeature.CUSTOM_INTEGRATIONS,
      PlanFeature.WHITE_LABEL,
      PlanFeature.BACKUP_RECOVERY,
    ],
    displayOrder: 3,
    isActive: true,
    isPublic: true,
  },
];
