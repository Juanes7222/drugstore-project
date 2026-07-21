---
id: local-sync-que-es
title: ¿Qué es el sync local entre workstations?
keywords:
  - sync local
  - red local
  - lan
  - mDNS
  - hub
audience: both
lastUpdated: 2026-07-20
route: local-network
---

# ¿Qué es el sync local entre workstations?

El sync local permite que las workstations de una misma farmacia compartan datos
directamente a través de la red LAN, sin necesidad de que el servidor central esté
disponible.

## ¿Por qué es necesario?

Cuando el servidor no está disponible (problemas de internet, mantenimiento, etc.),
cada workstation opera de forma aislada. Con el sync local:

- **Stock compartido:** Si una workstation vende un producto, las demás ven el
  stock actualizado en segundos.
- **Ventas visibles:** Las ventas realizadas en cualquier workstation son visibles
  en todas las demás.
- **Ajustes de inventario:** Los ajustes se reflejan inmediatamente en todas las
  workstations.
- **Sin dependencia del servidor:** El sync local funciona aunque el servidor
  esté completamente desconectado.

## ¿Cómo funciona?

1. Cada workstation se descubre automáticamente en la red LAN mediante mDNS
   (Bonjour).
2. Una workstation es elegida como "hub local" — el punto central de la red.
3. Las operaciones (ventas, devoluciones, ajustes) se envían al hub, que las
   distribuye a las demás workstations.
4. Cuando el servidor vuelve a estar disponible, el hub envía todas las
   operaciones acumuladas.

## Requisitos

- Todas las workstations deben estar en la misma red LAN (misma subred).
- Todas las workstations deben pertenecer a la misma ubicación (misma farmacia).
- Versión de la app: 0.1.0 o superior.
