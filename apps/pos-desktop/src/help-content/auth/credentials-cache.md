---
id: auth-credentials-cache
title: Qué es el cache de credenciales
keywords:
  - cache
  - credenciales
  - offline
  - almacenamiento
  - sesión
audience: cashier
lastUpdated: 2026-07-15
route: /help/credentials-cache
---

# Qué es el cache de credenciales

El **cache de credenciales** es un mecanismo de seguridad que permite al POS recordar tu identidad para que puedas iniciar sesión sin conexión a internet.

## Cómo funciona

1. La primera vez que iniciás sesión con conexión, el servidor te entrega un **blob cifrado** con tus credenciales.
2. Este blob se almacena de forma segura en el dispositivo (en localStorage cifrado).
3. Cuando intentás iniciar sesión sin conexión, el sistema usa este blob para verificar tu identidad localmente.

## Seguridad

- Las credenciales se almacenan **ofuscadas** (no en texto plano).
- Cada blob tiene una **fecha de expiración** — pasado ese tiempo, ya no se puede usar.
- Si el servidor rota sus claves de cifrado, el cache anterior se invalida automáticamente.
- El cache está vinculado al **dispositivo físico** — no se puede transferir a otro equipo.

## Mantenimiento

- El cache se renueva automáticamente cada vez que iniciás sesión con conexión.
- Un manager puede limpiar el cache manualmente desde la paleta de comandos (`Cmd + K` > "Limpiar cache offline").
- Si cambiás tu contraseña o PIN online, el cache se actualiza en el próximo inicio de sesión con conexión.

## Preguntas frecuentes

**¿Puedo borrar el cache manualmente?** Sí, los managers pueden hacerlo desde la paleta de comandos.

**¿Qué pasa si el cache expira?** Deberás conectar el dispositivo a internet e iniciar sesión normalmente para renovarlo.

**¿Es seguro?** Sí, los datos están ofuscados y vinculados al dispositivo. Sin embargo, la seguridad completa requiere Tauri Stronghold (próximamente).
