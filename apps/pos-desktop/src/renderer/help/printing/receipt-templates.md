# Plantillas de recibo

Las plantillas determinan cómo se ve el recibo impreso. Cada impresora puede tener su propia plantilla según el tipo de documento que imprime.

## Tipos de plantilla

- **ESC/POS** — Para impresoras térmicas de recibos. El formato se envía como comandos ESC/POS
- **PDF** — Para impresoras láser o inkjet. El formato se genera como PDF
- **HTML** — Para cualquier impresora. El HTML se convierte a PDF antes de imprimir

## Personalización

Las plantillas usan marcadores de posición como `{{sale.total}}` que se reemplazan con los valores reales al imprimir. Los marcadores disponibles incluyen:

### Datos de la venta
- `{{sale.id}}` — ID de la venta
- `{{sale.total}}` — Total de la venta
- `{{sale.subtotal}}` — Subtotal
- `{{sale.discount}}` — Descuento aplicado
- `{{sale.tax}}` — Impuestos
- `{{sale.items}}` — Lista de artículos

### Datos de la factura
- `{{invoice.invoiceNumber}}` — Número de factura
- `{{invoice.cufe}}` — CUFE (Código Único de Factura Electrónica)
- `{{invoice.issuedAt}}` — Fecha de emisión

### Datos del cliente
- `{{client.name}}` — Nombre del cliente
- `{{client.identification}}` — Identificación (CC/NIT)
- `{{client.address}}` — Dirección

### Datos de la farmacia
- `{{pharmacy.name}}` — Nombre de la farmacia
- `{{pharmacy.nit}}` — NIT
- `{{pharmacy.address}}` — Dirección
- `{{pharmacy.resolution}}` — Número de resolución DIAN

## Código QR

Puedes configurar qué información incluir en el código QR del recibo:
- Número de factura + CUFE (recomendado)
- Solo CUFE
- URL de la factura
- Ninguno

## Consejos

- Usa la plantilla predeterminada que viene con el sistema para empezar
- El tamaño de papel debe coincidir con el papel cargado en la impresora
- Las plantillas personalizadas se pueden añadir desde la página de administración de impresoras
- Si un marcador de posición no encuentra el valor, se muestra como `[NOMBRE_VARIABLE]` en lugar de "undefined"
