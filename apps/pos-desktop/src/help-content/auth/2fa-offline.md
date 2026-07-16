---
id: auth-2fa-offline
title: Cómo funciona el 2FA sin conexión
keywords:
  - 2fa
  - totp
  - autenticación
  - doble factor
  - offline
  - verificación
audience: both
lastUpdated: 2026-07-15
route: /help/2fa-offline
---

# Cómo funciona el 2FA sin conexión

La verificación en dos pasos (2FA) agrega una capa extra de seguridad a tu cuenta. Cuando el sistema está **sin conexión**, el 2FA se maneja de forma especial.

## Comportamiento offline

- **Si tenés 2FA habilitado y estás offline**, el sistema **salta el paso del código TOTP**.
- En lugar de pedir el código de la app de autenticación, el inicio de sesión continúa directamente.
- Verás un mensaje informativo: "Estás sin conexión. El 2FA se requerirá cuando vuelvas a tener internet."

## Por qué se salta el 2FA offline

- El código TOTP requiere la hora exacta del servidor para validarse.
- Sin conexión, no podemos verificar la hora contra el servidor.
- Para no bloquear el acceso, permitimos el ingreso sin 2FA temporalmente.

## Qué pasa cuando volvés a estar online

- La próxima vez que iniciés sesión **con conexión**, el 2FA se requerirá normalmente.
- Tus sesiones offline que se iniciaron sin 2FA serán validadas por el servidor (blessing).
- Si el servidor rechaza la sesión por razones de seguridad, deberás iniciar sesión de nuevo online.

## Recomendaciones

- Siempre que sea posible, iniciá sesión con conexión para evitar acumular sesiones sin 2FA.
- Si trabajás frecuentemente offline, asegurate de tener sesiones validadas periódicamente.
- El 2FA offline no reduce la seguridad general — el servidor valida todo al reconectar.
