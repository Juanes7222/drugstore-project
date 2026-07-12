# Qué pasa si la nueva versión tiene un problema

El sistema tiene múltiples capas de protección para asegurar que una actualización problemática no deje el POS inoperable.

## Rollback automático (por crash)

1. El sistema escribe un marcador cada vez que inicia.
2. Si la app se cierra inesperadamente dentro de los primeros 60 segundos, el marcador permanece.
3. Después de **3 inicios fallidos consecutivos**, el sistema:
   - Restaura la versión anterior.
   - Restaura el respaldo de la base de datos tomado antes de la actualización.
   - Muestra una notificación: "La versión anterior fue restaurada. La actualización X no funcionó correctamente."
   - Reporta el evento a soporte automáticamente.

## Rollback manual (por administrador)

El administrador del sistema (SaaS admin) puede:
- **Pausar** un despliegue si se detectan problemas.
- **Reversar** una versión, forzando a todos los puestos a volver a la versión anterior en el próximo chequeo.

## Restauración de datos

Antes de cada instalación:
1. Se toma un respaldo completo de la base de datos local.
2. Si la instalación o migración falla, se restaura ese respaldo automáticamente.
3. El proceso es transparente para el usuario.

## Garantía

- Nunca perdés datos de ventas, clientes, inventario o facturación por una actualización fallida.
- El sistema siempre mantiene la versión anterior disponible para restauración inmediata.
- Los respaldos se conservan hasta que la nueva versión se verifica como estable (más de 60 segundos de operación continua).
