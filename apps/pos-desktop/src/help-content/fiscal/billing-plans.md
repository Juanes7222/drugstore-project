---
id: licensing-billing-plans
title: Planes de suscripción y facturación electrónica
keywords:
  - planes
  - suscripción
  - facturación incluida
  - certificado DIAN
  - billing
  - contingencia
  - vencimiento
audience: manager
lastUpdated: 2026-08-23
route: licensing-plans
---

# Planes de suscripción y facturación electrónica

Los dos planes de suscripción incluyen todas las funciones del sistema. La única diferencia es **cómo se hace la facturación electrónica DIAN**.

## Plan con facturación incluida

- Nosotros transmitimos las facturas electrónicas a la DIAN por ti.
- **No tienes que subir ningún certificado**: el sistema ya cuenta con la habilitación.
- Ideal si no quieres gestionar certificados ni renovaciones.

## Plan con tu certificado DIAN

- Tú subes el **certificado digital de tu farmacia** (archivo `.pfx` o `.p12`) después del pago y de configurar la empresa.
- Junto con el certificado se ingresan la **contraseña del certificado** y el **código de seguridad del software** (se genera al habilitar el software en la DIAN).
- El paso se puede omitir al inicio, pero el sistema lo recuerda hasta que quede configurado: sin certificado no hay transmisión electrónica.

## Qué pasa si el certificado vence

- El sistema avisa **30 días antes** de la fecha de vencimiento.
- Si el certificado vence, la **facturación electrónica se suspende**.
- Las ventas **siguen funcionando en contingencia**: se registran normalmente y se transmiten cuando el certificado se renueva y se vuelve a subir.

## Comparación rápida

| | Facturación incluida | Tu certificado DIAN |
|---|---|---|
| Transmisión a la DIAN | Nosotros | Con tu certificado |
| Subir certificado | No | Sí (.pfx/.p12) |
| Renovar certificado | No | Sí, antes del vencimiento |
| Contingencia si vence | No aplica | Ventas siguen, sin transmisión |

Para más detalles sobre el certificado, consulta la guía [Certificado digital DIAN](/help/fiscal-dian-certificate).