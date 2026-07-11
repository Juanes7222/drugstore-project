# Configuración de respaldo de impresión

El sistema de respaldo garantiza que los documentos se impriman incluso cuando la impresora principal no está disponible.

## Cómo funciona

Cuando una impresora principal falla (offline, sin papel, error), el sistema sigue este orden:

1. **Impresora de respaldo configurada** — Si configuraste una impresora alternativa, el sistema intenta imprimir allí
2. **Servidor (opcional)** — Si activaste el respaldo por servidor, el trabajo se envía al servidor para imprimir remotamente
3. **Cola local** — Si ninguna opción funciona, el trabajo se guarda en la cola local para reintentar después

## Cómo configurar

Durante el asistente de configuración (paso 6), o desde la página de impresoras:

1. Selecciona la impresora principal
2. En "Respaldo", elige otra impresora configurada
3. Opcionalmente, activa "Enviar al servidor" como último recurso
4. Guarda los cambios

## Recomendaciones

- Para una farmacia con dos estaciones, configura la impresora de la otra estación como respaldo
- Activa el respaldo por servidor solo si el servidor tiene una impresora conectada
- Revisa periódicamente la página de salud de impresión para ver el estado de todos los respaldos
