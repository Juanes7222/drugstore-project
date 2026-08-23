---
id: fiscal-dian-certificate
title: Certificado digital DIAN
keywords:
  - certificado
  - DIAN
  - facturación electrónica
  - pfx
  - p12
  - firma digital
  - habilitación
  - código de seguridad
  - vencimiento
  - GSE
  - Certicámara
audience: manager
lastUpdated: 2026-08-23
route: certificate-setup
---

# Certificado digital DIAN

El certificado digital DIAN es el archivo que identifica legalmente a tu farmacia ante la DIAN para facturación electrónica. Es la firma digital de la empresa: con él el sistema firma y transmite cada factura.

## Qué es y para qué sirve

- Es un archivo de seguridad con extensión `.pfx` o `.p12` (formato PKCS#12).
- Contiene la identidad digital del representante legal o de la empresa: nombre, NIT y un par de llaves criptográficas.
- Sirve para **firmar** las facturas electrónicas (garantiza que salieron de tu farmacia y no fueron alteradas) y para **transmitirlas** a la DIAN.
- Sin certificado no hay transmisión electrónica: las facturas quedan en contingencia hasta que se configure.

## Cómo obtenerlo

El certificado se obtiene en el proceso de **habilitación en la DIAN**:

1. Solicita el certificado de firma digital ante una entidad de certificación autorizada (por ejemplo, GSE, Certicámara u otras habilitadas por la ONAC) o el emitido por la propia DIAN según el esquema de tu habilitación.
2. El trámite exige validar la identidad del representante legal y el NIT de la empresa.
3. Recibes el archivo `.pfx` o `.p12` junto con una **contraseña** que lo desbloquea. Guarda ambos en un lugar seguro: quien tenga el archivo y la contraseña puede firmar como tu farmacia.

## Contraseña del certificado

La contraseña del certificado es la que asignaste al generarlo (protege el archivo PKCS#12). Es diferente del código de seguridad del software.

## Código de seguridad del software

El código de seguridad del software se genera al **habilitar el software** en la DIAN:

1. Ingresa a la sección "Habilitación de software" del portal DIAN con el NIT de la empresa.
2. Registra el software de facturación que vas a usar.
3. La DIAN genera un código de seguridad asociado a ese software registrado. Ese código se ingresa junto con el certificado al configurarlo.

## Habilitación vs. producción

- El **certificado de pruebas** sirve para el ambiente de habilitación (probar la integración).
- Al operar en **producción** se sube el **certificado definitivo**. El sistema debe quedar configurado con el certificado de producción para transmitir facturas reales.

## Vencimiento y renovación

- Los certificados digitales vencen aproximadamente **un año** después de su emisión.
- El sistema te avisa con anticipación (30 días antes) para que renueves.
- Si el certificado vence, la facturación electrónica se suspende: las ventas siguen funcionando en **contingencia** hasta que subas el certificado renovado.

## Seguridad de tus datos

- El certificado se guarda **cifrado** en nuestros servidores.
- La **contraseña jamás se almacena**: solo se usa en el momento de subir el archivo.