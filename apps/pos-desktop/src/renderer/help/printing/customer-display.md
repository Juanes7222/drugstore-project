# Configuración de la pantalla para el cliente

La pantalla para el cliente (o display de cliente) se conecta al puerto de paso (pass-through) de la impresora térmica. Muestra información de la venta al cliente durante la transacción.

## Conexión

1. Conecta la pantalla al puerto "Customer Display" de la impresora térmica
2. En el asistente de configuración, marca "Sí" cuando pregunte si la impresora tiene una pantalla para el cliente
3. El sistema te permitirá elegir qué información mostrar

## Modos de visualización

- **Artículos en línea** — Muestra cada artículo escaneado con el total acumulado
- **Solo total** — Muestra únicamente el total acumulado (ideal para pantallas pequeñas)
- **Total y cambio** — Muestra el total durante la venta y el cambio al finalizar

## Secuencia típica

1. **Inactivo** — Muestra el mensaje de bienvenida configurado
2. **Inicio de venta** — Muestra el mensaje de bienvenida
3. **Durante la venta** — Muestra los artículos escaneados y el total
4. **Confirmación** — Muestra el total, el pago y el cambio
5. **Gracias** — Muestra el mensaje de agradecimiento, luego vuelve a inactivo

## Personalización

Puedes configurar:
- Mensaje de bienvenida (ej: "Bienvenido a Farmacia [Nombre]")
- Mensaje de agradecimiento (ej: "Gracias por su compra")
- Mensaje en inactivo (ej: "Bienvenido")
- Codificación de caracteres (CP437, CP850, UTF8)

## Solución de problemas

- Si la pantalla muestra caracteres extraños, cambia la codificación a CP850
- Si no se ve nada, verifica la conexión del cable
- La pantalla del cliente no bloquea la venta — si falla, solo se registra el error
- Si todos los intentos fallan en una sesión, aparece un aviso: "La pantalla del cliente no responde"
