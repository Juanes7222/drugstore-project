---
id: local-sync-hub
title: ¿Qué es el hub local y cómo se elige?
keywords:
  - hub
  - elección
  - consenso
  - heartbeat
  - siempre encendido
audience: both
lastUpdated: 2026-07-20
route: local-network
---

# ¿Qué es el hub local y cómo se elige?

El **hub local** es una workstation que actúa como punto central para la
sincronización en la red LAN. Recibe operaciones de las demás workstations
y las distribuye a todas.

## ¿Cómo se elige?

El hub se elige automáticamente mediante un algoritmo de consenso. Cada
workstation calcula independientemente qué workstation debería ser el hub
basándose en los mismos datos, por lo que todas llegan a la misma conclusión.

### Factores de puntuación

| Factor | Peso | Descripción |
|--------|------|-------------|
| Tiempo activo | 40% | Más tiempo encendida = mejor candidato |
| Estabilidad | 30% | Menos desconexiones = mejor candidato |
| Disco disponible | 15% | Más espacio libre = mejor candidato |
| Always-on | 15% | Workstations designadas como "siempre encendidas" tienen prioridad |

### Desempate

Si dos workstations tienen la misma puntuación, gana la que tenga el
identificador (workstationId) alfabéticamente menor.

## ¿Puedo designar el hub manualmente?

Sí. El gerente puede forzar una workstation específica como hub desde la
página de Red Local. Esto es útil si:

- Tiene una workstation siempre encendida (cajero principal).
- Quiere evitar cambios de hub durante horas pico.
- Está haciendo mantenimiento a la red.

## ¿Qué pasa si el hub se apaga?

1. Las demás workstations detectan que el hub no responde (90 segundos sin
   heartbeat).
2. Se ejecuta una nueva elección automática.
3. La siguiente mejor workstation se convierte en el nuevo hub.
4. Las operaciones pendientes se conservan y se envían al nuevo hub.
5. El cajero ve un mensaje breve "Reconfigurando sync local..." durante la
   transición (unos segundos).

## ¿Puede haber dos hubs al mismo tiempo?

Es una condición de carrera breve durante la transición. El segundo hub
intenta iniciar su servidor HTTP pero falla porque el puerto ya está en uso
por el primer hub, y automáticamente vuelve a modo cliente.
