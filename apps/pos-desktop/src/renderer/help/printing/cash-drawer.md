# Configuración del cajón monedero

El cajón monedero se conecta a la impresora de recibos térmicos mediante un cable RJ11 (igual al de un teléfono). Cuando la impresora recibe la orden de apertura, envía una señal eléctrica que abre el cajón.

## Conexión

1. Conecta el cable RJ11 del cajón al puerto "Cash Drawer" de la impresora térmica
2. En el asistente de configuración, marca "Sí" cuando pregunte si la impresora tiene un cajón monedero
3. El sistema detectará automáticamente el cajón y te permitirá configurarlo

## Modos de apertura

- **Cada vez que se confirma una venta** — El cajón se abre automáticamente al finalizar cada venta
- **Solo cuando se confirma un pago en efectivo** — El cajón se abre solo si el cliente paga en efectivo
- **Manualmente desde un botón** — El cajón solo se abre cuando el cajero hace clic en "Abrir cajón"

## Apertura manual

Desde la pantalla de cobro, hay un botón "Abrir cajón" para aperturas sin venta (arqueo, retiro de efectivo). Cada apertura manual requiere seleccionar un motivo:

- Arqueo de caja
- Retiro de efectivo
- Otro

## Solución de problemas

- Si el cajón no se abre, verifica la conexión del cable RJ11
- Prueba la apertura desde "Probar" en la configuración de la impresora
- Si falla la apertura automática, la venta se completa igual — el cajero recibe una notificación
- La apertura manual tiene un límite de 5 segundos entre intentos para evitar aperturas accidentales
