// Split the monolithic schema.prisma into schema-source/{shared,server-only}/*.prisma files.
//
// Cross-boundary relations (shared↔server-only) are replaced with plain scalar id fields
// in both directions, since Prisma requires two sides for every relation and the two builds
// (full vs local) use different model sets. Code that previously used Prisma `.include` to
// navigate across the boundary must use explicit follow-up queries instead.
//
// Run: node scripts/split-schema.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCHEMA_FILE = join(ROOT, 'prisma', 'schema.prisma');
const SHARED_DIR = join(ROOT, 'prisma', 'schema-source', 'shared');
const SERVER_ONLY_DIR = join(ROOT, 'prisma', 'schema-source', 'server-only');

// ---- Classification ----

const SHARED_MODELS = new Set([
  'Product', 'Category', 'PharmaceuticalForm', 'TaxScheme',
  'ProductBarcode', 'ProductPriceHistory', 'ProductTaxHistory',
  'Client', 'ClientClassification',
  'CashShift', 'ShiftCashCount',
  'Sale', 'SaleItem', 'SaleItemLot', 'SalePayment',
  'Lot', 'InventoryMovement', 'SyncQueue',
  'PaymentMethod',
]);

const SHARED_ENUMS = new Map([
  ['SaleType', ['Product']],
  ['TaxSchemeType', ['TaxScheme']],
  ['PaymentMethodCategory', ['PaymentMethod']],
  ['BarcodeType', ['ProductBarcode']],
  ['ClientType', ['ClientClassification']],
  ['IdentificationType', ['Client']],
  ['DataSubjectRequestStatus', ['Client']],
  ['LotState', ['Lot']],
  ['MovementType', ['InventoryMovement']],
  ['ShiftState', ['CashShift']],
  ['CashCountType', ['ShiftCashCount']],
  ['SaleOperationalState', ['Sale']],
  ['SyncOperationType', ['SyncQueue']],
  ['SyncStatus', ['SyncQueue']],
]);

const SERVER_ONLY_MODELS = new Set([
  'User', 'UserSession', 'Workstation',
  'AuditLog', 'Supplier',
  'PurchaseOrder', 'PurchaseOrderItem', 'PurchaseReception', 'PurchaseReceptionItem',
  'SupplierReturn', 'SupplierReturnItem',
  'InventoryAdjustmentDocument', 'PhysicalCount', 'AutoExpirationJob',
  'SystemConfig',
  'FiscalIssuerConfig', 'TechProviderConfig', 'FiscalResolution',
  'FiscalResolutionAllocation', 'FiscalDocument',
  'Prescription',
  'ClientReturn', 'ClientReturnItem', 'ClientReturnItemLot',
]);

const SERVER_ONLY_ENUMS = new Map([
  ['RoleType', ['User']],
  ['SessionRevocationReason', ['UserSession']],
  ['AdjustmentState', ['InventoryAdjustmentDocument']],
  ['PhysicalCountState', ['PhysicalCount']],
  ['SupplierIdentificationType', ['Supplier']],
  ['PurchaseOrderState', ['PurchaseOrder']],
  ['PurchaseReceptionState', ['PurchaseReception']],
  ['PurchaseReturnState', ['SupplierReturn']],
  ['ClientReturnState', ['ClientReturn']],
  ['RecipeType', ['Prescription']],
  ['FiscalDocumentType', ['FiscalDocument']],
  ['FiscalDocumentState', ['FiscalDocument']],
  ['ResolutionState', ['FiscalResolution']],
  ['ConfigValueType', ['SystemConfig']],
  ['SystemModule', ['SystemConfig']],
  ['AuditAction', ['AuditLog']],
]);

const ALL_SHARED = new Set([...SHARED_MODELS, ...SHARED_ENUMS.keys()]);
const ALL_SERVER_ONLY = new Set([...SERVER_ONLY_MODELS, ...SERVER_ONLY_ENUMS.keys()]);

function isShared(name) { return ALL_SHARED.has(name); }
function isServerOnly(name) { return ALL_SERVER_ONLY.has(name); }
function isOtherCategory(name, myCategory) {
  return myCategory === 'shared' ? isServerOnly(name) : isShared(name);
}

// ---- Parsing ----

function parseSchema(text) {
  const blocks = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('generator ') || line.startsWith('datasource ')) {
      let depth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      while (depth > 0 && i < lines.length - 1) {
        i++; depth += (lines[i].match(/{/g) || []).length; depth -= (lines[i].match(/}/g) || []).length;
      }
      i++; continue;
    }

    const m = line.match(/^(enum|model)\s+(\w+)\s*\{/);
    if (m) {
      const [, type, name] = m;
      const blockLines = [line];
      let depth = 1; i++;
      while (i < lines.length && depth > 0) {
        blockLines.push(lines[i]);
        depth += (lines[i].match(/{/g) || []).length;
        depth -= (lines[i].match(/}/g) || []).length;
        i++;
      }
      blocks.push({ type, name, lines: blockLines });
      continue;
    }
    i++;
  }
  return blocks;
}

function classifyBlock(block) {
  if (block.type === 'enum') {
    if (SHARED_ENUMS.has(block.name)) return 'shared';
    if (SERVER_ONLY_ENUMS.has(block.name)) return 'server-only';
    return null;
  }
  if (SHARED_MODELS.has(block.name)) return 'shared';
  if (SERVER_ONLY_MODELS.has(block.name)) return 'server-only';
  return null;
}

// ---- Field parsing ----

function parseField(line) {
  const t = line.trim();
  if (t.startsWith('@@') || t.startsWith('///') || t.startsWith('//') || t === '') return null;
  // fieldName    Type?[]    @attr @relation(...)
  const m = t.match(/^(\w+)\s+(\w+)(\?)?(\[\])?\s*(.*)$/);
  if (!m) return null;
  return {
    name: m[1], baseType: m[2], optional: !!m[3], array: !!m[4], attrs: m[5],
    isRelation: m[5].includes('@relation'),
  };
}

// ---- Flatten model (remove @relation fields targeting the other category) ----

function flattenModel(modelName, category) {
  const isShared = category === 'shared';
  // We keep lines as-is except we remove @relation fields (both forward and back-refs)
  // that target a model in the OTHER category. Scalar id fields stay.
  const lines = [];
  let inDocComment = false;

  for (const line of ALL_MODEL_LINES.get(modelName)) {
    const trimmed = line.trim();

    if (trimmed.startsWith('///') || trimmed.startsWith('//')) {
      lines.push(line); continue;
    }

    if (trimmed.startsWith('@@')) {
      lines.push(line); continue;
    }

    if (trimmed === '' || trimmed === '{' || trimmed === '}') {
      lines.push(line); continue;
    }

    const field = parseField(line);
    if (!field) { lines.push(line); continue; }

    // Check if this field's type is in the OTHER category
    const targetIsOther = isOtherCategory(field.baseType, category);

    if (targetIsOther) {
      if (field.isRelation || field.array) {
        // Remove the @relation field or back-ref array — the scalar FK stays as data.
        // Skip this line entirely.
        continue;
      }
      // Scalar field (like `userId`, `createdById`) — keep as data.
      lines.push(line);
      continue;
    }

    // Same-category or unknown type — keep as-is
    lines.push(line);
  }

  return lines;
}

// Cache original model lines
const ALL_MODEL_LINES = new Map();

// ---- Grouping ----

const GROUP_FILE = {
  shared: {
    'Category': 'catalog-base.prisma', 'PharmaceuticalForm': 'catalog-base.prisma',
    'TaxScheme': 'tax-scheme.prisma', 'PaymentMethod': 'payment-method.prisma',
    'Product': 'product.prisma', 'ProductBarcode': 'product-barcode.prisma',
    'ProductPriceHistory': 'product-price-history.prisma',
    'ProductTaxHistory': 'product-tax-history.prisma',
    'ClientClassification': 'client.prisma', 'Client': 'client.prisma',
    'CashShift': 'cash-shift.prisma', 'ShiftCashCount': 'shift-cash-count.prisma',
    'Sale': 'sale.prisma', 'SaleItem': 'sale-item.prisma',
    'SaleItemLot': 'sale-item-lot.prisma', 'SalePayment': 'sale-payment.prisma',
    'Lot': 'lot.prisma', 'InventoryMovement': 'inventory-movement.prisma',
    'SyncQueue': 'sync-queue.prisma',
  },
  'server-only': {
    'User': 'auth.prisma', 'UserSession': 'auth.prisma', 'Workstation': 'auth.prisma',
    'Supplier': 'supplier.prisma',
    'PurchaseOrder': 'purchase-order.prisma', 'PurchaseOrderItem': 'purchase-order.prisma',
    'PurchaseReception': 'purchase-reception.prisma', 'PurchaseReceptionItem': 'purchase-reception.prisma',
    'SupplierReturn': 'supplier-return.prisma', 'SupplierReturnItem': 'supplier-return.prisma',
    'InventoryAdjustmentDocument': 'inventory-adjustment.prisma',
    'PhysicalCount': 'physical-count.prisma', 'AutoExpirationJob': 'auto-expiration-job.prisma',
    'Prescription': 'prescription.prisma',
    'ClientReturn': 'client-return.prisma', 'ClientReturnItem': 'client-return.prisma',
    'ClientReturnItemLot': 'client-return.prisma',
    'FiscalIssuerConfig': 'fiscal-config.prisma', 'TechProviderConfig': 'fiscal-config.prisma',
    'FiscalResolution': 'fiscal-resolution.prisma', 'FiscalResolutionAllocation': 'fiscal-resolution.prisma',
    'FiscalDocument': 'fiscal-document.prisma',
    'SystemConfig': 'system-config.prisma', 'AuditLog': 'audit-log.prisma',
  },
};

// ---- Write helpers ----

function writeFile(dir, filename, comment, modelBlocks, enumBlocks) {
  const out = [
    `// ${comment}`,
    `// This file is generated by scripts/split-schema.mjs.`,
    '',
  ];
  if (enumBlocks) {
    for (const e of Array.isArray(enumBlocks) ? enumBlocks : [enumBlocks]) {
      out.push(`enum ${e.name} {`);
      for (const l of e.lines) {
        const t = l.trim();
        if (t.startsWith('enum') || t === '}') continue;
        if (t.startsWith('//') || t.startsWith('///')) { out.push(l); continue; }
        out.push(`  ${t}`);
      }
      out.push('}');
      out.push('');
    }
  }
  for (const block of modelBlocks || []) {
    out.push(`model ${block.name} {`);
    for (const line of block.lines) {
      if (line.trim() === `model ${block.name} {` || line.trim() === '}') continue;
      out.push(line.replace(/\t/g, '  '));
    }
    out.push('}');
    out.push('');
  }
  writeFileSync(join(dir, filename), out.join('\n'), 'utf-8');
}

// ---- Main ----

function main() {
  for (const dir of [SHARED_DIR, SERVER_ONLY_DIR]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });
  }

  const text = readFileSync(SCHEMA_FILE, 'utf-8');
  const blocks = parseSchema(text);
  console.log(`Parsed ${blocks.length} blocks`);

  // Categorize
  const sharedModels = [], serverModels = [], sharedEnums = [], serverEnums = [];
  for (const block of blocks) {
    const cat = classifyBlock(block);
    if (cat === 'shared' && block.type === 'model') sharedModels.push(block);
    else if (cat === 'server-only' && block.type === 'model') serverModels.push(block);
    else if (cat === 'shared' && block.type === 'enum') sharedEnums.push(block);
    else if (cat === 'server-only' && block.type === 'enum') serverEnums.push(block);
  }

  console.log(`  → ${sharedModels.length} shared models, ${serverModels.length} server-only models`);
  console.log(`  → ${sharedEnums.length} shared enums, ${serverEnums.length} server-only enums`);

  // Cache original model lines
  for (const block of [...sharedModels, ...serverModels]) {
    ALL_MODEL_LINES.set(block.name, block.lines);
  }

  // Flatten both sets
  for (const block of sharedModels) {
    block.lines = flattenModel(block.name, 'shared');
  }
  for (const block of serverModels) {
    block.lines = flattenModel(block.name, 'server-only');
  }

  // Group by file
  const sharedFiles = new Map();
  const serverFiles = new Map();

  // Shared enums in one file
  if (sharedEnums.length > 0) {
    sharedFiles.set('_shared-enums.prisma', []);
    for (const e of sharedEnums) {
      sharedFiles.get('_shared-enums.prisma').push(e);
    }
  }

  for (const block of sharedModels) {
    const f = GROUP_FILE.shared[block.name] || `${block.name.toLowerCase()}.prisma`;
    if (!sharedFiles.has(f)) sharedFiles.set(f, []);
    // Use a different structure: store model blocks directly without enum wrapping
    if (!sharedFiles.get(f)._models) sharedFiles.get(f)._models = [];
    sharedFiles.get(f)._models.push(block);
  }

  if (serverEnums.length > 0) {
    serverFiles.set('_server-only-enums.prisma', []);
    for (const e of serverEnums) {
      serverFiles.get('_server-only-enums.prisma').push(e);
    }
  }

  for (const block of serverModels) {
    const f = GROUP_FILE['server-only'][block.name] || `${block.name.toLowerCase()}.prisma`;
    if (!serverFiles.has(f)) serverFiles.set(f, []);
    if (!serverFiles.get(f)._models) serverFiles.get(f)._models = [];
    serverFiles.get(f)._models.push(block);
  }

  // Write shared files
  for (const [filename, data] of sharedFiles) {
    const enumBlocks = data.length > 0 ? data.filter(b => b.type === 'enum') : null;
    const models = data._models || data.filter(b => b.type === 'model');
    writeFile(SHARED_DIR, filename,
      'Shared schema fragment — included in both full and local builds.',
      models.length > 0 ? models : [],
      enumBlocks);
    console.log(`  ✓ shared/${filename}`);
  }

  // Write server-only files
  for (const [filename, data] of serverFiles) {
    const enumBlocks = data.length > 0 ? data.filter(b => b.type === 'enum') : null;
    const models = data._models || data.filter(b => b.type === 'model');
    writeFile(SERVER_ONLY_DIR, filename,
      'Server-only schema fragment — only included in the full build.',
      models,
      enumBlocks);
    console.log(`  ✓ server-only/${filename}`);
  }

  console.log(`\nDone.`);
}

main();
