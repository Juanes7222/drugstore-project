# Plan de Refactorización — POS Desktop

**Versión:** 1.0
**Fecha:** Julio 2026
**Objetivo:** Refactorizar archivos grandes y monolíticos (0% cobertura) en piezas más pequeñas y testeables antes de escribir nuevos tests. La meta es alcanzar 80%+ de cobertura de líneas sin tener que mockear componentes enteros.

---

## Tabla de Contenidos

1. [Diagnóstico General](#1-diagnóstico-general)
2. [Principios de Refactorización](#2-principios-de-refactorización)
3. [Priorización](#3-priorización)
4. [Refactorización 1: `service-context.tsx`](#4-refactorización-1-service-contexttsx)
5. [Refactorización 2: `login.page.tsx`](#5-refactorización-2-loginpagetsx)
6. [Refactorización 3: `command-palette.tsx`](#6-refactorización-3-command-palettetsx)
7. [Refactorización 4: `help-viewer.tsx`](#7-refactorización-4-help-viewertsx)
8. [Refactorización 5: `shortcut-cheatsheet.tsx`](#8-refactorización-5-shortcut-cheatsheettsx)
9. [Refactorización 6: `recovery.page.tsx`](#9-refactorización-6-recoverypagetsx)
10. [Refactorización 7: `sales-transaction.tsx`](#10-refactorización-7-sales-transactiontsx)
11. [Resumen de Esfuerzo](#11-resumen-de-esfuerzo)
12. [Orden de Ejecución](#12-orden-de-ejecución)

---

## 1. Diagnóstico General

| Archivo | Líneas | Cobertura | Prioridad | Problema Principal |
|---------|--------|-----------|-----------|-------------------|
| `renderer/components/common/service-context.tsx` | 470 | **0%** | 🔴 **CRÍTICA** | DI monolítico: 17 servicios en un solo `useEffect`. No se puede testear sin montar todo el árbol React. |
| `renderer/components/assistant/help-viewer.tsx` | 1.223 | **0%** | 🔴 ALTA | ~500 líneas de renderizador Markdown inline. Búsqueda, sidebar, temas todo mezclado. |
| `renderer/components/assistant/command-palette.tsx` | 713 | **0%** | 🔴 ALTA | Lógica de búsqueda, navegación por teclado, agrupación y renderizado en un solo componente. |
| `renderer/components/assistant/shortcut-cheatsheet.tsx` | 703 | **0%** | 🔴 ALTA | Captura de teclas, detección de conflictos, búsqueda y personalización todo en uno. |
| `renderer/components/auth/login.page.tsx` | 497 | **0%** | 🟡 MEDIA | Lógica de autenticación (PIN, password, 2FA, lockout) mezclada con JSX. Datos placeholder inline. |
| `domain/recovery/recovery.page.tsx` | 276 | **0%** | 🟡 MEDIA | Wiring container mediano. Ya separa presentación → `RecoveryPageView`. Fácil de extraer hook. |
| `renderer/components/SalesTransaction/sales-transaction.tsx` | 134 | **0%** | 🟢 BAJA | Relativamente pequeño. Factory de CatalogService inline. |

**Total de líneas a refactorizar:** ~4.016

---

## 2. Principios de Refactorización

1. **Extraer lógica pura primero** — toda función que no dependa de React (formatDate, renderMarkdown, parseInline, getItemLabel, formatCombo, etc.) debe vivir en `src/domain/` o `src/common/` como funciones exportadas puras y testeadas unitariamente.
2. **Extraer hooks de lógica de estado** — cada componente grande debe tener un hook `use<Nombre>` que contenga toda la lógica de estado, efectos secundarios, y llamadas a servicios. El componente se reduce a conectar el hook con componentes presentacionales.
3. **No mezclar responsabilidades** — el hook no renderiza JSX; el componente no contiene lógica de estado compleja.
4. **Mantener la interfaz pública estable** — los cambios deben ser compatibles hacia atrás. No cambiar nombres de exports ni props de componentes públicos durante la refactorización.
5. **Invocar al agente frontend-pos para componentes presentacionales nuevos** — los hooks y factories son responsabilidad del agente pos-local; los nuevos componentes visuales (SearchInput, ShortcutRow, etc.) los diseña frontend-pos.
6. **Invocar al agente pos-testing para los tests** — después de cada refactorización, pos-testing escribe los tests correspondientes.

---

## 3. Priorización

La priorización se basa en **impacto en cobertura × facilidad de testeo**:

| Prioridad | Archivo | Justificación |
|-----------|---------|---------------|
| **P0** | `service-context.tsx` | Es la dependencia raíz de todos los demás servicios. Sin tests aquí, no se puede mockear limpiamente ningún service hook. |
| **P1** | `command-palette.tsx` + `shortcut-cheatsheet.tsx` + `help-viewer.tsx` | Los tres del assistant comparten estructura similar (modal overlay + búsqueda). Se pueden refactorizar en paralelo. |
| **P2** | `login.page.tsx` | Auth es un dominio core. Ya existen componentes presentacionales separados (PinKeypad, Avatar, TwoFactorModal). |
| **P3** | `recovery.page.tsx` | Ya sigue un patrón decente. Bajo esfuerzo de refactorización. |
| **P4** | `sales-transaction.tsx` | Pequeño pero 0%. Refactorización mínima. |

---

## 4. Refactorización 1: `service-context.tsx`

### Archivo actual
`src/renderer/components/common/service-context.tsx` (470 líneas)

### Problemas identificados
- 17 servicios instanciados en un solo `useEffect` de 180 líneas
- `Services` interface monolítica con 17 campos
- 17 convenience hooks que son puro pass-through
- Tauri `invoke` importado dinámicamente dentro de callbacks (no testeable)
- UI de loading y error mezclada con la lógica de inicialización
- Dependencia directa de `getLocalDatabase()`, `isOnline()`, `isContingencyTechKeyPlaceholder()`

### Estrategia de refactorización

**Paso 1:** Extraer factorías de servicios a `src/domain/` por grupo:

```
src/domain/
├── fiscal/
│   ├── fiscal-service.factory.ts    # createFiscalServices(prisma, workstationId) → { fiscalNumberingService, contingencyService, invoiceService, fiscalScheduler }
├── printing/
│   ├── printing-service.factory.ts  # createPrintingServices(prismaClient, baseUrl, authToken) → { printerConfig, printQueue, printRouter, printerHealth, configExport, printingMetrics }
├── peripherals/
│   ├── peripheral-service.factory.ts # createPeripheralServices(printerConfig) → { cashDrawer, customerDisplay }
├── backup/
│   ├── backup-service.factory.ts    # createBackupService() (simple, quizás no necesita factory)
├── updates/
│   ├── update-service.factory.ts    # createUpdateService(prisma, currentVersion, ...)
├── domain-services/
│   ├── domain-service.factory.ts    # createDomainServices(prisma, auth, invoiceService, printRouter) → { returns, adjustments, prescriptions, recoveryLog }
```

Cada factory es una función pura (dependencias in ⇒ servicios out) que se puede testear sin React.

**Paso 2:** Extraer componentes de UI a `src/renderer/components/common/`:

```
src/renderer/components/common/
├── service-loading.tsx       # Loading spinner (extraído del bloque actual)
├── service-error-panel.tsx   # Panel de error fatal (extraído del bloque actual)
```

Estos son presentacionales puros → los diseña frontend-pos.

**Paso 3:** Extraer hook `useServiceInit` a `src/renderer/hooks/`:

```
src/renderer/hooks/
├── use-service-init.ts       # Hook que orquesta getLocalDatabase() → factorías → setInitState
```

Este hook es directamente testeable: se le inyectan factorías mock y se verifica que llame a cada una con las dependencias correctas.

**Paso 4:** Simplificar `ServiceProvider`:

```typescript
// ~80 líneas en lugar de 470
export const ServiceProvider: FC<ServiceProviderProps> = ({ apiBaseUrl, children }) => {
  const initState = useServiceInit({ apiBaseUrl });

  if (initState.status === "error") return <ServiceErrorPanel error={initState.error} />;
  if (initState.status === "loading") return <ServiceLoading />;
  return <ServiceContext.Provider value={initState.services}>{children}</ServiceContext.Provider>;
};
```

**Paso 5:** Mantener los 17 convenience hooks exactamente como están (misma firma, mismo nombre) para no romper importaciones existentes.

### Árbol resultante

```
src/
├── domain/
│   ├── fiscal/fiscal-service.factory.ts      # NUEVO
│   ├── printing/printing-service.factory.ts  # NUEVO
│   ├── peripherals/peripheral-service.factory.ts # NUEVO
│   ├── backup/backup-service.factory.ts      # NUEVO
│   ├── updates/update-service.factory.ts     # NUEVO
│   └── domain-services/domain-service.factory.ts # NUEVO
├── renderer/
│   ├── hooks/use-service-init.ts             # NUEVO
│   ├── components/common/
│   │   ├── service-context.tsx                # REFACTORIZADO (~80 líneas)
│   │   ├── service-loading.tsx                # NUEVO (frontend-pos)
│   │   └── service-error-panel.tsx            # NUEVO (frontend-pos)
```

### Tests a escribir (pos-testing)
- `domain/fiscal/fiscal-service.factory.test.ts`
- `domain/printing/printing-service.factory.test.ts`
- `domain/peripherals/peripheral-service.factory.test.ts`
- `domain/updates/update-service.factory.test.ts`
- `domain/domain-services/domain-service.factory.test.ts`
- `renderer/hooks/use-service-init.test.ts`
- `renderer/components/common/service-context.test.tsx` (integración: verifica que Provider renderice hijos correctamente)

---

## 5. Refactorización 2: `login.page.tsx`

### Archivo actual
`src/renderer/components/auth/login.page.tsx` (497 líneas)

### Problemas identificados
- 90 líneas de JSX + lógica mezclada en el componente principal
- `PLACEHOLDER_USERS` hardcodeado (seed data que debería venir de un servicio)
- Múltiples modos de UI: selección de avatar, input manual, PIN keypad, formulario de password, 2FA, lockout countdown
- Errores mapeados a strings de traducción inline
- `authService` creado con `useState` + lazy initializer

### Estrategia de refactorización

**Paso 1:** Extraer hook `useLoginPage`:

```typescript
// src/renderer/hooks/use-login-page.ts
interface UseLoginPageReturn {
  // Estado
  selectedUser: LocalUserInfo | null;
  showManualInput: boolean;
  identifier: string;
  password: string;
  error: string | null;
  isLoading: boolean;
  requiresTwoFactor: boolean;
  challengeToken: string | null;
  lockoutUntil: Date | null;
  countdown: number;

  // Acciones
  handleUserSelect: (user: LocalUserInfo) => void;
  handlePinComplete: (pin: string) => Promise<void>;
  handlePasswordLogin: () => Promise<void>;
  handleTwoFactorComplete: () => void;
  handleForgotPassword: () => void;
  setShowManualInput: (show: boolean) => void;
  setIdentifier: (id: string) => void;
  setPassword: (pw: string) => void;
}
```

El hook contiene:
- Creación del `AuthService`
- `handlePinComplete` / `handlePasswordLogin` con manejo de errores tipados
- Lockout countdown con `setInterval`
- Redirección si ya hay sesión

**Paso 2:** Extraer `PLACEHOLDER_USERS` a un archivo separado:

```typescript
// src/domain/auth/local-users.ts
export interface LocalUserInfo {
  id: string;
  displayName: string;
  role: RoleType;
  avatarUrl: string | null;
  avatarColor: string | null;
  username: string;
}
export const PLACEHOLDER_USERS: LocalUserInfo[] = [ ... ];
```

**Paso 3:** Extraer componentes presentacionales:

- `AvatarGrid` — grilla de avatars de usuarios
- `ManualLoginForm` — formulario de email + password
- `SelectedUserCredential` — contenedor que muestra el avatar del usuario seleccionado + PIN o password
- `LockoutBanner` — mensaje de lockout con countdown
- `ErrorBanner` — mensaje de error genérico

Estos los diseña frontend-pos.

**Paso 4:** Simplificar `LoginPage`:

```typescript
export const LoginPage: FC = () => {
  const {
    selectedUser, showManualInput, error, isLoading,
    requiresTwoFactor, challengeToken,
    handleUserSelect, handlePinComplete, handlePasswordLogin,
    handleTwoFactorComplete, handleForgotPassword,
    setShowManualInput, setIdentifier, setPassword
  } = useLoginPage();

  if (session) return null;
  if (requiresTwoFactor && challengeToken) {
    return <TwoFactorModal challengeToken={challengeToken} ... />;
  }

  return (
    <div className="flex h-screen ...">
      <AvatarGrid users={PLACEHOLDER_USERS} selectedUser={selectedUser} onSelect={handleUserSelect} />
      {showManualInput && <ManualLoginForm ... />}
      {selectedUser && !showManualInput && <SelectedUserCredential ... />}
      {error && <ErrorBanner message={error} />}
    </div>
  );
};
```

### Árbol resultante

```
src/
├── domain/auth/local-users.ts                # NUEVO (datos + tipo LocalUserInfo)
├── renderer/
│   ├── hooks/use-login-page.ts               # NUEVO
│   ├── components/auth/
│   │   ├── login.page.tsx                    # REFACTORIZADO (~120 líneas)
│   │   ├── avatar-grid.tsx                   # NUEVO (frontend-pos)
│   │   ├── manual-login-form.tsx             # NUEVO (frontend-pos)
│   │   ├── selected-user-credential.tsx      # NUEVO (frontend-pos)
│   │   ├── lockout-banner.tsx                # NUEVO (frontend-pos)
│   │   └── error-banner.tsx                  # NUEVO (frontend-pos)
```

### Tests a escribir (pos-testing)
- `renderer/hooks/use-login-page.test.ts`
- `domain/auth/local-users.test.ts`
- Component tests para cada nuevo componente presentacional

---

## 6. Refactorización 3: `command-palette.tsx`

### Archivo actual
`src/renderer/components/assistant/command-palette.tsx` (713 líneas)

### Problemas identificados
- Búsqueda (performSearch, debounce, build index) mezclada con navegación por teclado y renderizado
- 5 funciones helper (`getItemLabel`, `getItemDescription`, `getItemShortcut`) que deberían estar en `domain/assistant/`
- Agrupación y ordenamiento de resultados inline
- JSX de resultados (groups, items) ~200 líneas

### Estrategia de refactorización

**Paso 1:** Mover helpers a `domain/assistant/`:

```typescript
// src/domain/assistant/palette-helpers.ts
export { getItemLabel, getItemDescription, getItemShortcut, groupResults, CATEGORY_PRIORITY, CATEGORY_ICONS, GROUP_LABEL_KEYS };
```

**Paso 2:** Extraer hook `useCommandPalette`:

```typescript
// src/renderer/hooks/use-command-palette.ts
interface UseCommandPaletteReturn {
  results: IndexableItem[];
  selectedIndex: number;
  isSearching: boolean;
  searchError: string | null;
  groupedResults: { category: IndexableItem["category"]; items: IndexableItem[] }[];
  handleSearchChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  executeItem: (item: IndexableItem) => void;
  inputRef: RefObject<HTMLInputElement>;
  listRef: RefObject<HTMLDivElement>;
}
```

El hook contiene: búsqueda con debounce, navegación por teclado (flechas, enter, escape), ejecución de comandos, reset en open.

**Paso 3:** Extraer componentes presentacionales:

- `SearchInput` — input con icono y placeholder
- `SearchResultGroup` — grupo de resultados con encabezado
- `SearchResultItem` — item individual con label, descripción, shortcut
- `EmptyState` — mensaje cuando no hay resultados
- `SearchErrorState` — mensaje cuando hay error de búsqueda

**Paso 4:** Simplificar `CommandPalette`:

```typescript
export const CommandPalette: FC = () => {
  const { results, selectedIndex, groupedResults, handleSearchChange, handleKeyDown, executeItem, inputRef, listRef } = useCommandPalette();

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {paletteOpen && (
          <Dialog.Portal>
            <Dialog.Overlay asChild>...</Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div ... onKeyDown={handleKeyDown}>
                <SearchInput ref={inputRef} onChange={handleSearchChange} />
                {groupedResults.length === 0 && !isSearching && <EmptyState />}
                {searchError && <SearchErrorState message={searchError} />}
                {groupedResults.map(group => (
                  <SearchResultGroup key={group.category} category={group.category} items={group.items} selectedIndex={selectedIndex} onSelect={executeItem} />
                ))}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
```

### Árbol resultante

```
src/
├── domain/assistant/palette-helpers.ts       # NUEVO (helper functions extraídas)
├── renderer/
│   ├── hooks/use-command-palette.ts          # NUEVO
│   ├── components/assistant/
│   │   ├── command-palette.tsx               # REFACTORIZADO (~120 líneas)
│   │   ├── search-input.tsx                  # NUEVO (frontend-pos)
│   │   ├── search-result-group.tsx           # NUEVO (frontend-pos)
│   │   ├── search-result-item.tsx            # NUEVO (frontend-pos)
│   │   ├── palette-empty-state.tsx           # NUEVO (frontend-pos)
│   │   └── palette-search-error.tsx          # NUEVO (frontend-pos)
```

### Tests a escribir (pos-testing)
- `domain/assistant/palette-helpers.test.ts`
- `renderer/hooks/use-command-palette.test.ts`
- Component tests para cada nuevo componente presentacional

---

## 7. Refactorización 4: `help-viewer.tsx`

### Archivo actual
`src/renderer/components/assistant/help-viewer.tsx` (1.223 líneas)

### Problemas identificados
- **Mayor problema:** ~500 líneas de renderizador Markdown inline (parseInline, renderInline, renderMarkdown, renderTable, etc.)
- Funciones helper de fechas inline (`formatDate`, `isOlderThanSixMonths`, `getEntrySection`, `groupBySection`)
- Búsqueda de ayuda inline
- Sidebar + contenido principal mezclados

### Estrategia de refactorización

**Paso 1:** Extraer renderizador Markdown a `domain/assistant/`:

```typescript
// src/domain/assistant/markdown-renderer.ts
export { parseInline, renderInline, renderMarkdown, renderTable };
export type { InlineSegment };
```

Este módulo es 100% puro (sin React). Toma strings y produce ReactNode[] | InlineSegment[]. Es directamente testeable sin mockear nada.

**Paso 2:** Extraer helpers a `domain/assistant/`:

```typescript
// src/domain/assistant/help-helpers.ts
export { formatDate, isOlderThanSixMonths, getEntrySection, groupBySection, sectionLabelKey };
export type { EntrySection };
```

**Paso 3:** Extraer hook `useHelpViewer`:

```typescript
// src/renderer/hooks/use-help-viewer.ts
interface UseHelpViewerReturn {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filteredEntries: HelpContentEntry[];
  selectedEntry: HelpContentEntry | null;
  selectEntry: (entry: HelpContentEntry) => void;
  groupedEntries: { section: EntrySection; entries: HelpContentEntry[] }[];
  renderedContent: ReactNode[];
  sidebarRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
}
```

**Paso 4:** Extraer componentes presentacionales:

- `HelpSidebar` — lista de temas agrupados por sección con búsqueda
- `HelpContentViewer` — área de contenido principal con markdown renderizado
- `HelpSearchInput` — input de búsqueda
- `HelpWelcomeScreen` — pantalla de bienvenida cuando no hay tema seleccionado
- `HelpOutdatedNotice` — badge de contenido desactualizado (>6 meses)

### Árbol resultante

```
src/
├── domain/assistant/
│   ├── markdown-renderer.ts                  # NUEVO (~200 líneas extraídas)
│   └── help-helpers.ts                      # NUEVO (~50 líneas extraídas)
├── renderer/
│   ├── hooks/use-help-viewer.ts             # NUEVO
│   ├── components/assistant/
│   │   ├── help-viewer.tsx                   # REFACTORIZADO (~200 líneas)
│   │   ├── help-sidebar.tsx                  # NUEVO (frontend-pos)
│   │   ├── help-content-viewer.tsx           # NUEVO (frontend-pos)
│   │   ├── help-search-input.tsx             # NUEVO (frontend-pos)
│   │   ├── help-welcome-screen.tsx           # NUEVO (frontend-pos)
│   │   └── help-outdated-notice.tsx          # NUEVO (frontend-pos)
```

### Tests a escribir (pos-testing)
- `domain/assistant/markdown-renderer.test.ts` — **prioridad alta**: probar parseInline, renderMarkdown con headings, code blocks, tablas, listas, blockquotes
- `domain/assistant/help-helpers.test.ts` — probar formatDate, groupBySection, etc.
- `renderer/hooks/use-help-viewer.test.ts`
- Component tests para cada nuevo componente presentacional

---

## 8. Refactorización 5: `shortcut-cheatsheet.tsx`

### Archivo actual
`src/renderer/components/assistant/shortcut-cheatsheet.tsx` (703 líneas)

### Problemas identificados
- Lógica de captura de teclas con detección de conflictos inline
- Búsqueda y filtrado inline
- Personalización de atajos (capture mode, restore default) inline
- JSX de ~400 líneas para las filas de atajos

### Estrategia de refactorización

**Paso 1:** Extraer helpers a `domain/assistant/`:

```typescript
// src/domain/assistant/shortcut-helpers.ts
export { formatCombo, isModifierOnly, GROUP_LABEL_KEYS, CONTEXT_ORDER };
```

**Paso 2:** Extraer hook `useShortcutCheatsheet`:

```typescript
// src/renderer/hooks/use-shortcut-cheatsheet.ts
interface UseShortcutCheatsheetReturn {
  searchQuery: string;
  capturingId: string | null;
  conflictDescription: string | null;
  groupedBindings: { context: ShortcutContext; bindings: ShortcutBinding[] }[];
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  startCapture: (commandId: string) => void;
  cancelCapture: () => void;
  restoreDefault: (commandId: string) => void;
  isCustom: (commandId: string) => boolean;
  inputRef: RefObject<HTMLInputElement>;
}
```

**Paso 3:** Extraer componentes presentacionales:

- `ShortcutRow` — fila individual con key combo, descripción, botón de personalizar
- `ShortcutGroup` — grupo de atajos por contexto con encabezado
- `ShortcutSearchInput` — input de búsqueda
- `CaptureModeOverlay` — indicador visual de modo de captura
- `ConflictWarning` — mensaje de conflicto al personalizar

### Árbol resultante

```
src/
├── domain/assistant/shortcut-helpers.ts     # NUEVO
├── renderer/
│   ├── hooks/use-shortcut-cheatsheet.ts     # NUEVO
│   ├── components/assistant/
│   │   ├── shortcut-cheatsheet.tsx          # REFACTORIZADO (~120 líneas)
│   │   ├── shortcut-row.tsx                 # NUEVO (frontend-pos)
│   │   ├── shortcut-group.tsx               # NUEVO (frontend-pos)
│   │   ├── shortcut-search-input.tsx        # NUEVO (frontend-pos)
│   │   ├── capture-mode-overlay.tsx         # NUEVO (frontend-pos)
│   │   └── conflict-warning.tsx             # NUEVO (frontend-pos)
```

### Tests a escribir (pos-testing)
- `domain/assistant/shortcut-helpers.test.ts`
- `renderer/hooks/use-shortcut-cheatsheet.test.ts`
- Component tests para cada nuevo componente presentacional

---

## 9. Refactorización 6: `recovery.page.tsx`

### Archivo actual
`src/domain/recovery/recovery.page.tsx` (276 líneas)

### Problemas identificados
- Ya sigue un buen patrón (state → presentational component `RecoveryPageView`)
- La lógica de carga, auto-refresh, integridad de BD y backups está en el componente
- `formatAge` helper inline

### Estrategia de refactorización

**Paso 1:** Mover `formatAge` a `src/common/`:

```typescript
// src/common/format-age.ts
export function formatAge(isoString: string): string { ... }
```

**Paso 2:** Extraer hook `useRecoveryPage`:

```typescript
// src/renderer/hooks/use-recovery-page.ts
interface UseRecoveryPageReturn {
  loading: boolean;
  error: string | null;
  backups: BackupViewModel[];
  logEntries: RecoveryLogEntry[];
  healthStatus: RecoveryHealthStatus;
  backupHealth: BackupHealthLevel;
  selectedBackup: BackupMetadata | null;
  verifyReport: VerificationReport | null;
  restoreConfirmText: string;
  isRestoring: boolean;
  isVerifying: string | null;
  isCreatingBackup: boolean;
  gapHint: number | null;
  activeTab: "backups" | "log";
  setActiveTab: (tab: "backups" | "log") => void;
  setRestoreConfirmText: (text: string) => void;
  handleCreateBackup: () => Promise<void>;
  handleVerify: (id: string) => Promise<void>;
  handleSelectBackup: (backup: BackupMetadata) => Promise<void>;
  handleRestore: () => Promise<void>;
  handleCancelRestore: () => void;
  handleRefresh: () => Promise<void>;
  hasAccess: boolean;
}
```

El hook contiene: `loadData` con auto-refresh, integridad al montar, handlers de backup/verify/restore.

**Paso 3:** Mover `recovery.page.tsx` a `src/renderer/components/recovery/` (estaba en `domain/` por error histórico).

### Árbol resultante

```
src/
├── common/format-age.ts                     # NUEVO (extraído)
├── renderer/
│   ├── hooks/use-recovery-page.ts           # NUEVO
│   ├── components/recovery/
│   │   ├── recovery.page.tsx                # MOVIDO + REFACTORIZADO (~50 líneas)
│   │   ├── recovery-page-view.tsx           # ya existe (frontend-pos)
```

### Tests a escribir (pos-testing)
- `common/format-age.test.ts`
- `renderer/hooks/use-recovery-page.test.ts`
- `renderer/components/recovery/recovery.page.test.tsx`

---

## 10. Refactorización 7: `sales-transaction.tsx`

### Archivo actual
`src/renderer/components/SalesTransaction/sales-transaction.tsx` (134 líneas)

### Problemas identificados
- `createCatalogService` inline con lógica de entorno (mock vs HTTP)
- `addToCart` con lógica de dispatch y transformación de datos

### Estrategia de refactorización

**Paso 1:** Extraer `createCatalogService` a `src/infrastructure/`:

```typescript
// src/infrastructure/catalog-service-factory.ts
export function createCatalogService(): CatalogService { ... }
```

**Paso 2:** Extraer hook `useSalesTransaction`:

```typescript
// src/renderer/hooks/use-sales-transaction.ts
interface UseSalesTransactionReturn {
  catalogService: CatalogService;
  pendingItem: CatalogItem | null;
  isDialogOpen: boolean;
  handleSelect: (item: CatalogItem) => void;
  handleConfirmRestricted: () => void;
  handleCancelRestricted: () => void;
  handleCheckout: () => void;
}
```

### Árbol resultante

```
src/
├── infrastructure/catalog-service-factory.ts  # NUEVO
├── renderer/
│   ├── hooks/use-sales-transaction.ts         # NUEVO
│   ├── components/SalesTransaction/
│   │   ├── sales-transaction.tsx              # REFACTORIZADO (~60 líneas)
```

### Tests a escribir (pos-testing)
- `infrastructure/catalog-service-factory.test.ts`
- `renderer/hooks/use-sales-transaction.test.ts`
- `renderer/components/SalesTransaction/sales-transaction.test.tsx`

---

## 11. Resumen de Esfuerzo

| Refactorización | Archivos a crear | Archivos a modificar | Esfuerzo estimado (horas) | Dependencia |
|----------------|-----------------|---------------------|--------------------------|-------------|
| service-context.tsx | 6 | 1 | 4h | Ninguna (base) |
| login.page.tsx | 7 | 1 | 3h | service-context (usa hooks) |
| command-palette.tsx | 6 | 1 | 2.5h | service-context |
| help-viewer.tsx | 7 | 1 | 4h | service-context |
| shortcut-cheatsheet.tsx | 6 | 1 | 2.5h | service-context |
| recovery.page.tsx | 2 | 2 | 1.5h | service-context (usa useBackupService) |
| sales-transaction.tsx | 2 | 1 | 1h | service-context |
| **Total** | **36** | **8** | **18.5h** | |

**Nota:** service-context.tsx es la dependencia de todos los demás. Debe refactorizarse primero.

---

## 12. Orden de Ejecución

```
Fase 1 (P0): service-context.tsx
  └── Tests: factories + use-service-init + service-context integración

Fase 2 (P1): Los 3 componentes del assistant EN PARALELO
  ├── command-palette.tsx
  │   └── Tests: palette-helpers + use-command-palette + componentes
  ├── help-viewer.tsx
  │   └── Tests: markdown-renderer + help-helpers + use-help-viewer + componentes
  └── shortcut-cheatsheet.tsx
      └── Tests: shortcut-helpers + use-shortcut-cheatsheet + componentes

Fase 3 (P2): login.page.tsx
  └── Tests: local-users + use-login-page + componentes

Fase 4 (P3): recovery.page.tsx
  └── Tests: format-age + use-recovery-page + recovery.page

Fase 5 (P4): sales-transaction.tsx
  └── Tests: catalog-service-factory + use-sales-transaction + sales-transaction
```

Cada fase incluye:
1. **Refactorización** (pos-local agent) — extraer factories, hooks, helpers
2. **Componentes presentacionales** (frontend-pos agent) — diseñar nuevos componentes UI
3. **Tests** (pos-testing agent) — escribir tests para todo el código nuevo y refactorizado

Al finalizar las 5 fases, la cobertura proyectada debería alcanzar **80%+** sin necesidad de mockear componentes monolíticos enteros.
