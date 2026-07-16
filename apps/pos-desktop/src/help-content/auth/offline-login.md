---
id: auth-offline-login
title: Cómo funciona el login offline
keywords:
  - offline
  - login
  - inicio de sesión
  - desconectado
  - sin conexión
  - credenciales
audience: both
lastUpdated: 2026-07-15
route: /help/offline-login
---

# Cómo funciona el login offline

El sistema POS permite iniciar sesión incluso cuando no hay conexión con el servidor. Esto es posible gracias al **cache de credenciales offline**.

## Requisitos

- Haber iniciado sesión al menos una vez con conexión a internet en este dispositivo.
- El cache de credenciales no debe haber expirado (se renueva automáticamente al conectar).

## Cómo iniciar sesión sin conexión

1. En la pantalla de login, seleccioná tu usuario normalmente.
2. Ingresá tu PIN o contraseña como de costumbre.
3. Si estás sin conexión, el sistema usará automáticamente las credenciales almacenadas localmente.
4. La sesión quedará marcada como **pendiente de validar** hasta que el servidor la confirme.

## Qué esperar

- El proceso es transparente — no hay pasos adicionales.
- Verás un indicador "Sin conexión" en la pantalla de login.
- Las sesiones offline se validan automáticamente cuando se restablece la conexión.

## Limitaciones

- Si nunca iniciaste sesión en este dispositivo estando online, no podrás acceder sin conexión.
- Las credenciales offline expiran después de un tiempo. Deberás conectar el dispositivo para renovarlas.
- El 2FA (verificación en dos pasos) se salta en modo offline, pero se requerirá cuando vuelvas a estar online.
