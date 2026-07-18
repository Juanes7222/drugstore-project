import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { NOW, TWO_YEARS_FROM_NOW } from '../constants/dates';

/**
 * Seeds DIAN fiscal configuration: issuer data, tech provider, resolutions, allocations.
 * Required before any fiscal document can be generated.
 */

async function seedFiscalIssuer(): Promise<void> {
  await prisma.fiscalIssuerConfig.upsert({
    where: { id: IDS.FISCAL_ISSUER },
    update: {},
    create: {
      id: IDS.FISCAL_ISSUER,
      nit: '900123456-7',
      verificationDigit: '7',
      businessName: 'Droguería Farmacia Central S.A.S.',
      commercialName: 'Farmacia Central',
      organizationType: '1', // Persona jurídica
      taxRegime: '48', // Régimen simple de tributación — COMÚN
      taxResponsibilities: '[[ "R-99-PN", "Facturación" ], [ "R-00", "No responsable de IVA" ]]',
      address: 'Carrera 15 # 88-16',
      municipality: 'Bogotá D.C.',
      department: 'Cundinamarca',
      postalCode: '110221',
      phone: '6017450001',
      email: 'facturacion@farmaciacentral.com.co',
    },
  });
}

async function seedTechProvider(): Promise<void> {
  await prisma.techProviderConfig.upsert({
    where: { id: IDS.TECH_PROVIDER },
    update: {},
    create: {
      id: IDS.TECH_PROVIDER,
      endpointUrl: 'https://vpfe-hab-dian-v2-0-1-2.pymedigital.com/v1/',
      environment: 'TEST',
      timeoutSeconds: 30,
      credentialReference: 'vault://dian/tech-provider-creds',
    },
  });
}

async function seedResolutions(): Promise<void> {
  // Invoice resolution — 2-year validity, 1000-number range
  await prisma.fiscalResolution.upsert({
    where: { id: IDS.RESOLUTION_INVOICE },
    update: {},
    create: {
      id: IDS.RESOLUTION_INVOICE,
      resolutionNumber: 'RES-2025-001',
      documentType: 'INVOICE',
      prefix: 'FC',
      rangeFrom: 1,
      rangeTo: 1000,
      validFrom: new Date('2025-01-01'),
      validTo: new Date('2026-12-31'),
      state: 'ACTIVE',
      currentConsecutive: 0,
    },
  });

  // POS ticket resolution — for expedited POS receipts
  await prisma.fiscalResolution.upsert({
    where: { id: IDS.RESOLUTION_POS },
    update: {},
    create: {
      id: IDS.RESOLUTION_POS,
      resolutionNumber: 'RES-2025-002',
      documentType: 'POS_TICKET',
      prefix: 'PT',
      rangeFrom: 1,
      rangeTo: 5000,
      validFrom: new Date('2025-01-01'),
      validTo: new Date('2026-12-31'),
      state: 'ACTIVE',
      currentConsecutive: 0,
    },
  });
}

async function seedAllocations(): Promise<void> {
  // Workstation 1 — invoice allocation (half the range)
  await prisma.fiscalResolutionAllocation.upsert({
    where: { id: IDS.ALLOC_INVOICE_WS1 },
    update: {},
    create: {
      id: IDS.ALLOC_INVOICE_WS1,
      resolutionId: IDS.RESOLUTION_INVOICE,
      workstationId: IDS.WS_PRINCIPAL,
      rangeFrom: 1,
      rangeTo: 500,
      currentConsecutive: 0,
      allocatedAt: new Date('2025-01-01'),
      allocatedByUserId: IDS.USER_ADMIN,
    },
  });

  // Workstation 1 — POS ticket allocation
  await prisma.fiscalResolutionAllocation.upsert({
    where: { id: IDS.ALLOC_POS_WS1 },
    update: {},
    create: {
      id: IDS.ALLOC_POS_WS1,
      resolutionId: IDS.RESOLUTION_POS,
      workstationId: IDS.WS_PRINCIPAL,
      rangeFrom: 1,
      rangeTo: 2500,
      currentConsecutive: 0,
      allocatedAt: new Date('2025-01-01'),
      allocatedByUserId: IDS.USER_ADMIN,
    },
  });

  // Workstation 2 — invoice allocation (remaining half)
  await prisma.fiscalResolutionAllocation.upsert({
    where: { id: IDS.ALLOC_INVOICE_WS2 },
    update: {},
    create: {
      id: IDS.ALLOC_INVOICE_WS2,
      resolutionId: IDS.RESOLUTION_INVOICE,
      workstationId: IDS.WS_SECUNDARIA,
      rangeFrom: 501,
      rangeTo: 1000,
      currentConsecutive: 0,
      allocatedAt: new Date('2025-01-01'),
      allocatedByUserId: IDS.USER_ADMIN,
    },
  });
}

export async function seedFiscalConfig(): Promise<void> {
  console.log('Seeding fiscal DIAN configuration...');
  await seedFiscalIssuer();
  await seedTechProvider();
  await seedResolutions();
  await seedAllocations();
  console.log('   Issuer, tech provider, 2 resolutions, 3 allocations');
}
