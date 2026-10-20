# Auto-update de la app POS: panel de administración + instalación real + e2e

Fecha: 2026-10-20

## Intención

El dueño de la plataforma (rol `SAAS_ADMIN`) necesita subir una actualización de la
app POS desde el panel de administración, que los puestos de trabajo la detecten y la
apliquen solos, y que exista una prueba e2e que demuestre el recorrido completo.

Hoy el backend ya publica versiones y decide quién recibe una actualización, y el
cliente POS ya sabe descargar y verificar el binario. Lo que falta son tres cosas
concretas y un flujo probado.

## Estado actual (verificado)

| Pieza | Estado |
| --- | --- |
| `apps/server/src/modules/updates/*` (publicar, activar, pausar, rollback, check, telemetría, cohort) | Existe |
| API admin `POST/GET /admin/updates/*` (multipart con binario) | Existe, sin UI que la use |
| Cliente POS: check, descarga con SHA-256, telemetría, UI del modal | Existe |
| `GET /updates/download/:channel/:version/:filename` | **No existe** (la `downloadUrl` que se guarda apunta a una ruta muerta) |
| Comandos Rust `write_update_binary_command`, `compute_sha256_command`, `trigger_update_install_command`, `rollback_update_command` | **No existen** (el `invoke` falla en runtime) |
| Panel de administración de actualizaciones | **No existe** |
| Tests e2e del flujo de actualización | **No existen** |

## Objetivo

Recorrido completo, verificado por e2e:

1. El admin sube el instalador desde el panel → el backend lo guarda, lo firma y lo
   registra en `DRAFT`.
2. El admin lo activa → pasa a `ROLLING_OUT` y entra en el cohort por hash de
   workstation.
3. El POS consulta `/updates/check` → recibe versión, `downloadUrl`, `fileHash`.
4. El POS descarga el binario → el server verifica la firma HMAC antes de servirlo; el
   cliente verifica el SHA-256.
5. El POS instala (Rust lanza el instalador y reinicia la app) y reporta telemetría.
6. El panel muestra el estado del rollout y la telemetría.

## Decisiones

- **Firma**: el servidor calcula la firma (HMAC-SHA256 del binario) al publicar. El
  admin ya no manda un string libre. La descarga verifica esa firma y responde 403 si
  no cuadra. El cliente sigue verificando el SHA-256 que le da `/updates/check`.
- **Alcance del cliente**: se implementan los comandos Rust que faltan, incluida la
  instalación real (lanzar el instalador y reiniciar) y el rollback (restaurar el
  backup y relanzar la versión anterior).
- **Tests**: e2e de API en `apps/server` (Jest + Postgres real, infra que ya existe) +
  tests unitarios Rust de los helpers puros. Sin Playwright: `apps/web-backoffice` no
  tiene infra de tests y el flujo crítico es de API.

## Diseño

### 1. Server — ruta de descarga con verificación de firma

`GET /updates/download/:channel/:version/:filename` (público, igual que `/updates/check`).

1. Busca la `UpdateVersion` por `(channel, version)`; 404 si no existe.
2. Comprueba que el `filename` de la URL es el del binario publicado (comparando con
   el `downloadUrl` guardado); 404 si no coincide. Esto evita path traversal y
   garantiza que sólo se sirve el binario registrado.
3. Verifica la firma: HMAC-SHA256 de los bytes almacenados con
   `UPDATE_BINARY_SIGNING_SECRET`, comparado en tiempo constante con la columna
   `signature`. Si no cuadra → 403.
4. Responde el binario en streaming con `Content-Length` y
   `Content-Type: application/octet-stream`.

Cambios:
- `BinaryStorageService`: `openBinaryStream()` y `computeBinarySignature()`.
- `SignatureService`: `computeBinarySignature(buffer)` / `verifyBinarySignature()`
  con la clave de binarios.
- `UpdatesService.publishVersion()`: calcula la firma; deja de aceptar la del cliente.
- `AdminUpdatesController.publishVersion()`: deja de leer `metadata.signature`.
- `env.schema.ts` + `.env.example`: `UPDATE_BINARY_SIGNING_SECRET`.

La verificación se hace en dos pasadas (primero HMAC sobre el stream, luego se sirve
el stream) para no meter 500 MB en memoria.

### 2. Panel de administración — `/admin/updates`

`apps/web-backoffice`:

- `services/updates.ts`: `fetchUpdateVersions`, `fetchUpdateVersion(id)`,
  `publishUpdateVersion(file, metadata)` (multipart), `activateUpdateVersion`,
  `pauseUpdateVersion`, `resumeUpdateVersion`, `rollbackUpdateVersion`,
  `fetchUpdateTelemetrySummary`.
- `types/updates.ts`: tipos de la respuesta del server.
- `pages/admin/updates-page.tsx`: tabla de versiones (versión, canal, tipo, estado,
  % de rollout, tamaño, fecha), formulario de publicación (fichero + versión + canal +
  tipo + estrategia de rollout + notas) y acciones por fila (activar, pausar, reanudar,
  rollback). Resumen de telemetría arriba.
- Ruta en `App.tsx` (`/admin/updates`), item en `ADMIN_NAV_ITEMS`, claves i18n en
  `i18n/en.ts` e `i18n/es.ts`.

### 3. Rust — instalación real

Nuevo módulo `apps/pos-desktop/src-tauri/src/commands/update_install.rs`:

- `write_update_binary_command(version, filename, data)` — escribe el instalador
  descargado en el app data dir y devuelve la ruta. Acepta `filename` para conservar
  la extensión `.exe` (sin ella Windows no puede ejecutarlo).
- `compute_sha256_command(filePath)` — SHA-256 en hex del fichero.
- `trigger_update_install_command(downloadPath)` — valida la ruta, copia el ejecutable
  actual a `<appdata>/rollback/<versión>.exe`, lanza el instalador desacoplado
  (`DETACHED_PROCESS` en Windows) y cierra la app.
- `rollback_update_command()` — reinicia el sentinel de crash, restaura el backup más
  reciente y relanza el ejecutable anterior cuando su versión difiere de la que está
  corriendo.

TS: `download-manager.ts` pasa el `filename` extraído de la `downloadUrl` a
`write_update_binary_command`.

Tests unitarios Rust (`#[cfg(test)]`) para la validación de ruta, el nombre del
snapshot y la comparación de versiones.

### 4. E2E — `apps/server/test/updates.e2e-spec.ts`

Postgres real (mismo patrón que `sync-hub-convergence.e2e-spec.ts`): usuario
`SAAS_ADMIN` sembrado con argon2 + login por `POST /auth/login`.

1. Publicar con multipart → versión en `DRAFT`, `fileHash`/`fileSize` correctos.
2. Publicar sin rol admin → 403.
3. Sin activar, `/updates/check` no ofrece la actualización.
4. Activar → `/updates/check` ofrece la actualización con `downloadUrl` y `fileHash`.
5. Descargar → 200, bytes idénticos al subido, `content-length` correcto.
6. Binario alterado en el storage → descarga 403 (firma no cuadra).
7. Telemetría firmada con HMAC → 202; el detalle de la versión muestra la instalación
   y la tasa de éxito.
8. Versión duplicada → error de dominio.

## Fuera de alcance

- `tauri-plugin-updater` y el pipeline de firma de artefactos (NSIS) en CI.
- Tests de navegador (Playwright) del panel.
- UI de opt-in de canal por sede (la API ya existe).

## Validación

- `pnpm --filter @pharmacy/server test:e2e` (spec de actualizaciones).
- `pnpm --filter @pharmacy/server test` (unit).
- `pnpm --filter @pharmacy/web-backoffice typecheck` y `lint`.
- `cargo test` en `apps/pos-desktop/src-tauri` (si hay toolchain).
- `graphify update .`
