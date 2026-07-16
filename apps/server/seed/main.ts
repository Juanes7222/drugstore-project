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
  console.log('');
  console.log('━━━━ Usuarios ━━━━');
  console.log('   admin       / Admin123!   (ADMIN)');
  console.log('   cashier1    / 1234        (CASHIER)');
  console.log('   cashier2    / 1234        (CASHIER)');
  console.log('   inventory   / 1234        (INVENTORY_ASSISTANT)');
  console.log('   accountant  / 1234        (ACCOUNTANT)');
  console.log('');
  console.log('━━━━ Estaciones de trabajo (workstationId) ━━━━');
  console.log('   ws_principal   → Caja Principal  (código WS-001)');
  console.log('   ws_secundaria  → Caja Secundaria (código WS-002)');
  console.log('');
  console.log('Para hacer login, usa con curl:');
  console.log('   curl -s -X POST http://localhost:3000/auth/login \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"identifier":"admin","secret":"Admin123!","sessionType":"PASSWORD","workstationId":"ws_principal"}\'');
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