import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';

export async function seedSuppliers(): Promise<void> {
  console.log('Seeding suppliers...');
  const suppliers = [
    { id: IDS.SUP_DISFARMA, identificationType: 'NIT' as const, identificationNumber: '900123456-7', businessName: 'Disfarma S.A.S.', contactName: 'Andrés López', phone: '6017451234', email: 'ventas@disfarma.com.co', city: 'Bogotá D.C.', paymentTermsDays: 30, creditLimit: '50000000.00', createdById: IDS.USER_ADMIN },
    { id: IDS.SUP_COLVAN, identificationType: 'NIT' as const, identificationNumber: '800987654-3', businessName: 'Colvan Pharmaceutical S.A.', contactName: 'Diana Torres', phone: '6045559876', email: 'pedidos@colvan.com.co', city: 'Medellín', paymentTermsDays: 45, creditLimit: '30000000.00', createdById: IDS.USER_ADMIN },
    { id: IDS.SUP_CRUZ_VERDE, identificationType: 'NIT' as const, identificationNumber: '830111222-5', businessName: 'Droguerías Cruz Verde S.A.', contactName: 'Mónica Herrera', phone: '6012223344', email: 'comercial@cruzverde.com.co', city: 'Bogotá D.C.', paymentTermsDays: 15, creditLimit: '80000000.00', createdById: IDS.USER_ADMIN },
  ];

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { id: supplier.id },
      update: { businessName: supplier.businessName, phone: supplier.phone, email: supplier.email },
      create: supplier,
    });
  }
  console.log('   3 suppliers');
}