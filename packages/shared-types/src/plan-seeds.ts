// ---------------------------------------------------------------------------
// Default plan definitions (seed data)
//
// These are the plans available for pharmacy subscriptions. The server reads
// this file to seed the Plan table. Prices are in Colombian pesos (COP).
//
// There are exactly two plans, identical in features and price, differing
// only in the electronic-invoicing (DIAN) billing method:
//   PROVIDER   — DIAN transmission handled by our system (tech provider),
//                no certificates for the customer to manage.
//   CERTIFICATE — the customer uploads their own DIAN digital certificate
//                in the POS.
// ---------------------------------------------------------------------------

import {
  PlanBillingMethod,
  PlanFeature,
  PricingModel,
  BillingPeriod,
} from './licensing-enums';

export interface PlanSeedDefinition {
  code: string;
  name: string;
  description: string;
  billingMethod: PlanBillingMethod;
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
 * Both plans cost $199,000 COP/month and include every feature; only the
 * DIAN billing method differs. Legacy tier plans (STARTER/PROFESSIONAL/
 * ENTERPRISE) are deactivated by the server seed, not replaced here.
 */
export const DEFAULT_PLANS: PlanSeedDefinition[] = [
  {
    code: 'PROVIDER',
    name: 'Farmacia con facturación incluida',
    description:
      'Facturación electrónica DIAN gestionada por nosotros (proveedor tecnológico), sin certificados.',
    billingMethod: PlanBillingMethod.PROVIDER,
    pricingModel: PricingModel.FLAT,
    basePriceCents: 199_000_00, // $199,000 COP
    currency: 'COP',
    billingPeriod: BillingPeriod.MONTHLY,
    maxLocations: 999, // effectively unlimited
    maxWorkstationsPerLocation: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 40_000_00, // $40,000 COP per extra workstation
    features: [
      PlanFeature.MULTI_LOCATION,
      PlanFeature.UNLIMITED_LOCATIONS,
      PlanFeature.MULTI_TERMINAL_SYNC,
      PlanFeature.OFFLINE_MODE,
      PlanFeature.INVENTORY_MANAGEMENT,
      PlanFeature.PRESCRIPTION_MANAGEMENT,
      PlanFeature.FISCAL_PRINTING,
      PlanFeature.LABEL_PRINTING,
      PlanFeature.CUSTOMER_DISPLAY,
      PlanFeature.ADVANCED_REPORTS,
      PlanFeature.PRIORITY_SUPPORT,
      PlanFeature.API_ACCESS,
      PlanFeature.CUSTOM_INTEGRATIONS,
      PlanFeature.WHITE_LABEL,
      PlanFeature.BACKUP_RECOVERY,
    ],
    displayOrder: 1,
    isActive: true,
    isPublic: true,
  },
  {
    code: 'CERTIFICATE',
    name: 'Farmacia con tu certificado DIAN',
    description:
      'Facturación electrónica DIAN con tu propio certificado digital (lo subes en el POS).',
    billingMethod: PlanBillingMethod.CERTIFICATE,
    pricingModel: PricingModel.FLAT,
    basePriceCents: 199_000_00, // $199,000 COP
    currency: 'COP',
    billingPeriod: BillingPeriod.MONTHLY,
    maxLocations: 999, // effectively unlimited
    maxWorkstationsPerLocation: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 40_000_00, // $40,000 COP per extra workstation
    features: [
      PlanFeature.MULTI_LOCATION,
      PlanFeature.UNLIMITED_LOCATIONS,
      PlanFeature.MULTI_TERMINAL_SYNC,
      PlanFeature.OFFLINE_MODE,
      PlanFeature.INVENTORY_MANAGEMENT,
      PlanFeature.PRESCRIPTION_MANAGEMENT,
      PlanFeature.FISCAL_PRINTING,
      PlanFeature.LABEL_PRINTING,
      PlanFeature.CUSTOMER_DISPLAY,
      PlanFeature.ADVANCED_REPORTS,
      PlanFeature.PRIORITY_SUPPORT,
      PlanFeature.API_ACCESS,
      PlanFeature.CUSTOM_INTEGRATIONS,
      PlanFeature.WHITE_LABEL,
      PlanFeature.BACKUP_RECOVERY,
    ],
    displayOrder: 2,
    isActive: true,
    isPublic: true,
  },
];