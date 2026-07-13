---
id: screen-returns
title: Pantalla de Devoluciones
keywords:
  - devolución
  - reembolso
  - nota crédito
  - cliente
audience: cashier
lastUpdated: 2026-07-12
route: returns
---

# Pantalla de Devoluciones

La pantalla de devoluciones permite procesar devoluciones de productos vendidos anteriormente.

## Cómo procesar una devolución

1. Busca la venta original por número local o ID
2. Selecciona los items que se van a devolver
3. Indica la cantidad a devolver (no puede exceder la cantidad vendida)
4. Selecciona el método de reembolso
5. Agrega una razón (obligatoria)
6. Confirma la devolución

## Reglas de negocio

- Solo se pueden devolver productos de ventas confirmadas (CONFIRMED)
- La cantidad devuelta no puede exceder la cantidad original vendida
- El reembolso se registra en el SyncQueue para sincronización con el servidor
- Si el producto requiere prescripción, la devolución sigue las mismas reglas

## Notas

- Las devoluciones generan una nota crédito en el servidor
- El inventario se actualiza automáticamente al confirmar la devolución
- Las devoluciones procesadas offline se sincronizan cuando la conexión se restablece
