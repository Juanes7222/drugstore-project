import { prisma } from './helpers/db';
import { seedReferenceData } from './seed/reference-data';
import { seedWorkstations } from './seed/workstation';
import { seedUsers } from './seed/users';
import { seedProducts } from './seed/products';
import { seedSuppliers } from './seed/suppliers';
import { seedClients } from './seed/clients';
import { seedInventoryLots } from './seed/inventory-lots';
import { seedCashShifts } from './seed/cash-shifts';

async function main(): Promise<void> {
  console.log('Starting pharmacy-system seed...\n');

  // Users first so reference data can reference them (e.g. TaxScheme.createdById)
  await seedUsers();
  await seedWorkstations();
  await seedReferenceData();
  await seedProducts();
  await seedSuppliers();
  await seedClients();
  await seedInventoryLots();
  await seedCashShifts();

  console.log('\nSeed completed successfully!');
  console.log('   Login: admin / Admin123!  (role: ADMIN)');
  console.log('   Login: cashier1 / 1234  (role: CASHIER)');
  console.log('   Login: cashier2 / 1234  (role: CASHIER)');
  console.log('   Login: inventory / 1234  (role: INVENTORY_ASSISTANT)');
  console.log('   Login: accountant / 1234  (role: ACCOUNTANT)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });