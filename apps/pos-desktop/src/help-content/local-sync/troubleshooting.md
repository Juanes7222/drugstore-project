---
id: local-sync-troubleshooting
title: ¿Qué hacer si el hub no responde?
keywords:
  - hub no responde
  - troubleshooting
  - red
  - firewall
  - puerto
audience: both
lastUpdated: 2026-07-20
route: local-network
---

# ¿Qué hacer si el hub no responde?

## Síntomas

- El banner muestra "Hub local no disponible" en rojo.
- Las workstations no ven los cambios de las demás.
- La página de Red Local muestra el hub como "Fuera de línea".

## Pasos a seguir

### 1. Verificar la red

- Asegúrese de que todas las workstations estén en la misma red WiFi o Ethernet.
- Verifique que no haya cortafuegos bloqueando el puerto 49500 o mDNS (puerto 5353).
- Compruebe que las workstations tengan direcciones IP en el mismo rango.

### 2. Verificar el hub

- La workstation que actuaba como hub puede estar apagada, en suspensión o con
  la app cerrada.
- Enciéndala y abra la app. En menos de 30 segundos, la red local se restablecerá.
- Si no puede encenderla, espere a que la elección automática designe un nuevo hub
  (hasta 90 segundos).

### 3. Verificar la versión

- Todas las workstations deben tener la misma versión de la app (0.1.0 o superior).
- Una workstation con versión antigua no puede participar en la red local.
- El manager ve una advertencia en la página de Red Local.

### 4. Verificar la clave de red

- Si el hub rechaza la conexión (error 401), la clave de red local no coincide.
- Vaya a Configuración → Red Local → Rotar clave para generar una nueva.
- Las otras workstations recibirán la nueva clave en el próximo sync con el servidor.

### 5. Si nada funciona

- Reinicie todas las workstations.
- Si el problema persiste, desactive y reactive el sync local desde la página de
  Red Local.
- Contacte al soporte técnico si el problema continúa.
