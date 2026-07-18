import { prisma } from './helpers/db';
import { seedReferenceData } from './seed/reference-data';
import { seedWorkstations } from './seed/workstation';
import { seedUsers } from './seed/users';
import { seedProducts } from './seed/products';
import { seedSuppliers } from './seed/suppliers';
import { seedClients } from './seed/clients';
import { seedInventoryLots } from './seed/inventory-lots';
import { seedCashShifts } from './seed/cash-shifts';
import { seedSales } from './seed/sales';
import { seedPrescriptions } from './seed/prescriptions';
import { seedClientReturns } from './seed/client-returns';
import { seedPurchases } from './seed/purchases';
import { seedFiscalConfig } from './seed/fiscal-config';
import { seedPhysicalCounts } from './seed/physical-counts';
import { seedSyncQueue } from './seed/sync-queue';
import { seedSystemConfig } from './seed/system-config';
import { seedAuditLog } from './seed/audit-log';

async function main(): Promise<void> {
  console.log('Starting pharmacy-system seed...\n');

  // 1. Auth & workstations — needed by everything else
  await seedUsers();
  await seedWorkstations();

  // 2. Reference data — categories, forms, taxes, payment methods, classifications
  await seedReferenceData();

  // 3. Catalog & clients
  await seedProducts();
  await seedSuppliers();
  await seedClients();

  // 4. Inventory
  await seedInventoryLots();

  // 5. Inventory operations — physical counts reference lots + users (runs before sales for chronological consistency)
  await seedPhysicalCounts();

  // 6. Cash operations — shifts must exist before sales
  await seedCashShifts();

  // 7. Transactions — sales reference shifts, products, lots, clients, payment methods
  await seedSales();

  // 8. Medical — prescriptions reference sale items, returns reference sales + cash shifts
  await seedPrescriptions();
  await seedClientReturns();

  // 9. Purchasing — orders reference suppliers, products, users
  await seedPurchases();

  // 10. Fiscal DIAN — issuer, tech provider, resolutions, allocations
  await seedFiscalConfig();

  // 11. Sync — queue items reference workstations
  await seedSyncQueue();

  // 12. System configuration — module-scoped settings (no dependencies)
  await seedSystemConfig();

  // 13. Audit log — append-only historical entries (no FK constraints that block)
  await seedAuditLog();

  console.log('\nSeed completed successfully!');
  console.log('');
  console.log('━━━━ Usuarios ━━━━');
  console.log('   admin       / 123456      (OWNER)');
  console.log('   cashier1    / 123456      (CASHIER)');
  console.log('   cashier2    / 123456      (CASHIER)');
  console.log('   inventory   / 123456      (INVENTORY_ASSISTANT)');
  console.log('   accountant  / 123456      (ACCOUNTANT)');
  console.log('');
  console.log('━━━━ Productos ━━━━');
  console.log('   27 productos (2 de control especial)');
  console.log('');
  console.log('━━━━ Ventas ━━━━');
  console.log('   3 ventas confirmadas (2 turno cerrado, 1 turno abierto)');
  console.log('');
  console.log('━━━━ Prescripciones ━━━━');
  console.log('   2 recetas médicas (Losartán, Amoxicilina)');
  console.log('');
  console.log('━━━━ Devoluciones ━━━━');
  console.log('   1 devolución de cliente (jeringas 3ml x20)');
  console.log('');
  console.log('━━━━ Órdenes de compra ━━━━');
  console.log('   2 órdenes confirmadas (Disfarma, Colvan)');
  console.log('');
  console.log('━━━━ Conteos físicos ━━━━');
  console.log('   1 conteo aplicado → 1 documento ajuste → 2 movimientos');
  console.log('');
  console.log('━━━━ Sincronización ━━━━');
  console.log('   3 items completados en cola de sync');
  console.log('');
  console.log('━━━━ Configuración fiscal DIAN ━━━━');
  console.log('   Issuer, tech provider, 2 resoluciones, 3 asignaciones');
  console.log('');
  console.log('━━━━ Configuración del sistema ━━━━');
  console.log('   14 entradas de configuración');
  console.log('');
  console.log('━━━━ Auditoría ━━━━');
  console.log('   15 registros de auditoría');
  console.log('');
  console.log('━━━━ Estaciones de trabajo (workstationId) ━━━━');
  console.log('   ws_principal   → Caja Principal  (código WS-001)');
  console.log('   ws_secundaria  → Caja Secundaria (código WS-002)');
  console.log('');
  console.log('Para hacer login, usa con curl:');
  console.log('   curl -s -X POST http://localhost:3000/auth/login \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"identifier":"admin","secret":"123456","sessionType":"PASSWORD","workstationId":"ws_principal"}\'');
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