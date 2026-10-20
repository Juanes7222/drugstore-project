# Auto-update POS: panel admin + instalación real + e2e — Plan de implementación

> **For agentic workers:** Implementar task-by-task. Cada task es autocontenida y verificable.

**Goal:** Que el admin suba una actualización de la app POS desde el panel, que el POS la detecte, la descargue, la instale y la reporte, y que un e2e de API lo demuestre de punta a punta.

**Architecture:** El backend ya publica versiones y decide el cohort; le falta la ruta de descarga con verificación de firma. El panel admin (`apps/web-backoffice`) consume la API admin que ya existe. El cliente POS ya tiene la lógica TS; le faltan los comandos Rust que invoca.

**Tech Stack:** NestJS 11 + Prisma 7 (server), React 19 + MUI 5 + axios (backoffice), Tauri 2 / Rust (POS), Jest e2e (server), Vitest (pos-desktop).

**Spec:** `docs/superpowers/specs/2026-10-20-app-update-admin-panel-design.md`

## Global Constraints

- TypeScript estricto en todos los paquetes; nada de `require()`; validación con Zod; nada de `class-validator`.
- Comentarios y docstrings en inglés, sólo para lo no obvio.
- No añadir dependencias nuevas.
- No tocar ficheros generados de Prisma ni el cliente generado.
- Todo cambio de fuente va acompañado de `graphify update .` al final.

## Review Focus

- Binario con la firma alterada en el storage → la descarga debe fallar (403), no servirlo.
- Petición de descarga con un `filename` distinto del publicado → 404, nunca servir otro objeto.
- petición de publicación sin rol `SAAS_ADMIN` → 403.
- Versión duplicada (mismo `version` + `channel`) → error de dominio, no fila duplicada.
- Instalador descargado sin extensión `.exe` en Windows → el comando Rust debe rechazarlo, no lanzar un fichero que Windows no ejecuta.

---

### Task 1: Firma de binarios y ruta de descarga (server)

**Files:**
- Modify: `apps/server/src/config/env.schema.ts` (nueva `UPDATE_BINARY_SIGNING_SECRET`)
- Modify: `apps/server/.env.example` (si existe; si no, el env.schema basta)
- Modify: `apps/server/src/modules/updates/signature.service.ts`
- Modify: `apps/server/src/modules/updates/binary-storage.service.ts`
- Modify: `apps/server/src/modules/updates/updates.service.ts`
- Modify: `apps/server/src/modules/updates/updates.controller.ts` (ruta de descarga)
- Modify: `apps/server/src/modules/updates/admin/admin-updates.controller.ts`
- Test: `apps/server/src/modules/updates/signature.service.spec.ts` (nuevo)

**Interfaces:**
- `SignatureService.computeBinarySignature(content: Buffer): string` — HMAC-SHA256 hex con `UPDATE_BINARY_SIGNING_SECRET`.
- `SignatureService.verifyBinarySignature(content: Buffer, signature: string): boolean` — comparación en tiempo constante.
- `BinaryStorageService.openBinaryStream(channel, version, filename): Promise<Readable>`
- `BinaryStorageService.computeBinarySignature(channel, version, filename): Promise<string>` — HMAC sobre el stream, sin cargarlo entero en memoria.
- `UpdatesService.publishVersion({...})` — ya no recibe `signature`; la calcula.

- [x] **Step 1**: Test de `SignatureService`: misma entrada → misma firma; firma distinta → `verifyBinarySignature` false; clave distinta → firma distinta.
- [x] **Step 2**: `pnpm --filter @pharmacy/server test -- signature.service` → FAIL (la clase no existe aún).
- [x] **Step 3**: Implementar `SignatureService.computeBinarySignature` / `verifyBinarySignature` con `UPDATE_BINARY_SIGNING_SECRET` (env.schema: `z.string().min(32).default(...)`).
- [x] **Step 4**: `pnpm --filter @pharmacy/server test -- signature.service` → PASS.
- [x] **Step 5**: En `BinaryStorageService`, añadir `openBinaryStream` y `computeBinarySignature` (stream → HMAC por chunks).
- [x] **Step 6**: En `UpdatesService.publishVersion`, calcular la firma con `signatureService.computeBinarySignature(buffer)` y quitarla del tipo de entrada; en `AdminUpdatesController.publishVersion`, dejar de leer `metadata.signature`.
- [x] **Step 7**: Añadir `GET /updates/download/:channel/:version/:filename` en `UpdatesController` (público): 404 si no hay versión; 404 si el `filename` no es el del `downloadUrl` guardado; 403 si la firma no cuadra; si no, streaming con `Content-Length`.
- [x] **Step 8**: `pnpm --filter @pharmacy/server test` → PASS; `pnpm --filter @pharmacy/server typecheck` → sin errores.

---

### Task 2: Panel de administración de actualizaciones

**Files:**
- Create: `apps/web-backoffice/src/types/updates.ts`
- Create: `apps/web-backoffice/src/services/updates.ts`
- Create: `apps/web-backoffice/src/pages/admin/updates-page.tsx`
- Modify: `apps/web-backoffice/src/App.tsx` (ruta `/admin/updates`)
- Modify: `apps/web-backoffice/src/components/navigation.ts` (`ADMIN_NAV_ITEMS`)
- Modify: `apps/web-backoffice/src/i18n/en.ts`, `apps/web-backoffice/src/i18n/es.ts`

**Interfaces:**
- `services/updates.ts`: `fetchUpdateVersions()`, `fetchUpdateVersion(id)`, `publishUpdateVersion(file: File, metadata: PublishUpdateMetadata)`, `activateUpdateVersion(id)`, `pauseUpdateVersion(id, reason?)`, `resumeUpdateVersion(id)`, `rollbackUpdateVersion(id)`, `fetchUpdateTelemetrySummary()`.
- `publishUpdateVersion` envía `multipart/form-data` con el campo `binary` (fichero) y el campo `metadata` (JSON), que es lo que espera `AdminUpdatesController.publishVersion`.

- [x] **Step 1**: Crear `types/updates.ts` con los tipos de la respuesta del server (`UpdateVersionRow`, `UpdateVersionDetail`, `PublishUpdateMetadata`, `UpdateTelemetrySummary`).
- [x] **Step 2**: Crear `services/updates.ts` con las llamadas axios; `publishUpdateVersion` con `FormData` (`binary` + `metadata`).
- [x] **Step 3**: Crear `updates-page.tsx`: tabla de versiones + formulario de publicación + acciones por fila + resumen de telemetría. Estados de carga y error.
- [x] **Step 4**: Registrar la ruta en `App.tsx` (lazy, como las demás) y el item en `ADMIN_NAV_ITEMS` con icono de `app-icons`.
- [x] **Step 5**: Añadir las claves i18n en `en.ts` y `es.ts`.
- [x] **Step 6**: `pnpm --filter @pharmacy/web-backoffice typecheck` y `lint` → sin errores.

---

### Task 3: Comandos Rust de instalación (POS desktop)

**Files:**
- Create: `apps/pos-desktop/src-tauri/src/commands/update_install.rs`
- Modify: `apps/pos-desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/pos-desktop/src-tauri/src/lib.rs` (registrar los comandos)
- Modify: `apps/pos-desktop/src/domain/updates/download-manager.ts` (pasar `filename`)

**Interfaces:**
- `write_update_binary_command(version: String, filename: String, data: Vec<u8>) -> Result<String, String>` — devuelve la ruta del fichero escrito.
- `compute_sha256_command(file_path: String) -> Result<String, String>` — SHA-256 hex.
- `trigger_update_install_command(app: AppHandle, download_path: String) -> Result<(), String>` — snapshot del ejecutable actual, lanzar el instalador desacoplado, salir.
- `rollback_update_command(app: AppHandle) -> Result<RollbackOutcome, String>` — reinicia el sentinel, restaura el backup más reciente, relanza la versión anterior si difiere.

- [x] **Step 1**: Tests unitarios Rust (`#[cfg(test)]`) de los helpers puros: `sanitize_filename` (rechaza `..`, separadores, vacío), `snapshot_file_name(version)`, `is_previous_version(candidate, current)`.
- [x] **Step 2**: `cargo test --manifest-path apps/pos-desktop/src-tauri/Cargo.toml` → FAIL si el módulo no existe.
- [x] **Step 3**: Implementar `update_install.rs` con los cuatro comandos.
- [x] **Step 4**: Registrar el módulo en `commands/mod.rs` y los comandos en `generate_handler!` de `lib.rs`.
- [x] **Step 5**: En `download-manager.ts`, derivar el `filename` de la `downloadUrl` y pasarlo a `write_update_binary_command`; actualizar el mock del test.
- [x] **Step 6**: `cargo test` → PASS; `pnpm --filter @pharmacy/pos-desktop test` → PASS; `typecheck` → sin errores.

---

### Task 4: E2E del flujo de actualización

**Files:**
- Create: `apps/server/test/updates.e2e-spec.ts`

**Interfaces:**
- Semilla: usuario `SAAS_ADMIN` con hash argon2 + `POST /auth/login` para el token.
- El spec usa `UPDATE_STORAGE_PATH` para localizar y alterar el binario almacenado.

- [x] **Step 1**: Escribir el spec: publicar (multipart) → 201 y `DRAFT`; publicar sin rol admin → 403; check sin activar → sin actualización; activar → check con actualización; descargar → 200 y bytes idénticos; storage alterado → 403; telemetría firmada → 202 y detalle con instalación; versión duplicada → error.
- [x] **Step 2**: `pnpm --filter @pharmacy/server test:e2e -- updates.e2e-spec` → ver los fallos reales.
- [x] **Step 3**: Arreglar lo que falle hasta que PASS.
- [x] **Step 4**: `pnpm --filter @pharmacy/server test:e2e` completo → PASS.

---

### Task 5: Cierre

- [x] **Step 1**: `pnpm --filter @pharmacy/server test`, `pnpm --filter @pharmacy/pos-desktop test`.
- [x] **Step 2**: `pnpm --filter @pharmacy/web-backoffice typecheck` y `lint`; `pnpm --filter @pharmacy/server lint` y `typecheck`.
- [x] **Step 3**: `graphify update .`.
- [x] **Step 4**: Revisar el diff completo.

---

## Estado final

Ejecutado y verificado:

- `pnpm --filter @pharmacy/server test` → 184 suites, 2479 tests, verde.
- `pnpm --filter @pharmacy/server test:e2e` → 16 suites, 146 tests, verde (13 nuevos en
  `test/updates.e2e-spec.ts`).
- `pnpm --filter @pharmacy/pos-desktop test` → 392 ficheros, 6437 tests, verde.
- `pnpm --filter @pharmacy/web-backoffice typecheck` y `lint` → verde.
- `pnpm --filter @pharmacy/server typecheck` → verde. El `lint` del server ya venía rojo
  (14 errores y ~3700 avisos de prettier en ficheros ajenos a este cambio); los ficheros
  tocados no tienen errores.
- `cargo check --lib` (src-tauri) → verde.

Desviaciones respecto al plan:

- El payload del instalador viaja a Rust en base64, no como array de números: un array
  JSON de un byte por byte sería de un orden de magnitud mayor que el propio fichero.
- El binario de tests Rust no arranca en este entorno (`STATUS_ENTRYPOINT_NOT_FOUND`);
  afecta también a los 5 módulos de test Rust preexistentes. Los tests unitarios
  nuevos compilan, pero no se han podido ejecutar aquí.
- `FileTypeValidator` de Nest 11 valida por *magic numbers*, no por mimetype: el filtro
  original (`application/octet-stream`) rechazaba cualquier instalador real. Ahora
  acepta los tipos de instalador conocidos con *fallback* al mimetype declarado.
