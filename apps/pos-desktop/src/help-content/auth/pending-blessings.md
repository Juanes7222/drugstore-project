---
id: auth-pending-blessings
title: Por qué hay sesiones pendientes de validar
keywords:
  - bendición
  - validación
  - sesiones
  - offline
  - blessing
  - servidor
audience: both
lastUpdated: 2026-07-15
route: /help/pending-blessings
---

# Por qué hay sesiones pendientes de validar

Cuando iniciás sesión en modo offline, el sistema crea una **sesión local** que queda en estado **pendiente de validar** (pending blessing) hasta que el servidor la confirme.

## Qué significa "pendiente de validar"

- La sesión es completamente funcional para operaciones diarias (ventas, devoluciones, etc.).
- El servidor aún no ha verificado que la sesión sea válida.
- Algunas operaciones **privilegiadas** (como cambios de configuración) pueden requerir que la sesión esté validada.

## Cómo se resuelve

1. **Automáticamente**: Cuando el dispositivo se conecta al servidor, las sesiones pendientes se validan automáticamente.
2. **Manual**: Un manager puede forzar la revalidación desde la paleta de comandos o desde la vista de sesiones.

## Posibles resultados

| Resultado | Significado |
|-----------|-------------|
| **Validada** | La sesión fue confirmada por el servidor. Todo normal. |
| **Rechazada - Usuario deshabilitado** | Tu cuenta fue deshabilitada. Contactá al manager. |
| **Rechazada - Dispositivo revocado** | Este dispositivo fue deshabilitado. Contactá al operador. |
| **Rechazada - Token expirado** | La sesión offline expiró. Necesitás conectar para renovar. |

## Qué hacer si una sesión es rechazada

- Si ves una sesión rechazada, contactá a tu manager o al operador del sistema.
- La sesión rechazada ya no es válida y deberás iniciar sesión de nuevo (con conexión).
