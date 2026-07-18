import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { YESTERDAY, NOW } from '../constants/dates';

/**
 * Seeds medical prescriptions (Receta médica) per Decreto 780/2016.
 * Linked to sale items that have `requiresPrescription: true`.
 */

async function seedPrescriptionLosartan(): Promise<void> {
  const saleItemId = `${IDS.SALE_CLOSED_002}_it_1`; // Losartán 50mg

  await prisma.prescription.upsert({
    where: { id: IDS.PRESC_SALE1_IT },
    update: {},
    create: {
      id: IDS.PRESC_SALE1_IT,
      saleItemId,
      prescriptionNumber: 'RX-2025-004567',
      prescriberIdType: 'CC',
      prescriberIdNumber: '79123456',
      prescriberName: 'Dr. Andrés Medina',
      prescriberSpecialty: 'Medicina Interna',
      prescriptionDate: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate() - 5),
      expiresAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate() + 25),
      patientFullName: 'Juan Pérez',
      patientIdType: 'CC',
      patientIdNumber: '1234567890',
      verifiedById: IDS.USER_CASHIER1,
      verifiedAt: new Date(YESTERDAY.getFullYear(), YESTERDAY.getMonth(), YESTERDAY.getDate(), 11, 30, 0),
      isControlledSubstance: false,
      recipeType: 'PARTICULAR',
    },
  });
}

async function seedPrescriptionAmox(): Promise<void> {
  const saleItemId = `${IDS.SALE_OPEN_001}_it_1`; // Amoxicilina 500mg

  await prisma.prescription.upsert({
    where: { id: IDS.PRESC_SALE2_AMOX },
    update: {},
    create: {
      id: IDS.PRESC_SALE2_AMOX,
      saleItemId,
      prescriptionNumber: 'RX-2025-005678',
      prescriberIdType: 'CC',
      prescriberIdNumber: '79876543',
      prescriberName: 'Dra. Carolina Vega',
      prescriberSpecialty: 'Médico General',
      prescriptionDate: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 2),
      expiresAt: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 28),
      patientFullName: 'María González',
      patientIdType: 'CC',
      patientIdNumber: '2345678901',
      verifiedById: IDS.USER_CASHIER1,
      verifiedAt: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 10, 3, 0),
      isControlledSubstance: false,
      recipeType: 'PARTICULAR',
    },
  });
}

export async function seedPrescriptions(): Promise<void> {
  console.log('Seeding prescriptions...');
  await seedPrescriptionLosartan();
  await seedPrescriptionAmox();
  console.log('   2 prescriptions (Losartán, Amoxicilina)');
}
