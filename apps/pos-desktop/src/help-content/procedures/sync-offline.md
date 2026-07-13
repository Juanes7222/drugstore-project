---
id: proc-sync-offline
title: Qué hacer si la red está caída
keywords:
  - offline
  - desconectado
  - red
  - sincronización
  - contingencia
audience: both
lastUpdated: 2026-07-12
---

# Qué hacer si la red está caída

El sistema POS está diseñado para funcionar sin conexión a internet. Sigue estos pasos:

## 1. Verifica la conexión

- El indicador de conexión aparece en la barra superior (verde = conectado, rojo = desconectado)
- Si estás desconectado, el sistema sigue funcionando con datos locales

## 2. Continúa trabajando normalmente

- **Ventas**: puedes registrar y confirmar ventas sin conexión. Se guardan en la cola de sincronización.
- **Devoluciones**: igual que las ventas, se procesan localmente.
- **Ajustes de inventario**: se registran y sincronizan después.
- **Búsqueda de productos**: el catálogo local tiene los productos sincronizados previamente.

## 3. Cuando la conexión se restablezca

- El sistema intentará sincronizar automáticamente
- Puedes forzar la sincronización con `Cmd + Shift + S` o desde la paleta de comandos (`Cmd + K`)
- También puedes ir a la pantalla de Salud de Sincronización para monitorear el progreso

## 4. Si la conexión no se restablece

1. Verifica el cable de red o WiFi
2. Confirma que el servidor esté encendido
3. Contacta al administrador de TI si el problema persiste
4. Revisa la pantalla de Salud de Sincronización para ver operaciones pendientes
