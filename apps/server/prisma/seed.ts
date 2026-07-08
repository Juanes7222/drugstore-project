/**
 * Development seed script for pharmacy-system.
 *
 * Creates realistic Colombian pharmacy test data including:
 * - Reference data (categories, forms, tax schemes, payment methods)
 * - Users with different roles and hashed passwords
 * - Workstations (POS terminals)
 * - Products with prices, tax histories, and barcodes
 * - Suppliers (Colombian pharmaceutical distributors)
 * - Clients with classifications
 * - Inventory lots with stock
 * - Sample cash shifts
 *
 * Usage: npx tsx prisma/seed.ts
 * Requires: DATABASE_URL environment variable pointing to a running PostgreSQL.
 *           Run `docker compose -f docker-compose.dev.yml up -d` first.
 *
 * Idempotent: safe to run multiple times (uses upsert / delete-then-create).
 */

import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@pharmacy/database';
import * as argon2 from 'argon2';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL environment variable is not set.');
  console.error('Make sure a .env file exists in apps/server/ with DATABASE_URL defined.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Deterministic ULID-like IDs for predictable seed references.
// Format: cat_xxxxx, prod_xxxxx, etc. — easier to spot in logs than raw UUIDs.
// ---------------------------------------------------------------------------

const ID = {
  // Categories
  CAT_ANALGESICOS: 'cat_analgesicos',
  CAT_ANTIBIOTICOS: 'cat_antibioticos',
  CAT_ANTIINFLAMATORIOS: 'cat_antiinflamatorios',
  CAT_ANTIHISTAMINICOS: 'cat_antihistaminicos',
  CAT_CARDIOVASCULAR: 'cat_cardiovascular',
  CAT_GASTROINTESTINAL: 'cat_gastrointestinal',
  CAT_RESPIRATORIO: 'cat_respiratorio',
  CAT_VITAMINAS: 'cat_vitaminas',
  CAT_CUIDADO_PERSONAL: 'cat_cuidado_personal',
  CAT_MATERIAL_CURACION: 'cat_material_curacion',

  // Pharmaceutical Forms
  FORM_TABLETA: 'form_tableta',
  FORM_CAPSULA: 'form_capsula',
  FORM_JARABE: 'form_jarabe',
  FORM_INYECTABLE: 'form_inyectable',
  FORM_CREMA: 'form_crema',
  FORM_OVULO: 'form_ovulo',
  FORM_GOTAS: 'form_gotas',
  FORM_SOBRE: 'form_sobre',
  FORM_SPRAY: 'form_spray',

  // Tax Schemes
  TAX_IVA_19: 'tax_iva_19',
  TAX_IVA_5: 'tax_iva_5',
  TAX_EXENTO: 'tax_exento',

  // Payment Methods
  PAY_EFECTIVO: 'pay_efectivo',
  PAY_TARJETA_DEBITO: 'pay_tarjeta_debito',
  PAY_TARJETA_CREDITO: 'pay_tarjeta_credito',
  PAY_TRANSFERENCIA: 'pay_transferencia',
  PAY_BOTON_PSE: 'pay_boton_pse',
  PAY_NEQUI: 'pay_nequi',
  PAY_DAVIPLATA: 'pay_daviplata',

  // Client Classifications
  CLASS_PARTICULAR: 'class_particular',
  CLASS_FRECUENTE: 'class_frecuente',
  CLASS_INSTITUCIONAL: 'class_institucional',

  // Workstations
  WS_PRINCIPAL: 'ws_principal',
  WS_SECUNDARIA: 'ws_secundaria',

  // Users
  USER_ADMIN: 'user_admin',
  USER_CASHIER1: 'user_cashier1',
  USER_CASHIER2: 'user_cashier2',
  USER_INVENTORY: 'user_inventory',
  USER_ACCOUNTANT: 'user_accountant',

  // Suppliers
  SUP_DISFARMA: 'sup_disfarma',
  SUP_COLVAN: 'sup_colvan',
  SUP_CRUZ_VERDE: 'sup_cruz_verde',

  // Clients
  CLIENT_JUAN: 'client_juan',
  CLIENT_MARIA: 'client_maria',
  CLIENT_CARLOS: 'client_carlos',
  CLIENT_ANDREA: 'client_andrea',
  CLIENT_PEDRO: 'client_pedro',
  CLIENT_LAURA: 'client_laura',
  CLIENT_DIEGO: 'client_diego',
  CLIENT_SOFIA: 'client_sofia',
  CLIENT_CLINICA_SAN_JOSE: 'client_clinica_san_jose',
  CLIENT_HOGAR_GERIATRICO: 'client_hogar_geriatrico',

  // Products
  PROD_ACETAMINOFEN_500: 'prod_acetaminofen_500',
  PROD_IBUPROFENO_400: 'prod_ibuprofeno_400',
  PROD_IBUPROFENO_800: 'prod_ibuprofeno_800',
  PROD_DICLOFENACO_50: 'prod_diclofenaco_50',
  PROD_NAPROXENO_250: 'prod_naproxeno_250',
  PROD_AMOXICILINA_500: 'prod_amoxicilina_500',
  PROD_AZITROMICINA_500: 'prod_azitromicina_500',
  PROD_CEFALEXINA_500: 'prod_cefalexina_500',
  PROD_COTRIMOXAZOL: 'prod_cotrimoxazol',
  PROD_LORATADINA_10: 'prod_loratadina_10',
  PROD_CETIRIZINA_10: 'prod_cetirizina_10',
  PROD_DESLORATADINA_5: 'prod_desloratadina_5',
  PROD_LOSARTAN_50: 'prod_losartan_50',
  PROD_ENALAPRIL_10: 'prod_enalapril_10',
  PROD_OMEPRAZOL_20: 'prod_omeprazol_20',
  PROD_ESOMEPRAZOL_40: 'prod_esomeprazol_40',
  PROD_RANITIDINA_150: 'prod_ranitidina_150',
  PROD_SALBUTAMOL_100: 'prod_salbutamol_100',
  PROD_DOLEX_FORTE: 'prod_dolex_forte',
  PROD_VITAMINA_C_500: 'prod_vitamina_c_500',
  PROD_ALCOHOL_70: 'prod_alcohol_70',
  PROD_GUANTES_LATEX_M: 'prod_guantes_latex_m',
  PROD_JERINGA_3ML: 'prod_jeringa_3ml',
  PROD_BAJALENGUAS: 'prod_bajalenguas',
  PROD_GASA_ESTERIL: 'prod_gasa_esteril',

  // Product Price Histories
  PRICE_ACET_500: 'price_acet_500',
  PRICE_IBU_400: 'price_ibu_400',
  PRICE_IBU_800: 'price_ibu_800',
  PRICE_DIC_50: 'price_dic_50',
  PRICE_NAP_250: 'price_nap_250',
  PRICE_AMOX_500: 'price_amox_500',
  PRICE_AZIT_500: 'price_azit_500',
  PRICE_CEF_500: 'price_cef_500',
  PRICE_COTRI: 'price_cotri',
  PRICE_LORAT_10: 'price_lorat_10',
  PRICE_CET_10: 'price_cet_10',
  PRICE_DESL_5: 'price_desl_5',
  PRICE_LOS_50: 'price_los_50',
  PRICE_ENAL_10: 'price_enal_10',
  PRICE_OME_20: 'price_ome_20',
  PRICE_ESO_40: 'price_eso_40',
  PRICE_RAN_150: 'price_ran_150',
  PRICE_SALB_100: 'price_salb_100',
  PRICE_DOLEX: 'price_dolex',
  PRICE_VITC_500: 'price_vitc_500',
  PRICE_ALCOHOL: 'price_alcohol',
  PRICE_GUANTES: 'price_guantes',
  PRICE_JERINGA: 'price_jeringa',
  PRICE_BAJA: 'price_baja',
  PRICE_GASA: 'price_gasa',

  // Tax Histories
  TAXH_ACET_500: 'taxh_acet_500',
  TAXH_IBU_400: 'taxh_ibu_400',
  TAXH_IBU_800: 'taxh_ibu_800',
  TAXH_DIC_50: 'taxh_dic_50',
  TAXH_NAP_250: 'taxh_nap_250',
  TAXH_AMOX_500: 'taxh_amox_500',
  TAXH_AZIT_500: 'taxh_azit_500',
  TAXH_CEF_500: 'taxh_cef_500',
  TAXH_COTRI: 'taxh_cotri',
  TAXH_LORAT_10: 'taxh_lorat_10',
  TAXH_CET_10: 'taxh_cet_10',
  TAXH_DESL_5: 'taxh_desl_5',
  TAXH_LOS_50: 'taxh_los_50',
  TAXH_ENAL_10: 'taxh_enal_10',
  TAXH_OME_20: 'taxh_ome_20',
  TAXH_ESO_40: 'taxh_eso_40',
  TAXH_RAN_150: 'taxh_ran_150',
  TAXH_SALB_100: 'taxh_salb_100',
  TAXH_DOLEX: 'taxh_dolex',
  TAXH_VITC_500: 'taxh_vitc_500',
  TAXH_ALCOHOL: 'taxh_alcohol',
  TAXH_GUANTES: 'taxh_guantes',
  TAXH_JERINGA: 'taxh_jeringa',
  TAXH_BAJA: 'taxh_baja',
  TAXH_GASA: 'taxh_gasa',

  // Lots
  LOT_ACET_001: 'lot_acet_001',
  LOT_IBU_001: 'lot_ibu_001',
  LOT_IBU_002: 'lot_ibu_002',
  LOT_DIC_001: 'lot_dic_001',
  LOT_NAP_001: 'lot_nap_001',
  LOT_AMOX_001: 'lot_amox_001',
  LOT_AZIT_001: 'lot_azit_001',
  LOT_CEF_001: 'lot_cef_001',
  LOT_COTRI_001: 'lot_cotri_001',
  LOT_LORAT_001: 'lot_lorat_001',
  LOT_CET_001: 'lot_cet_001',
  LOT_DESL_001: 'lot_desl_001',
  LOT_LOS_001: 'lot_los_001',
  LOT_ENAL_001: 'lot_enal_001',
  LOT_OME_001: 'lot_ome_001',
  LOT_ESO_001: 'lot_eso_001',
  LOT_RAN_001: 'lot_ran_001',
  LOT_SALB_001: 'lot_salb_001',
  LOT_DOLEX_001: 'lot_dolex_001',
  LOT_VITC_001: 'lot_vitc_001',
  LOT_ALCOHOL_001: 'lot_alcohol_001',
  LOT_GUANTES_001: 'lot_guantes_001',
  LOT_JERINGA_001: 'lot_jeringa_001',
  LOT_BAJA_001: 'lot_baja_001',
  LOT_GASA_001: 'lot_gasa_001',

  // Cash Shifts
  SHIFT_OPEN: 'shift_open',
  SHIFT_CLOSED_YESTERDAY: 'shift_closed_yesterday',
};

// ---------------------------------------------------------------------------
// Helper: reusable dates
// ---------------------------------------------------------------------------
const NOW = new Date();
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const TWO_YEARS_FROM_NOW = new Date(NOW.getFullYear() + 2, NOW.getMonth(), NOW.getDate());
const ONE_MONTH_AGO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
const SIX_MONTHS_AGO = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('🌱 Starting pharmacy-system seed...\n');

  await seedReferenceData();
  await seedWorkstations();
  await seedUsers();
  await seedProducts();
  await seedSuppliers();
  await seedClients();
  await seedInventoryLots();
  await seedCashShifts();

  console.log('\n✅ Seed completed successfully!');
  console.log('   Login: admin / Admin123!  (role: ADMIN)');
  console.log('   Login: cashier1 / Cashier123!  (role: CASHIER)');
  console.log('   Login: inventory / Inventory123!  (role: INVENTORY_ASSISTANT)');
}

// ---------------------------------------------------------------------------
// 1. Reference data
// ---------------------------------------------------------------------------
async function seedReferenceData(): Promise<void> {
  console.log('📦 Seeding reference data...');

  const categories = [
    { id: ID.CAT_ANALGESICOS, name: 'ANALGÉSICOS', sortOrder: 1 },
    { id: ID.CAT_ANTIBIOTICOS, name: 'ANTIBIÓTICOS', sortOrder: 2 },
    { id: ID.CAT_ANTIINFLAMATORIOS, name: 'ANTIINFLAMATORIOS', sortOrder: 3 },
    { id: ID.CAT_ANTIHISTAMINICOS, name: 'ANTIHISTAMÍNICOS', sortOrder: 4 },
    { id: ID.CAT_CARDIOVASCULAR, name: 'CARDIOVASCULAR', sortOrder: 5 },
    { id: ID.CAT_GASTROINTESTINAL, name: 'GASTROINTESTINAL', sortOrder: 6 },
    { id: ID.CAT_RESPIRATORIO, name: 'RESPIRATORIO', sortOrder: 7 },
    { id: ID.CAT_VITAMINAS, name: 'VITAMINAS Y SUPLEMENTOS', sortOrder: 8 },
    { id: ID.CAT_CUIDADO_PERSONAL, name: 'CUIDADO PERSONAL', sortOrder: 9 },
    { id: ID.CAT_MATERIAL_CURACION, name: 'MATERIAL DE CURACIÓN', sortOrder: 10 },
  ];

  for (const c of categories) {
    await prisma.category.upsert({
      where: { id: c.id },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: c,
    });
  }

  const forms = [
    { id: ID.FORM_TABLETA, name: 'TABLETA', sortOrder: 1 },
    { id: ID.FORM_CAPSULA, name: 'CÁPSULA', sortOrder: 2 },
    { id: ID.FORM_JARABE, name: 'JARABE', sortOrder: 3 },
    { id: ID.FORM_INYECTABLE, name: 'INYECTABLE', sortOrder: 4 },
    { id: ID.FORM_CREMA, name: 'CREMA', sortOrder: 5 },
    { id: ID.FORM_OVULO, name: 'ÓVULO', sortOrder: 6 },
    { id: ID.FORM_GOTAS, name: 'GOTAS', sortOrder: 7 },
    { id: ID.FORM_SOBRE, name: 'SOBRE', sortOrder: 8 },
    { id: ID.FORM_SPRAY, name: 'SPRAY', sortOrder: 9 },
  ];

  for (const f of forms) {
    await prisma.pharmaceuticalForm.upsert({
      where: { id: f.id },
      update: { name: f.name, sortOrder: f.sortOrder },
      create: f,
    });
  }

  const now = new Date('2025-01-01');
  const taxSchemes = [
    { id: ID.TAX_IVA_19, code: 'IVA-19', name: 'IVA 19%', taxType: 'IVA' as const, rate: '19.0000', effectiveFrom: now, createdById: ID.USER_ADMIN },
    { id: ID.TAX_IVA_5, code: 'IVA-5', name: 'IVA 5%', taxType: 'IVA' as const, rate: '5.0000', effectiveFrom: now, createdById: ID.USER_ADMIN },
    { id: ID.TAX_EXENTO, code: 'EXENTO', name: 'Exento de IVA', taxType: 'EXENTO' as const, rate: '0.0000', effectiveFrom: now, createdById: ID.USER_ADMIN },
  ];

  for (const t of taxSchemes) {
    await prisma.taxScheme.upsert({
      where: { id: t.id },
      update: { code: t.code, name: t.name, taxType: t.taxType, rate: t.rate },
      create: t,
    });
  }

  const paymentMethods = [
    { id: ID.PAY_EFECTIVO, internalCode: 'PM001', name: 'Efectivo', category: 'CASH' as const, isCash: true, sortOrder: 1 },
    { id: ID.PAY_TARJETA_DEBITO, internalCode: 'PM002', name: 'Tarjeta Débito', dianCode: '1', category: 'DEBIT_CARD' as const, sortOrder: 2 },
    { id: ID.PAY_TARJETA_CREDITO, internalCode: 'PM003', name: 'Tarjeta Crédito', dianCode: '2', category: 'CREDIT_CARD' as const, sortOrder: 3 },
    { id: ID.PAY_TRANSFERENCIA, internalCode: 'PM004', name: 'Transferencia Bancaria', dianCode: '3', category: 'BANK_TRANSFER' as const, sortOrder: 4 },
    { id: ID.PAY_BOTON_PSE, internalCode: 'PM005', name: 'Botón PSE', dianCode: '49', category: 'DIGITAL_WALLET' as const, sortOrder: 5 },
    { id: ID.PAY_NEQUI, internalCode: 'PM006', name: 'Nequi', dianCode: '102', category: 'DIGITAL_WALLET' as const, sortOrder: 6 },
    { id: ID.PAY_DAVIPLATA, internalCode: 'PM007', name: 'Daviplata', dianCode: '103', category: 'DIGITAL_WALLET' as const, sortOrder: 7 },
  ];

  for (const pm of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { id: pm.id },
      update: { name: pm.name, category: pm.category, sortOrder: pm.sortOrder },
      create: pm,
    });
  }

  const classifications = [
    { id: ID.CLASS_PARTICULAR, type: 'PARTICULAR' as const, discountPercentage: '0.00', sortOrder: 1 },
    { id: ID.CLASS_FRECUENTE, type: 'FRECUENTE' as const, discountPercentage: '5.00', sortOrder: 2 },
    { id: ID.CLASS_INSTITUCIONAL, type: 'INSTITUTIONAL' as const, discountPercentage: '10.00', sortOrder: 3 },
  ];

  for (const cl of classifications) {
    await prisma.clientClassification.upsert({
      where: { id: cl.id },
      update: { type: cl.type, discountPercentage: cl.discountPercentage },
      create: cl,
    });
  }

  console.log('   ✅ Categories, forms, tax schemes, payment methods, client classifications');
}

// ---------------------------------------------------------------------------
// 2. Workstations
// ---------------------------------------------------------------------------
async function seedWorkstations(): Promise<void> {
  console.log('🖥️  Seeding workstations...');

  const workstations = [
    { id: ID.WS_PRINCIPAL, name: 'Caja Principal', code: 'WS-001', registeredAt: SIX_MONTHS_AGO, lastSeenAt: NOW },
    { id: ID.WS_SECUNDARIA, name: 'Caja Secundaria', code: 'WS-002', registeredAt: SIX_MONTHS_AGO, lastSeenAt: YESTERDAY },
  ];

  for (const ws of workstations) {
    await prisma.workstation.upsert({
      where: { id: ws.id },
      update: { name: ws.name, lastSeenAt: ws.lastSeenAt },
      create: ws,
    });
  }

  console.log('   ✅ 2 workstations');
}

// ---------------------------------------------------------------------------
// 3. Users
// ---------------------------------------------------------------------------
async function seedUsers(): Promise<void> {
  console.log('👤 Seeding users...');

  const hashAdmin = await argon2.hash('Admin123!', { type: argon2.argon2id });
  const hashCashier = await argon2.hash('Cashier123!', { type: argon2.argon2id });
  const hashInventory = await argon2.hash('Inventory123!', { type: argon2.argon2id });
  const hashAccountant = await argon2.hash('Accountant123!', { type: argon2.argon2id });

  const users = [
    { id: ID.USER_ADMIN, username: 'admin', fullName: 'Administrador del Sistema', email: 'admin@pharmacy.local', passwordHash: hashAdmin, role: 'ADMIN' as const },
    { id: ID.USER_CASHIER1, username: 'cashier1', fullName: 'María Rodríguez', email: 'maria.rodriguez@pharmacy.local', passwordHash: hashCashier, role: 'CASHIER' as const },
    { id: ID.USER_CASHIER2, username: 'cashier2', fullName: 'Carlos Méndez', email: 'carlos.mendez@pharmacy.local', passwordHash: hashCashier, role: 'CASHIER' as const },
    { id: ID.USER_INVENTORY, username: 'inventory', fullName: 'Luisa García', email: 'luisa.garcia@pharmacy.local', passwordHash: hashInventory, role: 'INVENTORY_ASSISTANT' as const },
    { id: ID.USER_ACCOUNTANT, username: 'accountant', fullName: 'Pedro Contreras', email: 'pedro.contreras@pharmacy.local', passwordHash: hashAccountant, role: 'ACCOUNTANT' as const },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { fullName: u.fullName, passwordHash: u.passwordHash },
      create: {
        ...u,
        passwordAlgorithm: 'argon2id',
        createdById: null,
      },
    });
  }

  console.log('   ✅ 5 users (admin, cashier1, cashier2, inventory, accountant)');
}

// ---------------------------------------------------------------------------
// 4. Products (with prices, tax histories, and barcodes)
// ---------------------------------------------------------------------------
async function seedProducts(): Promise<void> {
  console.log('💊 Seeding products...');

  const commonPriceTimestamp = new Date('2025-06-01');

  interface SeedProduct {
    id: string;
    internalCode: string;
    commercialName: string;
    genericName: string;
    activePrinciple: string;
    concentration: string;
    concentrationUnit: string;
    laboratory: string;
    saleType: 'FREE_SALE' | 'PRESCRIPTION';
    minimumStock: number;
    categoryId: string;
    pharmaceuticalFormId: string;
    invimaRegistry: string | null;
    price: string;
    priceHistoryId: string;
    taxHistoryId: string;
    taxSchemeId: string;
    barcode: string;
    barcodeType: 'EAN13';
    barcodeId: string;
  }

  const products: SeedProduct[] = [
    { id: ID.PROD_ACETAMINOFEN_500, internalCode: 'P001', commercialName: 'Acetaminofén 500mg', genericName: 'Acetaminofén', activePrinciple: 'Acetaminofén', concentration: '500', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 50, categoryId: ID.CAT_ANALGESICOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2012M-001234', price: '3500.00', priceHistoryId: ID.PRICE_ACET_500, taxHistoryId: ID.TAXH_ACET_500, taxSchemeId: ID.TAX_IVA_5, barcode: '7702001012345', barcodeType: 'EAN13', barcodeId: 'bc_acet_500' },
    { id: ID.PROD_IBUPROFENO_400, internalCode: 'P002', commercialName: 'Ibuprofeno 400mg', genericName: 'Ibuprofeno', activePrinciple: 'Ibuprofeno', concentration: '400', concentrationUnit: 'mg', laboratory: 'La Santé', saleType: 'FREE_SALE', minimumStock: 40, categoryId: ID.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2015M-002345', price: '2800.00', priceHistoryId: ID.PRICE_IBU_400, taxHistoryId: ID.TAXH_IBU_400, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012346', barcodeType: 'EAN13', barcodeId: 'bc_ibu_400' },
    { id: ID.PROD_IBUPROFENO_800, internalCode: 'P003', commercialName: 'Ibuprofeno 800mg', genericName: 'Ibuprofeno', activePrinciple: 'Ibuprofeno', concentration: '800', concentrationUnit: 'mg', laboratory: 'La Santé', saleType: 'PRESCRIPTION', minimumStock: 30, categoryId: ID.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2015M-002346', price: '5200.00', priceHistoryId: ID.PRICE_IBU_800, taxHistoryId: ID.TAXH_IBU_800, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012353', barcodeType: 'EAN13', barcodeId: 'bc_ibu_800' },
    { id: ID.PROD_DICLOFENACO_50, internalCode: 'P004', commercialName: 'Diclofenaco Sódico 50mg', genericName: 'Diclofenaco', activePrinciple: 'Diclofenaco Sódico', concentration: '50', concentrationUnit: 'mg', laboratory: 'MK', saleType: 'FREE_SALE', minimumStock: 35, categoryId: ID.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2013M-003456', price: '2100.00', priceHistoryId: ID.PRICE_DIC_50, taxHistoryId: ID.TAXH_DIC_50, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012360', barcodeType: 'EAN13', barcodeId: 'bc_dic_50' },
    { id: ID.PROD_NAPROXENO_250, internalCode: 'P005', commercialName: 'Naproxeno Sódico 250mg', genericName: 'Naproxeno', activePrinciple: 'Naproxeno Sódico', concentration: '250', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 30, categoryId: ID.CAT_ANTIINFLAMATORIOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2014M-004567', price: '4100.00', priceHistoryId: ID.PRICE_NAP_250, taxHistoryId: ID.TAXH_NAP_250, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012377', barcodeType: 'EAN13', barcodeId: 'bc_nap_250' },
    { id: ID.PROD_AMOXICILINA_500, internalCode: 'P006', commercialName: 'Amoxicilina 500mg', genericName: 'Amoxicilina', activePrinciple: 'Amoxicilina Trihidrato', concentration: '500', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'PRESCRIPTION', minimumStock: 60, categoryId: ID.CAT_ANTIBIOTICOS, pharmaceuticalFormId: ID.FORM_CAPSULA, invimaRegistry: 'INVIMA-2011M-005678', price: '1800.00', priceHistoryId: ID.PRICE_AMOX_500, taxHistoryId: ID.TAXH_AMOX_500, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012384', barcodeType: 'EAN13', barcodeId: 'bc_amox_500' },
    { id: ID.PROD_AZITROMICINA_500, internalCode: 'P007', commercialName: 'Azitromicina 500mg', genericName: 'Azitromicina', activePrinciple: 'Azitromicina Dihidrato', concentration: '500', concentrationUnit: 'mg', laboratory: 'Pfizer', saleType: 'PRESCRIPTION', minimumStock: 25, categoryId: ID.CAT_ANTIBIOTICOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2013M-006789', price: '12500.00', priceHistoryId: ID.PRICE_AZIT_500, taxHistoryId: ID.TAXH_AZIT_500, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012391', barcodeType: 'EAN13', barcodeId: 'bc_azit_500' },
    { id: ID.PROD_CEFALEXINA_500, internalCode: 'P008', commercialName: 'Cefalexina 500mg', genericName: 'Cefalexina', activePrinciple: 'Cefalexina Monohidrato', concentration: '500', concentrationUnit: 'mg', laboratory: 'MK', saleType: 'PRESCRIPTION', minimumStock: 25, categoryId: ID.CAT_ANTIBIOTICOS, pharmaceuticalFormId: ID.FORM_CAPSULA, invimaRegistry: 'INVIMA-2012M-007890', price: '3400.00', priceHistoryId: ID.PRICE_CEF_500, taxHistoryId: ID.TAXH_CEF_500, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012407', barcodeType: 'EAN13', barcodeId: 'bc_cef_500' },
    { id: ID.PROD_COTRIMOXAZOL, internalCode: 'P009', commercialName: 'Cotrimoxazol Forte', genericName: 'Trimetoprim + Sulfametoxazol', activePrinciple: 'Trimetoprim + Sulfametoxazol', concentration: '160+800', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'PRESCRIPTION', minimumStock: 20, categoryId: ID.CAT_ANTIBIOTICOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2014M-008901', price: '2600.00', priceHistoryId: ID.PRICE_COTRI, taxHistoryId: ID.TAXH_COTRI, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012414', barcodeType: 'EAN13', barcodeId: 'bc_cotri' },
    { id: ID.PROD_LORATADINA_10, internalCode: 'P010', commercialName: 'Loratadina 10mg', genericName: 'Loratadina', activePrinciple: 'Loratadina', concentration: '10', concentrationUnit: 'mg', laboratory: 'Bayer', saleType: 'FREE_SALE', minimumStock: 40, categoryId: ID.CAT_ANTIHISTAMINICOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-009012', price: '4500.00', priceHistoryId: ID.PRICE_LORAT_10, taxHistoryId: ID.TAXH_LORAT_10, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012421', barcodeType: 'EAN13', barcodeId: 'bc_lorat_10' },
    { id: ID.PROD_CETIRIZINA_10, internalCode: 'P011', commercialName: 'Cetirizina 10mg', genericName: 'Cetirizina', activePrinciple: 'Cetirizina Diclorhidrato', concentration: '10', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 35, categoryId: ID.CAT_ANTIHISTAMINICOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2011M-010123', price: '3200.00', priceHistoryId: ID.PRICE_CET_10, taxHistoryId: ID.TAXH_CET_10, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012438', barcodeType: 'EAN13', barcodeId: 'bc_cet_10' },
    { id: ID.PROD_DESLORATADINA_5, internalCode: 'P012', commercialName: 'Desloratadina 5mg', genericName: 'Desloratadina', activePrinciple: 'Desloratadina', concentration: '5', concentrationUnit: 'mg', laboratory: 'Bayer', saleType: 'FREE_SALE', minimumStock: 25, categoryId: ID.CAT_ANTIHISTAMINICOS, pharmaceuticalFormId: ID.FORM_JARABE, invimaRegistry: 'INVIMA-2012M-011234', price: '15000.00', priceHistoryId: ID.PRICE_DESL_5, taxHistoryId: ID.TAXH_DESL_5, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012445', barcodeType: 'EAN13', barcodeId: 'bc_desl_5' },
    { id: ID.PROD_LOSARTAN_50, internalCode: 'P013', commercialName: 'Losartán 50mg', genericName: 'Losartán Potásico', activePrinciple: 'Losartán Potásico', concentration: '50', concentrationUnit: 'mg', laboratory: 'Tecnoquímicas', saleType: 'PRESCRIPTION', minimumStock: 50, categoryId: ID.CAT_CARDIOVASCULAR, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-012345', price: '6800.00', priceHistoryId: ID.PRICE_LOS_50, taxHistoryId: ID.TAXH_LOS_50, taxSchemeId: ID.TAX_IVA_5, barcode: '7702002012452', barcodeType: 'EAN13', barcodeId: 'bc_los_50' },
    { id: ID.PROD_ENALAPRIL_10, internalCode: 'P014', commercialName: 'Enalapril 10mg', genericName: 'Enalapril Maleato', activePrinciple: 'Enalapril Maleato', concentration: '10', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'PRESCRIPTION', minimumStock: 30, categoryId: ID.CAT_CARDIOVASCULAR, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-013456', price: '2900.00', priceHistoryId: ID.PRICE_ENAL_10, taxHistoryId: ID.TAXH_ENAL_10, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012469', barcodeType: 'EAN13', barcodeId: 'bc_enal_10' },
    { id: ID.PROD_OMEPRAZOL_20, internalCode: 'P015', commercialName: 'Omeprazol 20mg', genericName: 'Omeprazol', activePrinciple: 'Omeprazol', concentration: '20', concentrationUnit: 'mg', laboratory: 'La Santé', saleType: 'FREE_SALE', minimumStock: 60, categoryId: ID.CAT_GASTROINTESTINAL, pharmaceuticalFormId: ID.FORM_CAPSULA, invimaRegistry: 'INVIMA-2011M-014567', price: '2200.00', priceHistoryId: ID.PRICE_OME_20, taxHistoryId: ID.TAXH_OME_20, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012476', barcodeType: 'EAN13', barcodeId: 'bc_ome_20' },
    { id: ID.PROD_ESOMEPRAZOL_40, internalCode: 'P016', commercialName: 'Esomeprazol 40mg', genericName: 'Esomeprazol', activePrinciple: 'Esomeprazol Magnésico', concentration: '40', concentrationUnit: 'mg', laboratory: 'AstraZeneca', saleType: 'PRESCRIPTION', minimumStock: 20, categoryId: ID.CAT_GASTROINTESTINAL, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2013M-015678', price: '18500.00', priceHistoryId: ID.PRICE_ESO_40, taxHistoryId: ID.TAXH_ESO_40, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012483', barcodeType: 'EAN13', barcodeId: 'bc_eso_40' },
    { id: ID.PROD_RANITIDINA_150, internalCode: 'P017', commercialName: 'Ranitidina 150mg', genericName: 'Ranitidina', activePrinciple: 'Ranitidina Clorhidrato', concentration: '150', concentrationUnit: 'mg', laboratory: 'Genfar', saleType: 'FREE_SALE', minimumStock: 35, categoryId: ID.CAT_GASTROINTESTINAL, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2010M-016789', price: '1600.00', priceHistoryId: ID.PRICE_RAN_150, taxHistoryId: ID.TAXH_RAN_150, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012490', barcodeType: 'EAN13', barcodeId: 'bc_ran_150' },
    { id: ID.PROD_SALBUTAMOL_100, internalCode: 'P018', commercialName: 'Salbutamol 100mcg/inh', genericName: 'Salbutamol', activePrinciple: 'Salbutamol Sulfato', concentration: '100', concentrationUnit: 'mcg', laboratory: 'GSK', saleType: 'PRESCRIPTION', minimumStock: 15, categoryId: ID.CAT_RESPIRATORIO, pharmaceuticalFormId: ID.FORM_SPRAY, invimaRegistry: 'INVIMA-2011M-017890', price: '22000.00', priceHistoryId: ID.PRICE_SALB_100, taxHistoryId: ID.TAXH_SALB_100, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012506', barcodeType: 'EAN13', barcodeId: 'bc_salb_100' },
    { id: ID.PROD_DOLEX_FORTE, internalCode: 'P019', commercialName: 'Dolex Forte', genericName: 'Acetaminofén + Cafeína', activePrinciple: 'Acetaminofén + Cafeína', concentration: '500+65', concentrationUnit: 'mg', laboratory: 'GSK', saleType: 'FREE_SALE', minimumStock: 80, categoryId: ID.CAT_ANALGESICOS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2009M-018901', price: '5600.00', priceHistoryId: ID.PRICE_DOLEX, taxHistoryId: ID.TAXH_DOLEX, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012513', barcodeType: 'EAN13', barcodeId: 'bc_dolex' },
    { id: ID.PROD_VITAMINA_C_500, internalCode: 'P020', commercialName: 'Vitamina C 500mg', genericName: 'Ácido Ascórbico', activePrinciple: 'Ácido Ascórbico', concentration: '500', concentrationUnit: 'mg', laboratory: 'MK', saleType: 'FREE_SALE', minimumStock: 50, categoryId: ID.CAT_VITAMINAS, pharmaceuticalFormId: ID.FORM_TABLETA, invimaRegistry: 'INVIMA-2014M-019012', price: '2800.00', priceHistoryId: ID.PRICE_VITC_500, taxHistoryId: ID.TAXH_VITC_500, taxSchemeId: ID.TAX_EXENTO, barcode: '7702002012520', barcodeType: 'EAN13', barcodeId: 'bc_vitc_500' },
    { id: ID.PROD_ALCOHOL_70, internalCode: 'P021', commercialName: 'Alcohol Antiséptico 70%', genericName: 'Alcohol Etílico', activePrinciple: 'Alcohol Etílico', concentration: '70', concentrationUnit: '%', laboratory: 'JGB', saleType: 'FREE_SALE', minimumStock: 30, categoryId: ID.CAT_CUIDADO_PERSONAL, pharmaceuticalFormId: ID.FORM_CREMA, invimaRegistry: null, price: '8500.00', priceHistoryId: ID.PRICE_ALCOHOL, taxHistoryId: ID.TAXH_ALCOHOL, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012537', barcodeType: 'EAN13', barcodeId: 'bc_alcohol_70' },
    { id: ID.PROD_GUANTES_LATEX_M, internalCode: 'P022', commercialName: 'Guantes de Látex Talla M', genericName: 'Guantes de Látex', activePrinciple: 'Látex Natural', concentration: 'N/A', concentrationUnit: '', laboratory: 'Protec', saleType: 'FREE_SALE', minimumStock: 100, categoryId: ID.CAT_MATERIAL_CURACION, pharmaceuticalFormId: ID.FORM_INYECTABLE, invimaRegistry: null, price: '12000.00', priceHistoryId: ID.PRICE_GUANTES, taxHistoryId: ID.TAXH_GUANTES, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012544', barcodeType: 'EAN13', barcodeId: 'bc_guantes_m' },
    { id: ID.PROD_JERINGA_3ML, internalCode: 'P023', commercialName: 'Jeringa Desechable 3ml', genericName: 'Jeringa Desechable', activePrinciple: 'N/A', concentration: '3', concentrationUnit: 'ml', laboratory: 'BD', saleType: 'FREE_SALE', minimumStock: 200, categoryId: ID.CAT_MATERIAL_CURACION, pharmaceuticalFormId: ID.FORM_INYECTABLE, invimaRegistry: null, price: '800.00', priceHistoryId: ID.PRICE_JERINGA, taxHistoryId: ID.TAXH_JERINGA, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012551', barcodeType: 'EAN13', barcodeId: 'bc_jeringa_3ml' },
    { id: ID.PROD_BAJALENGUAS, internalCode: 'P024', commercialName: 'Bajalenguas de Madera x100', genericName: 'Bajalenguas', activePrinciple: 'N/A', concentration: 'N/A', concentrationUnit: '', laboratory: 'Genérico', saleType: 'FREE_SALE', minimumStock: 50, categoryId: ID.CAT_MATERIAL_CURACION, pharmaceuticalFormId: ID.FORM_INYECTABLE, invimaRegistry: null, price: '4500.00', priceHistoryId: ID.PRICE_BAJA, taxHistoryId: ID.TAXH_BAJA, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012568', barcodeType: 'EAN13', barcodeId: 'bc_bajalenguas' },
    { id: ID.PROD_GASA_ESTERIL, internalCode: 'P025', commercialName: 'Gasa Estéril 10x10cm x10', genericName: 'Gasa Estéril', activePrinciple: 'Algodón', concentration: 'N/A', concentrationUnit: '', laboratory: 'Protec', saleType: 'FREE_SALE', minimumStock: 40, categoryId: ID.CAT_MATERIAL_CURACION, pharmaceuticalFormId: ID.FORM_INYECTABLE, invimaRegistry: null, price: '6500.00', priceHistoryId: ID.PRICE_GASA, taxHistoryId: ID.TAXH_GASA, taxSchemeId: ID.TAX_IVA_19, barcode: '7702002012575', barcodeType: 'EAN13', barcodeId: 'bc_gasa' },
  ];

  for (const p of products) {
    // Upsert product
    await prisma.product.upsert({
      where: { id: p.id },
      update: {
        commercialName: p.commercialName,
        genericName: p.genericName,
        saleType: p.saleType,
        categoryId: p.categoryId,
        pharmaceuticalFormId: p.pharmaceuticalFormId,
      },
      create: {
        id: p.id,
        internalCode: p.internalCode,
        commercialName: p.commercialName,
        genericName: p.genericName,
        activePrinciple: p.activePrinciple,
        concentration: p.concentration,
        concentrationUnit: p.concentrationUnit,
        laboratory: p.laboratory,
        saleType: p.saleType,
        minimumStock: p.minimumStock,
        isActive: true,
        categoryId: p.categoryId,
        pharmaceuticalFormId: p.pharmaceuticalFormId,
        invimaRegistry: p.invimaRegistry,
        createdById: ID.USER_ADMIN,
      },
    });

    // Upsert price history
    await prisma.productPriceHistory.upsert({
      where: { id: p.priceHistoryId },
      update: { price: p.price },
      create: {
        id: p.priceHistoryId,
        productId: p.id,
        price: p.price,
        effectiveFrom: commonPriceTimestamp,
        changedById: ID.USER_ADMIN,
        changedAt: commonPriceTimestamp,
        changeReason: 'Precio inicial de carga',
      },
    });

    // Link current price to product
    await prisma.product.update({
      where: { id: p.id },
      data: { currentPriceId: p.priceHistoryId },
    });

    // Upsert tax history
    await prisma.productTaxHistory.upsert({
      where: { id: p.taxHistoryId },
      update: { taxSchemeId: p.taxSchemeId },
      create: {
        id: p.taxHistoryId,
        productId: p.id,
        taxSchemeId: p.taxSchemeId,
        effectiveFrom: commonPriceTimestamp,
        changedById: ID.USER_ADMIN,
        changedAt: commonPriceTimestamp,
        changeReason: 'Asignación inicial de impuesto',
      },
    });

    // Link current tax to product
    await prisma.product.update({
      where: { id: p.id },
      data: { currentTaxHistoryId: p.taxHistoryId },
    });

    // Upsert barcode
    await prisma.productBarcode.upsert({
      where: { id: p.barcodeId },
      update: { barcode: p.barcode },
      create: {
        id: p.barcodeId,
        productId: p.id,
        barcode: p.barcode,
        barcodeType: p.barcodeType,
        isPrimary: true,
      },
    });
  }

  console.log(`   ✅ ${products.length} products with prices, taxes, and barcodes`);
}

// ---------------------------------------------------------------------------
// 5. Suppliers
// ---------------------------------------------------------------------------
async function seedSuppliers(): Promise<void> {
  console.log('🏭 Seeding suppliers...');

  const suppliers = [
    { id: ID.SUP_DISFARMA, identificationType: 'NIT' as const, identificationNumber: '900123456-7', businessName: 'Disfarma S.A.S.', contactName: 'Andrés López', phone: '6017451234', email: 'ventas@disfarma.com.co', city: 'Bogotá D.C.', paymentTermsDays: 30, creditLimit: '50000000.00' },
    { id: ID.SUP_COLVAN, identificationType: 'NIT' as const, identificationNumber: '800987654-3', businessName: 'Colvan Pharmaceutical S.A.', contactName: 'Diana Torres', phone: '6045559876', email: 'pedidos@colvan.com.co', city: 'Medellín', paymentTermsDays: 45, creditLimit: '30000000.00' },
    { id: ID.SUP_CRUZ_VERDE, identificationType: 'NIT' as const, identificationNumber: '830111222-5', businessName: 'Droguerías Cruz Verde S.A.', contactName: 'Mónica Herrera', phone: '6012223344', email: 'comercial@cruzverde.com.co', city: 'Bogotá D.C.', paymentTermsDays: 15, creditLimit: '80000000.00' },
  ];

  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { id: s.id },
      update: { businessName: s.businessName, phone: s.phone, email: s.email },
      create: { ...s, createdById: ID.USER_ADMIN },
    });
  }

  console.log('   ✅ 3 suppliers');
}

// ---------------------------------------------------------------------------
// 6. Clients
// ---------------------------------------------------------------------------
async function seedClients(): Promise<void> {
  console.log('👥 Seeding clients...');

  const clients = [
    { id: ID.CLIENT_JUAN, identificationType: 'CC' as const, identificationNumber: '1234567890', fullName: 'Juan Pérez', email: 'juan.perez@email.com', phone: '3001112233', classificationId: ID.CLASS_FRECUENTE },
    { id: ID.CLIENT_MARIA, identificationType: 'CC' as const, identificationNumber: '2345678901', fullName: 'María González', email: 'maria.gonzalez@email.com', phone: '3102223344', classificationId: ID.CLASS_PARTICULAR },
    { id: ID.CLIENT_CARLOS, identificationType: 'CC' as const, identificationNumber: '3456789012', fullName: 'Carlos Martínez', email: null, phone: '3203334455', classificationId: ID.CLASS_PARTICULAR },
    { id: ID.CLIENT_ANDREA, identificationType: 'CC' as const, identificationNumber: '4567890123', fullName: 'Andrea López', email: 'andrea.lopez@email.com', phone: '3114445566', classificationId: ID.CLASS_FRECUENTE },
    { id: ID.CLIENT_PEDRO, identificationType: 'CC' as const, identificationNumber: '5678901234', fullName: 'Pedro Ramírez', email: null, phone: '3225556677', classificationId: ID.CLASS_PARTICULAR },
    { id: ID.CLIENT_LAURA, identificationType: 'CC' as const, identificationNumber: '6789012345', fullName: 'Laura Díaz', email: 'laura.diaz@email.com', phone: '3136667788', classificationId: ID.CLASS_FRECUENTE },
    { id: ID.CLIENT_DIEGO, identificationType: 'CC' as const, identificationNumber: '7890123456', fullName: 'Diego Torres', email: null, phone: '3237778899', classificationId: ID.CLASS_PARTICULAR },
    { id: ID.CLIENT_SOFIA, identificationType: 'CC' as const, identificationNumber: '8901234567', fullName: 'Sofía Hernández', email: 'sofia.h@email.com', phone: '3148889900', classificationId: ID.CLASS_FRECUENTE },
    { id: ID.CLIENT_CLINICA_SAN_JOSE, identificationType: 'NIT' as const, identificationNumber: '900555666-1', fullName: 'Clínica San José S.A.S.', email: 'compras@clinicasanjose.com', phone: '6014445566', classificationId: ID.CLASS_INSTITUCIONAL },
    { id: ID.CLIENT_HOGAR_GERIATRICO, identificationType: 'NIT' as const, identificationNumber: '801222333-4', fullName: 'Hogar Geriátrico Santa Ana', email: 'admin@hogarsantaana.org', phone: '6045556677', classificationId: ID.CLASS_INSTITUCIONAL },
  ];

  for (const c of clients) {
    await prisma.client.upsert({
      where: { id: c.id },
      update: { fullName: c.fullName, phone: c.phone, email: c.email, classificationId: c.classificationId },
      create: {
        ...c,
        createdById: ID.USER_ADMIN,
        updatedById: null,
        address: null,
        municipality: 'Bogotá D.C.',
        department: 'Cundinamarca',
        consentGivenAt: null,
        consentVersion: null,
        consentScope: null,
      },
    });
  }

  console.log('   ✅ 10 clients (8 individuals, 2 institutional)');
}

// ---------------------------------------------------------------------------
// 7. Inventory Lots
// ---------------------------------------------------------------------------
async function seedInventoryLots(): Promise<void> {
  console.log('📦 Seeding inventory lots...');

  const lots = [
    { id: ID.LOT_ACET_001, batchNumber: 'ACE-2025-001', productId: ID.PROD_ACETAMINOFEN_500, currentStock: 120, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_IBU_001, batchNumber: 'IBU-2025-001', productId: ID.PROD_IBUPROFENO_400, currentStock: 85, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_IBU_002, batchNumber: 'IBU-2025-002', productId: ID.PROD_IBUPROFENO_800, currentStock: 60, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_DIC_001, batchNumber: 'DIC-2025-001', productId: ID.PROD_DICLOFENACO_50, currentStock: 70, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_NAP_001, batchNumber: 'NAP-2025-001', productId: ID.PROD_NAPROXENO_250, currentStock: 55, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_AMOX_001, batchNumber: 'AMX-2025-001', productId: ID.PROD_AMOXICILINA_500, currentStock: 200, expirationDate: new Date(NOW.getFullYear() + 1, 11, 31) },
    { id: ID.LOT_AZIT_001, batchNumber: 'AZT-2025-001', productId: ID.PROD_AZITROMICINA_500, currentStock: 40, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_CEF_001, batchNumber: 'CEF-2025-001', productId: ID.PROD_CEFALEXINA_500, currentStock: 45, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_COTRI_001, batchNumber: 'CTR-2025-001', productId: ID.PROD_COTRIMOXAZOL, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_LORAT_001, batchNumber: 'LOR-2025-001', productId: ID.PROD_LORATADINA_10, currentStock: 90, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_CET_001, batchNumber: 'CET-2025-001', productId: ID.PROD_CETIRIZINA_10, currentStock: 65, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_DESL_001, batchNumber: 'DES-2025-001', productId: ID.PROD_DESLORATADINA_5, currentStock: 30, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_LOS_001, batchNumber: 'LOS-2025-001', productId: ID.PROD_LOSARTAN_50, currentStock: 100, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_ENAL_001, batchNumber: 'ENA-2025-001', productId: ID.PROD_ENALAPRIL_10, currentStock: 50, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_OME_001, batchNumber: 'OME-2025-001', productId: ID.PROD_OMEPRAZOL_20, currentStock: 150, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_ESO_001, batchNumber: 'ESO-2025-001', productId: ID.PROD_ESOMEPRAZOL_40, currentStock: 35, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_RAN_001, batchNumber: 'RAN-2025-001', productId: ID.PROD_RANITIDINA_150, currentStock: 70, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_SALB_001, batchNumber: 'SAL-2025-001', productId: ID.PROD_SALBUTAMOL_100, currentStock: 25, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_DOLEX_001, batchNumber: 'DLX-2025-001', productId: ID.PROD_DOLEX_FORTE, currentStock: 200, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_VITC_001, batchNumber: 'VTC-2025-001', productId: ID.PROD_VITAMINA_C_500, currentStock: 100, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_ALCOHOL_001, batchNumber: 'ALC-2025-001', productId: ID.PROD_ALCOHOL_70, currentStock: 40, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_GUANTES_001, batchNumber: 'GLT-2025-001', productId: ID.PROD_GUANTES_LATEX_M, currentStock: 300, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_JERINGA_001, batchNumber: 'JER-2025-001', productId: ID.PROD_JERINGA_3ML, currentStock: 500, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_BAJA_001, batchNumber: 'BJL-2025-001', productId: ID.PROD_BAJALENGUAS, currentStock: 80, expirationDate: TWO_YEARS_FROM_NOW },
    { id: ID.LOT_GASA_001, batchNumber: 'GAS-2025-001', productId: ID.PROD_GASA_ESTERIL, currentStock: 60, expirationDate: TWO_YEARS_FROM_NOW },
  ];

  for (const l of lots) {
    await prisma.lot.upsert({
      where: { id: l.id },
      update: { currentStock: l.currentStock, expirationDate: l.expirationDate, batchNumber: l.batchNumber },
      create: {
        id: l.id,
        batchNumber: l.batchNumber,
        expirationDate: l.expirationDate,
        entryDate: ONE_MONTH_AGO,
        state: 'ACTIVE',
        currentStock: l.currentStock,
        version: 0,
        productId: l.productId,
        locationCode: 'EST-01-A',
      },
    });

    // Create initial stock movement for each lot
    await prisma.inventoryMovement.upsert({
      where: { id: `mov_init_${l.id}` },
      update: { quantity: l.currentStock },
      create: {
        id: `mov_init_${l.id}`,
        lotId: l.id,
        movementType: 'INITIAL_STOCK',
        quantity: l.currentStock,
        previousStock: 0,
        newStock: l.currentStock,
        productId: l.productId,
        createdById: ID.USER_ADMIN,
        notes: 'Carga inicial de inventario',
        createdAt: ONE_MONTH_AGO,
      },
    });
  }

  console.log(`   ✅ ${lots.length} lots with initial stock movements`);
}

// ---------------------------------------------------------------------------
// 8. Sample Cash Shifts
// ---------------------------------------------------------------------------
async function seedCashShifts(): Promise<void> {
  console.log('💰 Seeding cash shifts...');

  // An open shift for today
  await prisma.cashShift.upsert({
    where: { id: ID.SHIFT_OPEN },
    update: {},
    create: {
      id: ID.SHIFT_OPEN,
      workstationId: ID.WS_PRINCIPAL,
      userId: ID.USER_CASHIER1,
      state: 'OPEN',
      openedAt: NOW,
      openingBalance: '200000.00',
      openingNotes: 'Turno de la mañana',
      expectedClosingAmount: '0',
      actualClosingAmount: '0',
      closingDifference: '0',
      forcedClose: false,
      hasExtendedAlert: false,
    },
  });

  // A closed shift from yesterday (useful for testing reports)
  await prisma.cashShift.upsert({
    where: { id: ID.SHIFT_CLOSED_YESTERDAY },
    update: {},
    create: {
      id: ID.SHIFT_CLOSED_YESTERDAY,
      workstationId: ID.WS_PRINCIPAL,
      userId: ID.USER_CASHIER1,
      state: 'CLOSED',
      openedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 8, 0, 0),
      closedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 20, 0, 0),
      closedByUserId: ID.USER_CASHIER1,
      openingBalance: '200000.00',
      openingNotes: 'Turno de ayer',
      expectedClosingAmount: '1856000.00',
      actualClosingAmount: '1855000.00',
      closingDifference: '-1000.00',
      closingNotes: 'Faltante de $1,000',
      forcedClose: false,
      hasExtendedAlert: false,
    },
  });

  // Add a cash count for the closed shift
  await prisma.shiftCashCount.upsert({
    where: { id: 'shiftcount_closed_1' },
    update: {},
    create: {
      id: 'shiftcount_closed_1',
      cashShiftId: ID.SHIFT_CLOSED_YESTERDAY,
      countType: 'CLOSING',
      countedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 20, 0, 0),
      countedByUserId: ID.USER_CASHIER1,
      notes: 'Conteo de cierre del turno',
    },
  });

  console.log('   ✅ 2 cash shifts (1 open, 1 closed)');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('❌ Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
