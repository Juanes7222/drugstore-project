/**
 * Licensing seed — plans, subscription, locations, activation codes,
 * workstation activations, and check-in history.
 *
 * Creates:
 *   3 plans (Starter, Professional, Enterprise)
 *   1 subscription (ACTIVE, Professional plan)
 *   1 location
 *   2 activation codes (1 USED per workstation, 1 UNUSED)
 *   2 workstation activations
 *   3 license check-in records
 *
 * @category Seed
 */

import { Prisma } from '@pharmacy/database';
import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { NOW, SIX_MONTHS_AGO, YESTERDAY } from '../constants/dates';

const ONE_YEAR_FROM_NOW = new Date(NOW.getFullYear() + 1, NOW.getMonth(), NOW.getDate());
const SEVEN_DAYS_AGO = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
const TWO_DAYS_AGO = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);

export async function seedLicensing(): Promise<void> {
  console.log('Seeding licensing...');

  // ---- Plans ----
  const plans: Prisma.PlanCreateManyInput[] = [
    {
      id: IDS.PLAN_STARTER,
      code: 'STARTER',
      name: 'Farmacia Básica',
      description:
        'Para farmacias independientes que necesitan un sistema POS confiable con operación offline.',
      pricingModel: 'FLAT',
      basePriceCents: 99_000_00,
      currency: 'COP',
      billingPeriod: 'MONTHLY',
      maxLocations: 1,
      maxWorkstationsPerLocation: 1,
      includedWorkstations: 1,
      extraWorkstationPriceCents: null,
      features: ['OFFLINE_MODE', 'FISCAL_PRINTING', 'INVENTORY_MANAGEMENT'],
      displayOrder: 1,
      isActive: true,
      isPublic: true,
      createdAt: SIX_MONTHS_AGO,
      updatedAt: SIX_MONTHS_AGO,
    },
    {
      id: IDS.PLAN_PROFESSIONAL,
      code: 'PROFESSIONAL',
      name: 'Farmacia Profesional',
      description:
        'Para farmacias con múltiples sucursales que requieren reportes avanzados, manejo de recetas médicas y sincronización entre terminales.',
      pricingModel: 'PER_LOCATION',
      basePriceCents: 199_000_00,
      currency: 'COP',
      billingPeriod: 'MONTHLY',
      maxLocations: 3,
      maxWorkstationsPerLocation: 2,
      includedWorkstations: 2,
      extraWorkstationPriceCents: 50_000_00,
      features: [
        'OFFLINE_MODE',
        'MULTI_LOCATION',
        'MULTI_TERMINAL_SYNC',
        'ADVANCED_REPORTS',
        'INVENTORY_MANAGEMENT',
        'PRESCRIPTION_MANAGEMENT',
        'FISCAL_PRINTING',
        'LABEL_PRINTING',
        'CUSTOMER_DISPLAY',
      ],
      displayOrder: 2,
      isActive: true,
      isPublic: true,
      createdAt: SIX_MONTHS_AGO,
      updatedAt: SIX_MONTHS_AGO,
    },
    {
      id: IDS.PLAN_ENTERPRISE,
      code: 'ENTERPRISE',
      name: 'Cadena de Farmacias',
      description:
        'Para cadenas de farmacias que necesitan gestión ilimitada de sucursales, integraciones personalizadas, soporte prioritario y respaldo automatizado.',
      pricingModel: 'PER_LOCATION',
      basePriceCents: 399_000_00,
      currency: 'COP',
      billingPeriod: 'MONTHLY',
      maxLocations: 999,
      maxWorkstationsPerLocation: 5,
      includedWorkstations: 3,
      extraWorkstationPriceCents: 40_000_00,
      features: [
        'OFFLINE_MODE',
        'MULTI_LOCATION',
        'UNLIMITED_LOCATIONS',
        'MULTI_TERMINAL_SYNC',
        'ADVANCED_REPORTS',
        'INVENTORY_MANAGEMENT',
        'PRESCRIPTION_MANAGEMENT',
        'FISCAL_PRINTING',
        'LABEL_PRINTING',
        'CUSTOMER_DISPLAY',
        'PRIORITY_SUPPORT',
        'API_ACCESS',
        'CUSTOM_INTEGRATIONS',
        'WHITE_LABEL',
        'BACKUP_RECOVERY',
      ],
      displayOrder: 3,
      isActive: true,
      isPublic: true,
      createdAt: SIX_MONTHS_AGO,
      updatedAt: SIX_MONTHS_AGO,
    },
  ];
  // Use createMany instead of upsert since Plan has a unique constraint on code
  // that conflicts with the generic upsert-by-id helper.
  await prisma.plan.createMany({ data: plans, skipDuplicates: true });
  console.log('   3 plans');

  // ---- Subscription ----
  const subscription: Prisma.SubscriptionCreateManyInput = {
    id: IDS.SUBSCRIPTION_DEFAULT,
    planId: IDS.PLAN_PROFESSIONAL,
    customerName: 'Droguería La Esperanza',
    customerTaxId: '9001234567',
    customerEmail: 'admin@drogueriaesperanza.com',
    customerPhone: '+5712345678',
    customerAddress: 'Calle 123 #45-67',
    status: 'ACTIVE',
    currentPeriodStart: SIX_MONTHS_AGO,
    currentPeriodEnd: ONE_YEAR_FROM_NOW,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    paymentMethod: null,
    paymentReference: 'SEED-BANK-TRANSFER-001',
    lastPaymentAt: SIX_MONTHS_AGO,
    nextPaymentDueAt: ONE_YEAR_FROM_NOW,
    gracePeriodDays: 7,
    offlineGracePeriodDays: 30,
    createdAt: SIX_MONTHS_AGO,
    updatedAt: SIX_MONTHS_AGO,
  };
  await prisma.subscription.createMany({ data: [subscription], skipDuplicates: true });
  console.log('   1 subscription (Professional — Droguería La Esperanza)');

  // ---- Location ----
  const location = {
    id: IDS.LOCATION_MAIN,
    subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
    name: 'Sede Principal',
    address: 'Calle 123 #45-67',
    city: 'Bogotá',
    region: 'Bogotá D.C.',
    country: 'CO',
    taxId: null,
    phone: '+5712345678',
    email: 'admin@drogueriaesperanza.com',
    isActive: true,
    latitude: null,
    longitude: null,
    notes: null,
    createdAt: SIX_MONTHS_AGO,
    updatedAt: SIX_MONTHS_AGO,
  };
  await prisma.location.createMany({ data: [location], skipDuplicates: true });
  console.log('   1 location (Sede Principal)');

  // ---- Activation codes ----
  // One used code per workstation, plus one spare unused code.
  const activationCodes: Prisma.ActivationCodeCreateManyInput[] = [
    {
      id: IDS.ACT_CODE_WS1,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      locationId: IDS.LOCATION_MAIN,
      code: 'ABCD-EFGH-IJKL-MNOP',
      type: 'WORKSTATION',
      status: 'USED',
      usedAt: SIX_MONTHS_AGO,
      usedByActivationId: IDS.WS_ACTIVATION_PRINCIPAL,
      expiresAt: ONE_YEAR_FROM_NOW,
      createdAt: SIX_MONTHS_AGO,
    },
    {
      id: IDS.ACT_CODE_WS2,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      locationId: IDS.LOCATION_MAIN,
      code: 'QRST-UVWX-YZ01-2345',
      type: 'WORKSTATION',
      status: 'USED',
      usedAt: SIX_MONTHS_AGO,
      usedByActivationId: IDS.WS_ACTIVATION_SECUNDARIA,
      expiresAt: ONE_YEAR_FROM_NOW,
      createdAt: SIX_MONTHS_AGO,
    },
    {
      id: IDS.ACT_CODE_UNUSED,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      locationId: IDS.LOCATION_MAIN,
      code: 'UNUS-EDCO-DEAB-CDEF',
      type: 'WORKSTATION',
      status: 'UNUSED',
      usedAt: null,
      usedByActivationId: null,
      expiresAt: ONE_YEAR_FROM_NOW,
      createdAt: SIX_MONTHS_AGO,
    },
  ];
  await prisma.activationCode.createMany({ data: activationCodes, skipDuplicates: true });
  console.log('   3 activation codes');

  // ---- Workstation activations ----
  const workstationActivations = [
    {
      id: IDS.WS_ACTIVATION_PRINCIPAL,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      locationId: IDS.LOCATION_MAIN,
      hardwareFingerprint: 'hw-fp-principal-001',
      workstationName: 'Caja Principal',
      activationCodeId: IDS.ACT_CODE_WS1,
      isActive: true,
      activatedAt: SIX_MONTHS_AGO,
      revokedAt: null,
      revokedReason: null,
      lastCheckInAt: NOW,
      lastCheckInIp: '192.168.1.100',
      initialActivationIp: '192.168.1.100',
      checkInCount: 25,
      createdAt: SIX_MONTHS_AGO,
      updatedAt: NOW,
    },
    {
      id: IDS.WS_ACTIVATION_SECUNDARIA,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      locationId: IDS.LOCATION_MAIN,
      hardwareFingerprint: 'hw-fp-secundaria-002',
      workstationName: 'Caja Secundaria',
      activationCodeId: IDS.ACT_CODE_WS2,
      isActive: true,
      activatedAt: SIX_MONTHS_AGO,
      revokedAt: null,
      revokedReason: null,
      lastCheckInAt: YESTERDAY,
      lastCheckInIp: '192.168.1.101',
      initialActivationIp: '192.168.1.101',
      checkInCount: 18,
      createdAt: SIX_MONTHS_AGO,
      updatedAt: YESTERDAY,
    },
  ];
  await prisma.workstationActivation.createMany({ data: workstationActivations, skipDuplicates: true });
  console.log('   2 workstation activations');

  // ---- License check-ins ----
  const checkIns = [
    {
      id: IDS.CHECKIN_001,
      workstationActivationId: IDS.WS_ACTIVATION_PRINCIPAL,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      ipAddress: '192.168.1.100',
      userAgent: 'PharmacyPOS/1.0',
      hardwareFingerprint: 'hw-fp-principal-001',
      tokenExpiresAt: ONE_YEAR_FROM_NOW,
      checkedInAt: NOW,
    },
    {
      id: IDS.CHECKIN_002,
      workstationActivationId: IDS.WS_ACTIVATION_PRINCIPAL,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      ipAddress: '192.168.1.100',
      userAgent: 'PharmacyPOS/1.0',
      hardwareFingerprint: 'hw-fp-principal-001',
      tokenExpiresAt: ONE_YEAR_FROM_NOW,
      checkedInAt: TWO_DAYS_AGO,
    },
    {
      id: IDS.CHECKIN_003,
      workstationActivationId: IDS.WS_ACTIVATION_SECUNDARIA,
      subscriptionId: IDS.SUBSCRIPTION_DEFAULT,
      ipAddress: '192.168.1.101',
      userAgent: 'PharmacyPOS/1.0',
      hardwareFingerprint: 'hw-fp-secundaria-002',
      tokenExpiresAt: ONE_YEAR_FROM_NOW,
      checkedInAt: YESTERDAY,
    },
  ];
  await prisma.licenseCheckIn.createMany({ data: checkIns, skipDuplicates: true });
  console.log('   3 license check-ins');
}
