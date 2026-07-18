import { prisma } from '../helpers/db';

/**
 * Seeds base SystemConfig entries that modules expect at runtime.
 * Without these, features like discount limits or password policies
 * would read empty config.
 */

interface SeedConfig {
  key: string;
  value: unknown;
  valueType: 'NUMBER' | 'BOOLEAN' | 'STRING' | 'ARRAY' | 'OBJECT';
  module: string;
  description: string;
  isSensitive: boolean;
}

const CONFIGS: SeedConfig[] = [
  {
    key: 'sale.max_discount_percentage',
    value: 30,
    valueType: 'NUMBER',
    module: 'SALES_POS',
    description: 'Máximo porcentaje de descuento permitido por línea de venta',
    isSensitive: false,
  },
  {
    key: 'sale.max_discount_percentage_per_manager',
    value: 50,
    valueType: 'NUMBER',
    module: 'SALES_POS',
    description: 'Máximo descuento que puede autorizar un MANAGER',
    isSensitive: false,
  },
  {
    key: 'auth.password_min_length',
    value: 8,
    valueType: 'NUMBER',
    module: 'AUTH_USERS',
    description: 'Longitud mínima de contraseña',
    isSensitive: false,
  },
  {
    key: 'auth.max_failed_login_attempts',
    value: 5,
    valueType: 'NUMBER',
    module: 'AUTH_USERS',
    description: 'Intentos fallidos antes de bloquear usuario',
    isSensitive: false,
  },
  {
    key: 'auth.lockout_duration_minutes',
    value: 30,
    valueType: 'NUMBER',
    module: 'AUTH_USERS',
    description: 'Duración del bloqueo por intentos fallidos',
    isSensitive: false,
  },
  {
    key: 'auth.session_timeout_minutes',
    value: 480,
    valueType: 'NUMBER',
    module: 'AUTH_USERS',
    description: 'Tiempo máximo de inactividad de sesión (8 horas)',
    isSensitive: false,
  },
  {
    key: 'auth.password_rotation_days',
    value: 90,
    valueType: 'NUMBER',
    module: 'AUTH_USERS',
    description: 'Días para forzar cambio de contraseña',
    isSensitive: false,
  },
  {
    key: 'inventory.lot_expiration_alert_days',
    value: 90,
    valueType: 'NUMBER',
    module: 'INVENTORY',
    description: 'Días antes del vencimiento para generar alerta',
    isSensitive: false,
  },
  {
    key: 'inventory.auto_expiration_batch_size',
    value: 100,
    valueType: 'NUMBER',
    module: 'INVENTORY',
    description: 'Lotes procesados por lote en el job de vencimiento',
    isSensitive: false,
  },
  {
    key: 'cash_shift.extended_alert_hours',
    value: 12,
    valueType: 'NUMBER',
    module: 'CASH_SHIFT',
    description: 'Horas sin cerrar turno para disparar alerta',
    isSensitive: false,
  },
  {
    key: 'fiscal_dian.retry_max_attempts',
    value: 3,
    valueType: 'NUMBER',
    module: 'FISCAL_DIAN',
    description: 'Reintentos máximos de transmisión DIAN',
    isSensitive: false,
  },
  {
    key: 'fiscal_dian.retry_interval_minutes',
    value: 5,
    valueType: 'NUMBER',
    module: 'FISCAL_DIAN',
    description: 'Intervalo entre reintentos de transmisión',
    isSensitive: false,
  },
  {
    key: 'sync.max_payload_size_bytes',
    value: 1048576,
    valueType: 'NUMBER',
    module: 'SYNC_OFFLINE',
    description: 'Tamaño máximo de payload de sincronización (1MB)',
    isSensitive: false,
  },
  {
    key: 'purchase.default_payment_terms_days',
    value: 30,
    valueType: 'NUMBER',
    module: 'PURCHASES',
    description: 'Plazo por defecto para pago a proveedores',
    isSensitive: false,
  },
];

export async function seedSystemConfig(): Promise<void> {
  console.log('Seeding system configuration...');
  for (const cfg of CONFIGS) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value as Record<string, unknown> },
      create: {
        key: cfg.key,
        value: cfg.value as Record<string, unknown>,
        valueType: cfg.valueType,
        module: cfg.module as Parameters<typeof prisma.systemConfig.create>[0]['data']['module'],
        description: cfg.description,
        isSensitive: cfg.isSensitive,
      },
    });
  }
  console.log(`   ${CONFIGS.length} configuration entries`);
}
