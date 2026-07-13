---
id: screen-sync-health
title: Salud de Sincronización
keywords:
  - sincronización
  - sync
  - estado
  - pendiente
  - error
  - cola
audience: manager
lastUpdated: 2026-07-12
route: sync-health
---

# Salud de Sincronización

La pantalla de salud de sincronización muestra el estado de la cola de sincronización con el servidor.

## Información disponible

- **Cola de operaciones**: número de operaciones pendientes, fallidas, y en error permanente
- **Historial de intentos**: cuándo fue el último intento de sincronización
- **Cronología de salud**: gráfico de operaciones completadas vs fallidas por hora
- **Métricas**: tiempo desde el último sync exitoso, velocidad de procesamiento

## Cómo interpretar los estados

| Estado | Significado |
|--------|-------------|
| PENDING | Esperando ser enviado al servidor |
| IN_PROGRESS | Enviándose actualmente |
| COMPLETED | Procesado exitosamente por el servidor |
| FAILED | Error temporal — se reintentará automáticamente |
| PERMANENT_FAILURE | Error definitivo — requiere intervención del manager |

## Acciones disponibles

- **Reintentar**: reintenta todas las operaciones fallidas
- **Descartar**: descarta operaciones en error permanente (solo manager)
- **Exportar**: exporta el registro de operaciones a CSV

## Problemas comunes

### Operaciones stuck en PENDING
1. Verifica la conexión de red
2. Confirma que el servidor esté accesible
3. Usa "Sincronizar ahora" para forzar un intento

### Errores permanentes (PERMANENT_FAILURE)
1. Revisa el mensaje de error para cada operación
2. Si es un error de validación, corrige los datos localmente
3. Si es un conflicto, contacta al administrador del sistema
