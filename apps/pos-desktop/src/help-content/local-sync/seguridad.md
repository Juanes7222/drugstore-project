---
id: local-sync-seguridad
title: ¿Cómo se protege la comunicación local?
keywords:
  - seguridad
  - hmac
  - clave de red
  - cifrado
  - mDNS
  - autenticación
audience: both
lastUpdated: 2026-07-20
route: local-network
---

# ¿Cómo se protege la comunicación local?

La comunicación entre workstations en la red LAN está protegida mediante:

## 1. Clave de red local (local network key)

Cada ubicación de farmacia tiene una **clave de red local única** de 256 bits.
Esta clave:

- Se genera automáticamente cuando se activa el sync local.
- Se comparte entre todas las workstations de la misma ubicación.
- Se almacena cifrada en cada workstation (usando el almacenamiento seguro).
- **Nunca se transmite en texto plano** por la red LAN.

## 2. Autenticación HMAC

Cada petición HTTP entre workstations incluye un encabezado `X-Local-Auth`
que contiene un **HMAC-SHA256** de todo el cuerpo de la petición, firmado
con la clave de red local.

Esto garantiza que:
- Solo workstations con la clave correcta pueden enviar operaciones.
- Las peticiones no pueden ser modificadas en tránsito (integridad).
- Workstations de otra farmacia no pueden conectarse a la red.

## 3. Hash en mDNS (autenticación pasiva)

El anuncio mDNS incluye un **hash SHA-256** de la clave de red local, no la
clave misma. Esto permite que las workstations identifiquen rápidamente si
un peer pertenece a la misma ubicación sin revelar la clave.

## 4. HTTP plano (decisión deliberada)

El servidor local usa **HTTP, no HTTPS**. Esto es una decisión de diseño
deliberada basada en:

- **Beneficio marginal de TLS en LAN:** En una red local donde ya controlamos
  quién se conecta mediante HMAC, agregar TLS añade complejidad significativa
  (distribución de certificados, cadenas de confianza) sin beneficio de
  seguridad proporcional.
- **Rendimiento:** HTTP tiene menor latencia que HTTPS, importante para el
  sync en tiempo real.
- **Simplicidad:** No hay que gestionar certificados auto-firmados ni CAs.

## 5. Rotación de clave

El gerente puede rotar la clave de red local en cualquier momento:

1. Genere una nueva clave desde Configuración → Red Local → Rotar clave.
2. Las workstations reciben la nueva clave en el próximo sync con el servidor.
3. La clave anterior tiene un **período de gracia de 24 horas** para evitar
   pérdida de datos.
4. Después de 24 horas, la clave anterior es rechazada.

## 6. Aislamiento entre ubicaciones

El sync local **nunca** transfiere datos entre diferentes ubicaciones
(droguerías). Cada ubicación tiene su propia clave de red. Si una workstation
se muda a otra ubicación:

- La clave de red anterior deja de funcionar.
- La workstation debe ser reactivada en la nueva ubicación.
- El auth module existente maneja este proceso.
