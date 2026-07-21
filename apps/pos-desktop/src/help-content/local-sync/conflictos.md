---
id: local-sync-conflictos
title: ¿Cómo se resuelven los conflictos entre workstations?
keywords:
  - conflicto
  - first write wins
  - reversión
  - servidor
audience: both
lastUpdated: 2026-07-20
route: local-network
---

# ¿Cómo se resuelven los conflictos entre workstations?

Cuando dos workstations modifican el mismo producto o recurso mientras están
offline, se produce un **conflicto**. El sistema tiene reglas claras para
resolverlo.

## Regla general: "El primero en escribir gana"

Cuando el hub recibe operaciones de diferentes workstations para el mismo
recurso, la operación que llegó **primero** al hub es la que se aplica.
La segunda operación se rechaza y la workstation que la envió debe revertir
el cambio localmente.

### Ejemplo

1. Workstation A vende 10 unidades del producto X (stock: 100 → 90).
2. Workstation B (todavía sin ver el cambio de A) hace un ajuste de -20
   (stock: 100 → 80).
3. Ambas operaciones llegan al hub.
4. La que llegó primero se aplica. La otra se rechaza.
5. La workstation perdedora revierte el cambio localmente y notifica al cajero.

## El servidor tiene la última palabra

El hub resuelve conflictos de forma provisional. Cuando el servidor está
disponible:

1. El hub envía todas las operaciones al servidor.
2. El servidor aplica su propio algoritmo de resolución de conflictos.
3. Si la decisión del servidor difiere de la del hub, la decisión del servidor
   **prevalece**.
4. Las workstations afectadas reciben la actualización del servidor.

## Tipos de conflicto

| Tipo | Descripción | Resolución |
|------|-------------|------------|
| FIRST_WRITE_WINS | Dos operaciones modifican el mismo recurso | Gana la primera en llegar al hub |
| HUB_CONFLICT_REJECTED | El hub rechazó la operación | Revertir localmente |
| DEPENDENCY_MISSING | Falta una operación de la que depende | Reintentar después |
| SERVER_WINS | El servidor contradijo al hub | Aceptar decisión del servidor |

## ¿Qué debe hacer el cajero?

- Si recibe una notificación de conflicto, la operación que intentó hacer fue
  revertida.
- Verifique el stock actual del producto antes de reintentar.
- Si el conflicto no está claro, contacte al gerente.

## ¿Qué debe hacer el gerente?

- Revise la página de Red Local → Conflictos para ver el historial.
- Si hay conflictos sin resolver (HUB_CONFLICT_UNRESOLVED), revise cada caso
  manualmente.
- Considere ajustar el inventario manualmente si es necesario.
