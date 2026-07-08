Cómo usar — comandos simples
Opción 1: One-command (recomendado para primera vez)
# Desde la raíz del proyecto — hace TODO: Docker, dependencias, schema, seed
.\scripts\setup-dev.ps1
Opción 2: Paso a paso (más control)
# 1. Levantar bases de datos
docker compose -f docker-compose.dev.yml up -d

# 2. Instalar dependencias (solo primera vez)
pnpm install

# 3. Generar cliente Prisma
pnpm db:generate

# 4. Pushear schema
pnpm dev:db:push

# 5. Poblar datos de prueba
pnpm dev:db:seed

# 6. Iniciar servidor
pnpm dev:start
Opción 3: Todo desde root con un solo comando
pnpm setup:dev     # instala + genera + infra + push + seed
pnpm dev           # inicia server + pos-desktop en paralelo
Datos de prueba incluidos en el seed (idempotente)
Entidad	Cantidad
Usuarios	5 (admin, cashier1, cashier2, inventory, accountant)
Workstations	2 (Caja Principal, Caja Secundaria)
Categorías	10 (ANALGÉSICOS, ANTIBIÓTICOS, etc.)
Formas farmacéuticas	9 (TABLETA, CÁPSULA, JARABE, etc.)
Esquemas de impuestos	3 (IVA 19%, IVA 5%, Exento)
Métodos de pago	7 (Efectivo, Débito, Crédito, PSE, Nequi, Daviplata)
Productos	25 (con precios, tax histories, y códigos de barras EAN13)
Proveedores	3 (Disfarma, Colvan, Cruz Verde)
Clientes	10 (8 particulares + 2 institucionales)
Lotes de inventario	25 (con stock inicial y movimientos INITIAL_STOCK)
Turnos de caja	2 (1 abierto hoy, 1 cerrado ayer con conteo)
Credenciales de login
admin      / Admin123!      → ADMIN
cashier1   / Cashier123!    → CASHIER
inventory  / Inventory123!  → INVENTORY_ASSISTANT
accountant / Accountant123! → ACCOUNTANT
Para el POS Desktop
El POS desktop usa PGlite (PostgreSQL embebido) — no necesita Docker. Solo necesita que el servidor esté corriendo:
cd apps/pos-desktop
pnpm dev
El Vite dev server arranca en http://localhost:5174 y se conecta a la API del server en http://localhost:3000 (configurado en apps/pos-desktop/.env).
Para tests E2E
El script existente sigue funcionando igual:
.\scripts\test-e2e.ps1
Usa docker-compose.test.yml (puertos 5433 y 6380, sin persistencia) y levanta/baja automáticamente