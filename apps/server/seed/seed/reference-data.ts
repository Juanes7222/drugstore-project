import { prisma } from '../helpers/db';
import { seedMany } from '../helpers/upsert';
import { IDS } from '../constants/ids';
import { TAX_EFFECTIVE_DATE } from '../constants/dates';

async function seedCategories(): Promise<void> {
  const categories = [
    { id: IDS.CAT_ANALGESICOS, name: 'ANALGÉSICOS', sortOrder: 1 },
    { id: IDS.CAT_ANTIBIOTICOS, name: 'ANTIBIÓTICOS', sortOrder: 2 },
    { id: IDS.CAT_ANTIINFLAMATORIOS, name: 'ANTIINFLAMATORIOS', sortOrder: 3 },
    { id: IDS.CAT_ANTIHISTAMINICOS, name: 'ANTIHISTAMÍNICOS', sortOrder: 4 },
    { id: IDS.CAT_CARDIOVASCULAR, name: 'CARDIOVASCULAR', sortOrder: 5 },
    { id: IDS.CAT_GASTROINTESTINAL, name: 'GASTROINTESTINAL', sortOrder: 6 },
    { id: IDS.CAT_RESPIRATORIO, name: 'RESPIRATORIO', sortOrder: 7 },
    { id: IDS.CAT_VITAMINAS, name: 'VITAMINAS Y SUPLEMENTOS', sortOrder: 8 },
    { id: IDS.CAT_CUIDADO_PERSONAL, name: 'CUIDADO PERSONAL', sortOrder: 9 },
    { id: IDS.CAT_MATERIAL_CURACION, name: 'MATERIAL DE CURACIÓN', sortOrder: 10 },
    { id: IDS.CAT_SISTEMA_NERVIOSO, name: 'SISTEMA NERVIOSO', sortOrder: 11 },
  ];
  await seedMany(prisma.category, categories);
}

async function seedPharmaceuticalForms(): Promise<void> {
  const forms = [
    { id: IDS.FORM_TABLETA, name: 'TABLETA', sortOrder: 1 },
    { id: IDS.FORM_CAPSULA, name: 'CÁPSULA', sortOrder: 2 },
    { id: IDS.FORM_JARABE, name: 'JARABE', sortOrder: 3 },
    { id: IDS.FORM_INYECTABLE, name: 'INYECTABLE', sortOrder: 4 },
    { id: IDS.FORM_CREMA, name: 'CREMA', sortOrder: 5 },
    { id: IDS.FORM_OVULO, name: 'ÓVULO', sortOrder: 6 },
    { id: IDS.FORM_GOTAS, name: 'GOTAS', sortOrder: 7 },
    { id: IDS.FORM_SOBRE, name: 'SOBRE', sortOrder: 8 },
    { id: IDS.FORM_SPRAY, name: 'SPRAY', sortOrder: 9 },
  ];
  await seedMany(prisma.pharmaceuticalForm, forms);
}

async function seedTaxSchemes(): Promise<void> {
  const schemes = [
    { id: IDS.TAX_IVA_19, code: 'IVA-19', name: 'IVA 19%', taxType: 'IVA' as const, rate: '19.0000', effectiveFrom: TAX_EFFECTIVE_DATE, createdById: IDS.USER_ADMIN },
    { id: IDS.TAX_IVA_5, code: 'IVA-5', name: 'IVA 5%', taxType: 'IVA' as const, rate: '5.0000', effectiveFrom: TAX_EFFECTIVE_DATE, createdById: IDS.USER_ADMIN },
    { id: IDS.TAX_EXENTO, code: 'EXENTO', name: 'Exento de IVA', taxType: 'EXENTO' as const, rate: '0.0000', effectiveFrom: TAX_EFFECTIVE_DATE, createdById: IDS.USER_ADMIN },
  ];
  await seedMany(prisma.taxScheme, schemes);
}

async function seedPaymentMethods(): Promise<void> {
  const methods = [
    { id: IDS.PAY_EFECTIVO, internalCode: 'PM001', name: 'Efectivo', category: 'CASH' as const, isCash: true, sortOrder: 1 },
    { id: IDS.PAY_TARJETA_DEBITO, internalCode: 'PM002', name: 'Tarjeta Débito', dianCode: '1', category: 'DEBIT_CARD' as const, sortOrder: 2 },
    { id: IDS.PAY_TARJETA_CREDITO, internalCode: 'PM003', name: 'Tarjeta Crédito', dianCode: '2', category: 'CREDIT_CARD' as const, sortOrder: 3 },
    { id: IDS.PAY_TRANSFERENCIA, internalCode: 'PM004', name: 'Transferencia Bancaria', dianCode: '3', category: 'BANK_TRANSFER' as const, sortOrder: 4 },
    { id: IDS.PAY_BOTON_PSE, internalCode: 'PM005', name: 'Botón PSE', dianCode: '49', category: 'BANK_TRANSFER' as const, sortOrder: 5 },
    { id: IDS.PAY_NEQUI, internalCode: 'PM006', name: 'Nequi', dianCode: '102', category: 'DIGITAL_WALLET' as const, sortOrder: 6 },
    { id: IDS.PAY_DAVIPLATA, internalCode: 'PM007', name: 'Daviplata', dianCode: '103', category: 'DIGITAL_WALLET' as const, sortOrder: 7 },
  ];
  await seedMany(prisma.paymentMethod, methods);
}

async function seedClientClassifications(): Promise<void> {
  const classifications = [
    { id: IDS.CLASS_PARTICULAR, type: 'PARTICULAR' as const, discountPercentage: '0.00', sortOrder: 1 },
    { id: IDS.CLASS_FRECUENTE, type: 'FREQUENT' as const, discountPercentage: '5.00', sortOrder: 2 },
    { id: IDS.CLASS_INSTITUCIONAL, type: 'INSTITUTIONAL' as const, discountPercentage: '10.00', sortOrder: 3 },
  ];
  await seedMany(prisma.clientClassification, classifications);
}

export async function seedReferenceData(): Promise<void> {
  console.log('Seeding reference data...');
  await seedCategories();
  await seedPharmaceuticalForms();
  await seedTaxSchemes();
  await seedPaymentMethods();
  await seedClientClassifications();
  console.log('   Categories, forms, tax schemes, payment methods, client classifications');
}