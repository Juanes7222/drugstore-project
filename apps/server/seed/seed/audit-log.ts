import { prisma } from '../helpers/db';
import { IDS } from '../constants/ids';
import { SIX_MONTHS_AGO, ONE_MONTH_AGO, YESTERDAY, NOW } from '../constants/dates';

/**
 * Seeds the append-only audit log with key historical events.
 * Covers user creation, product loading, cash shift lifecycle, and sales.
 * Foreign keys use NoAction so deletions never cascade into audit rows.
 */

function auditDate(base: Date, hour: number, minute: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0);
}

const ENTRIES: Array<{
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  details: string | null;
  userId: string | null;
  workstationId: string | null;
  createdAt: Date;
}> = [
  // System setup
  {
    id: 'audit_seed_001', action: 'CREATE', module: 'AUTH_USERS', entityType: 'User', entityId: IDS.USER_ADMIN,
    entityName: 'Administrador del Sistema', details: 'Usuario administrador creado durante inicialización del sistema',
    userId: null, workstationId: null, createdAt: SIX_MONTHS_AGO,
  },
  {
    id: 'audit_seed_002', action: 'CREATE', module: 'AUTH_USERS', entityType: 'User', entityId: IDS.USER_CASHIER1,
    entityName: 'María Rodríguez', details: 'Cajero creado por admin',
    userId: IDS.USER_ADMIN, workstationId: null, createdAt: auditDate(SIX_MONTHS_AGO, 9, 0),
  },
  {
    id: 'audit_seed_003', action: 'CREATE', module: 'AUTH_USERS', entityType: 'User', entityId: IDS.USER_CASHIER2,
    entityName: 'Carlos Méndez', details: 'Cajero creado por admin',
    userId: IDS.USER_ADMIN, workstationId: null, createdAt: auditDate(SIX_MONTHS_AGO, 9, 5),
  },
  {
    id: 'audit_seed_004', action: 'CREATE', module: 'AUTH_USERS', entityType: 'User', entityId: IDS.USER_INVENTORY,
    entityName: 'Luisa García', details: 'Asistente de inventario creado por admin',
    userId: IDS.USER_ADMIN, workstationId: null, createdAt: auditDate(SIX_MONTHS_AGO, 9, 10),
  },
  {
    id: 'audit_seed_005', action: 'CREATE', module: 'AUTH_USERS', entityType: 'User', entityId: IDS.USER_ACCOUNTANT,
    entityName: 'Pedro Contreras', details: 'Contador creado por admin',
    userId: IDS.USER_ADMIN, workstationId: null, createdAt: auditDate(SIX_MONTHS_AGO, 9, 15),
  },

  // Product catalog loading
  {
    id: 'audit_seed_006', action: 'CREATE', module: 'CATALOG', entityType: 'Product', entityId: IDS.PROD_ACETAMINOFEN_500,
    entityName: 'Acetaminofén 500mg', details: 'Carga inicial de catálogo — 27 productos',
    userId: IDS.USER_ADMIN, workstationId: null, createdAt: auditDate(ONE_MONTH_AGO, 8, 0),
  },

  // Inventory initial stock
  {
    id: 'audit_seed_007', action: 'CREATE', module: 'INVENTORY', entityType: 'Lot', entityId: IDS.LOT_ACET_001,
    entityName: 'ACE-2025-001', details: 'Carga inicial de inventario — 27 lotes creados con stock inicial',
    userId: IDS.USER_ADMIN, workstationId: null, createdAt: auditDate(ONE_MONTH_AGO, 8, 30),
  },

  // Cash shift — yesterday's opening
  {
    id: 'audit_seed_008', action: 'STATE_CHANGE', module: 'CASH_SHIFT', entityType: 'CashShift', entityId: IDS.SHIFT_CLOSED_YESTERDAY,
    entityName: 'Turno ayer', details: 'Apertura de turno: balance inicial $200,000',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(YESTERDAY, 8, 0),
  },

  // Sales — closed shift
  {
    id: 'audit_seed_009', action: 'STATE_CHANGE', module: 'SALES_POS', entityType: 'Sale', entityId: IDS.SALE_CLOSED_001,
    entityName: 'Venta Clínica San José', details: 'Venta confirmada: $639,875 — 4 items',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(YESTERDAY, 9, 17),
  },
  {
    id: 'audit_seed_010', action: 'STATE_CHANGE', module: 'SALES_POS', entityType: 'Sale', entityId: IDS.SALE_CLOSED_002,
    entityName: 'Venta Juan Pérez', details: 'Venta confirmada: $513,000 — 5 items, descuento frecuente 5%',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(YESTERDAY, 11, 32),
  },

  // Cash shift — yesterday's closing
  {
    id: 'audit_seed_011', action: 'STATE_CHANGE', module: 'CASH_SHIFT', entityType: 'CashShift', entityId: IDS.SHIFT_CLOSED_YESTERDAY,
    entityName: 'Turno ayer', details: 'Cierre de turno: esperado $1,856,000, real $1,855,000, diferencia -$1,000',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(YESTERDAY, 20, 0),
  },

  // Client return
  {
    id: 'audit_seed_012', action: 'CREATE', module: 'SALES_POS', entityType: 'ClientReturn', entityId: IDS.RETURN_CLOSED_001,
    entityName: 'Devolución Clínica San José', details: 'Devolución de 20 jeringas 3ml — $95,600',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(YESTERDAY, 17, 0),
  },

  // Physical count
  {
    id: 'audit_seed_013', action: 'STATE_CHANGE', module: 'INVENTORY', entityType: 'PhysicalCount', entityId: IDS.PHYS_COUNT_001,
    entityName: 'Conteo mensual antibióticos', details: 'Conteo aplicado: +15 Amoxicilina, -5 Azitromicina',
    userId: IDS.USER_INVENTORY, workstationId: null, createdAt: auditDate(ONE_MONTH_AGO, 13, 0),
  },

  // Open shift — today
  {
    id: 'audit_seed_014', action: 'STATE_CHANGE', module: 'CASH_SHIFT', entityType: 'CashShift', entityId: IDS.SHIFT_OPEN,
    entityName: 'Turno abierto hoy', details: 'Apertura de turno: balance inicial $200,000',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(NOW, 8, 0),
  },

  // Sale on open shift
  {
    id: 'audit_seed_015', action: 'STATE_CHANGE', module: 'SALES_POS', entityType: 'Sale', entityId: IDS.SALE_OPEN_001,
    entityName: 'Venta María González', details: 'Venta confirmada: $130,186 — 5 items, pago mixto efectivo+Nequi',
    userId: IDS.USER_CASHIER1, workstationId: IDS.WS_PRINCIPAL, createdAt: auditDate(NOW, 10, 3),
  },
];

export async function seedAuditLog(): Promise<void> {
  console.log('Seeding audit log...');
  for (const entry of ENTRIES) {
    await prisma.auditLog.upsert({
      where: { id: entry.id },
      update: {},
      create: {
        id: entry.id,
        action: entry.action as Parameters<typeof prisma.auditLog.create>[0]['data']['action'],
        module: entry.module as Parameters<typeof prisma.auditLog.create>[0]['data']['module'],
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityName: entry.entityName,
        details: entry.details,
        userId: entry.userId,
        workstationId: entry.workstationId,
        createdAt: entry.createdAt,
      },
    });
  }
  console.log(`   ${ENTRIES.length} audit log entries`);
}
