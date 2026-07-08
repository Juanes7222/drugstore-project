## **Sistema de Gestión Integral para Droguería** 

Documento Técnico de Especificación del Sistema 

|**Versión:**|v0.1.0|
|---|---|
|**Estado:**|Borrador|
|**Autor:**|Juan Esteban Cardona|
|**Fecha:**|1 de julio de 2026|
|**Clasifcación:**|Confdencial|



**Historial de Versiones** 

|**Versión**|**Fecha**|**Autor**|**Cambios**|
|---|---|---|---|
|0.1.0|1 de julio|Juan Esteban|Versión inicial|
||de 2026|Cardona||



## **Índice general** 

|**1. **|**Introducción**|**1**|
|---|---|---|
||1.1. Qué es el Sistema . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|1|
||1.2. Por Qué Existe este Sistema . . . . . . . . . . . . . . . . . . . . . . . . . .|1|
||1.3. Arquitectura General . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|2|
||1.3.1.<br>Capa 1 - POS de Escritorio (Local-First) . . . . . . . . . . . . . . .|2|
||1.3.2.<br>Capa 2 - Backofce Web (Panel Administrativo) . . . . . . . . . . .|2|
||1.3.3.<br>Capa 3 - Motor Fiscal Desacoplado . . . . . . . . . . . . . . . . . .|3|
||1.3.4.<br>Infraestructura Compartida<br>. . . . . . . . . . . . . . . . . . . . . .|3|
||1.4. Módulos Funcionales . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|3|
||1.5. Marco Regulatorio<br>. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|5|
||1.6. Modelo de Operación con la DIAN<br>. . . . . . . . . . . . . . . . . . . . . .|5|
||1.7. Alcance y Límites del Sistema . . . . . . . . . . . . . . . . . . . . . . . . .|6|
||1.7.1.<br>Dentro del Alcance . . . . . . . . . . . . . . . . . . . . . . . . . . .|6|
||1.7.2.<br>Fuera del Alcance (esta versión) . . . . . . . . . . . . . . . . . . . .|6|
||1.8. Referencias Normativas . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|7|
|**2. **|**Objetivos**|**8**|
||2.1. Objetivo General . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|8|
||2.2. Objetivos Específcos . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .|8|
||2.3. Alcance de los Objetivos . . . . . . . . . . . . . . . . . . . . . . . . . . . .|9|
||2.4. Especifcación Técnica del Objetivo General<br>. . . . . . . . . . . . . . . . .|9|



i 

## **Índice de figuras** 

ii 

## **Índice de tablas** 

iii 

## **Capítulo 1** 

## **Introducción** 

## **1.1 Qué es el Sistema** 

El **Sistema de Gestión para Droguería** es un sistema de información completo para la operación de una droguería moderna en Colombia. Cubre el ciclo operativo integral del establecimiento: desde la gestión del inventario y las compras a proveedores, pasando por el punto de venta con facturación electrónica en tiempo real, hasta los reportes contables y fiscales que exige la Dirección de Impuestos y Aduanas Nacionales (DIAN). 

No se trata de un módulo aislado ni de una adaptación de un sistema genérico: fue diseñado desde cero para el contexto regulatorio, operativo y tecnológico de una droguería colombiana. 

## **1.2 Por Qué Existe este Sistema** 

Las droguerías en Colombia operan bajo un conjunto de exigencias simultáneas que los sistemas genéricos de punto de venta no resuelven adecuadamente: 

- **Control de lotes y vencimientos:** Obligatorio por la normativa de la de la entidad sanitaria (INVIMA). 

- **Diferenciación de productos:** Distinción clara entre productos de venta libre y aquellos que requieren venta bajo fórmula médica restringida. 

- **Facturación electrónica obligatoria:** Emisión de factura electrónica o tiquete de caja electrónico ante la DIAN por cada transacción, de conformidad con el Anexo Técnico 1.9. 

1 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

- **Operación continua:** Capacidad de mantener las ventas e impresión de comprobantes incluso ante fallos en la conectividad a internet. 

- **Trazabilidad completa de inventario:** Registro inmutable de movimientos para el estricto cumplimiento sanitario. 

El sistema nace para resolver todas estas exigencias dentro de un único flujo cohesionado, evitando que el personal deba recurrir a herramientas fragmentadas para cada función. 

## **1.3 Arquitectura General** 

El sistema está compuesto por tres capas independientes que operan de forma coordinada. 

## **1.3.1 Capa 1 - POS de Escritorio (Local-First)** 

Es la aplicación utilizada por los cajeros en el mostrador. Se ejecuta en el equipo de la estación de trabajo de forma autónoma, sin depender de internet para operar. Cuenta con su propia base de datos local con una réplica del catálogo de productos, clientes frecuentes, configuraciones de precios e impuestos, además de una cola persistente de operaciones pendientes de sincronización. 

Si la conexión al servidor central se interrumpe, el punto de venta (POS) continúa vendiendo, cobrando y emitiendo comprobantes. Una vez que la conexión se restablece, sincroniza automáticamente todo el historial transaccional ocurrido durante el período sin línea. 

- **Tecnologías:** Tauri 2 (runtime, backend en Rust), React, TypeScript para la interfaz, SQLite con SQLCipher para la base de datos local cifrada y Zustand para la gestión de estado. 

## **1.3.2 Capa 2 - Backoffice Web (Panel Administrativo)** 

Es la interfaz web utilizada por la administración y el equipo contable desde cualquier dispositivo con navegador. Desde este panel se gestiona el catálogo de productos, los proveedores, las órdenes de compra, los usuarios del sistema, las configuraciones fiscales y se consultan todos los reportes operativos. No requiere instalación local y trabaja directamente contra el servidor central como fuente única de verdad. 

**Tecnologías:** React, TypeScript, Vite, TanStack Table para las tablas de datos avanzadas y Recharts para los gráficos del panel de indicadores. 

2 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **1.3.3 Capa 3 - Motor Fiscal Desacoplado** 

Es un microservicio independiente que encapsula toda la lógica de facturación electrónica requerida por la DIAN. Recibe eventos de ventas confirmadas, genera el archivo XML en formato UBL 2.1, lo firma digitalmente empleando el estándar XAdES-BES, lo transmite al proveedor tecnológico y gestiona los estados de validación de forma asíncrona. 

Su arquitectura desacoplada garantiza que las actualizaciones periódicas del Anexo Técnico de la DIAN no obliguen a desplegar todo el sistema, limitando el mantenimiento exclusivamente a este motor fiscal. 

**Tecnologías:** Node.js, TypeScript (consumidor de cola BullMQ, generador de XML, firmador XAdES-BES y cliente de la API del proveedor tecnológico). 

## **1.3.4 Infraestructura Compartida** 

El servidor central utiliza **NestJS con TypeScript** como framework de API, **PostgreSQL** como base de datos relacional junto con **Prisma** como ORM, y **BullMQ sobre Redis** como la cola de mensajería para la comunicación asíncrona entre la API principal y el motor fiscal. Todo el proyecto se encuentra estructurado en un **monorepo gestionado con Turborepo** , lo que permite compartir los tipos TypeScript de las entidades (producto, cliente, venta, documento fiscal) entre el POS, el backoffice y el servidor sin duplicar código. 

## **1.4 Módulos Funcionales** 

El sistema está compuesto por **11 módulos funcionales** que abarcan un total de **741 requisitos atómicos** . 

3 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

|**#**|**Módulo**|**RF**|**Descripción resumida**|
|---|---|---|---|
|1|Autenticación y|41|Gestión de usuarios y roles (cajero, auxiliar de inventa-|
||Usuarios||rio, administrador, contador), sesiones y auditoría de|
||||acceso. Incluye bloqueo por intentos fallidos y cierre|
||||automático por inactividad.|
|2|Caja y Turnos|48|Apertura y cierre de turno con base declarada, cuadre|
||||por medio de pago, arqueos parciales y alertas de turno|
||||extendido. El turno actúa como el contenedor contable|
||||de las ventas.|
|3|Catálogo de|61|Gestión de productos farmacéuticos: nombre genérico|
||Productos||y comercial, laboratorio, forma farmacéutica, concen-|
||||tración, código de barras, tarifa IVA, clasifcación li-|
||||bre/receta y precios.|
|4|Inventario y Lotes|72|Trazabilidad completa por lote y fecha de vencimiento,|
||||valoración PEPS (FIFO), alertas de vencimiento, blo-|
||||queo de lotes y tomas físicas. Todo movimiento genera|
||||un registro inmutable.|
|5|Compras y|62|Órdenes de compra, recepción de mercancía, devolucio-|
||Recepción||nes, actualización del costo promedio ponderado (CPP)|
||||y generación del documento soporte electrónico para no|
||||obligados a facturar.|
|6|Ventas POS|89|Flujo de venta: búsqueda, carrito, descuentos con límites|
||||por rol, múltiples medios de pago, ventas en espera,|
||||devoluciones, confrmación de receta médica y emisión|
||||de documentos.|
|7|Clientes|58|Registro con validación de identifcaciones colombianas|
||||(CC, NIT, CE, pasaporte, TI), creación rápida desde el|
||||POS e historial de compras según su clasifcación.|
|8|Sincronización|74|Cola persistente con idempotencia por UUID, sincro-|
||Ofine||nización automática con reintentos exponenciales, re-|
||||solución de confictos y gestión de múltiples estaciones|
||||concurrentes.|
|9|Facturación|81|Generación de FEV (01), tiquete POS (03), notas crédito|
||Electrónica||(91) y débito (92) en XML UBL 2.1. Firma XAdES-BES,|
||||cálculo CUFE/CUDE SHA-384, modo contingencia y|
||||repositorio por 5 años.|
|10|Reportes y|79|Reportes de ventas, caja, inventario y fscales (IVA, in-|
||Contabilidad||gresos brutos, exógena). Panel de indicadores en tiempo|
||||real con exportación a formatos CSV y PDF.|
|11|Confguración<br>General|76|Datos del establecimiento, mapeo DIAN de medios de<br>pago esquemas de impuestos políticas de seguridad<br>4|



Datos del establecimiento, mapeo DIAN de medios de 4 pago, esquemas de impuestos, políticas de seguridad, respaldo automático y bitácora de auditoría inmutable de 5 años. 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **1.5 Marco Regulatorio** 

El sistema fue concebido estructuralmente para cumplir de forma simultánea con cuatro marcos normativos del entorno colombiano: 

## **Cumplimiento DIAN** 

La **Resolución 000165 de 2023** de la DIAN (que adopta el Anexo Técnico 1.9) regula la factura electrónica de venta, los documentos equivalentes electrónicos (como el tiquete de caja POS electrónico) y el documento soporte en adquisiciones efectuadas a sujetos no obligados a facturar. El sistema genera todos los tipos documentales exigidos y gestiona el proceso de habilitación, set de pruebas y operación en producción. 

## **Normativa Sanitaria INVIMA** 

El **Decreto 780 de 2016** (Único Reglamentario del Sector Salud) y las normativas complementarias del INVIMA para establecimientos farmacéuticos exigen el control estricto de fechas de vencimiento, trazabilidad por lotes y la separación operativa de medicamentos de venta libre frente a los de receta médica. Los módulos de inventario y catálogo dan cumplimiento riguroso a estos aspectos. 

## **Protección de Datos Personales** 

La **Ley 1581 de 2012** (Habeas Data) exige la protección y el cifrado de datos sensibles de clientes y el registro de acceso a dicha información. El sistema implementa cifrado en reposo mediante SQLCipher en el POS, cifrado en tránsito con TLS 1.3 y un log de auditoría especializado con retención mínima de 5 años. 

## **Obligaciones Tributarias de Conservación** 

Las normas tributarias colombianas obligan a conservar los documentos fiscales electrónicos durante un período mínimo de **5 años** , además de garantizar la información para la presentación de la información exógena. El repositorio inmutable de archivos XML del sistema cumple directamente con esta obligación legal. 

## **1.6 Modelo de Operación con la DIAN** 

El sistema no transmite los documentos directamente a la DIAN, sino que lo hace a través de un **proveedor tecnológico (PT) autorizado** . El proveedor tecnológico se encarga 

5 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

de estampar la firma digital final, transmitir al Web Service de la DIAN, gestionar las respuestas recibidas ( `ApplicationResponse` ) y resguardar el XML histórico. El motor fiscal del sistema se comunica con la API REST del proveedor de manera transparente. 

El proceso de habilitación como facturador electrónico se realiza en el portal de la DIAN bajo la modalidad de _«software de un proveedor tecnológico»_ : se asocia el proveedor elegido, se ejecuta satisfactoriamente el set de pruebas (6 facturas de venta, 2 notas crédito y 2 notas débito) y se activa la responsabilidad antes de iniciar la operación real en producción. 

## **1.7 Alcance Límites del Sistema y** 

## **1.7.1 Dentro del Alcance** 

Venta al público directa en el mostrador del punto de venta. 

- Gestión de compras a proveedores y recepción técnica de mercancía. 

- Control de inventario estructurado por lotes con trazabilidad completa. 

- Facturación electrónica integrada (FEV, TCE-POS, notas crédito, notas débito y documento soporte). 

- Reportes operativos, de rotación de inventarios y obligaciones fiscales. 

Gestión de clientes junto con su historial completo de compras. 

- Soporte para múltiples estaciones de trabajo concurrentes en un mismo establecimiento. 

- Operación autónoma sin internet (offline-first) con sincronización automática posterior. 

## **1.7.2 Fuera del Alcance (esta versión)** 

- **Nómina electrónica:** Se considera un proceso administrativo independiente ante la DIAN y no está incluido en este sistema. 

- **Contabilidad completa con estados financieros:** El sistema exporta la información en formatos estructurados compatibles con los principales softwares contables del mercado, pero no genera balances, estados de resultados ni libros mayores. 

- **Despachos a domicilio o comercio electrónico (e-commerce):** Canales de venta digitales no contemplados en la arquitectura actual. 

6 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

**Gestión de múltiples sedes como cadena unificada:** Cada establecimiento opera como un sistema independiente en esta versión; la consolidación de datos multi-sede queda excluida del alcance. 

## **1.8 Referencias Normativas** 

|**Norma**|**Descripción**|
|---|---|
|Resolución DIAN 000165 de|Adopta el Anexo Técnico 1.9 de Factura Electrónica de|
|2023|Venta.|
|Anexo Técnico FEV v1.9|Especifcación técnica XML UBL 2.1, CUFE, XAdES-BES|
||y tipos documentales.|
|Decreto 358 de 2020|Regulaciones generales sobre el Sistema de Facturación|
||Electrónica.|
|Decreto 780 de 2016|Decreto Único del Sector Salud aplicable a establecimien-|
||tos farmacéuticos.|
|Ley 1581 de 2012|Marco regulatorio para la Protección de datos personales|
||(Habeas Data).|
|Resolución INVIMA vigente|Establece las buenas prácticas para establecimientos far-|
||macéuticos minoristas.|



7 

## **Capítulo 2** 

## **Objetivos** 

## **2.1 Objetivo General** 

Desarrollar un sistema de información integral para la gestión de una droguería en Colombia, capaz de automatizar los procesos operativos, comerciales, fiscales y administrativos del establecimiento, garantizando la trazabilidad de inventario, la continuidad operativa en modalidad local ( _offline_ ), y el estricto cumplimiento de la normativa sanitaria y tributaria vigente. 

## **2.2 Objetivos Específicos** 

Para dar cumplimiento al objetivo general, el sistema se desarrollará con base en las siguientes metas específicas: 

- **Centralización operativa:** Unificar la operación de la droguería en una única plataforma que integre el control de inventario, compras, ventas, gestión de clientes, arqueo de caja, reportes y configuración general. 

- **Trazabilidad de inventario:** Controlar las existencias por lotes y fechas de vencimiento, asegurando un registro inmutable de entradas, salidas, ajustes, devoluciones y bloqueos de productos farmacéuticos. 

- **Disponibilidad offline-first:** Permitir la operación continua del punto de venta sin conexión a internet, manteniendo la capacidad de facturar, cobrar y registrar transacciones localmente para su posterior sincronización asíncrona. 

- **Cumplimiento fiscal:** Generar documentos fiscales electrónicos conforme a los 

8 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

- requerimientos normativos de la DIAN, incluyendo facturas electrónicas de venta, tiquetes POS, notas crédito, notas débito y documentos soporte. 

- **Arquitectura desacoplada:** Aislar la lógica fiscal del resto de los componentes mediante un motor independiente, garantizando que las actualizaciones técnicas de la DIAN no afecten la estabilidad operativa del POS ni del panel administrativo. 

- **Validación de procesos:** Facilitar la gestión de terceras partes, el ciclo de compras y la recepción técnica de mercancía mediante flujos validados y completamente auditables. 

- **Inteligencia de negocio:** Producir reportes operativos, contables y fiscales estructurados que permitan a la administración y al área contable la toma de decisiones estratégicas basadas en datos actualizados. 

- **Seguridad y auditoría:** Garantizar la seguridad, la confidencialidad y el control de acceso estricto sobre la información sensible del negocio y los datos personales de los clientes. 

- **Escalabilidad modular:** Diseñar una arquitectura orientada a componentes que facilite la evolución del sistema por módulos independientes sin comprometer la estabilidad global de la aplicación. 

- **Alineación regulatoria:** Asegurar la concordancia del software con todas las exigencias legales aplicables al sector farmacéutico y al ecosistema tributario colombiano. 

## **2.3 Alcance de los Objetivos** 

La definición de estas metas no solo delimita las capacidades funcionales del sistema, sino que establece la intención estratégica del proyecto: resolver la operación completa de un establecimiento farmacéutico mediante una solución informática unificada, tolerante a fallos de conectividad y plenamente alineada con el marco normativo del país. Estos objetivos actúan como el enlace fundamental entre las necesidades estratégicas de la organización y las especificaciones técnicas requeridas para su posterior desarrollo. 

9 

## **Capítulo 3** 

## **Alcance del Sistema** 

## **3.1 Alcance Funcional** 

El sistema cubrirá la operación integral de un establecimiento farmacéutico en Colombia, automatizando y centralizando los flujos de trabajo críticos de la organización. Las capacidades funcionales incluidas abarcan de manera detallada: 

- **Gestión de existencias:** Administración avanzada de inventario estructurado por lotes y control estricto de fechas de vencimiento. 

- **Abastecimiento y compras:** Registro de órdenes de compra a proveedores y validación en la recepción técnica de mercancía. 

- **Ciclo transaccional:** Operación completa del punto de venta (POS) para la comercialización de productos, control de caja, apertura, arqueo y cierre de turnos. 

- **Gestión de terceros:** Registro y clasificación de clientes con validación de identificaciones fiscales colombianas. 

- **Ecosistema fiscal:** Generación y emisión asíncrona de los documentos fiscales electrónicos regulados por la normativa nacional. 

- **Inteligencia operativa:** Sincronización robusta de datos entre estaciones de trabajo y consolidación de reportes operativos, contables y tributarios. 

Para soportar estas funciones, la solución incorporará un panel administrativo ( _backoffice_ ) web dedicado a tareas de gestión estratégica y un motor fiscal desacoplado encargado de procesar la comunicación con la DIAN. Todo el flujo del punto de venta estará gobernado por una arquitectura _local-first_ , lo que garantiza la continuidad absoluta de las ventas y la emisión de comprobantes en contingencia offline. 

10 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **3.2 Alcance Operativo** 

La aplicación está diseñada para la operación de un establecimiento farmacéutico individual, soportando una o múltiples estaciones de trabajo concurrentes dentro de la misma infraestructura física de la sede. Bajo este modelo, cada terminal POS posee la capacidad de trabajar de manera totalmente autónoma, resolviendo localmente las lecturas de códigos de barras, la aplicación de precios e impuestos y el almacenamiento de transacciones, efectuando la sincronización de datos con el servidor central de forma transparente en cuanto la conectividad esté disponible. 

El diseño del software modela con precisión las prácticas diarias de una droguería: 

- Apertura y cierre de turnos vinculados al cajero como contenedor contable de las operaciones. 

- Venta fluida de productos farmacéuticos con validación de restricciones (venta libre frente a fórmula médica). 

- Aplicación controlada de políticas de descuento parametrizadas por el rol del usuario. 

- Gestión auditable de devoluciones parciales o totales de mercancía. 

- Ajustes de inventario documentados y bloqueos preventivos de lotes vencidos o próximos a vencer. 

Asimismo, el sistema garantizará el resguardo, la inmutabilidad y la consulta ágil de toda la información fiscal y comercial, facilitando los procesos de auditoría interna y el estricto cumplimiento ante las entidades de control. 

## **3.3 Alcance Técnico** 

Desde la perspectiva de la arquitectura de software, la solución implementará una infraestructura distribuida en tres capas independientes y coordinadas: un POS de escritorio orientado a la persistencia local, un panel administrativo web centralizado y un microservicio fiscal desacoplado. El sistema garantizará la persistencia segura de los datos a través de motores locales cifrados en los terminales, una lógica de sincronización asíncrona e idempotente hacia la base de datos central, y mecanismos estrictos de auditoría en base de datos para registrar operaciones sensibles. 

El componente tecnológico contempla la integración mediante API REST con un proveedor tecnológico autorizado para la firma digital de los archivos XML, el almacenamiento indexado de los documentos fiscales por el periodo de retención legal exigido, y el manejo 

11 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

automático de modos de contingencia operativos. En términos de seguridad, se implementará un control de acceso basado en roles (RBAC), el cifrado avanzado de datos personales en reposo y en tránsito, y políticas automatizadas de respaldo de la información crítica del negocio. 

## **3.4 Fuera del Alcance** 

Con el objetivo de delimitar el esfuerzo de desarrollo y asegurar la estabilidad de la operación central, se declaran explícitamente excluidas de esta versión las siguientes funcionalidades: 

- **Gestión de nómina electrónica:** Proceso de transmisión de pagos laborales ante la DIAN, el cual deberá ser gestionado por un sistema externo. 

- **Contabilidad financiera integral:** El sistema no generará balances generales, estados de resultados ni libros mayores contables; su alcance se limita a la exportación de datos estructurados y compatibles para el software del contador. 

- **Operación multi-sede unificada:** No se incluye la consolidación de inventarios ni ventas para cadenas de droguerías con distribución geográfica masiva; cada sede operará como una instancia independiente. 

- **Canales digitales de venta:** Quedan fuera del diseño actual el comercio electrónico ( _e-commerce_ ) y la gestión logística de despachos a domicilio. 

- **Sistemas externos de salud:** No se contempla la integración de la plataforma con entidades promotoras de salud (EPS), laboratorios clínicos o plataformas externas de dispensación avanzada de medicamentos. 

Adicionalmente, se establece que el sistema no busca reemplazar la labor del profesional contable ni sus herramientas de software. Cualquier requerimiento operativo o técnico que no se encuentre explícitamente detallado en este documento de especificación se considerará fuera del alcance, y su incorporación requerirá un proceso formal de aprobación para futuras versiones o extensiones de la plataforma. 

## **3.5 Límites y Supuestos** 

El éxito en el despliegue del sistema se fundamenta en los siguientes supuestos y condiciones previas del entorno: 

**Infraestructura de Hardware:** Se asume que el establecimiento dispone de la infraestructura informática mínima requerida para ejecutar las estaciones de trabajo del 

12 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

POS, periféricos de impresión térmica de tiquetes y lectores físicos de códigos de barras. 

**Credenciales y Firma Digital:** Es condición indispensable que la droguería cuente con un certificado digital válido para los procesos de facturación electrónica y que complete la contratación de un proveedor tecnológico debidamente autorizado por la DIAN. 

**Topología de Red:** El proyecto parte del supuesto técnico de que la sincronización de datos y la concurrencia ocurren de manera interna entre las estaciones de una misma sede y el servidor de datos, y no entre múltiples puntos geográficos distribuidos. 

Cualquier necesidad de expansión orientada a modelos de operación en cadena, integración con canales digitales o redes de distribución externa no forma parte de las restricciones de este diseño, por lo que deberá ser abordada estructuralmente como un proyecto de ingeniería independiente en una fase posterior. 

13 

## **Capítulo 4** 

## **Requisitos Funcionales** 

## **4.1 Módulo 1: Autenticación Gestión de Usuarios y** 

## **4.1.1 Contexto del módulo** 

Este módulo regula la creación, modificación y desactivación de usuarios del sistema, así como el mecanismo de autenticación, el control de sesiones y la restricción de operaciones según el rol asignado. Todos los accesos y cambios sobre usuarios generan registros de auditoría. El término _usuario_ se refiere exclusivamente a personas que operan el sistema (cajero, administrador, etc.), y se diferencia del término _cliente_ , que designa al comprador en el punto de venta. 

En este sistema, la autenticación se realiza mediante **nombre de usuario** y contraseña. El correo electrónico, en caso de existir, se considera un dato opcional de contacto y no una credencial de acceso. 

## **4.1.2 Creación de usuarios** 

## **RF-AUTH-01 - Formulario de creación de usuario** 

**Descripción:** El sistema debe presentar un formulario de creación de usuario que exija como campos obligatorios: nombre completo, nombre de usuario, contraseña inicial y rol. El sistema no debe completar la creación si alguno de estos campos está vacío, y debe identificar de forma individual cuál o cuáles campos faltan. 

14 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-AUTH-02 - Validación de longitud del nombre completo** 

**Descripción:** El sistema debe validar que el nombre completo del nuevo usuario tenga una longitud mínima de 3 caracteres y máxima de 100 caracteres. Si la validación falla, el sistema debe informar al administrador con un mensaje que indique el criterio incumplido, sin borrar los demás campos del formulario. 

## **RF-AUTH-03 - Validación de formato del nombre de usuario** 

**Descripción:** El sistema debe validar que el nombre de usuario ingresado tenga una longitud mínima de 4 caracteres y máxima de 30 caracteres, y que contenga únicamente letras, números, guion medio y guion bajo. Si el formato es inválido, el sistema debe informar el error sin borrar los demás campos del formulario ni avanzar en el proceso de creación. 

## **RF-AUTH-04 - Unicidad del nombre de usuario** 

**Descripción:** El sistema debe verificar que el nombre de usuario del nuevo usuario no esté registrado previamente, independientemente del estado activo o inactivo del usuario que ya lo posea. Si ya existe, el sistema debe informar al administrador con un mensaje explícito e impedir completar la creación. 

## **RF-AUTH-05 - Política de contraseña inicial** 

**Descripción:** El sistema debe validar que la contraseña inicial cumpla la política de seguridad vigente, que debe incluir como mínimo: longitud mínima de 8 caracteres, al menos una letra mayúscula, al menos una letra minúscula y al menos un dígito numérico. Si algún criterio no se cumple, el sistema debe informar cuál o cuáles criterios son incumplidos sin revelar la política completa en texto plano. 

## **RF-AUTH-06 - Cambio obligatorio de contraseña en primer inicio** 

**Descripción:** El sistema debe marcar como “cambio de contraseña obligatorio en el próximo inicio de sesión” a todo usuario cuya contraseña haya sido asignada por el administrador durante la creación. 

## **RF-AUTH-07 - Lista cerrada de roles** 

**Descripción:** El sistema debe presentar los roles disponibles como una lista cerrada y predefinida que incluya exactamente: cajero, auxiliar de inventario, administrador y contador. El sistema no debe permitir crear ni asignar roles fuera de esta lista sin una operación explícita de configuración avanzada. 

15 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-AUTH-08 - Rol obligatorio en creación** 

**Descripción:** El sistema debe impedir completar la creación de un usuario si no se ha seleccionado un rol válido de la lista definida en RF-AUTH-07, e informar al administrador que el rol es obligatorio. 

## **RF-AUTH-09 - Estado inicial del usuario** 

**Descripción:** El sistema debe asignar el estado “activo” a todo usuario recién creado, salvo que el administrador seleccione explícitamente el estado “inactivo” durante el proceso de creación. 

## **RF-AUTH-10 - Auditoría de creación de usuario** 

**Descripción:** El sistema debe registrar en la auditoría la creación de cada usuario, incluyendo: fecha y hora del evento, nombre completo del usuario creado, nombre de usuario asignado, rol asignado, estado inicial y nombre del usuario administrador que ejecutó la operación. La contraseña no debe quedar registrada en ningún formato en la auditoría. 

## **4.1.3 Modificación de usuarios** 

## **RF-AUTH-11 - Modificación del nombre completo** 

**Descripción:** El sistema debe permitir al administrador modificar el nombre completo de un usuario existente. El nuevo valor debe cumplir las mismas reglas de longitud definidas en RF-AUTH-02. Si no las cumple, el sistema debe informar el error e impedir guardar el cambio. 

## **RF-AUTH-12 - Modificación del nombre de usuario** 

**Descripción:** El sistema debe permitir al administrador modificar el nombre de usuario de un usuario existente. El nuevo valor debe cumplir las reglas de formato definidas en RF-AUTH-03 y la regla de unicidad definida en RF-AUTH-04. Si alguna regla no se cumple, el sistema debe informar el error específico e impedir guardar el cambio. 

## **RF-AUTH-13 - Modificación de rol** 

**Descripción:** El sistema debe permitir al administrador modificar el rol de un usuario existente. El nuevo rol debe pertenecer a la lista definida en RF-AUTH-07. El cambio debe aplicarse de forma efectiva en el próximo inicio de sesión del usuario 

16 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

afectado. 

## **RF-AUTH-14 - Invalidación inmediata de sesiones por cambio de rol** 

**Descripción:** El sistema debe invalidar de forma inmediata todas las sesiones activas del usuario cuyo rol sea modificado por el administrador, sin esperar a que esas sesiones expiren por inactividad. 

## **RF-AUTH-15 - Auditoría de modificación de usuario** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de usuario, incluyendo: campo modificado, valor anterior, valor nuevo, nombre del administrador responsable, fecha y hora. Si se modifica más de un campo en la misma operación, cada campo debe quedar registrado individualmente. 

## **4.1.4 Activación e inactivación de usuarios** 

## **RF-AUTH-16 - Inactivación de usuario** 

**Descripción:** El sistema debe permitir al administrador cambiar el estado de un usuario de “activo” a “inactivo”. Al completarse la inactivación, el sistema debe invalidar inmediatamente todas las sesiones activas del usuario inactivado. 

## **RF-AUTH-17 - Reactivación de usuario** 

**Descripción:** El sistema debe permitir al administrador cambiar el estado de un usuario de “inactivo” a “activo”. La reactivación no debe exigir la asignación de una nueva contraseña ni modificar ningún otro atributo del usuario. 

## **RF-AUTH-18 - Protección del último administrador activo** 

**Descripción:** El sistema debe impedir que un administrador inactive su propio usuario cuando sea el único usuario con rol de administrador y estado activo en el sistema. En ese caso, el sistema debe informar al administrador que la operación no es posible e indicar el motivo. 

## **RF-AUTH-19 - Conservación del historial de usuario inactivado** 

**Descripción:** El sistema debe conservar íntegro el historial de operaciones, ventas, movimientos y registros asociados a un usuario inactivado. La inactivación no debe eliminar, ocultar ni modificar ningún dato histórico vinculado al usuario. 

17 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-AUTH-20 - Auditoría de cambios de estado** 

**Descripción:** El sistema debe registrar en la auditoría cada cambio de estado de usuario (activación o inactivación), incluyendo: usuario afectado, estado anterior, estado nuevo, nombre del administrador responsable, fecha y hora. 

## **4.1.5 Consulta de usuarios** 

## **RF-AUTH-21 - Consulta y filtrado de usuarios** 

**Descripción:** El sistema debe permitir al administrador consultar el listado completo de usuarios del sistema, con la opción de filtrar por estado (activo, inactivo o ambos) y por rol. 

## **RF-AUTH-22 - Detalle de usuario** 

**Descripción:** El sistema debe mostrar en el detalle de cada usuario: nombre completo, nombre de usuario, rol asignado, estado actual, fecha y hora de creación, y fecha y hora del último inicio de sesión registrado. Si el usuario nunca ha iniciado sesión, el sistema debe indicarlo explícitamente. 

## **4.1.6 Autenticación** 

## **RF-AUTH-23 - Credenciales obligatorias de acceso** 

**Descripción:** El sistema debe exigir nombre de usuario y contraseña para autenticar a cualquier usuario que intente acceder a sus funcionalidades. Sin autenticación exitosa, el sistema no debe conceder acceso a ninguna pantalla ni operación. 

## **RF-AUTH-24 - Validación genérica de credenciales** 

**Descripción:** El sistema debe verificar que el nombre de usuario exista en el sistema y que la contraseña corresponda al usuario registrado bajo ese identificador. Si alguna de las dos condiciones no se cumple, el sistema debe presentar un mensaje genérico de credenciales incorrectas sin especificar cuál de los dos valores falló. 

## **RF-AUTH-25 - Bloqueo temporal por intentos fallidos** 

**Descripción:** El sistema debe bloquear temporalmente el acceso de un usuario cuando el número de intentos de inicio de sesión fallidos consecutivos alcance el límite 

18 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

configurable por el administrador. Durante el bloqueo, el sistema debe informar al usuario que su acceso está temporalmente suspendido e indicar el tiempo restante del bloqueo. El período de bloqueo también debe ser configurable. 

## **RF-AUTH-26 - Restricción de acceso para usuarios inactivos** 

**Descripción:** El sistema debe impedir el inicio de sesión de un usuario con estado “inactivo” e informar que la cuenta no está activa, sin revelar otros detalles sobre el estado o configuración del usuario. 

## **RF-AUTH-27 - Registro de intentos de inicio de sesión** 

**Descripción:** El sistema debe registrar cada intento de inicio de sesión con los siguientes datos: nombre de usuario utilizado, estación de trabajo desde la que se realizó el intento, fecha, hora y resultado (exitoso o fallido con indicación de la causa interna, no visible para el usuario). 

## **RF-AUTH-28 - Identificación visible de sesión autenticada** 

**Descripción:** El sistema debe mostrar al usuario autenticado, durante toda la duración de su sesión, su nombre completo y el rol activo con el que inició sesión. 

## **4.1.7 Control de sesión e inactividad** 

## **RF-AUTH-29 - Cierre automático por inactividad** 

**Descripción:** El sistema debe cerrar automáticamente la sesión de un usuario cuando no se registre ninguna interacción durante el período de inactividad configurado por el administrador. El período configurable debe tener un valor mínimo de 1 minuto y un máximo de 60 minutos. 

## **RF-AUTH-30 - Advertencia previa al cierre por inactividad** 

**Descripción:** El sistema debe emitir una advertencia visible al usuario cuando resten 2 minutos o menos para el cierre automático de sesión por inactividad, ofreciendo una acción explícita para extender la sesión activa. 

## **RF-AUTH-31 - Auditoría de cierre por inactividad** 

**Descripción:** El sistema debe registrar en la auditoría cada cierre de sesión por inactividad, incluyendo: usuario, estación de trabajo, fecha y hora del cierre. 

19 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-AUTH-32 - Auditoría de cierre manual de sesión** 

**Descripción:** El sistema debe registrar en la auditoría cada cierre de sesión realizado manualmente por el usuario, incluyendo: usuario, estación de trabajo, fecha y hora del cierre. 

## **RF-AUTH-33 - Invalidación inmediata por cambio de rol o estado** 

**Descripción:** El sistema debe invalidar de forma inmediata la sesión de un usuario cuando el administrador modifique su rol o cambie su estado a inactivo, sin esperar a que la sesión expire por inactividad ni a que el usuario realice una nueva acción. 

## **4.1.8 Control de acceso por rol** 

## **RF-AUTH-34 - Evaluación de permisos por rol** 

**Descripción:** El sistema debe evaluar el rol del usuario autenticado antes de ejecutar cualquier operación y rechazar aquellas operaciones para las cuales el rol no tenga autorización, sin importar la forma en que la operación fue invocada. 

## **RF-AUTH-35 - Mensaje de operación no autorizada** 

**Descripción:** El sistema debe informar al usuario cuando intente ejecutar una operación no autorizada para su rol, usando un mensaje que indique que no tiene permiso para realizar la acción, sin revelar detalles sobre la estructura interna del sistema ni la lista de permisos del rol. 

## **RF-AUTH-36 - Auditoría de intentos no autorizados** 

**Descripción:** El sistema debe registrar en la auditoría cada intento fallido de ejecutar una operación no autorizada, incluyendo: usuario, operación intentada, estación de trabajo, fecha y hora. 

## **RF-AUTH-37 - Restricciones específicas para cajero** 

**Descripción:** El sistema debe garantizar que un usuario con rol de cajero no pueda acceder, visualizar ni ejecutar operaciones de: gestión de usuarios, configuración del sistema, reportes fiscales reservados al contador o administrador, ni ajustes de precios fuera de los límites autorizados. 

20 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-AUTH-38 - Restricciones específicas para contador** 

**Descripción:** El sistema debe garantizar que un usuario con rol de contador no pueda registrar ventas, modificar inventario, crear o modificar usuarios, ni alterar ninguna configuración del sistema. 

## **4.1.9 Restablecimiento de contraseña** 

## **RF-AUTH-39 - Restablecimiento administrativo de contraseña** 

**Descripción:** El sistema debe permitir al administrador restablecer la contraseña de un usuario existente. La nueva contraseña asignada debe cumplir la política de seguridad definida en RF-AUTH-05. Si no la cumple, el sistema debe informar el criterio incumplido e impedir guardar el restablecimiento. 

## **RF-AUTH-40 - Cambio obligatorio tras restablecimiento** 

**Descripción:** El sistema debe marcar al usuario cuya contraseña fue restablecida por el administrador con el indicador “cambio de contraseña obligatorio en el próximo inicio de sesión”, tal como se define en RF-AUTH-06. 

## **RF-AUTH-41 - Auditoría de restablecimiento de contraseña** 

**Descripción:** El sistema debe registrar en la auditoría cada restablecimiento de contraseña, incluyendo: usuario afectado, nombre del administrador responsable, fecha y hora. La contraseña no debe quedar registrada en ningún formato en la auditoría. 

## **4.2 Módulo 2: Caja y Turnos** 

## **4.2.1 Contexto del módulo** 

Este módulo regula el ciclo de vida completo de un turno de caja: apertura, operación, cierre y consulta posterior. Un turno es la unidad de control operativo y financiero que delimita el período de trabajo de un cajero en una estación de trabajo específica. Toda venta, anulación y devolución queda asociada al turno activo en el momento de su registro. El cierre de turno es el mecanismo formal para verificar la correspondencia entre el recaudo esperado y el recaudo declarado por el cajero. 

21 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

**Restricción fundamental:** ninguna venta puede existir en el sistema sin estar asociada a un turno activo. Esta restricción aplica en modo con conectividad y en modo de operación local sin conectividad. 

## **4.2.2 Precondiciones de apertura** 

## **RF-CAJA-01 - Autorización para apertura de turno** 

**Descripción:** El sistema debe verificar que el usuario que intenta abrir un turno tenga rol de cajero o administrador antes de presentar el formulario de apertura. Si el rol del usuario no lo autoriza, el sistema debe bloquear el acceso al formulario e informar que la operación no está permitida para su rol. 

## **RF-CAJA-02 - Unicidad de turno activo por estación** 

**Descripción:** El sistema debe verificar que no exista un turno con estado “activo” en la estación de trabajo desde la cual se intenta la apertura antes de habilitar el formulario de apertura. Si ya existe un turno activo en esa estación, el sistema debe informar el nombre del cajero que lo abrió, la fecha y la hora de apertura, e impedir la creación de un nuevo turno hasta que el existente sea cerrado formalmente. 

## **RF-CAJA-03 - Unicidad de turno activo por usuario** 

**Descripción:** El sistema debe verificar que el usuario que intenta abrir el turno no tenga ya un turno activo en ninguna otra estación de trabajo del sistema. Si el usuario ya tiene un turno activo en otra estación, el sistema debe informar en cuál estación está activo y bloquear la apertura de uno nuevo hasta que el existente sea cerrado. 

## **RF-CAJA-04 - Cierre forzado por administrador** 

**Descripción:** El sistema debe permitir al administrador, y solo al administrador, forzar el cierre de un turno activo en cualquier estación de trabajo cuando el cajero original no pueda ejecutar el cierre. Esta operación debe quedar registrada en la auditoría con el motivo documentado por el administrador. 

22 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.2.3 Apertura de turno** 

## **RF-CAJA-05 - Formulario de apertura de turno** 

**Descripción:** El sistema debe presentar el formulario de apertura de turno con los siguientes campos: monto base en efectivo (obligatorio) y observación de apertura (opcional). Los datos de usuario, estación de trabajo, fecha y hora deben ser registrados automáticamente por el sistema sin requerir ingreso manual por parte del cajero. 

## **RF-CAJA-06 - Validación del monto base** 

**Descripción:** El sistema debe validar que el monto base en efectivo declarado en la apertura sea un valor numérico mayor o igual a cero. Si el valor ingresado es negativo o no es numérico, el sistema debe informar el error e impedir completar la apertura. 

## **RF-CAJA-07 - Registro inmutable de apertura** 

**Descripción:** El sistema debe registrar en el turno abierto los siguientes datos de forma inmutable: identificador único del turno, nombre completo del cajero, identificador de la estación de trabajo, fecha y hora exactas de apertura, monto base en efectivo declarado y observación de apertura si fue ingresada. 

## **RF-CAJA-08 - Activación del turno** 

**Descripción:** El sistema debe asignar el estado “activo” al turno inmediatamente después de completar la apertura y habilitar la estación de trabajo para el registro de ventas. 

## **RF-CAJA-09 - Visualización persistente del turno activo** 

**Descripción:** El sistema debe mostrar de forma visible y permanente en la pantalla principal del punto de venta, durante toda la duración del turno, el nombre del cajero activo, la hora de inicio del turno y el monto base declarado. 

## **RF-CAJA-10 - Auditoría de apertura de turno** 

**Descripción:** El sistema debe registrar en la auditoría la apertura de cada turno, incluyendo: identificador del turno, usuario, estación de trabajo, fecha, hora y monto base. La observación de apertura también debe quedar registrada si fue ingresada. 

23 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.2.4 Operación durante el turno** 

## **RF-CAJA-11 - Prohibición de ventas sin turno activo** 

**Descripción:** El sistema debe impedir el registro de cualquier venta nueva en una estación de trabajo que no tenga un turno con estado “activo”. Si el cajero intenta iniciar una venta sin turno activo, el sistema debe mostrar un mensaje que indique que es necesario abrir un turno antes de operar. 

## **RF-CAJA-12 - Asociación automática de ventas al turno** 

**Descripción:** El sistema debe asociar automáticamente cada venta confirmada al identificador del turno activo en la estación de trabajo en el momento del registro, sin requerir selección manual por parte del cajero. 

## **RF-CAJA-13 - Asociación de anulaciones y devoluciones al turno** 

**Descripción:** El sistema debe asociar de igual forma al turno activo cada anulación de venta y cada devolución registradas durante el período del turno, con independencia de si la venta original correspondió al mismo turno o a uno anterior. 

## **RF-CAJA-14 - Resumen operativo en tiempo real** 

**Descripción:** El sistema debe mostrar al cajero, en tiempo real durante el turno activo, el número de ventas realizadas en el turno actual y el total acumulado de recaudo del turno, agrupado por medio de pago. 

## **RF-CAJA-15 - Actualización inmediata del resumen de turno** 

**Descripción:** El sistema debe actualizar el resumen acumulado del turno de forma inmediata cada vez que se confirme una venta, se registre una anulación o se registre una devolución en la estación de trabajo. 

## **4.2.5 Precondiciones de cierre** 

## **RF-CAJA-16 - Autorización para cierre de turno** 

**Descripción:** El sistema debe verificar que el usuario que intenta cerrar un turno sea el mismo cajero que lo abrió o un usuario con rol de administrador. Si el usuario no cumple ninguna de estas condiciones, el sistema debe bloquear el cierre e informar el motivo. 

24 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAJA-17 - Advertencia por ventas pendientes de sincronización** 

**Descripción:** El sistema debe verificar si existen ventas con estado de sincronización pendiente al momento en que el cajero intenta cerrar el turno. Si existen, el sistema debe informar la cantidad de ventas pendientes y permitir al cajero decidir de forma explícita si desea continuar con el cierre o esperar a que se complete la sincronización. 

## **RF-CAJA-18 - Advertencia por documentos fiscales pendientes o rechazados** 

**Descripción:** El sistema debe verificar si existen documentos fiscales con estado “pendiente de envío” o “rechazado” al momento del cierre del turno. Si existen, el sistema debe informar la cantidad de documentos en ese estado y registrar esta advertencia junto al cierre, sin bloquear la operación de cierre. 

## **4.2.6 Proceso de cierre de turno** 

## **RF-CAJA-19 - Resumen previo al cierre** 

**Descripción:** El sistema debe presentar al cajero, antes de solicitar los montos de cierre, un resumen del turno que incluya: número total de ventas confirmadas, número de anulaciones, número de devoluciones, y totales de recaudo desagregados por cada medio de pago registrado durante el turno. 

## **RF-CAJA-20 - Ingreso de montos físicos por medio de pago** 

**Descripción:** El sistema debe solicitar al cajero que ingrese el monto físico contado para cada medio de pago habilitado en el sistema al momento del cierre. El monto de cierre es obligatorio para el efectivo y opcional para los demás medios de pago cuando el sistema no tenga acceso directo al valor reportado por el dispositivo de pago correspondiente. 

## **RF-CAJA-21 - Cálculo de diferencia por medio de pago** 

**Descripción:** El sistema debe calcular automáticamente la diferencia de cierre para cada medio de pago como la resta entre el monto esperado según ventas del turno y el monto físico declarado por el cajero. Una diferencia positiva indica sobrante y una diferencia negativa indica faltante. 

25 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAJA-22 - Cálculo de diferencia total de cierre** 

**Descripción:** El sistema debe calcular la diferencia total de cierre como la suma de las diferencias individuales de todos los medios de pago incluidos en el cierre del turno. 

## **RF-CAJA-23 - Visualización de reconciliación de cierre** 

**Descripción:** El sistema debe mostrar al cajero el detalle completo de la reconciliación de cierre antes de confirmarla, con los valores esperados, los valores declarados y las diferencias por cada medio de pago. 

## **RF-CAJA-24 - Observación opcional de cierre** 

**Descripción:** El sistema debe permitir al cajero ingresar una observación opcional de hasta 500 caracteres al momento del cierre del turno para documentar la causa de diferencias o cualquier novedad operativa relevante. 

## **RF-CAJA-25 - Confirmación explícita de cierre** 

**Descripción:** El sistema debe solicitar al cajero una confirmación explícita antes de completar el cierre del turno, mostrando el resumen final de la reconciliación para que el cajero la verifique antes de aceptar. 

## **RF-CAJA-26 - Registro inmutable del cierre de turno** 

**Descripción:** El sistema debe registrar el cierre del turno con los siguientes datos de forma inmutable: identificador del turno, usuario que ejecutó el cierre, fecha y hora exactas del cierre, monto esperado por medio de pago, monto declarado por medio de pago, diferencia por medio de pago, diferencia total y observación de cierre si fue ingresada. 

## **RF-CAJA-27 - Cambio de estado a cerrado** 

**Descripción:** El sistema debe cambiar el estado del turno a “cerrado” inmediatamente después de registrar el cierre y deshabilitar el registro de nuevas ventas en la estación de trabajo correspondiente. 

## **RF-CAJA-28 - Comprobante de cierre de turno** 

**Descripción:** El sistema debe generar e imprimir automáticamente el comprobante de cierre de turno al confirmar el cierre, con el resumen completo de la reconciliación. Si la impresora no está disponible, el sistema debe permitir al cajero imprimir el 

26 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

comprobante manualmente desde el historial de turnos. 

## **RF-CAJA-29 - Auditoría de cierre de turno** 

**Descripción:** El sistema debe registrar en la auditoría el cierre de cada turno, incluyendo: identificador del turno, usuario que ejecutó el cierre, estación de trabajo, fecha y hora del cierre, diferencia total calculada y si existían documentos fiscales o ventas de sincronización pendientes en el momento del cierre. 

## **4.2.7 Reapertura de turno** 

## **RF-CAJA-30 - Restricción de reapertura de turno** 

**Descripción:** El sistema debe impedir la reapertura de un turno cerrado por parte del cajero. Solo el administrador puede reabrir un turno cerrado, y únicamente si el turno fue cerrado en las últimas 24 horas. 

## **RF-CAJA-31 - Motivo obligatorio para reapertura** 

**Descripción:** El sistema debe exigir al administrador que ingrese un motivo documentado para reabrir un turno cerrado. Si el campo de motivo está vacío, el sistema debe impedir completar la reapertura. 

## **RF-CAJA-32 - Registro de reapertura** 

**Descripción:** El sistema debe cambiar el estado del turno a “activo” al confirmar la reapertura y registrar en el historial del turno: nombre del administrador que autorizó la reapertura, motivo ingresado, fecha y hora de la reapertura. 

## **RF-CAJA-33 - Auditoría de reapertura de turno** 

**Descripción:** El sistema debe registrar en la auditoría cada reapertura de turno, incluyendo: identificador del turno, usuario que ejecutó el cierre original, usuario administrador que autorizó la reapertura, motivo, estación de trabajo, fecha y hora. 

27 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.2.8 Consulta de turnos** 

## **RF-CAJA-34 - Consulta filtrable de historial de turnos** 

**Descripción:** El sistema debe permitir al administrador consultar el historial completo de turnos con la opción de aplicar filtros combinables por: cajero, estación de trabajo, estado del turno (activo, cerrado) y rango de fechas de apertura. 

## **RF-CAJA-35 - Datos mostrados en listado de turnos** 

**Descripción:** El sistema debe mostrar en el listado de resultados de la consulta los siguientes datos de cada turno: identificador del turno, nombre del cajero, estación de trabajo, fecha y hora de apertura, fecha y hora de cierre (si aplica), estado y diferencia total de cierre (si aplica). 

## **RF-CAJA-36 - Detalle completo de turno** 

**Descripción:** El sistema debe permitir al administrador acceder al detalle completo de cualquier turno desde el listado de resultados, mostrando: datos de apertura, datos de cierre, lista de ventas asociadas con su estado individual, anulaciones, devoluciones, totales por medio de pago y observaciones de apertura y cierre. 

## **RF-CAJA-37 - Filtro de ventas dentro del detalle de turno** 

**Descripción:** El sistema debe permitir al administrador filtrar las ventas dentro del detalle de un turno por estado (confirmada, anulada, con devolución) para facilitar la revisión de operaciones específicas. 

## **RF-CAJA-38 - Consulta de reconciliación de turno cerrado** 

**Descripción:** El sistema debe permitir al administrador consultar los datos de reconciliación de un turno cerrado, mostrando para cada medio de pago: monto esperado, monto declarado y diferencia individual, más la diferencia total del turno. 

## **RF-CAJA-39 - Exportación de turnos** 

**Descripción:** El sistema debe permitir al administrador exportar el detalle de un turno o el resultado de una consulta de turnos en al menos un formato estructurado legible por herramientas externas, como CSV. 

28 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.2.9 Alertas y notificaciones operativas** 

## **RF-CAJA-40 - Notificación por diferencia de cierre superior al umbral** 

**Descripción:** El sistema debe notificar al administrador cuando una diferencia de cierre de turno supere el umbral máximo de diferencia permitido, configurable por el administrador en valor absoluto de moneda. La notificación debe quedar visible en el panel administrativo hasta que el administrador la revise explícitamente. 

## **RF-CAJA-41 - Auditoría de revisión de notificación** 

**Descripción:** El sistema debe registrar en la auditoría cada vez que un administrador revise y descarte una notificación de diferencia de cierre, incluyendo el identificador del turno, el administrador responsable y la fecha y hora de la revisión. 

## **RF-CAJA-42 - Alerta por exceso de duración de turno** 

**Descripción:** El sistema debe emitir una alerta al cajero cuando el turno activo lleve más horas abiertas que el límite de duración máxima configurable por el administrador. La alerta debe mostrarse en la pantalla del punto de venta sin bloquear la operación. 

## **4.2.10 Comportamiento en modo offline** 

## **RF-CAJA-43 - Apertura de turno en modo local** 

**Descripción:** El sistema debe permitir abrir un turno de caja en modo de operación local cuando no haya conectividad con el servidor central, registrando todos los datos de apertura en el almacenamiento local de la estación de trabajo. 

## **RF-CAJA-44 - Sincronización de apertura de turno** 

**Descripción:** El sistema debe sincronizar automáticamente los datos de apertura del turno con el servidor central al restablecer la conectividad, conservando la fecha y hora originales de apertura registradas localmente. 

## **RF-CAJA-45 - Cierre de turno en modo local** 

**Descripción:** El sistema debe permitir cerrar un turno en modo de operación local cuando no haya conectividad, registrando los datos de cierre y la reconciliación en el almacenamiento local. 

29 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAJA-46 - Sincronización de cierre de turno** 

**Descripción:** El sistema debe sincronizar los datos de cierre del turno con el servidor central al restablecer la conectividad, manteniendo los valores y la hora de cierre registrados originalmente en modo local. 

## **RF-CAJA-47 - Visualización de turnos pendientes de sincronización** 

**Descripción:** El sistema debe identificar en la bandeja de sincronización pendiente los turnos cuya apertura o cierre no hayan sido sincronizados con el servidor central, con indicación explícita del estado de sincronización de cada uno. 

## **RF-CAJA-48 - Validación local de turno único por estación** 

**Descripción:** El sistema debe garantizar que la validación de turno único por estación de trabajo (RF-CAJA-02) se aplique también en modo de operación local, consultando el almacenamiento local para detectar si ya existe un turno activo en la estación, sin requerir conexión al servidor central para esta verificación. 

## **4.3 Módulo 3: Catálogo de Productos** 

## **4.3.1 Contexto del módulo** 

Este módulo regula el ciclo de vida completo de un producto dentro del sistema: su creación, configuración, modificación, clasificación, estado y visibilidad en el punto de venta. El producto es la unidad mínima de referencia del catálogo y representa un medicamento o artículo de venta con atributos farmacéuticos específicos. El catálogo es compartido por los módulos de inventario, ventas POS, compras y facturación, por lo que cualquier cambio en un producto impacta directamente en todos esos módulos. 

Un producto se diferencia de un lote: el producto define qué se vende (nombre, precio, impuesto, concentración, etc.), mientras que el lote representa existencias físicas específicas de ese producto con número de lote y fecha de vencimiento propios, gestionados en el Módulo 4. 

30 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.3.2 Control de acceso al catálogo** 

## **RF-CAT-01 - Creación de productos restringida por rol** 

**Descripción:** El sistema debe permitir crear productos únicamente a usuarios con rol de auxiliar de inventario o administrador. Si un usuario con rol diferente intenta acceder al formulario de creación, el sistema debe bloquear el acceso e informar que la operación no está autorizada para su rol. 

## **RF-CAT-02 - Modificación de productos restringida por rol** 

**Descripción:** El sistema debe permitir modificar productos únicamente a usuarios con rol de auxiliar de inventario o administrador. Si un usuario con rol diferente intenta ejecutar una modificación, el sistema debe rechazarla e informar el motivo. 

## **RF-CAT-03 - Cambio de estado restringido al administrador** 

**Descripción:** El sistema debe permitir inactivar o reactivar productos únicamente a usuarios con rol de administrador. Un auxiliar de inventario no debe tener acceso a la operación de cambio de estado de un producto. 

## **4.3.3 Creación de producto - datos generales** 

## **RF-CAT-04 - Formulario de creación de producto** 

**Descripción:** El sistema debe presentar el formulario de creación de producto con los siguientes campos obligatorios: nombre comercial, principio activo, forma farmacéutica, concentración, unidad de medida de concentración, laboratorio fabricante y categoría. El sistema no debe completar la creación si alguno de estos campos está vacío, e identificar individualmente cuál o cuáles faltan. 

## **RF-CAT-05 - Validación del nombre comercial** 

**Descripción:** El sistema debe validar que el nombre comercial del producto tenga una longitud mínima de 2 caracteres y máxima de 150 caracteres. Si la validación falla, el sistema debe informar el criterio incumplido sin borrar los demás campos del formulario. 

31 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-06 - Validación del principio activo** 

**Descripción:** El sistema debe validar que el principio activo tenga una longitud mínima de 2 caracteres y máxima de 200 caracteres. Si la validación falla, el sistema debe informar el criterio incumplido sin borrar los demás campos del formulario. 

## **RF-CAT-07 - Lista predefinida de formas farmacéuticas** 

**Descripción:** El sistema debe presentar la forma farmacéutica como una lista de valores predefinidos y configurables por el administrador, que incluya al menos: tableta, cápsula, jarabe, suspensión, solución inyectable, crema, gel, óvulo, supositorio, gotas y polvo. El usuario no debe poder ingresar una forma farmacéutica fuera de esta lista salvo que el administrador la haya registrado previamente. 

## **RF-CAT-08 - Lista predefinida de categorías** 

**Descripción:** El sistema debe presentar la categoría del producto como una lista de valores predefinidos y configurables por el administrador. El usuario no debe poder asignar una categoría fuera de esta lista salvo que el administrador la haya registrado previamente. 

## **RF-CAT-09 - Campos opcionales de creación** 

**Descripción:** El sistema debe permitir al usuario ingresar opcionalmente los siguientes campos adicionales durante la creación: nombre genérico, registro INVIMA, código ATC, indicación terapéutica principal, condiciones especiales de almacenamiento y observaciones internas. La ausencia de estos campos no debe impedir la creación del producto. 

## **RF-CAT-10 - Validación de formato del registro INVIMA** 

**Descripción:** El sistema debe validar que el registro INVIMA, cuando sea ingresado, cumpla el formato alfanumérico definido por el INVIMA para Colombia. Si el formato es inválido, el sistema debe informar el error sin borrar los demás campos del formulario. 

## **RF-CAT-11 - Detección de duplicados exactos** 

**Descripción:** El sistema debe validar que no existan dos productos activos con el mismo nombre comercial, principio activo, forma farmacéutica y concentración de forma simultánea. Si se detecta duplicado exacto, el sistema debe informar al usuario el nombre del producto existente e impedir completar la creación. 

32 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-12 - Auditoría de creación de producto** 

**Descripción:** El sistema debe registrar en la auditoría la creación de cada producto, incluyendo: identificador del producto, todos los campos capturados, usuario responsable, fecha y hora. El registro debe ser inmutable. 

## **4.3.4 Código interno del producto** 

## **RF-CAT-13 - Asignación automática de código interno** 

**Descripción:** El sistema debe asignar automáticamente un código interno único a cada producto en el momento de su creación, sin requerir intervención del usuario. 

## **RF-CAT-14 - Esquema configurable de código interno** 

**Descripción:** El sistema debe generar el código interno bajo un esquema secuencial o alfanumérico configurable por el administrador, que garantice unicidad en todos los productos del sistema independientemente de su estado activo o inactivo. 

## **RF-CAT-15 - Inmutabilidad del código interno** 

**Descripción:** El sistema debe impedir que el código interno de un producto sea modificado después de su asignación inicial, sin importar el rol del usuario que lo solicite. 

## **RF-CAT-16 - Visibilidad del código interno** 

**Descripción:** El sistema debe mostrar el código interno del producto de forma visible en la ficha del producto, en los resultados de búsqueda del catálogo y en el detalle de los movimientos de inventario asociados. 

## **4.3.5 Gestión de códigos de barras** 

## **RF-CAT-17 - Asociación múltiple de códigos de barras** 

**Descripción:** El sistema debe permitir asociar uno o más códigos de barras a un mismo producto después de su creación o durante el proceso de creación. 

33 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-18 - Unicidad de código de barras entre productos activos** 

**Descripción:** El sistema debe validar que el código de barras a asociar no esté ya asignado a otro producto con estado activo. Si ya existe, el sistema debe informar el nombre del producto con el que entra en conflicto e impedir la asociación. 

## **RF-CAT-19 - Reasignación de código de barras de producto inactivo** 

**Descripción:** El sistema debe permitir al administrador o auxiliar de inventario asociar un código de barras que ya pertenece a un producto inactivo, siempre que el administrador confirme explícitamente la reasignación y quede registrado en la auditoría. 

## **RF-CAT-20 - Eliminación de asociación de código de barras** 

**Descripción:** El sistema debe permitir eliminar la asociación de un código de barras de un producto, siempre que el producto conserve al menos un código de barras activo o un código interno suficiente para ser identificado en el punto de venta. 

## **RF-CAT-21 - Auditoría de operaciones sobre códigos de barras** 

**Descripción:** El sistema debe registrar en la auditoría cada asociación y cada eliminación de código de barras, incluyendo: identificador del producto, código de barras afectado, tipo de operación, usuario responsable, fecha y hora. 

## **4.3.6 Configuración de precio** 

## **RF-CAT-22 - Configuración de precio de venta** 

**Descripción:** El sistema debe permitir al administrador configurar el precio de venta unitario vigente de un producto expresado en la moneda local del sistema. El precio es un campo obligatorio para que un producto sea elegible para la venta en el punto de venta. 

## **RF-CAT-23 - Validación del precio de venta** 

**Descripción:** El sistema debe validar que el precio de venta sea un valor numérico mayor que cero. Si el valor ingresado es cero, negativo o no numérico, el sistema debe informar el error e impedir guardar el precio. 

34 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-24 - Restricción de cambio de precio por rol** 

**Descripción:** El sistema debe impedir que un cajero o auxiliar de inventario modifique el precio de venta vigente de un producto. Solo el administrador puede ejecutar cambios de precio. 

## **RF-CAT-25 - Aplicación no retroactiva del precio vigente** 

**Descripción:** El sistema debe aplicar el precio de venta vigente a todas las nuevas ventas del producto a partir del momento exacto en que el cambio sea confirmado, sin afectar retroactivamente ventas ya confirmadas con un precio anterior. 

## **4.3.7 Configuración de impuestos** 

## **RF-CAT-26 - Asignación de esquema tributario** 

**Descripción:** El sistema debe permitir al administrador asignar un esquema de impuesto a cada producto desde una lista de esquemas predefinidos y configurables, que incluya al menos: exento de IVA, IVA 0 %, IVA 5 % e IVA 19 %, y cualquier otro esquema vigente aplicable según la normativa tributaria colombiana. 

## **RF-CAT-27 - Impuesto obligatorio para habilitación de venta** 

**Descripción:** El sistema debe validar que todo producto tenga un esquema de impuesto asignado antes de ser habilitado para la venta. Si un producto no tiene esquema asignado, el sistema debe impedir su adición al carrito de venta e informar al cajero que el producto requiere configuración de impuesto. 

## **RF-CAT-28 - Aplicación no retroactiva del esquema tributario** 

**Descripción:** El sistema debe aplicar el esquema de impuesto vigente de un producto en el cálculo automático de cada venta, de acuerdo con la tarifa configurada. El cambio de esquema de impuesto solo debe aplicar a ventas nuevas, sin modificar ventas ya confirmadas. 

## **RF-CAT-29 - Restricción de cambio tributario por rol** 

**Descripción:** El sistema debe impedir que un cajero o auxiliar de inventario modifique el esquema de impuesto de un producto. Solo el administrador puede ejecutar cambios en la configuración tributaria de un producto. 

35 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.3.8 Historial de precios e impuestos** 

## **RF-CAT-30 - Historial de cambios de precio** 

**Descripción:** El sistema debe registrar en el historial de precios del producto cada cambio de precio de venta con los siguientes datos: fecha y hora del cambio, precio anterior, precio nuevo y usuario administrador responsable del cambio. 

## **RF-CAT-31 - Historial de cambios tributarios** 

**Descripción:** El sistema debe registrar en el historial de configuración tributaria del producto cada cambio de esquema de impuesto con los siguientes datos: fecha y hora del cambio, esquema anterior, esquema nuevo y usuario administrador responsable. 

## **RF-CAT-32 - Consulta de historial de precios e impuestos** 

**Descripción:** El sistema debe permitir al administrador consultar el historial completo de precios e impuestos de cualquier producto, ordenado cronológicamente del más reciente al más antiguo. 

## **RF-CAT-33 - Inmutabilidad del historial de precios e impuestos** 

**Descripción:** El sistema debe impedir la modificación o eliminación de registros del historial de precios e impuestos una vez generados. 

## **4.3.9 Modificación de datos del producto** 

## **RF-CAT-34 - Modificación de datos descriptivos** 

**Descripción:** El sistema debe permitir modificar los datos descriptivos de un producto activo: nombre comercial, principio activo, forma farmacéutica, concentración, unidad de medida, laboratorio fabricante, categoría, nombre genérico, registro INVIMA, código ATC, indicación terapéutica, condiciones de almacenamiento y observaciones internas. 

## **RF-CAT-35 - Reaplicación de validaciones al modificar** 

**Descripción:** El sistema debe aplicar las mismas reglas de validación definidas en la sección 3.2 al modificar campos del producto. Si la validación falla en algún campo, el sistema debe informar el error específico e impedir guardar los cambios. 

36 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-36 - Verificación de duplicados al modificar** 

**Descripción:** El sistema debe verificar nuevamente la regla de duplicado definida en RF-CAT-11 al modificar el nombre comercial, principio activo, forma farmacéutica o concentración de un producto. Si la combinación modificada genera un duplicado con otro producto activo, el sistema debe informar el conflicto e impedir guardar el cambio. 

## **RF-CAT-37 - Auditoría de modificación de producto** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de producto, incluyendo por cada campo modificado: nombre del campo, valor anterior, valor nuevo, usuario responsable, fecha y hora. Si se modifican múltiples campos en una misma operación, cada campo debe quedar registrado individualmente. 

## **4.3.10 Estado del producto** 

## **RF-CAT-38 - Inactivación de producto** 

**Descripción:** El sistema debe permitir al administrador cambiar el estado de un producto de “activo” a “inactivo”. El cambio de estado debe ser efectivo de forma inmediata en el catálogo y en el punto de venta. 

## **RF-CAT-39 - Restricción de venta de producto inactivo** 

**Descripción:** El sistema debe impedir que un producto con estado “inactivo” sea agregado a una nueva venta en el punto de venta. Si el cajero busca o escanea un producto inactivo, el sistema debe informar que el producto no está disponible para la venta sin revelar más detalles internos. 

## **RF-CAT-40 - Conservación del historial de producto inactivado** 

**Descripción:** El sistema debe conservar íntegros todos los datos y el historial de ventas, movimientos de inventario y documentos asociados a un producto inactivado. La inactivación no debe eliminar, ocultar ni alterar ningún dato histórico vinculado al producto. 

## **RF-CAT-41 - Reactivación condicionada de producto** 

**Descripción:** El sistema debe permitir al administrador cambiar el estado de un producto de “inactivo” a “activo”, siempre que el producto tenga precio de venta 

37 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

configurado y esquema de impuesto asignado. Si alguno de estos datos falta, el sistema debe informar cuál es el dato pendiente de configuración antes de permitir la reactivación. 

## **RF-CAT-42 - Auditoría de cambios de estado del producto** 

**Descripción:** El sistema debe registrar en la auditoría cada cambio de estado de un producto (activación o inactivación), incluyendo: identificador del producto, estado anterior, estado nuevo, usuario administrador responsable, fecha y hora. 

## **4.3.11 Clasificación por tipo de venta** 

## **RF-CAT-43 - Clasificación obligatoria de tipo de venta** 

**Descripción:** El sistema debe clasificar cada producto en exactamente una de las siguientes categorías de tipo de venta: venta libre o venta con receta médica obligatoria. Esta clasificación es obligatoria y debe asignarse durante la creación del producto. 

## **RF-CAT-44 - Visibilidad de clasificación en POS** 

**Descripción:** El sistema debe mostrar de forma visible la clasificación de tipo de venta del producto en la pantalla del punto de venta cuando el cajero lo agrega al carrito, para que el cajero pueda identificar si se requiere receta médica antes de completar la venta. 

## **RF-CAT-45 - Auditoría de cambio de clasificación de venta** 

**Descripción:** El sistema debe registrar en la auditoría cada cambio de clasificación de tipo de venta de un producto, incluyendo: identificador del producto, clasificación anterior, clasificación nueva, usuario responsable, fecha y hora. 

38 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.3.12 Configuración de stock mínimo** 

## **RF-CAT-46 - Configuración de stock mínimo** 

**Descripción:** El sistema debe permitir al administrador o al auxiliar de inventario configurar un valor de stock mínimo para cada producto, expresado en la unidad de medida de dispensación del producto. 

## **RF-CAT-47 - Validación del stock mínimo** 

**Descripción:** El sistema debe validar que el stock mínimo sea un valor numérico mayor o igual a cero. Si el valor no cumple esta condición, el sistema debe informar el error e impedir guardar la configuración. 

## **RF-CAT-48 - Uso del stock mínimo como umbral de reposición** 

**Descripción:** El sistema debe usar el stock mínimo configurado en RF-CAT-46 como umbral de referencia para las alertas de reposición definidas en el Módulo 4 (Inventario). Si no se ha configurado un stock mínimo, el sistema debe asumir cero como valor predeterminado y no generar alertas de reposición para ese producto. 

## **4.3.13 Búsqueda en el punto de venta** 

## **RF-CAT-49 - Búsqueda unificada de productos en POS** 

**Descripción:** El sistema debe permitir al cajero buscar productos en el punto de venta por nombre comercial, nombre genérico, principio activo, código interno o código de barras mediante un único campo de búsqueda. 

## **RF-CAT-50 - Búsqueda incremental en POS** 

**Descripción:** El sistema debe ejecutar la búsqueda de forma incremental, mostrando resultados relevantes a partir del segundo carácter ingresado sin requerir que el cajero presione una tecla de confirmación. 

## **RF-CAT-51 - Filtrado de productos activos en POS** 

**Descripción:** El sistema debe retornar únicamente productos con estado “activo” en los resultados de búsqueda del punto de venta, independientemente del término ingresado. 

39 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-52 - Datos mínimos en resultados de búsqueda POS** 

**Descripción:** El sistema debe mostrar en cada resultado de búsqueda del punto de venta los siguientes datos mínimos del producto: nombre comercial, principio activo, concentración, forma farmacéutica, laboratorio, precio de venta vigente, stock disponible y clasificación de tipo de venta. 

## **RF-CAT-53 - Adición automática al carrito por escaneo** 

**Descripción:** El sistema debe agregar automáticamente al carrito el producto cuyo código de barras sea escaneado, siempre que exista coincidencia exacta con un producto activo y que el producto tenga stock disponible mayor que cero. Si no hay coincidencia exacta o el stock es cero, el sistema debe informar al cajero el motivo sin agregar ningún ítem al carrito. 

## **RF-CAT-54 - Disponibilidad local del catálogo activo** 

**Descripción:** El sistema debe conservar el catálogo de productos activos con sus precios, impuestos y datos de búsqueda disponibles en el almacenamiento local de la estación de trabajo para permitir búsqueda y adición al carrito en modo de operación sin conectividad, conforme a lo establecido en el Módulo 8 (Sincronización y Operación Offline). 

## **4.3.14 Consulta administrativa del catálogo** 

## **RF-CAT-55 - Consulta filtrable del catálogo** 

**Descripción:** El sistema debe permitir al administrador consultar el catálogo completo de productos con la opción de aplicar filtros combinables por: estado (activo, inactivo o ambos), categoría, laboratorio fabricante, forma farmacéutica y tipo de venta. 

## **RF-CAT-56 - Datos mostrados en la consulta administrativa** 

**Descripción:** El sistema debe mostrar en el listado de resultados de la consulta administrativa los siguientes datos de cada producto: código interno, nombre comercial, principio activo, forma farmacéutica, concentración, categoría, laboratorio, precio de venta vigente, esquema de impuesto, tipo de venta y estado. 

40 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CAT-57 - Ficha administrativa completa del producto** 

**Descripción:** El sistema debe permitir al administrador acceder a la ficha completa de cualquier producto desde el listado de resultados, mostrando todos los campos registrados, el historial de precios, el historial de impuestos, los códigos de barras asociados y el historial de modificaciones. 

## **RF-CAT-58 - Exportación de consulta del catálogo** 

**Descripción:** El sistema debe permitir al administrador exportar el resultado de una consulta del catálogo en al menos un formato estructurado legible por herramientas externas, como CSV. 

## **4.3.15 Gestión de categorías y formas farmacéuticas** 

## **RF-CAT-59 - Gestión de categorías de producto** 

**Descripción:** El sistema debe permitir al administrador crear, modificar e inactivar categorías de producto. Una categoría inactiva no debe aparecer en la lista de opciones al crear o modificar un producto, pero los productos que ya la tenían asignada deben conservarla en su registro histórico. 

## **RF-CAT-60 - Gestión de formas farmacéuticas** 

**Descripción:** El sistema debe permitir al administrador crear, modificar e inactivar formas farmacéuticas. Una forma farmacéutica inactiva no debe aparecer en la lista de opciones al crear o modificar un producto, pero los productos que ya la tenían asignada deben conservarla en su registro histórico. 

## **RF-CAT-61 - Auditoría de categorías y formas farmacéuticas** 

**Descripción:** El sistema debe registrar en la auditoría cada creación, modificación e inactivación de categorías y formas farmacéuticas, incluyendo: tipo de elemento afectado, valor anterior si aplica, valor nuevo, usuario administrador responsable, fecha y hora. 

## **4.4 Módulo 4: Inventario Lotes y** 

41 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.4.1 Contexto del módulo** 

Este módulo regula la gestión de existencias físicas de los productos del catálogo. Mientras el Módulo 3 define qué se vende, este módulo gestiona cuánto hay disponible, dónde está, de qué lote proviene y cuándo vence. La unidad de gestión es el lote: cada conjunto de unidades de un producto con un número de lote específico asignado por el fabricante y una fecha de vencimiento propia. 

Todo movimiento de inventario, entrada, salida por venta, ajuste, devolución o bloqueo, queda registrado de forma inmutable con los datos del lote afectado. El stock disponible se calcula en tiempo real como la suma de existencias de lotes válidos no bloqueados. Este cálculo es la fuente de verdad para el punto de venta, las alertas de reposición y los reportes de inventario. 

**Restricción fundamental:** el sistema no debe permitir que ninguna operación de venta descuente existencias de un lote vencido ni de un lote bloqueado, sin importar el canal por el que se origine la operación. 

## **4.4.2 Control de acceso al módulo de inventario** 

## **RF-INV-01 - Registro de entradas restringido por rol** 

**Descripción:** El sistema debe permitir registrar entradas de inventario únicamente a usuarios con rol de auxiliar de inventario o administrador. Si un usuario con rol diferente intenta registrar una entrada, el sistema debe bloquear la operación e informar que no está autorizada para su rol. 

## **RF-INV-02 - Registro de ajustes restringido por rol** 

**Descripción:** El sistema debe permitir registrar ajustes de inventario únicamente a usuarios con rol de auxiliar de inventario o administrador. Un usuario con rol de cajero no debe tener acceso a la operación de ajuste de inventario. 

## **RF-INV-03 - Bloqueo y desbloqueo de lotes restringido por rol** 

**Descripción:** El sistema debe permitir bloquear y desbloquear lotes únicamente a usuarios con rol de administrador. Un auxiliar de inventario puede consultar el estado de bloqueo de un lote, pero no puede modificarlo. 

42 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-04 - Consulta de inventario según rol** 

**Descripción:** El sistema debe permitir consultar el inventario y la trazabilidad de lotes a usuarios con rol de administrador, auxiliar de inventario y contador. El cajero solo debe tener acceso al stock disponible total del producto durante la venta, sin ver el detalle por lote. 

## **4.4.3 Registro y gestión de lotes** 

## **RF-INV-05 - Identificación y datos básicos del lote** 

**Descripción:** El sistema debe gestionar las existencias de cada producto de forma independiente por lote. Cada lote queda identificado por: identificador interno único asignado por el sistema, número de lote del fabricante, producto al que pertenece, fecha de vencimiento, fecha de ingreso al sistema y estado. 

## **RF-INV-06 - Validación del número de lote** 

**Descripción:** El sistema debe validar que el número de lote ingresado no esté vacío y tenga una longitud máxima de 50 caracteres. Si la validación falla, el sistema debe informar el error e impedir registrar el lote. 

## **RF-INV-07 - Validación y advertencia por fecha de vencimiento** 

**Descripción:** El sistema debe validar que la fecha de vencimiento de un lote sea una fecha posterior a la fecha de registro de la entrada. Si la fecha de vencimiento es igual o anterior a la fecha actual, el sistema debe advertir al auxiliar de inventario antes de permitir el registro, exigiendo confirmación explícita y documentando la advertencia en la auditoría. 

## **RF-INV-08 - Convivencia de múltiples lotes activos por producto** 

**Descripción:** El sistema debe permitir que existan múltiples lotes activos del mismo producto con diferentes números de lote y diferentes fechas de vencimiento de forma simultánea. 

## **RF-INV-09 - Prevención de duplicado de lote activo** 

**Descripción:** El sistema debe impedir el registro de un lote con el mismo número de lote para el mismo producto si ese número de lote ya existe con estado activo en el inventario. Si se detecta duplicado, el sistema debe informar que el lote ya existe 

43 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

y sugerir al usuario registrar una entrada adicional sobre el lote existente. 

## **RF-INV-10 - Estados de lote** 

**Descripción:** El sistema debe manejar los siguientes estados para cada lote: activo, agotado, vencido y bloqueado. El sistema debe actualizar automáticamente el estado de un lote a “vencido” en la fecha en que su fecha de vencimiento sea alcanzada o superada. 

## **RF-INV-11 - Proceso automático diario de vencimiento** 

**Descripción:** El sistema debe verificar diariamente, en un proceso automático programado, qué lotes han alcanzado o superado su fecha de vencimiento y debe cambiar su estado a “vencido” de forma inmediata. Este proceso debe ejecutarse independientemente de si hay usuarios activos en el sistema. 

## **RF-INV-12 - Cambio automático a agotado** 

**Descripción:** El sistema debe actualizar automáticamente el estado de un lote a “agotado” cuando su cantidad disponible llegue a cero como resultado de una venta, ajuste o devolución a proveedor, sin requerir intervención del usuario. 

## **4.4.4 Cálculo de stock disponible** 

## **RF-INV-13 - Regla de cálculo de stock disponible** 

**Descripción:** El sistema debe calcular el stock disponible de un producto como la suma de las cantidades de todos sus lotes que cumplan simultáneamente las siguientes condiciones: estado activo, fecha de vencimiento posterior a la fecha actual y no bloqueados. 

## **RF-INV-14 - Actualización inmediata del stock disponible** 

**Descripción:** El sistema debe actualizar el stock disponible de un producto de forma inmediata cada vez que se registre cualquier movimiento que afecte sus lotes: entrada, salida por venta, ajuste, devolución de cliente, devolución a proveedor o cambio de estado de lote. 

44 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-15 - Stock visible para el cajero** 

**Descripción:** El sistema debe mostrar el stock disponible calculado según RF-INV13 como el valor que se presenta al cajero en el punto de venta al consultar un producto. El cajero no debe ver existencias de lotes vencidos ni bloqueados como parte del stock disponible. 

## **RF-INV-16 - Desglose de existencias por lote** 

**Descripción:** El sistema debe mostrar al auxiliar de inventario y al administrador, en la vista de detalle del inventario de un producto, el desglose de existencias por lote, indicando para cada lote: número de lote, cantidad disponible, fecha de vencimiento, fecha de ingreso y estado. 

## **4.4.5 Política FEFO** 

## **RF-INV-17 - Selección FEFO en ventas** 

**Descripción:** El sistema debe aplicar la política FEFO ( _First Expired, First Out_ ) al descontar existencias por una venta, seleccionando automáticamente el lote activo con la fecha de vencimiento más próxima entre todos los lotes disponibles del producto vendido. 

## **RF-INV-18 - Continuidad FEFO con múltiples lotes** 

**Descripción:** El sistema debe continuar seleccionando el siguiente lote con fecha de vencimiento más próxima si el lote seleccionado por FEFO no tiene existencias suficientes para cubrir la cantidad vendida, hasta completar el total de la venta o hasta agotar los lotes disponibles. 

## **RF-INV-19 - Registro de lotes afectados por venta** 

**Descripción:** El sistema debe registrar en el movimiento de salida qué lote o lotes específicos fueron afectados por la venta, con la cantidad descontada de cada uno, aun cuando la venta haya implicado múltiples lotes. 

## **RF-INV-20 - Bloqueo de venta por stock insuficiente** 

**Descripción:** El sistema debe impedir confirmar una venta si la cantidad solicitada supera el stock disponible total del producto, calculado según RF-INV-13, e informar al cajero la cantidad máxima disponible en ese momento. 

45 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.4.6 Bloqueo y desbloqueo de lotes** 

## **RF-INV-21 - Bloqueo manual de lote** 

**Descripción:** El sistema debe permitir al administrador bloquear manualmente un lote activo indicando obligatoriamente el motivo del bloqueo. Un lote bloqueado no debe ser seleccionable para ventas, ajustes de salida ni transferencias hasta ser desbloqueado explícitamente. 

## **RF-INV-22 - Exclusión de lotes bloqueados del stock disponible** 

**Descripción:** El sistema debe excluir los lotes con estado bloqueado del cálculo de stock disponible definido en RF-INV-13, de modo que las existencias de esos lotes no sean ofrecidas al cajero en el punto de venta. 

## **RF-INV-23 - Desbloqueo condicionado de lote** 

**Descripción:** El sistema debe permitir al administrador desbloquear un lote previamente bloqueado, siempre que el lote no esté vencido. Si el lote está vencido, el sistema debe impedir el desbloqueo e informar que el lote no puede habilitarse para la venta por su estado de vencimiento. 

## **RF-INV-24 - Auditoría de bloqueo y desbloqueo de lotes** 

**Descripción:** El sistema debe registrar en la auditoría cada bloqueo y desbloqueo de lote, incluyendo: identificador del lote, número de lote, producto asociado, motivo del bloqueo o desbloqueo, usuario administrador responsable, fecha y hora. 

## **4.4.7 Alertas por vencimiento** 

## **RF-INV-25 - Configuración de umbral de vencimiento próximo** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de alerta de vencimiento próximo expresado en número de días, con un valor mínimo de 1 día y un máximo de 365 días. 

## **RF-INV-26 - Alerta al cajero por lote próximo a vencer** 

**Descripción:** El sistema debe emitir una alerta al cajero en el punto de venta cuando el lote seleccionado para despachar un producto tenga una fecha de vencimiento dentro del umbral de días configurado en RF-INV-25. La alerta debe mostrar la fecha 

46 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

exacta de vencimiento del lote y permitir al cajero continuar o cancelar la adición del ítem al carrito. 

## **RF-INV-27 - Lista consolidada diaria de lotes próximos a vencer** 

**Descripción:** El sistema debe generar diariamente una lista consolidada de lotes próximos a vencer, agrupada por producto, que incluya: nombre del producto, número de lote, cantidad disponible y fecha de vencimiento, para todos los lotes cuya fecha de vencimiento esté dentro del umbral configurado en RF-INV-25. 

## **RF-INV-28 - Notificación administrativa de lotes próximos a vencer** 

**Descripción:** El sistema debe notificar al administrador y al auxiliar de inventario de la lista de lotes próximos a vencer generada en RF-INV-27, mostrándola como una alerta activa en el panel administrativo hasta que sea revisada explícitamente por el usuario. 

## **RF-INV-29 - Consulta filtrable de lotes próximos a vencer** 

**Descripción:** El sistema debe permitir al administrador y al auxiliar de inventario consultar el reporte de lotes próximos a vencer con filtros combinables por: horizonte en días, categoría de producto, laboratorio y estado de lote. 

## **4.4.8 Alertas por stock mínimo** 

## **RF-INV-30 - Verificación posterior a movimientos de salida** 

**Descripción:** El sistema debe verificar el stock disponible de cada producto después de cada movimiento de salida (venta, ajuste negativo o devolución a proveedor) y compararlo con el stock mínimo configurado para ese producto según RF-CAT-46. 

## **RF-INV-31 - Generación de alerta de reposición** 

**Descripción:** El sistema debe generar una alerta de reposición para un producto cuando su stock disponible calculado según RF-INV-13 sea igual o menor al stock mínimo configurado. La alerta debe permanecer activa hasta que el stock disponible supere el stock mínimo como resultado de una nueva entrada de inventario. 

47 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-32 - Visualización de alertas de stock mínimo** 

**Descripción:** El sistema debe mostrar las alertas de stock mínimo activas en el panel de inventario del auxiliar de inventario y del administrador, indicando para cada producto: nombre, stock disponible actual, stock mínimo configurado y diferencia entre ambos valores. 

## **RF-INV-33 - Integración con sugerencias de reposición** 

**Descripción:** El sistema debe incluir en la lista de sugerencias de reposición definida en RF-COM-08 todos los productos con alertas de stock mínimo activas, sin duplicados, ordenados de mayor a menor urgencia según la diferencia entre stock disponible y stock mínimo. 

## **4.4.9 Movimientos de inventario** 

## **RF-INV-34 - Registro inmutable de movimientos de inventario** 

**Descripción:** El sistema debe registrar cada movimiento de inventario con los siguientes datos de forma inmutable: identificador único del movimiento, tipo de movimiento, identificador del lote afectado, número de lote, producto, cantidad afectada, stock resultante del lote después del movimiento, usuario responsable, fecha y hora, y referencia al documento origen cuando aplique (número de compra, número de venta, número de ajuste o número de devolución). 

## **RF-INV-35 - Tipos de movimiento soportados** 

**Descripción:** El sistema debe manejar los siguientes tipos de movimiento de inventario: entrada por compra, salida por venta, ajuste positivo, ajuste negativo, devolución de cliente, devolución a proveedor, bloqueo administrativo, desbloqueo administrativo y vencimiento automático. 

## **RF-INV-36 - Prohibición de modificación o eliminación de movimientos** 

**Descripción:** El sistema debe impedir la modificación o eliminación de cualquier movimiento de inventario ya registrado, independientemente del rol del usuario que lo solicite. Las correcciones deben realizarse mediante movimientos compensatorios con referencia al movimiento original. 

48 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.4.10 Registro de entradas de inventario** 

## **RF-INV-37 - Formulario de entrada de inventario** 

**Descripción:** El sistema debe presentar el formulario de entrada de inventario con los siguientes campos obligatorios: producto (seleccionado del catálogo activo), número de lote, cantidad ingresada, fecha de vencimiento y costo unitario de compra. El campo de referencia a la compra asociada debe completarse automáticamente cuando la entrada se origine desde el módulo de compras. 

## **RF-INV-38 - Validación de cantidad ingresada** 

**Descripción:** El sistema debe validar que la cantidad ingresada en una entrada sea un valor numérico entero mayor que cero. Si la validación falla, el sistema debe informar el error e impedir guardar la entrada. 

## **RF-INV-39 - Incremento de existencias por entrada** 

**Descripción:** El sistema debe incrementar las existencias del lote correspondiente en la cantidad registrada al confirmar una entrada de inventario. Si el lote no existía previamente, el sistema debe crearlo con los datos ingresados y asignarle estado “activo”. 

## **RF-INV-40 - Auditoría de entrada de inventario** 

**Descripción:** El sistema debe registrar en la auditoría cada entrada de inventario, incluyendo: producto, lote, cantidad ingresada, costo unitario, usuario responsable, fecha y hora, y referencia a la compra si aplica. 

## **4.4.11 Ajustes de inventario** 

## **RF-INV-41 - Registro de ajuste de inventario** 

**Descripción:** El sistema debe permitir al auxiliar de inventario o administrador registrar un ajuste de inventario sobre un lote específico, indicando obligatoriamente: lote afectado, tipo de ajuste (positivo o negativo), cantidad ajustada y motivo documentado con un mínimo de 10 caracteres. 

49 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-42 - Validación de cantidad en ajuste** 

**Descripción:** El sistema debe validar que la cantidad del ajuste sea un valor numérico entero mayor que cero. El tipo de ajuste (positivo o negativo) se especifica mediante el campo de tipo, no mediante el signo de la cantidad. 

## **RF-INV-43 - Restricción de ajuste negativo por stock insuficiente** 

**Descripción:** El sistema debe impedir registrar un ajuste negativo sobre un lote si la cantidad a descontar supera las existencias actuales del lote. En ese caso, el sistema debe informar la cantidad disponible en el lote e impedir guardar el ajuste. 

## **RF-INV-44 - Aplicación inmediata de ajuste** 

**Descripción:** El sistema debe actualizar las existencias del lote afectado de forma inmediata al confirmar el ajuste, sumando la cantidad si es ajuste positivo o restándola si es ajuste negativo. 

## **RF-INV-45 - Auditoría de ajustes de inventario** 

**Descripción:** El sistema debe registrar en la auditoría cada ajuste de inventario, incluyendo: lote afectado, tipo de ajuste, cantidad, stock anterior del lote, stock resultante del lote, motivo documentado, usuario responsable, fecha y hora. 

## **4.4.12 Devoluciones de clientes al inventario** 

## **RF-INV-46 - Reintegro por devolución de cliente** 

**Descripción:** El sistema debe reintegrar las existencias de los lotes correspondientes al inventario cuando se registre una devolución de cliente confirmada, en la cantidad y lotes especificados en la devolución, según lo definido en RF-POS-22. 

## **RF-INV-47 - Tratamiento de devolución sobre lote vencido** 

**Descripción:** El sistema debe verificar que el lote al que se reintegran unidades por una devolución de cliente no esté vencido. Si el lote está vencido, el sistema debe impedir el reintegro al inventario disponible y registrar las unidades como devueltas en un estado de “pendiente de disposición”, informando al auxiliar de inventario para su gestión manual. 

50 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-48 - Movimiento de devolución de cliente referenciado** 

**Descripción:** El sistema debe registrar el reintegro de devolución de cliente como un movimiento de tipo “devolución de cliente” referenciado al número de venta original y al número de devolución generado. 

## **4.4.13 Devoluciones a proveedor desde inventario** 

## **RF-INV-49 - Descuento por devolución a proveedor** 

**Descripción:** El sistema debe descontar del inventario las unidades correspondientes al registrar una devolución a proveedor confirmada, según lo definido en RF-COM-06, generando un movimiento de tipo “devolución a proveedor” asociado al lote afectado. 

## **RF-INV-50 - Restricción de devolución a proveedor por stock insuficiente** 

**Descripción:** El sistema debe impedir registrar una devolución a proveedor si la cantidad a devolver supera las existencias actuales del lote indicado. En ese caso, el sistema debe informar la cantidad disponible e impedir guardar la devolución. 

## **4.4.14 Conteo físico de inventario** 

## **RF-INV-51 - Inicio de conteo físico** 

**Descripción:** El sistema debe permitir al auxiliar de inventario o administrador iniciar un proceso de conteo físico de inventario para uno o más productos o para toda la bodega. Durante el conteo, el sistema debe registrar la fecha y hora de inicio y el usuario que lo inició. 

## **RF-INV-52 - Registro de cantidades físicas por lote** 

**Descripción:** El sistema debe permitir al auxiliar de inventario ingresar las cantidades físicas contadas por lote durante un proceso de conteo activo, sin bloquear las operaciones normales de venta mientras el conteo está en curso. 

## **RF-INV-53 - Cálculo de diferencias de conteo** 

**Descripción:** El sistema debe calcular la diferencia entre la cantidad teórica registrada en el sistema y la cantidad física ingresada para cada lote contado, mostrando el resultado al auxiliar de inventario antes de confirmar el ajuste. 

51 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-54 - Ajuste por conteo físico** 

**Descripción:** El sistema debe aplicar los ajustes de inventario resultantes del conteo físico como movimientos de tipo “ajuste por conteo físico”, referenciados al identificador del proceso de conteo, una vez que el administrador confirme explícitamente los resultados. 

## **RF-INV-55 - Auditoría de conteo físico** 

**Descripción:** El sistema debe registrar en la auditoría el inicio, los resultados y la confirmación de cada proceso de conteo físico, incluyendo: usuario que inició el conteo, fecha y hora de inicio, usuario que confirmó los ajustes, fecha y hora de confirmación y resumen de diferencias encontradas. 

## **4.4.15 Trazabilidad de lotes** 

## **RF-INV-56 - Consulta de trazabilidad completa de lote** 

**Descripción:** El sistema debe permitir al administrador o auxiliar de inventario consultar la trazabilidad completa de un lote específico por su número de lote o identificador interno, mostrando todos los movimientos asociados en orden cronológico. 

## **RF-INV-57 - Datos mostrados en la trazabilidad de lote** 

**Descripción:** El sistema debe mostrar en la consulta de trazabilidad de un lote los siguientes datos por cada movimiento: fecha y hora, tipo de movimiento, cantidad afectada, stock resultante, usuario responsable y referencia al documento origen cuando aplique. 

## **RF-INV-58 - Consulta de ventas asociadas a un lote** 

**Descripción:** El sistema debe permitir consultar desde la trazabilidad de un lote los datos de las ventas en las que ese lote fue despachado, mostrando el número de venta, la fecha y el cliente asociado cuando esté disponible. 

## **RF-INV-59 - Búsqueda inversa de ventas por lote** 

**Descripción:** El sistema debe permitir al administrador buscar todas las ventas en las que fue despachado un lote específico, para facilitar la gestión de alertas sanitarias, retiros de mercado o investigaciones internas. 

52 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.4.16 Reportes de inventario** 

## **RF-INV-60 - Reporte de inventario valorizado** 

**Descripción:** El sistema debe generar un reporte de inventario valorizado que incluya para cada producto: nombre comercial, código interno, detalle por lote (número de lote, cantidad disponible, fecha de vencimiento), stock total disponible, costo promedio ponderado y valor total estimado de las existencias. 

## **RF-INV-61 - Reporte de movimientos de inventario** 

**Descripción:** El sistema debe generar un reporte de movimientos de inventario por período, filtrables por producto, lote, tipo de movimiento y usuario, mostrando cada movimiento con sus datos completos según RF-INV-34. 

## **RF-INV-62 - Reporte de lotes bloqueados activos** 

**Descripción:** El sistema debe generar un reporte de lotes bloqueados activos, mostrando para cada lote bloqueado: producto, número de lote, cantidad disponible, motivo del bloqueo, fecha de bloqueo y usuario que ejecutó el bloqueo. 

## **RF-INV-63 - Reporte de lotes vencidos con existencias** 

**Descripción:** El sistema debe generar un reporte de lotes vencidos con existencias mayores a cero, indicando para cada lote: producto, número de lote, cantidad restante, fecha de vencimiento y fecha en que el sistema registró el vencimiento automático. 

## **RF-INV-64 - Exportación de reportes de inventario** 

**Descripción:** El sistema debe permitir exportar cualquier reporte de inventario en al menos un formato estructurado legible por herramientas externas, como CSV. 

## **4.4.17 Comportamiento en modo offline** 

## **RF-INV-65 - Disponibilidad local de stock por producto** 

**Descripción:** El sistema debe conservar en el almacenamiento local de la estación de trabajo el stock disponible total por producto, actualizado con la última sincronización, para permitir la validación de disponibilidad durante ventas en modo de operación sin conectividad. 

53 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-66 - Descuento local de stock en ventas offline** 

**Descripción:** El sistema debe descontar del stock local disponible las cantidades vendidas durante la operación sin conectividad, de modo que las ventas subsiguientes en modo offline no superen el stock disponible registrado localmente. 

## **RF-INV-67 - Registro y sincronización cronológica de movimientos offline** 

**Descripción:** El sistema debe registrar localmente todos los movimientos de inventario generados durante la operación sin conectividad y sincronizarlos con el servidor central al restablecer la conectividad, en el orden cronológico en que fueron generados. 

## **RF-INV-68 - Reconciliación de stock local y central** 

**Descripción:** El sistema debe reconciliar el stock local con el stock del servidor central al completar la sincronización, aplicando los movimientos pendientes al estado del inventario central y resolviendo cualquier diferencia entre el stock local y el stock remoto antes de actualizar el catálogo local. 

## **RF-INV-69 - Alerta por stock negativo tras conciliación offline** 

**Descripción:** El sistema debe informar al administrador cuando, al reconciliar el inventario después de una operación offline, se detecte que el stock resultante de algún lote sea negativo como consecuencia de ventas concurrentes desde otras estaciones. En ese caso, el sistema debe registrar el incidente como un movimiento de ajuste de conciliación y generar una alerta para revisión manual. 

## **4.4.18 Indicadores de rotación** 

## **RF-INV-70 - Cálculo de rotación mensual** 

**Descripción:** El sistema debe calcular y mostrar la rotación mensual de cada producto como el número de unidades vendidas en el último mes calendario, con base en los movimientos de tipo “salida por venta” registrados en ese período. 

## **RF-INV-71 - Identificación de productos de baja rotación** 

**Descripción:** El sistema debe identificar y listar los productos sin movimientos de salida por venta en los últimos 90 días como productos de baja rotación, con la posibilidad de filtrar por categoría y laboratorio. 

54 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-INV-72 - Uso de rotación en sugerencias de reposición** 

**Descripción:** El sistema debe usar la rotación calculada en RF-INV-70 como factor de priorización en las sugerencias de reposición definidas en RF-COM-08, de manera que los productos con mayor rotación y menor stock relativo al mínimo aparezcan primero en la lista de sugerencias. 

## **4.5 Módulo 5: Compras y Recepción** 

## **4.5.1 Contexto del módulo** 

Este módulo regula el proceso de abastecimiento de la droguería: la gestión de proveedores, el registro de órdenes de compra, la recepción física de mercancía y las devoluciones a proveedor. Es el punto de entrada formal de existencias al inventario: toda unidad que ingrese al stock debe hacerlo a través de una recepción de compra registrada en este módulo, lo que garantiza trazabilidad completa desde el proveedor hasta el punto de venta. 

El módulo interactúa directamente con el Módulo 4 (Inventario y Lotes) al generar movimientos de entrada, y con el Módulo 3 (Catálogo) al referenciar productos existentes. Ninguna recepción puede crear productos nuevos: si un producto no está en el catálogo, debe ser registrado primero en el Módulo 3 antes de poder recibirse en una compra. 

Distinción clave entre orden de compra y recepción: una orden de compra es el documento que registra la intención de adquirir productos a un proveedor; una recepción es el registro formal de los productos que efectivamente ingresan al inventario. Una orden puede recibirse parcialmente en múltiples eventos de recepción. 

## **4.5.2 Control de acceso al módulo de compras** 

## **RF-COM-01 - Registro de proveedores restringido por rol** 

**Descripción:** El sistema debe permitir registrar proveedores únicamente a usuarios con rol de administrador. Si un usuario con rol diferente intenta acceder al formulario de registro de proveedor, el sistema debe bloquear el acceso e informar que la operación no está autorizada para su rol. 

55 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-02 - Gestión de órdenes de compra restringida por rol** 

**Descripción:** El sistema debe permitir crear y modificar órdenes de compra a usuarios con rol de auxiliar de inventario o administrador. Un cajero o contador no debe tener acceso a estas operaciones. 

## **RF-COM-03 - Registro de recepciones restringido por rol** 

**Descripción:** El sistema debe permitir registrar recepciones de mercancía a usuarios con rol de auxiliar de inventario o administrador. Un cajero o contador no debe poder registrar recepciones. 

## **RF-COM-04 - Registro de devoluciones a proveedor restringido por rol** 

**Descripción:** El sistema debe permitir registrar devoluciones a proveedor a usuarios con rol de auxiliar de inventario o administrador. La anulación de una devolución ya confirmada debe requerir rol de administrador. 

## **RF-COM-05 - Consulta del módulo de compras según rol** 

**Descripción:** El sistema debe permitir consultar órdenes de compra, recepciones, devoluciones y reportes de compras a usuarios con rol de administrador, auxiliar de inventario y contador. El cajero no debe tener acceso a este módulo. 

## **4.5.3 Gestión de proveedores** 

## **RF-COM-06 - Formulario de registro de proveedor** 

**Descripción:** El sistema debe presentar el formulario de registro de proveedor con los siguientes campos obligatorios: tipo de identificación tributaria, número de identificación tributaria, nombre o razón social y estado (activo o inactivo). Los campos de contacto son opcionales en el registro inicial. 

## **RF-COM-07 - Validación del tipo de identificación tributaria** 

**Descripción:** El sistema debe validar que el tipo de identificación tributaria corresponda a uno de los tipos válidos en Colombia: NIT, cédula de ciudadanía, cédula de extranjería o pasaporte. Si el tipo seleccionado no corresponde a esta lista, el sistema debe impedir completar el registro. 

56 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-08 - Validación del número de identificación tributaria** 

**Descripción:** El sistema debe validar que el número de identificación tributaria no esté vacío y tenga una longitud máxima de 20 caracteres alfanuméricos. Si la validación falla, el sistema debe informar el error e impedir guardar el registro. 

## **RF-COM-09 - Prevención de duplicado de proveedor activo** 

**Descripción:** El sistema debe verificar que no exista un proveedor activo con el mismo tipo y número de identificación tributaria antes de completar el registro. Si ya existe, el sistema debe informar el nombre del proveedor registrado e impedir crear un duplicado. 

## **RF-COM-10 - Datos de contacto opcionales del proveedor** 

**Descripción:** El sistema debe permitir registrar los siguientes datos de contacto del proveedor de forma opcional: nombre del representante comercial, teléfono principal, correo electrónico de contacto, dirección y ciudad. Cada uno de estos campos debe tener una longitud máxima de 150 caracteres. 

## **RF-COM-11 - Modificación auditada de proveedor** 

**Descripción:** El sistema debe permitir al administrador modificar cualquier dato de un proveedor existente. Cada modificación debe quedar registrada en la auditoría con el campo modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **RF-COM-12 - Inactivación de proveedor** 

**Descripción:** El sistema debe permitir al administrador cambiar el estado de un proveedor de “activo” a “inactivo”. Un proveedor inactivo no debe aparecer en la lista de selección al crear nuevas órdenes de compra, pero sí debe conservarse en el historial de órdenes y recepciones anteriores. 

## **RF-COM-13 - Restricción de inactivación por órdenes pendientes** 

**Descripción:** El sistema debe impedir inactivar un proveedor que tenga órdenes de compra en estado “pendiente de recepción”. Si existen órdenes en ese estado, el sistema debe informar la cantidad de órdenes pendientes e impedir la inactivación hasta que sean cerradas o anuladas. 

57 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-14 - Consulta de proveedores con filtros** 

**Descripción:** El sistema debe permitir al administrador consultar el listado de proveedores con filtros por estado (activo, inactivo o ambos) y por nombre o número de identificación. 

## **RF-COM-15 - Auditoría de creación de proveedor** 

**Descripción:** El sistema debe registrar en la auditoría la creación de cada proveedor, incluyendo todos los datos registrados, el usuario administrador responsable, la fecha y la hora. 

## **4.5.4 Órdenes de compra** 

## **RF-COM-16 - Creación de orden de compra** 

**Descripción:** El sistema debe permitir crear una orden de compra asociada a un proveedor activo, con uno o más ítems. Cada ítem debe especificar: producto del catálogo activo, cantidad solicitada y costo unitario esperado. La fecha de la orden debe registrarse automáticamente por el sistema. 

## **RF-COM-17 - Prohibición de orden de compra vacía** 

**Descripción:** El sistema debe impedir crear una orden de compra sin al menos un ítem registrado. Si el usuario intenta guardar una orden vacía, el sistema debe informar el error e impedir completar la operación. 

## **RF-COM-18 - Validación de cantidad solicitada** 

**Descripción:** El sistema debe validar que la cantidad solicitada de cada ítem en la orden sea un valor numérico entero mayor que cero. Si la validación falla en algún ítem, el sistema debe identificar cuál ítem tiene el error e impedir guardar la orden. 

## **RF-COM-19 - Validación del costo unitario esperado** 

**Descripción:** El sistema debe validar que el costo unitario esperado de cada ítem sea un valor numérico mayor que cero. Si la validación falla, el sistema debe informar el error e impedir guardar la orden. 

58 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-20 - Numeración única y secuencial de orden de compra** 

**Descripción:** El sistema debe asignar un número de orden de compra único y secuencial en el momento en que la orden sea guardada. Este número debe ser inmutable y visible en todas las consultas y documentos relacionados con esa orden. 

## **RF-COM-21 - Estados de orden de compra** 

**Descripción:** El sistema debe manejar los siguientes estados para una orden de compra: borrador, confirmada, parcialmente recibida, completamente recibida y anulada. 

## **RF-COM-22 - Modificación restringida según estado de orden** 

**Descripción:** El sistema debe permitir al usuario modificar los ítems de una orden con estado “borrador”. Una vez confirmada la orden, no debe ser posible modificar sus ítems ni su proveedor sin anularla primero. 

## **RF-COM-23 - Anulación de orden de compra según estado y rol** 

**Descripción:** El sistema debe permitir al administrador o auxiliar de inventario anular una orden de compra con estado “borrador” o “confirmada”. Si la orden tiene recepciones parciales ya registradas, solo el administrador puede anularla, y el sistema debe exigir un motivo documentado. Una orden con estado “completamente recibida” no puede ser anulada. 

## **RF-COM-24 - Auditoría de órdenes de compra** 

**Descripción:** El sistema debe registrar en la auditoría la creación, confirmación y anulación de cada orden de compra, incluyendo: número de orden, proveedor, usuario responsable, estado anterior, estado nuevo, fecha y hora, y motivo cuando aplique. 

## **4.5.5 Recepción de mercancía** 

## **RF-COM-25 - Recepción condicionada al estado de la orden** 

**Descripción:** El sistema debe permitir registrar una recepción de mercancía referenciada a una orden de compra con estado “confirmada” o “parcialmente recibida”. Si se intenta registrar una recepción sobre una orden con estado diferente, el sistema debe informar el estado actual de la orden e impedir la operación. 

59 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-26 - Recepción sin orden de compra previa** 

**Descripción:** El sistema debe permitir registrar recepciones sin orden de compra previa cuando el administrador lo autorice explícitamente. En ese caso, el auxiliar de inventario debe seleccionar el proveedor directamente en el formulario de recepción y documentar el motivo de la recepción sin orden. 

## **RF-COM-27 - Formulario de recepción con ítems precargados** 

**Descripción:** El sistema debe presentar el formulario de recepción con los ítems pendientes de recibir de la orden asociada precargados. El auxiliar de inventario debe poder ingresar por cada ítem recibido: cantidad recibida, número de lote, fecha de vencimiento y costo unitario real de recepción. 

## **RF-COM-28 - Recepción parcial de ítems** 

**Descripción:** El sistema debe permitir recibir una cantidad menor a la solicitada en la orden para cualquier ítem, registrando la diferencia como cantidad pendiente de recibir. En ese caso, el estado de la orden debe cambiar a “parcialmente recibida”. 

## **RF-COM-29 - Restricción por exceso en cantidad recibida** 

**Descripción:** El sistema debe impedir registrar una cantidad recibida mayor a la cantidad pendiente de recibir para cualquier ítem de la orden. Si la cantidad excede el pendiente, el sistema debe informar la cantidad máxima permitida e impedir guardar la recepción. 

## **RF-COM-30 - Validación de vencimiento en recepción** 

**Descripción:** El sistema debe validar que la fecha de vencimiento de cada lote recibido sea posterior a la fecha de recepción, aplicando la misma regla definida en RF-INV-07. Si la fecha de vencimiento es igual o anterior a la fecha actual, el sistema debe advertir al auxiliar e impedir registrar el lote sin confirmación explícita del administrador. 

## **RF-COM-31 - Numeración única y secuencial de recepción** 

**Descripción:** El sistema debe asignar un número de recepción único y secuencial en el momento en que la recepción sea confirmada. Este número debe ser inmutable y quedar referenciado en todos los movimientos de inventario generados por esa recepción. 

60 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-32 - Generación automática de movimientos de entrada** 

**Descripción:** El sistema debe generar automáticamente un movimiento de entrada en el Módulo 4 por cada ítem confirmado en la recepción, con todos los datos del lote recibido, según lo definido en RF-INV-37 a RF-INV-40. 

## **RF-COM-33 - Actualización de estado de orden por recepción** 

**Descripción:** El sistema debe actualizar el estado de la orden de compra a “completamente recibida” cuando todos sus ítems hayan sido recibidos en su totalidad. Si quedan ítems con cantidad pendiente mayor que cero, el estado debe permanecer como “parcialmente recibida”. 

## **RF-COM-34 - Auditoría de recepción de mercancía** 

**Descripción:** El sistema debe registrar en la auditoría cada recepción confirmada, incluyendo: número de recepción, número de orden asociada si aplica, proveedor, ítems recibidos con sus lotes y cantidades, usuario responsable, fecha y hora. 

## **4.5.6 Cálculo de costo promedio ponderado** 

## **RF-COM-35 - Cálculo del costo promedio ponderado** 

**Descripción:** El sistema debe calcular el costo promedio ponderado (CPP) de un producto al confirmar cada recepción que incluya ese producto, usando la siguiente fórmula: CPP nuevo = (stock anterior × CPP anterior + cantidad recibida × costo unitario recibido) / (stock anterior + cantidad recibida). 

## **RF-COM-36 - Actualización inmediata del CPP vigente** 

**Descripción:** El sistema debe almacenar el CPP vigente de cada producto y actualizarlo de forma inmediata cada vez que se confirme una recepción con un costo unitario diferente al CPP actual, sin modificar retroactivamente el costo registrado en recepciones anteriores. 

## **RF-COM-37 - Historial de cambios del CPP** 

**Descripción:** El sistema debe conservar el historial de cambios del CPP de cada producto, registrando por cada actualización: fecha y hora, CPP anterior, CPP nuevo, cantidad y costo unitario de la recepción que lo originó, y número de recepción de referencia. 

61 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-38 - Visualización del CPP vigente** 

**Descripción:** El sistema debe mostrar el CPP vigente de cada producto en la ficha del producto dentro del módulo de inventario y en los reportes de valorización de inventario, diferenciándolo claramente del precio de venta configurado en el Módulo 3. 

## **RF-COM-39 - Cálculo del margen estimado** 

**Descripción:** El sistema debe usar el CPP vigente como base para el cálculo del margen estimado de cada producto, calculado como: margen = (precio de venta - CPP) / precio de venta x 100, expresado en porcentaje. 

## **4.5.7 Devoluciones a proveedor** 

## **RF-COM-40 - Devolución sobre lote con existencias disponibles** 

**Descripción:** El sistema debe permitir registrar una devolución a proveedor sobre un lote específico que tenga existencias disponibles mayores que cero en el inventario. Si el lote no tiene existencias suficientes, el sistema debe informar la cantidad disponible e impedir guardar la devolución. 

## **RF-COM-41 - Formulario de devolución a proveedor** 

**Descripción:** El sistema debe presentar el formulario de devolución a proveedor con los siguientes campos obligatorios: proveedor, producto, lote a devolver, cantidad a devolver y motivo documentado con un mínimo de 10 caracteres. 

## **RF-COM-42 - Validación de cantidad a devolver** 

**Descripción:** El sistema debe validar que la cantidad a devolver sea un valor numérico entero mayor que cero y no superior a las existencias disponibles del lote indicado. Si alguna condición falla, el sistema debe informar el error específico e impedir guardar la devolución. 

## **RF-COM-43 - Motivos predefinidos de devolución a proveedor** 

**Descripción:** El sistema debe manejar los siguientes motivos predefinidos de devolución a proveedor, seleccionables como lista y complementables con observación libre: producto vencido o próximo a vencer, avería o daño físico, error en el pedido, retiro del mercado por INVIMA y otro motivo. 

62 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-44 - Generación automática de movimiento por devolución a proveedor** 

**Descripción:** El sistema debe generar automáticamente un movimiento de salida de tipo “devolución a proveedor” en el Módulo 4 al confirmar una devolución, descontando la cantidad devuelta del lote afectado, según lo definido en RF-INV-49 y RF-INV-50. 

## **RF-COM-45 - Numeración única y secuencial de devolución** 

**Descripción:** El sistema debe asignar un número de devolución único y secuencial al confirmar cada devolución a proveedor. Este número debe quedar referenciado en el movimiento de inventario generado y en la auditoría. 

## **RF-COM-46 - Anulación restringida de devolución a proveedor** 

**Descripción:** El sistema debe permitir al administrador o auxiliar de inventario anular una devolución a proveedor con estado “pendiente de confirmación”. Una vez confirmada, la devolución no puede ser anulada y las correcciones deben realizarse mediante una nueva entrada de inventario referenciada a la devolución original. 

## **RF-COM-47 - Auditoría de devolución a proveedor** 

**Descripción:** El sistema debe registrar en la auditoría cada devolución a proveedor confirmada, incluyendo: número de devolución, proveedor, producto, lote, cantidad, motivo, usuario responsable, fecha y hora. 

## **4.5.8 Sugerencias de reposición** 

## **RF-COM-48 - Generación automática de sugerencias de reposición** 

**Descripción:** El sistema debe generar automáticamente la lista de sugerencias de reposición incluyendo todos los productos cuyo stock disponible sea igual o menor al stock mínimo configurado, según lo establecido en RF-INV-31 y RF-INV-33. 

## **RF-COM-49 - Ordenamiento de sugerencias por urgencia** 

**Descripción:** El sistema debe ordenar la lista de sugerencias de reposición por urgencia, colocando primero los productos con mayor diferencia negativa entre stock disponible y stock mínimo, y priorizando entre iguales los de mayor rotación según RF-INV-72. 

63 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-COM-50 - Datos mostrados en sugerencias de reposición** 

**Descripción:** El sistema debe mostrar en cada ítem de la lista de sugerencias de reposición: nombre del producto, código interno, categoría, stock disponible actual, stock mínimo configurado, diferencia, rotación mensual y proveedor habitual si existe uno asociado al producto. 

## **RF-COM-51 - Asociación de proveedor habitual a producto** 

**Descripción:** El sistema debe permitir al administrador o auxiliar de inventario asociar un proveedor habitual a cada producto del catálogo para que aparezca preseleccionado en las sugerencias de reposición. Esta asociación debe ser opcional y modificable. 

## **RF-COM-52 - Generación de orden desde sugerencias de reposición** 

**Descripción:** El sistema debe permitir al auxiliar de inventario o administrador generar una orden de compra directamente desde la lista de sugerencias de reposición, preseleccionando los productos sugeridos como ítems de la nueva orden y permitiendo ajustar cantidades antes de confirmarla. 

## **RF-COM-53 - Actualización automática de sugerencias de reposición** 

**Descripción:** El sistema debe actualizar la lista de sugerencias de reposición de forma automática cada vez que se confirme una recepción de mercancía, una devolución de cliente o un ajuste de inventario que modifique el stock disponible de algún producto incluido en la lista. 

## **4.5.9 Reportes de compras** 

## **RF-COM-54 - Reporte de órdenes de compra por período** 

**Descripción:** El sistema debe generar un reporte de órdenes de compra por período, filtrable por proveedor, estado de la orden y rango de fechas, mostrando para cada orden: número de orden, proveedor, fecha, estado, total estimado y total recibido. 

## **RF-COM-55 - Reporte de recepciones por período** 

**Descripción:** El sistema debe generar un reporte de recepciones por período, filtrable por proveedor, producto y rango de fechas, mostrando para cada recepción: número de recepción, número de orden asociada, proveedor, productos recibidos con lotes y 

64 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

costos, y usuario responsable. 

## **RF-COM-56 - Reporte de devoluciones a proveedor por período** 

**Descripción:** El sistema debe generar un reporte de devoluciones a proveedor por período, filtrable por proveedor, producto y motivo, mostrando para cada devolución: número de devolución, proveedor, producto, lote, cantidad, motivo y usuario responsable. 

## **RF-COM-57 - Reporte de margen estimado por producto** 

**Descripción:** El sistema debe generar un reporte de margen estimado por producto, mostrando para cada producto activo: nombre, CPP vigente, precio de venta vigente y margen porcentual calculado según RF-COM-39, ordenable por margen de mayor a menor o de menor a mayor. 

## **RF-COM-58 - Reporte de compras por proveedor** 

**Descripción:** El sistema debe generar un reporte de compras por proveedor en un período seleccionado, mostrando el total de unidades y el valor total recibido por cada proveedor, con posibilidad de ver el detalle por producto. 

## **RF-COM-59 - Exportación de reportes de compras** 

**Descripción:** El sistema debe permitir exportar cualquier reporte de compras en al menos un formato estructurado legible por herramientas externas, como CSV. 

## **4.5.10 Comportamiento en modo offline** 

## **RF-COM-60 - Disponibilidad local de proveedores y catálogo para compras offline** 

**Descripción:** El sistema debe conservar en el almacenamiento local de la estación de trabajo el listado de proveedores activos y el catálogo de productos activos para permitir la creación y edición de órdenes de compra en modo de operación sin conectividad. 

## **RF-COM-61 - Registro offline de recepciones de mercancía** 

**Descripción:** El sistema debe permitir registrar recepciones de mercancía en modo de operación sin conectividad, almacenando la recepción y los movimientos de inventario 

65 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

generados en la cola de sincronización local, según lo definido en el Módulo 8. 

## **RF-COM-62 - Sincronización idempotente de compras offline** 

**Descripción:** El sistema debe sincronizar automáticamente con el servidor central las órdenes de compra, recepciones y devoluciones registradas en modo offline al restablecer la conectividad, aplicando el principio de idempotencia definido en RFSYNC-05 para evitar duplicados en los movimientos de inventario generados. 

## **4.6 Módulo 6: Ventas POS** 

## **4.6.1 Contexto del módulo** 

Este módulo regula el ciclo de vida completo de una venta en el punto de venta: desde la apertura del carrito hasta la confirmación del cobro, la impresión del comprobante, el descuento de inventario y la generación del documento fiscal. Es el módulo de mayor frecuencia de uso del sistema y el de mayor impacto operativo directo, por lo que sus flujos deben ser rápidos, precisos y resilientes ante fallos de conectividad. 

Una venta es la transacción comercial que nace cuando el cajero agrega el primer ítem al carrito y termina en uno de tres estados finales posibles: confirmada, anulada o abandonada (carrito descartado antes del cobro). Solo las ventas confirmadas generan movimientos de inventario, documentos fiscales y registros contables. Las ventas abandonadas no dejan trazabilidad financiera, pero sí registro de auditoría. 

Distinción clave entre estado operacional y estado fiscal: una venta puede estar confirmada operacionalmente desde el momento del cobro, pero su documento fiscal puede estar en estado pendiente de envío, validado, rechazado o contingencia. Estos dos estados son independientes y deben gestionarse por separado, tal como se define en el Módulo 9 (Facturación Electrónica DIAN). 

66 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.6.2 Control de acceso al módulo de ventas POS** 

## **RF-POS-01 - Acceso restringido al punto de venta** 

**Descripción:** El sistema debe permitir iniciar y registrar ventas únicamente a usuarios con rol de cajero o administrador. Si un usuario con rol diferente intenta acceder a la pantalla de punto de venta, el sistema debe bloquear el acceso e informar que la operación no está autorizada para su rol. 

## **RF-POS-02 - Requisito de turno activo para vender** 

**Descripción:** El sistema debe requerir que el usuario tenga un turno de caja activo en la estación de trabajo antes de habilitar cualquier operación de venta, en cumplimiento de RF-CAJA-11. Si no existe turno activo, el sistema debe mostrar el mensaje correspondiente y redirigir al flujo de apertura de turno. 

## **RF-POS-03 - Permiso explícito para anular ventas** 

**Descripción:** El sistema debe permitir ejecutar anulaciones de ventas únicamente a usuarios con permiso explícito de anulación, independientemente de su rol. El administrador tiene este permiso por defecto. El cajero solo puede anular si el administrador se lo ha habilitado en su configuración de usuario. 

## **RF-POS-04 - Registro de devoluciones según rol** 

**Descripción:** El sistema debe permitir registrar devoluciones de clientes a usuarios con rol de cajero, auxiliar de inventario o administrador. La devolución de una venta de otro cajero debe requerir confirmación del administrador cuando el sistema esté configurado para exigirlo. 

## **4.6.3 Inicio de venta** 

## **RF-POS-05 - Pantalla inicial del POS lista para operar** 

**Descripción:** El sistema debe presentar la pantalla principal del punto de venta con un área de carrito vacía y un campo de búsqueda de productos activo al inicio del turno, listo para recibir texto o lectura de código de barras sin pasos intermedios. 

67 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-06 - Creación automática de venta al agregar el primer ítem** 

**Descripción:** El sistema debe crear una nueva venta con un identificador interno único en el momento en que el cajero agrega el primer ítem al carrito. Este identificador debe ser asignado por el sistema de forma automática y nunca reutilizado, aun si la venta es posteriormente abandonada. 

## **RF-POS-07 - Asociación automática de venta a turno y usuario** 

**Descripción:** El sistema debe asociar automáticamente la venta al turno activo de la estación de trabajo y al usuario autenticado en el momento de su creación, sin requerir selección manual por parte del cajero. 

## **RF-POS-08 - Registro de fecha y hora de inicio de venta** 

**Descripción:** El sistema debe registrar la fecha y hora exactas de inicio de la venta en el momento en que se crea el identificador interno, según RF-POS-06. 

## **4.6.4 Búsqueda y adición de productos al carrito** 

## **RF-POS-09 - Búsqueda unificada de productos** 

**Descripción:** El sistema debe permitir al cajero buscar productos para agregar al carrito mediante un único campo de búsqueda que acepte: nombre comercial, nombre genérico, principio activo, código interno y código de barras ingresado por teclado o escáner. 

## **RF-POS-10 - Búsqueda incremental de productos** 

**Descripción:** El sistema debe ejecutar la búsqueda de forma incremental, mostrando resultados a partir del segundo carácter ingresado, sin requerir que el cajero presione una tecla de confirmación adicional. 

## **RF-POS-11 - Datos mostrados en resultados de búsqueda** 

**Descripción:** El sistema debe mostrar en cada resultado de búsqueda los siguientes datos del producto: nombre comercial, principio activo, concentración, forma farmacéutica, laboratorio, precio de venta vigente, stock disponible y clasificación de tipo de venta (libre o con receta médica obligatoria). 

68 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-12 - Exclusión de productos inactivos en búsqueda** 

**Descripción:** El sistema debe retornar únicamente productos con estado “activo” en los resultados de búsqueda del punto de venta. Si el término de búsqueda coincide solo con productos inactivos, el sistema debe mostrar el carrito vacío de resultados sin mensajes de error sobre los productos inactivos. 

## **RF-POS-13 - Adición manual de producto al carrito** 

**Descripción:** El sistema debe agregar un producto al carrito cuando el cajero lo seleccione de los resultados de búsqueda, con una cantidad inicial de una unidad, siempre que el producto cumpla todas las condiciones de venta definidas en la sección 6.5. 

## **RF-POS-14 - Adición automática por código de barras** 

**Descripción:** El sistema debe agregar automáticamente un producto al carrito cuando el código de barras escaneado tenga coincidencia exacta con un producto activo con stock disponible mayor que cero. Si el mismo producto ya está en el carrito, el sistema debe incrementar la cantidad existente en una unidad en lugar de crear una línea duplicada. 

## **RF-POS-15 - Advertencia por código de barras sin coincidencia** 

**Descripción:** El sistema debe mostrar una advertencia visible al cajero cuando el código de barras escaneado no tenga coincidencia con ningún producto activo del catálogo, sin agregar ningún ítem al carrito ni interrumpir el flujo de venta. 

## **4.6.5 Gestión del carrito** 

## **RF-POS-16 - Modificación de cantidad en carrito** 

**Descripción:** El sistema debe permitir al cajero modificar la cantidad de cualquier ítem del carrito antes de confirmar el cobro, ingresando directamente el nuevo valor o usando controles de incremento y decremento. 

## **RF-POS-17 - Validación de cantidad en carrito** 

**Descripción:** El sistema debe validar que la cantidad modificada de un ítem sea un valor numérico entero mayor que cero. Si el valor ingresado es cero, negativo o no numérico, el sistema debe rechazar la modificación e informar al cajero el criterio 

69 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

incumplido. 

## **RF-POS-18 - Restricción por stock disponible al modificar cantidad** 

**Descripción:** El sistema debe validar que la cantidad modificada de un ítem no supere el stock disponible del producto en el momento de la modificación. Si la cantidad excede el stock disponible, el sistema debe informar al cajero la cantidad máxima disponible e impedir guardar la modificación. 

## **RF-POS-19 - Eliminación de ítems del carrito** 

**Descripción:** El sistema debe permitir al cajero eliminar cualquier ítem del carrito antes de confirmar el cobro, mediante una acción explícita sobre el ítem. 

## **RF-POS-20 - Recalculo inmediato de totales del carrito** 

**Descripción:** El sistema debe actualizar de forma inmediata los valores de subtotal, impuestos desagregados por tarifa, descuentos aplicados y total de la venta ante cada modificación del carrito: adición de ítem, cambio de cantidad, eliminación de ítem o aplicación de descuento. 

## **RF-POS-21 - Resumen permanente de la venta activa** 

**Descripción:** El sistema debe mostrar de forma permanente y visible en la pantalla del punto de venta, durante toda la duración de la venta activa: el número de ítems en el carrito, el subtotal sin impuestos, el total de impuestos, el total de descuentos y el total a pagar. 

## **RF-POS-22 - Datos mostrados por ítem en el carrito** 

**Descripción:** El sistema debe mostrar para cada ítem del carrito: nombre comercial del producto, cantidad, precio unitario vigente, valor de impuesto del ítem, descuento aplicado sobre el ítem si existe y subtotal del ítem. 

## **RF-POS-23 - Descarte explícito de venta antes del cobro** 

**Descripción:** El sistema debe permitir al cajero descartar la venta activa antes del cobro mediante una acción explícita. El sistema debe solicitar confirmación antes de descartar el carrito si este contiene al menos un ítem. 

70 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-24 - Auditoría de ventas descartadas** 

**Descripción:** El sistema debe registrar en la auditoría cada venta descartada antes del cobro, incluyendo: identificador de la venta, usuario, estación de trabajo, productos que estaban en el carrito, fecha y hora del descarte. 

## **4.6.6 Restricciones de venta sobre productos** 

## **RF-POS-25 - Prohibición de venta sin existencias** 

**Descripción:** El sistema debe impedir agregar al carrito un producto cuyo stock disponible, calculado según RF-INV-13, sea igual a cero. Si el cajero intenta agregar un producto agotado, el sistema debe informar que no hay existencias disponibles y no agregar el ítem. 

## **RF-POS-26 - Prohibición de exceder stock en carrito** 

**Descripción:** El sistema debe impedir agregar al carrito un producto si la cantidad resultante en el carrito supera el stock disponible del producto. Si el cajero intenta superar el stock, el sistema debe informar la cantidad máxima disponible e impedir el ajuste. 

## **RF-POS-27 - Prohibición de venta de lote vencido** 

**Descripción:** El sistema debe impedir agregar al carrito un producto cuyo único lote disponible esté vencido, según lo establecido en RF-INV-05 y RF-INV-10, e informar al cajero que el producto no está disponible para la venta. 

## **RF-POS-28 - Alerta por lote próximo a vencer** 

**Descripción:** El sistema debe emitir una alerta visible al cajero cuando el producto que intenta agregar al carrito tenga el lote disponible más próximo dentro del umbral de vencimiento configurado en RF-INV-25, mostrando la fecha de vencimiento del lote y permitiendo al cajero confirmar o cancelar la adición. 

## **RF-POS-29 - Prohibición de venta de producto inactivo** 

**Descripción:** El sistema debe impedir agregar al carrito un producto con estado inactivo en el catálogo, según RF-CAT-09, e informar al cajero que el producto no está disponible. 

71 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-30 - Prohibición de venta sin esquema tributario** 

**Descripción:** El sistema debe impedir agregar al carrito un producto que no tenga esquema de impuesto configurado, según RF-CAT-27, e informar al cajero que el producto requiere configuración antes de poder venderse. 

## **4.6.7 Descuentos** 

## **RF-POS-31 - Descuento por ítem con límite por rol** 

**Descripción:** El sistema debe permitir aplicar un descuento sobre un ítem específico del carrito, expresado como porcentaje del precio unitario. El descuento aplicado no debe superar el porcentaje máximo autorizado para el rol del cajero, configurable por el administrador. 

## **RF-POS-32 - Descuento global con límite por rol** 

**Descripción:** El sistema debe permitir aplicar un descuento global sobre el total de la venta, expresado como porcentaje del total sin descuento. El descuento global aplicado no debe superar el porcentaje máximo de descuento global autorizado para el rol del cajero, configurable de forma independiente al límite del descuento por ítem. 

## **RF-POS-33 - Bloqueo de descuentos por encima del límite** 

**Descripción:** El sistema debe impedir guardar un descuento por ítem o un descuento global que supere el límite configurado para el rol del cajero. Si el porcentaje ingresado supera el límite, el sistema debe informar el porcentaje máximo permitido e impedir aplicar el descuento. 

## **RF-POS-34 - Aprobación de descuento por administrador en sesión paralela** 

**Descripción:** El sistema debe permitir que un administrador autentique su sesión en la pantalla del punto de venta para aprobar un descuento que supere el límite del cajero, sin cerrar la sesión del cajero activo. Al aprobar el descuento, el sistema debe registrar que fue autorizado por el administrador. 

## **RF-POS-35 - Trazabilidad de descuentos aplicados** 

**Descripción:** El sistema debe registrar por cada descuento aplicado en la venta: tipo de descuento (por ítem o global), porcentaje aplicado, valor en moneda, usuario 

72 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

cajero que lo ingresó y usuario administrador que lo autorizó si aplica. 

## **RF-POS-36 - Recalculo tributario posterior a descuentos** 

**Descripción:** El sistema debe recalcular el total de impuestos después de aplicar cualquier descuento, usando como base el precio con descuento aplicado, no el precio original. 

## **4.6.8 Productos con receta médica obligatoria** 

## **RF-POS-37 - Advertencia por producto con receta obligatoria** 

**Descripción:** El sistema debe mostrar una advertencia claramente visible al cajero cuando se agregue al carrito un producto clasificado como “venta con receta médica obligatoria”, según RF-CAT-43 y RF-CAT-44, indicando que el producto requiere presentación de receta. 

## **RF-POS-38 - Configuración de exigencia de confirmación de receta** 

**Descripción:** El sistema debe permitir al administrador configurar si la venta de productos con receta médica obligatoria exige confirmación explícita del cajero antes de continuar, o si la advertencia es solo informativa. Si está configurado como obligatorio, el sistema no debe permitir confirmar la venta sin que el cajero marque explícitamente que la receta fue presentada. 

## **RF-POS-39 - Registro de validación de receta en la venta** 

**Descripción:** El sistema debe registrar en la venta si alguno de los productos vendidos es de venta con receta médica obligatoria, junto con el indicador de si el cajero confirmó la presentación de la receta cuando el sistema está configurado para exigirlo. 

73 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.6.9 Asociación de cliente a la venta** 

## **RF-POS-40 - Asociación de cliente a venta activa** 

**Descripción:** El sistema debe permitir al cajero asociar un cliente a la venta activa en cualquier momento antes de confirmar el cobro, mediante búsqueda por número de identificación o nombre. 

## **RF-POS-41 - Creación de cliente desde el POS** 

**Descripción:** El sistema debe permitir al cajero crear un cliente nuevo directamente desde la pantalla del punto de venta durante la venta activa, capturando al menos tipo de identificación, número de identificación y nombre o razón social, sin interrumpir ni descartar el carrito en curso. 

## **RF-POS-42 - Cliente obligatorio por monto máximo sin identificar** 

**Descripción:** El sistema debe marcar la asociación de cliente como obligatoria cuando el monto total de la venta supere el límite máximo para ventas sin identificar, configurable por el administrador. Si se intenta confirmar el cobro sin cliente asociado y el monto supera el límite, el sistema debe informar al cajero e impedir continuar. 

## **RF-POS-43 - Cliente obligatorio para factura electrónica** 

**Descripción:** El sistema debe marcar la asociación de cliente como obligatoria para emitir factura electrónica de venta cuando el cliente la solicite, dado que el Módulo 9 requiere los datos del adquirente para la generación del documento fiscal. 

## **RF-POS-44 - Desvinculación de cliente antes del cobro** 

**Descripción:** El sistema debe permitir al cajero desvincular un cliente de la venta activa antes de confirmar el cobro, mediante una acción explícita, siempre que no se haya comprometido la emisión de factura electrónica al cliente. 

74 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.6.10 Selección del tipo de documento fiscal** 

## **RF-POS-45 - Selección del tipo de documento antes del cobro** 

**Descripción:** El sistema debe permitir al cajero seleccionar antes del cobro si la venta generará una factura electrónica de venta o un tiquete de caja, cuando ambos tipos de documento estén habilitados por la configuración del sistema. 

## **RF-POS-46 - Datos completos de cliente para factura electrónica** 

**Descripción:** El sistema debe exigir la asociación de un cliente con sus datos de identificación completos cuando el cajero seleccione la emisión de factura electrónica de venta, según lo requerido en RF-CLI-05 y RF-DIAN-02. 

## **RF-POS-47 - Asignación automática de tipo de documento** 

**Descripción:** El sistema debe asignar automáticamente el tipo de documento según las reglas configuradas por el administrador cuando el cajero no realice ninguna selección explícita antes del cobro. 

## **4.6.11 Registro de pago y cobro** 

## **RF-POS-48 - Pantalla de cobro con medios habilitados** 

**Descripción:** El sistema debe presentar la pantalla de cobro mostrando el total a pagar y los medios de pago disponibles y habilitados para la estación de trabajo, configurables por el administrador. 

## **RF-POS-49 - Cobro con uno o múltiples medios de pago** 

**Descripción:** El sistema debe permitir registrar el pago de una venta con un único medio de pago o con múltiples medios de pago simultáneos. La suma de los montos registrados por todos los medios de pago debe ser igual o mayor al total de la venta antes de permitir confirmar el cobro. 

## **RF-POS-50 - Cálculo automático de cambio** 

**Descripción:** El sistema debe calcular automáticamente el cambio a devolver al cliente como la diferencia entre la suma de los montos recibidos y el total de la venta, cuando el monto total recibido supere el total a pagar. El cambio solo debe calcularse sobre el monto en efectivo, no sobre otros medios de pago. 

75 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-51 - Prohibición de cobro con pago insuficiente** 

**Descripción:** El sistema debe impedir confirmar el cobro si la suma de los montos registrados por todos los medios de pago es menor al total de la venta. Si existe diferencia pendiente, el sistema debe mostrar el monto faltante e impedir continuar. 

## **RF-POS-52 - Validación de monto por medio de pago** 

**Descripción:** El sistema debe validar que cada monto individual ingresado por medio de pago sea un valor numérico mayor que cero. Si el valor es cero, negativo o no numérico, el sistema debe informar el error e impedir agregar ese medio de pago al cobro. 

## **RF-POS-53 - Prohibición de repetir medio de pago en la venta** 

**Descripción:** El sistema debe impedir registrar el mismo medio de pago más de una vez en la misma venta. Si el cajero intenta agregar un medio de pago ya registrado, el sistema debe informar el error e impedir la adición. 

## **4.6.12 Confirmación de la venta** 

## **RF-POS-54 - Confirmación explícita previa al cobro** 

**Descripción:** El sistema debe solicitar al cajero una confirmación explícita antes de procesar el cobro, mostrando el resumen final de la venta con el total, los medios de pago y el cambio si aplica. 

## **RF-POS-55 - Confirmación atómica de la venta** 

**Descripción:** El sistema debe confirmar la venta de forma atómica: el descuento de inventario, el registro del cobro, la actualización del resumen del turno y la generación del comprobante deben ocurrir como una unidad indivisible. Si alguno de estos pasos falla, el sistema debe revertir los demás y preservar el carrito para que el cajero pueda reintentar. 

## **RF-POS-56 - Registro inmutable de venta confirmada** 

**Descripción:** El sistema debe registrar la venta confirmada con los siguientes datos de forma inmutable: identificador interno único, número secuencial de venta del turno, identificador del turno, usuario cajero, estación de trabajo, fecha y hora de confirmación, lista completa de ítems con producto, lote, cantidad y precios, 

76 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

descuentos aplicados, impuestos desagregados, medios de pago con montos, cambio entregado, cliente asociado si existe, tipo de documento fiscal seleccionado y estado operacional inicial. 

## **RF-POS-57 - Descuento de inventario al confirmar la venta** 

**Descripción:** El sistema debe descontar las existencias de los lotes correspondientes según la política FEFO definida en RF-INV-17 a RF-INV-19 en el momento exacto de la confirmación de la venta, antes de emitir el comprobante. 

## **RF-POS-58 - Actualización inmediata del resumen del turno** 

**Descripción:** El sistema debe actualizar el resumen del turno activo de forma inmediata al confirmar la venta, sumando el total de la venta al recaudo acumulado del medio de pago correspondiente, según RF-CAJA-15. 

## **RF-POS-59 - Estados iniciales operacional y fiscal de la venta** 

**Descripción:** El sistema debe asignar el estado operacional “confirmada” a la venta al completar su registro y el estado fiscal “pendiente de envío” al documento fiscal asociado, en cumplimiento de RF-DIAN-08. 

## **4.6.13 Comprobante de venta** 

## **RF-POS-60 - Generación inmediata de comprobante** 

**Descripción:** El sistema debe generar el comprobante de venta de forma inmediata al confirmar el cobro, antes de cualquier transmisión al servidor central o al proveedor tecnológico DIAN. 

## **RF-POS-61 - Contenido mínimo del comprobante de venta** 

**Descripción:** El sistema debe incluir en el comprobante de venta los siguientes datos mínimos: nombre y datos del establecimiento, número interno de la venta, fecha y hora de la transacción, nombre del cajero, lista de productos vendidos con cantidad y precio unitario, descuentos aplicados, impuestos desagregados, total, medios de pago y cambio entregado. 

77 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-62 - Marcado de comprobante provisional** 

**Descripción:** El sistema debe incluir en el comprobante la indicación de que el documento es un “comprobante provisional” cuando el documento fiscal aún no haya sido validado por la DIAN, para evitar confusión con la representación gráfica de la factura electrónica definitiva. 

## **RF-POS-63 - Impresión automática y disponibilidad para reimpresión** 

**Descripción:** El sistema debe enviar automáticamente el comprobante a la impresora configurada para la estación de trabajo al confirmar la venta. Si la impresora no está disponible, el sistema debe notificar al cajero y conservar el comprobante disponible para reimprimir desde el historial de ventas del turno. 

## **RF-POS-64 - Reimpresión de comprobante del turno activo** 

**Descripción:** El sistema debe permitir al cajero reimprimir el comprobante de cualquier venta del turno activo desde la pantalla del historial de ventas del turno, sin requerir autorización adicional. 

## **RF-POS-65 - Envío digital de comprobante o representación gráfica** 

**Descripción:** El sistema debe permitir enviar el comprobante o la representación gráfica de la factura electrónica al cliente por un medio digital configurado por el administrador, cuando el cliente lo solicite y el sistema tenga disponible el medio configurado. 

## **4.6.14 Ventas en espera** 

## **RF-POS-66 - Suspensión de venta activa** 

**Descripción:** El sistema debe permitir al cajero suspender la venta activa para atender otra transacción urgente, conservando el carrito en un estado “en espera” asociado a la estación de trabajo y al cajero. 

## **RF-POS-67 - Límite configurable de ventas en espera** 

**Descripción:** El sistema debe permitir al cajero tener un máximo de ventas en espera simultáneas configurable por el administrador. Si se intenta suspender más ventas del límite configurado, el sistema debe informar al cajero e impedir la suspensión. 

78 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-68 - Recuperación de venta en espera** 

**Descripción:** El sistema debe permitir al cajero recuperar una venta en espera y continuar desde el punto en que fue suspendida, con el carrito, descuentos y cliente asociado exactamente como quedaron al momento de la suspensión. 

## **RF-POS-69 - Liberación automática de venta en espera por inactividad** 

**Descripción:** El sistema debe liberar automáticamente una venta en espera que no haya sido retomada después de un tiempo de inactividad configurable por el administrador, descartándola y registrando el evento en la auditoría. 

## **4.6.15 Anulaciones de ventas** 

## **RF-POS-70 - Anulación de venta con motivo obligatorio** 

**Descripción:** El sistema debe permitir anular una venta confirmada únicamente a usuarios con permiso de anulación, según RF-POS-03, exigiendo la selección de un motivo predefinido y la opción de agregar una observación libre. 

## **RF-POS-71 - Motivos predefinidos de anulación** 

**Descripción:** El sistema debe manejar los siguientes motivos predefinidos de anulación, seleccionables como lista: error en el producto registrado, error en la cantidad, error en el precio, solicitud del cliente, fallo en el medio de pago y otro motivo. 

## **RF-POS-72 - Restricción de anulación por estado fiscal validado** 

**Descripción:** El sistema debe impedir anular una venta que ya tenga un documento fiscal con estado “validado” ante la DIAN, e informar al usuario que en ese caso debe emitir una nota crédito electrónica según los requisitos del Módulo 9. La anulación directa solo es posible si el documento fiscal está en estado “pendiente de envío” o “rechazado”. 

## **RF-POS-73 - Reversión exacta de inventario por anulación** 

**Descripción:** El sistema debe revertir el descuento de inventario de los lotes afectados al anular una venta, reintegrando las existencias exactas que fueron descontadas al momento de la confirmación, con los mismos lotes y cantidades, según RF-INV-20. 

79 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-74 - Cambio de estado operacional a anulada** 

**Descripción:** El sistema debe cambiar el estado operacional de la venta a “anulada” al confirmar la anulación, conservando el registro completo de la venta original y agregando los datos de la anulación: usuario, motivo, observación, fecha y hora. 

## **RF-POS-75 - Auditoría de anulaciones de venta** 

**Descripción:** El sistema debe registrar en la auditoría cada anulación de venta, incluyendo: identificador de la venta anulada, usuario que ejecutó la anulación, motivo, observación, estación de trabajo, fecha y hora. 

## **4.6.16 Devoluciones de clientes** 

## **RF-POS-76 - Registro de devolución parcial o total** 

**Descripción:** El sistema debe permitir registrar una devolución parcial o total sobre una venta con estado operacional “confirmada”, identificando la venta original por su número de venta. 

## **RF-POS-77 - Selección de ítems y cantidades a devolver** 

**Descripción:** El sistema debe presentar al cajero la lista de ítems de la venta original con sus cantidades y permitir seleccionar cuáles ítems y en qué cantidades se devuelven. La cantidad a devolver por ítem no debe superar la cantidad vendida en la venta original. 

## **RF-POS-78 - Motivos predefinidos de devolución** 

**Descripción:** El sistema debe exigir la selección de un motivo de devolución predefinido: cambio de producto, producto defectuoso, producto incorrecto, solicitud del cliente y otro motivo. El campo de observación libre es opcional. 

## **RF-POS-79 - Cálculo del valor a reembolsar** 

**Descripción:** El sistema debe calcular el valor a reembolsar al cliente como la suma de los subtotales con impuestos de los ítems devueltos, considerando los descuentos proporcionales aplicados en la venta original. 

80 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-POS-80 - Registro del medio de reembolso** 

**Descripción:** El sistema debe registrar el medio de reembolso al cliente: efectivo, crédito para próxima compra u otro medio habilitado. Si el reembolso es en efectivo, debe registrarse como una salida de caja del turno activo. 

## **RF-POS-81 - Reintegro de inventario por devolución** 

**Descripción:** El sistema debe reintegrar al inventario las existencias de los lotes correspondientes al confirmar la devolución, aplicando las reglas definidas en RFINV-46 y RF-INV-47. 

## **RF-POS-82 - Numeración única y secuencial de devolución de cliente** 

**Descripción:** El sistema debe asignar un número de devolución único y secuencial al confirmar cada devolución, referenciado a la venta original. 

## **RF-POS-83 - Auditoría de devoluciones de cliente** 

**Descripción:** El sistema debe registrar en la auditoría cada devolución de cliente confirmada, incluyendo: número de devolución, número de venta original, ítems devueltos con cantidades, valor reembolsado, medio de reembolso, usuario responsable, estación de trabajo, fecha y hora. 

## **4.6.17 Historial de ventas del turno** 

## **RF-POS-84 - Historial del turno activo** 

**Descripción:** El sistema debe mostrar al cajero el historial de ventas confirmadas, anuladas y con devoluciones del turno activo en la estación de trabajo, ordenadas de la más reciente a la más antigua. 

## **RF-POS-85 - Datos mostrados en historial de ventas** 

**Descripción:** El sistema debe mostrar en el historial de cada venta: número de venta, hora de confirmación, total, estado operacional, estado fiscal, cliente asociado si existe y número de ítems. 

## **RF-POS-86 - Acceso al detalle de ventas del turno** 

**Descripción:** El sistema debe permitir al cajero acceder al detalle completo de cualquier venta del turno activo, incluyendo ítems, medios de pago, descuentos 

81 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

aplicados y estado fiscal del documento. 

## **4.6.18 Comportamiento en modo offline** 

## **RF-POS-87 - Flujo completo de venta en modo offline** 

**Descripción:** El sistema debe permitir completar el flujo completo de una venta -búsqueda de producto, carrito, cobro, confirmación e impresión de comprobante- en modo de operación sin conectividad, usando el catálogo local, precios e impuestos almacenados según RF-CAT-54 y RF-SYNC-03. 

## **RF-POS-88 - Registro local de venta offline para sincronización** 

**Descripción:** El sistema debe registrar cada venta confirmada en modo offline con el estado de sincronización “pendiente de envío” y almacenarla en la cola local de sincronización según RF-SYNC-01 y RF-SYNC-02, para su posterior transmisión al servidor central al restablecer la conectividad. 

## **RF-POS-89 - Indicador permanente del estado de conectividad** 

**Descripción:** El sistema debe mostrar de forma permanente y visible en la pantalla del punto de venta un indicador del estado de conectividad actual, diferenciando claramente los modos: conectado y sincronizado, conectado con pendientes de sincronización, y sin conectividad operando localmente. 

## **4.7 Módulo 7: Clientes** 

## **4.7.1 Contexto del módulo** 

Este módulo regula el ciclo de vida de los clientes registrados en el sistema: su creación, modificación, clasificación, inactivación y consulta. El término cliente designa exclusivamente a la persona natural o jurídica que realiza una compra en la droguería, y se diferencia del término usuario, que designa al personal que opera el sistema. 

El módulo tiene dos contextos de uso diferenciados que imponen requisitos distintos. El primero es el contexto de caja, donde el cajero necesita crear o seleccionar un cliente con rapidez durante una venta activa sin interrumpir el flujo de atención. El segundo es el 

82 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

contexto administrativo, donde el administrador gestiona la base de clientes con mayor detalle, asigna clasificaciones y consulta historiales. 

El vínculo más crítico de este módulo es con el Módulo 9 (Facturación Electrónica DIAN): cuando una venta genera factura electrónica, los datos del cliente son campos obligatorios del documento fiscal y deben cumplir los requisitos del Anexo Técnico 1.9. Un cliente con datos incompletos o inválidos impide la generación del documento fiscal. 

## **4.7.2 Control de acceso al módulo de clientes** 

## **RF-CLI-01 - Creación de clientes desde el POS según rol** 

**Descripción:** El sistema debe permitir crear clientes desde el punto de venta a usuarios con rol de cajero o administrador. Si un usuario con rol diferente intenta crear un cliente desde el POS, el sistema debe bloquear la operación e informar que no está autorizada para su rol. 

## **RF-CLI-02 - Gestión administrativa de clientes restringida por rol** 

**Descripción:** El sistema debe permitir crear, modificar y consultar clientes desde el panel administrativo únicamente a usuarios con rol de administrador. Un cajero o auxiliar de inventario no debe tener acceso al panel administrativo de clientes fuera del flujo de venta. 

## **RF-CLI-03 - Consulta de historial de compras según rol** 

**Descripción:** El sistema debe permitir consultar el historial de compras de un cliente a usuarios con rol de administrador y contador. Un cajero puede ver si un cliente ya tiene compras previas como referencia durante la venta, pero no puede acceder al historial completo fuera del flujo de venta. 

## **RF-CLI-04 - Inactivación y reactivación de clientes restringida por rol** 

**Descripción:** El sistema debe permitir inactivar y reactivar clientes únicamente a usuarios con rol de administrador. 

83 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.7.3 Tipos de identificación admitidos** 

## **RF-CLI-05 - Tipos de identificación para personas naturales residentes** 

**Descripción:** El sistema debe admitir los siguientes tipos de identificación para clientes personas naturales residentes en Colombia: cédula de ciudadanía (CC), tarjeta de identidad (TI), registro civil (RC), cédula de extranjería (CE) y pasaporte. 

## **RF-CLI-06 - Tipo de identificación para personas jurídicas** 

**Descripción:** El sistema debe admitir los siguientes tipos de identificación para clientes personas jurídicas o establecimientos: NIT. 

## **RF-CLI-07 - Tipo de identificación consumidor final** 

**Descripción:** El sistema debe admitir el tipo de identificación “consumidor final” para ventas en las que el cliente no proporciona datos de identificación y el monto de la venta no supera el límite configurado para ventas sin identificar, según RF-POS42. Un cliente con tipo “consumidor final” no debe poder asociarse a una factura electrónica de venta. 

## **RF-CLI-08 - Validación de formato según tipo de identificación** 

**Descripción:** El sistema debe validar el formato del número de identificación según el tipo seleccionado: para cédula de ciudadanía debe aceptar entre 6 y 10 dígitos numéricos; para NIT debe aceptar entre 9 y 10 dígitos numéricos opcionalmente con dígito de verificación separado; para tarjeta de identidad debe aceptar entre 10 y 11 dígitos numéricos; para pasaporte debe aceptar entre 5 y 20 caracteres alfanuméricos; y para cédula de extranjería debe aceptar entre 6 y 15 caracteres alfanuméricos. Si el formato no cumple las reglas del tipo seleccionado, el sistema debe informar el criterio incumplido e impedir guardar el registro. 

## **4.7.4 Creación rápida de cliente desde el POS** 

## **RF-CLI-09 - Creación rápida de cliente durante venta activa** 

**Descripción:** El sistema debe permitir al cajero crear un cliente nuevo directamente desde la pantalla del punto de venta durante una venta activa, sin cerrar ni descartar el carrito en curso, mediante un flujo simplificado de captura de datos mínimos. 

84 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CLI-10 - Datos mínimos requeridos en creación rápida POS** 

**Descripción:** El sistema debe exigir en la creación rápida desde el POS únicamente los siguientes campos: tipo de identificación, número de identificación y nombre completo o razón social. Todos los demás campos del cliente deben ser opcionales en este contexto. 

## **RF-CLI-11 - Validación de identificación en creación rápida POS** 

**Descripción:** El sistema debe validar en la creación rápida desde el POS que el número de identificación cumpla el formato del tipo seleccionado, según RF-CLI-08, antes de guardar el registro. 

## **RF-CLI-12 - Prevención de duplicado en creación rápida POS** 

**Descripción:** El sistema debe verificar en la creación rápida desde el POS que no exista ya un cliente con el mismo tipo y número de identificación en el sistema, sin importar su estado activo o inactivo. Si ya existe un cliente con esa identificación, el sistema debe mostrar los datos del cliente existente y ofrecer la opción de asociarlo a la venta activa en lugar de crear un duplicado. 

## **RF-CLI-13 - Asociación automática de cliente recién creado a la venta** 

**Descripción:** El sistema debe asociar automáticamente el cliente recién creado desde el POS a la venta activa en el momento en que su registro sea confirmado, sin requerir un paso adicional de selección por parte del cajero. 

## **RF-CLI-14 - Clasificación inicial particular en creación rápida** 

**Descripción:** El sistema debe asignar automáticamente la clasificación “particular” a todo cliente creado desde el POS en la creación rápida. El administrador puede modificar esta clasificación posteriormente desde el panel administrativo. 

## **RF-CLI-15 - Límite de pasos en creación rápida desde POS** 

**Descripción:** El sistema debe completar la creación rápida y retornar al cajero a la pantalla de la venta activa en un máximo de dos pasos adicionales desde el momento en que el cajero inicia el flujo de creación rápida. 

85 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.7.5 Creación completa de cliente desde el panel administrativo** 

## **RF-CLI-16 - Formulario administrativo de creación de cliente** 

**Descripción:** El sistema debe presentar en el panel administrativo un formulario de creación de cliente con los siguientes campos obligatorios: tipo de identificación, número de identificación, nombre completo o razón social y clasificación de cliente. 

## **RF-CLI-17 - Campos opcionales en creación administrativa** 

**Descripción:** El sistema debe presentar en el panel administrativo los siguientes campos opcionales adicionales en el formulario de creación: nombre comercial o de fantasía, correo electrónico de contacto, teléfono principal, teléfono secundario, dirección completa, ciudad, departamento, régimen tributario (simplificado o común) y observaciones internas. 

## **RF-CLI-18 - Validación del correo electrónico** 

**Descripción:** El sistema debe validar el correo electrónico del cliente, cuando sea ingresado, bajo el formato estándar usuario@dominio.extensión. Si el formato es inválido, el sistema debe informar el error e impedir guardar el registro. 

## **RF-CLI-19 - Validación de teléfonos del cliente** 

**Descripción:** El sistema debe validar que el teléfono del cliente, cuando sea ingresado, contenga entre 7 y 15 dígitos numéricos. Si la validación falla, el sistema debe informar el error e impedir guardar el registro. 

## **RF-CLI-20 - Regla de unicidad por tipo y número de identificación** 

**Descripción:** El sistema debe verificar que no exista un cliente con el mismo tipo y número de identificación en el sistema, independientemente de su estado, antes de completar la creación. Si ya existe, el sistema debe informar el nombre del cliente encontrado e impedir crear el duplicado. 

## **RF-CLI-21 - Identificador interno único de cliente** 

**Descripción:** El sistema debe asignar automáticamente un identificador interno único al cliente en el momento de su creación, bajo el mismo esquema de generación definido en RF-CAT-13 para productos, adaptado al contexto de clientes. 

86 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CLI-22 - Auditoría de creación de cliente** 

**Descripción:** El sistema debe registrar en la auditoría la creación de cada cliente, incluyendo todos los campos capturados, el usuario responsable, la fecha y la hora. El registro debe ser inmutable. 

## **4.7.6 Búsqueda de cliente desde el POS** 

## **RF-CLI-23 - Búsqueda unificada de cliente en venta activa** 

**Descripción:** El sistema debe permitir al cajero buscar un cliente existente durante una venta activa mediante un único campo de búsqueda que acepte: número de identificación (búsqueda exacta) o nombre completo o razón social (búsqueda parcial desde el segundo carácter). 

## **RF-CLI-24 - Exclusión de clientes inactivos en búsqueda POS** 

**Descripción:** El sistema debe retornar únicamente clientes con estado “activo” en los resultados de búsqueda desde el punto de venta. Los clientes inactivos no deben aparecer en la búsqueda del cajero. 

## **RF-CLI-25 - Datos mostrados en búsqueda de cliente desde POS** 

**Descripción:** El sistema debe mostrar en cada resultado de la búsqueda desde el POS los siguientes datos del cliente: tipo y número de identificación, nombre completo o razón social, clasificación y régimen tributario si está disponible. 

## **RF-CLI-26 - Asociación automática de cliente seleccionado a la venta** 

**Descripción:** El sistema debe asociar automáticamente el cliente a la venta activa cuando el cajero lo seleccione de los resultados de búsqueda, sin requerir pasos adicionales de confirmación. 

## **RF-CLI-27 - Disponibilidad local de clientes frecuentes e institucionales** 

**Descripción:** El sistema debe conservar en el almacenamiento local de la estación de trabajo el listado de clientes frecuentes e institucionales activos para permitir la búsqueda y asociación de clientes en modo de operación sin conectividad, según lo definido en el Módulo 8. 

87 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.7.7 Modificación de clientes** 

## **RF-CLI-28 - Restricciones de modificación según historial de ventas** 

**Descripción:** El sistema debe permitir al administrador modificar desde el panel administrativo cualquier campo del cliente, excepto el tipo y número de identificación una vez que el cliente tenga al menos una venta confirmada asociada. Si el cliente no tiene ventas asociadas, el tipo y número de identificación también pueden modificarse. 

## **RF-CLI-29 - Validaciones aplicables en modificación de cliente** 

**Descripción:** El sistema debe aplicar las mismas reglas de validación definidas en las secciones 7.2 y 7.4 al modificar los datos de un cliente. Si alguna validación falla, el sistema debe informar el error específico e impedir guardar los cambios. 

## **RF-CLI-30 - Verificación de unicidad al modificar identificación** 

**Descripción:** El sistema debe verificar la regla de unicidad de identificación definida en RF-CLI-20 al modificar el número de identificación de un cliente que no tenga ventas asociadas. Si la nueva identificación genera un duplicado, el sistema debe informar el conflicto e impedir guardar el cambio. 

## **RF-CLI-31 - Auditoría detallada de modificación de cliente** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de cliente, incluyendo por cada campo modificado: nombre del campo, valor anterior, valor nuevo, usuario administrador responsable, fecha y hora. Si se modifican múltiples campos en una misma operación, cada campo debe quedar registrado individualmente. 

## **4.7.8 Estado del cliente** 

## **RF-CLI-32 - Inactivación de cliente** 

**Descripción:** El sistema debe permitir al administrador cambiar el estado de un cliente de “activo” a “inactivo”. Un cliente inactivo no debe aparecer en los resultados de búsqueda del POS ni estar disponible para ser asociado a nuevas ventas. 

## **RF-CLI-33 - Conservación del historial de cliente inactivado** 

**Descripción:** El sistema debe conservar íntegro el historial de compras y todos los documentos fiscales asociados a un cliente inactivado. La inactivación no debe 

88 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

eliminar, ocultar ni alterar ningún dato histórico vinculado al cliente. 

## **RF-CLI-34 - Restricción de inactivación por documentos fiscales pendientes** 

**Descripción:** El sistema debe impedir inactivar un cliente que tenga ventas con documentos fiscales en estado “pendiente de envío” o “rechazado”, dado que esos documentos requieren los datos del cliente para completar la transmisión al proveedor tecnológico DIAN. El sistema debe informar la cantidad de documentos pendientes e impedir la inactivación hasta que sean resueltos. 

## **RF-CLI-35 - Reactivación de cliente sin datos adicionales** 

**Descripción:** El sistema debe permitir al administrador reactivar un cliente con estado “inactivo” sin requerir ningún dato adicional ni modificar los datos existentes del cliente. 

## **RF-CLI-36 - Auditoría de cambios de estado del cliente** 

**Descripción:** El sistema debe registrar en la auditoría cada cambio de estado de cliente (inactivación o reactivación), incluyendo: identificador del cliente, estado anterior, estado nuevo, usuario administrador responsable, fecha y hora. 

## **4.7.9 Clasificación de clientes** 

## **RF-CLI-37 - Clasificaciones soportadas de cliente** 

**Descripción:** El sistema debe manejar las siguientes clasificaciones de cliente: particular, frecuente e institucional. Todo cliente debe tener exactamente una clasificación asignada en todo momento. 

## **RF-CLI-38 - Modificación de clasificación de cliente** 

**Descripción:** El sistema debe permitir al administrador cambiar la clasificación de un cliente entre las opciones definidas en RF-CLI-37 en cualquier momento, sin restricción por el estado activo o inactivo del cliente ni por el historial de compras. 

## **RF-CLI-39 - Visualización de clasificación en POS** 

**Descripción:** El sistema debe mostrar la clasificación del cliente de forma visible en la pantalla del punto de venta cuando el cajero lo asocie a una venta activa, para que el cajero pueda identificar si aplican condiciones diferenciadas. 

89 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CLI-40 - Auditoría de cambios de clasificación** 

**Descripción:** El sistema debe registrar en la auditoría cada cambio de clasificación de cliente, incluyendo: identificador del cliente, clasificación anterior, clasificación nueva, usuario responsable, fecha y hora. 

## **4.7.10 Condiciones diferenciadas por clasificación** 

## **RF-CLI-41 - Configuración de descuentos automáticos por clasificación** 

**Descripción:** El sistema debe permitir al administrador configurar un porcentaje de descuento automático asociado a la clasificación “frecuente” y a la clasificación “institucional”, de forma independiente para cada una. Si el porcentaje está configurado en cero, no debe aplicarse ningún descuento automático para esa clasificación. 

## **RF-CLI-42 - Aplicación automática de descuento por clasificación** 

**Descripción:** El sistema debe aplicar automáticamente el descuento configurado para la clasificación del cliente al momento en que el cajero asocia el cliente a la venta activa, sin requerir ninguna acción adicional del cajero. El descuento debe reflejarse en el total de la venta y respetando los mismos límites de descuento definidos en RF-POS-31 y RF-POS-32. 

## **RF-CLI-43 - Eliminación de descuento automático por clasificación** 

**Descripción:** El sistema debe permitir al cajero eliminar el descuento automático aplicado por clasificación de cliente antes de confirmar la venta, siempre que tenga permiso para modificar descuentos según su configuración de rol. 

## **RF-CLI-44 - Visualización explícita del origen del descuento** 

**Descripción:** El sistema debe mostrar al cajero de forma explícita cuando un descuento sea aplicado por la clasificación del cliente, indicando el origen del descuento, el porcentaje y el valor en moneda, para diferenciarlo de los descuentos manuales. 

90 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.7.11 Datos fiscales del cliente para facturación DIAN** 

## **RF-CLI-45 - Verificación de datos mínimos para factura electrónica** 

**Descripción:** El sistema debe verificar que un cliente tenga los datos mínimos requeridos por el Anexo Técnico 1.9 de la DIAN antes de permitir emitir una factura electrónica de venta asociada a ese cliente. Los datos mínimos son: tipo de identificación, número de identificación y nombre completo o razón social. 

## **RF-CLI-46 - Compatibilidad del tipo de identificación con facturación electrónica** 

**Descripción:** El sistema debe verificar adicionalmente que el tipo de identificación del cliente sea compatible con los tipos admitidos por la DIAN para el adquirente de una factura electrónica. Si el tipo no es admitido para facturación electrónica, el sistema debe informar al cajero que no es posible emitir factura electrónica para ese cliente e impedir la selección del tipo de documento fiscal “factura electrónica de venta” para esa venta. 

## **RF-CLI-47 - Uso de datos del cliente registrados para el adquirente fiscal** 

**Descripción:** El sistema debe usar el nombre completo o razón social, tipo de identificación y número de identificación del cliente registrados en el sistema como los datos del adquirente en el documento fiscal, sin permitir que el cajero los sobrescriba manualmente durante la venta. 

## **RF-CLI-48 - Inclusión del régimen tributario en el documento fiscal** 

**Descripción:** El sistema debe incluir el régimen tributario del cliente en el documento fiscal cuando este dato esté registrado en el perfil del cliente y sea requerido por la estructura del documento según el Anexo Técnico 1.9. 

## **4.7.12 Historial de compras del cliente** 

## **RF-CLI-49 - Consulta del historial completo de compras** 

**Descripción:** El sistema debe permitir al administrador consultar el historial completo de compras de un cliente desde el panel administrativo, mostrando todas las ventas confirmadas asociadas a ese cliente ordenadas de la más reciente a la más antigua. 

91 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CLI-50 - Datos mostrados en historial de compras del cliente** 

**Descripción:** El sistema debe mostrar en el listado del historial de compras de un cliente los siguientes datos por cada venta: número de venta, fecha y hora, total de la venta, estado operacional, tipo de documento fiscal emitido y estado fiscal del documento. 

## **RF-CLI-51 - Acceso al detalle de ventas desde historial del cliente** 

**Descripción:** El sistema debe permitir al administrador acceder al detalle completo de cualquier venta del historial de un cliente, mostrando ítems, medios de pago, descuentos, impuestos y datos del documento fiscal asociado. 

## **RF-CLI-52 - Filtros del historial de compras del cliente** 

**Descripción:** El sistema debe permitir al administrador filtrar el historial de compras de un cliente por rango de fechas, estado operacional de la venta y tipo de documento fiscal emitido. 

## **RF-CLI-53 - Indicadores acumulados en perfil de cliente** 

**Descripción:** El sistema debe calcular y mostrar en el perfil del cliente los siguientes indicadores acumulados: número total de ventas confirmadas, valor total acumulado de compras, fecha de la primera compra registrada y fecha de la compra más reciente. 

## **RF-CLI-54 - Exportación del historial de compras del cliente** 

**Descripción:** El sistema debe permitir al administrador exportar el historial de compras de un cliente en al menos un formato estructurado legible por herramientas externas, como CSV. 

## **4.7.13 Consulta y gestión administrativa de clientes** 

## **RF-CLI-55 - Consulta administrativa completa de clientes** 

**Descripción:** El sistema debe permitir al administrador consultar el listado completo de clientes con la opción de aplicar filtros combinables por: estado (activo, inactivo o ambos), clasificación (particular, frecuente, institucional) y texto de búsqueda por nombre o número de identificación. 

92 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CLI-56 - Datos mostrados en consulta administrativa de clientes** 

**Descripción:** El sistema debe mostrar en el listado de resultados de la consulta administrativa los siguientes datos de cada cliente: identificador interno, tipo y número de identificación, nombre completo o razón social, clasificación, régimen tributario, estado y fecha del último registro de compra. 

## **RF-CLI-57 - Exportación de consultas administrativas de clientes** 

**Descripción:** El sistema debe permitir al administrador exportar el resultado de una consulta de clientes en al menos un formato estructurado legible por herramientas externas, como CSV. 

## **4.7.14 Comportamiento en modo offline** 

## **RF-CLI-58 - Sincronización idempotente de clientes offline** 

**Descripción:** El sistema debe sincronizar los clientes creados o modificados en modo de operación sin conectividad con el servidor central al restablecer la conectividad, aplicando el principio de idempotencia definido en RF-SYNC-05 para evitar duplicados. Si al sincronizar se detecta que la identificación del nuevo cliente ya existe en el servidor central, el sistema debe marcar el conflicto en la bandeja de sincronización para resolución manual por parte del administrador, sin fusionar automáticamente los registros. 

## **4.8 Módulo 8: Sincronización y Operación Offline** 

## **4.8.1 Contexto del módulo** 

Este módulo regula el comportamiento del sistema cuando la conectividad con el servidor central es parcial, intermitente o inexistente, y define los mecanismos por los cuales las operaciones registradas localmente se transfieren al servidor central de forma segura, íntegra y sin duplicados cuando la conectividad se restablece. 

La arquitectura del sistema es _local-first_ : la estación de trabajo debe ser capaz de operar de forma autónoma para los flujos operativos críticos, venta, cobro, apertura y cierre de turno, y búsqueda de productos, sin depender de una conexión activa al servidor central. 

93 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

El servidor central es la fuente de verdad para el estado global del sistema, pero no debe ser un requisito de disponibilidad para la operación de caja en tiempo real. 

Este módulo interactúa directamente con todos los demás módulos del sistema. Cada módulo que genera datos persistentes debe respetar los estados de sincronización definidos aquí. Los módulos de mayor criticidad para la operación offline son: Módulo 2 (Caja), Módulo 6 (Ventas POS), Módulo 4 (Inventario) y Módulo 9 (Facturación DIAN). 

Distinción fundamental: la sincronización con el servidor central y la transmisión fiscal al proveedor tecnológico DIAN son dos procesos completamente independientes. Una operación puede estar sincronizada con el servidor central y aún tener su documento fiscal pendiente de validación, o viceversa. Ambos estados deben gestionarse por separado. 

## **4.8.2 Almacenamiento local de la estación de trabajo** 

## **RF-SYNC-01 - Réplica funcional de datos en almacenamiento local** 

**Descripción:** El sistema debe mantener en el almacenamiento local de cada estación de trabajo una réplica funcional de los siguientes datos, actualizados con la última sincronización exitosa: catálogo de productos activos con precios e impuestos vigentes, listado de clientes frecuentes e institucionales activos, configuración de medios de pago habilitados, configuración de impuestos, rangos de numeración fiscal activos, umbrales y reglas de descuento por rol, configuración de alertas de vencimiento y parámetros generales del sistema necesarios para la operación de caja. 

## **RF-SYNC-02 - Actualización incremental de la réplica local** 

**Descripción:** El sistema debe actualizar la réplica local de cada dato inmediatamente después de cada sincronización exitosa con el servidor central, reemplazando únicamente los registros que hayan cambiado desde la última actualización y no la totalidad del conjunto de datos. 

## **RF-SYNC-03 - Conservación local del inventario disponible por producto** 

**Descripción:** El sistema debe conservar en el almacenamiento local el estado del inventario disponible por producto, actualizado con cada movimiento de salida o entrada registrado localmente, para permitir la validación de disponibilidad durante ventas en modo offline. 

94 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-04 - Cifrado de datos sensibles en almacenamiento local** 

**Descripción:** El sistema debe cifrar los datos almacenados localmente que contengan información sensible, incluyendo datos de clientes, valores de ventas y credenciales de sesión en caché, usando un mecanismo de cifrado que impida su lectura directa desde el sistema de archivos del dispositivo. 

## **RF-SYNC-05 - Prohibición de acceso externo directo a datos locales** 

**Descripción:** El sistema debe impedir que los datos del almacenamiento local sean accedidos o modificados directamente por el usuario a través de cualquier mecanismo externo a la aplicación. Cualquier modificación de datos locales debe realizarse únicamente a través de operaciones validadas del sistema. 

## **4.8.3 Detección y clasificación del estado de conectividad** 

## **RF-SYNC-06 - Verificación periódica de conectividad** 

**Descripción:** El sistema debe evaluar continuamente el estado de conectividad con el servidor central mediante verificaciones periódicas con un intervalo configurable por el administrador, con un valor mínimo de 10 segundos y un máximo de 120 segundos. 

## **RF-SYNC-07 - Clasificación del estado de conectividad** 

**Descripción:** El sistema debe clasificar el estado de conectividad en exactamente uno de los siguientes tres estados en todo momento: conectado y sincronizado (conexión activa con el servidor central y sin operaciones pendientes en la cola local), conectado con pendientes (conexión activa pero existen operaciones locales aún no sincronizadas) y sin conectividad (no hay conexión activa con el servidor central). 

## **RF-SYNC-08 - Indicador visible del estado de conectividad** 

**Descripción:** El sistema debe mostrar de forma permanente y visible en la pantalla del punto de venta un indicador del estado de conectividad actual, diferenciando visualmente los tres estados definidos en RF-SYNC-07 mediante colores, iconos o texto inequívoco. 

95 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-09 - Distinción entre conectividad con servidor central y DIAN** 

**Descripción:** El sistema debe distinguir entre una pérdida de conectividad con el servidor central propio y una pérdida de conectividad con el proveedor tecnológico DIAN, dado que ambas tienen implicaciones operativas y normativas diferentes, según lo definido en RF-CONT-01. 

## **RF-SYNC-10 - Log de transiciones de conectividad** 

**Descripción:** El sistema debe registrar en el log de conectividad cada transición de estado de conectividad, incluyendo: estado anterior, estado nuevo, fecha y hora de la transición y duración del estado anterior. 

## **4.8.4 Cola de operaciones pendientes** 

## **RF-SYNC-11 - Persistencia de la cola local de sincronización** 

**Descripción:** El sistema debe mantener en el almacenamiento local una cola de operaciones pendientes de sincronización persistente, que sobreviva al cierre de la aplicación, reinicios del dispositivo y pérdidas de energía sin pérdida de datos. 

## **RF-SYNC-12 - Encolado de operaciones no transmitidas** 

**Descripción:** El sistema debe agregar a la cola local toda operación que no pueda ser transmitida al servidor central en el momento de su registro, independientemente de si la causa es falta de conectividad, error de red o fallo temporal del servidor. 

## **RF-SYNC-13 - Tipos de operaciones soportadas en la cola** 

**Descripción:** El sistema debe manejar los siguientes tipos de operaciones en la cola de sincronización: apertura de turno, cierre de turno, venta confirmada, anulación de venta, devolución de cliente, entrada de inventario, ajuste de inventario, devolución a proveedor, creación de cliente, modificación de cliente y orden de compra. 

## **RF-SYNC-14 - Metadatos obligatorios de cada operación en cola** 

**Descripción:** El sistema debe asignar a cada operación en la cola los siguientes atributos en el momento de su creación: identificador de operación único e irrepetible, tipo de operación, payload completo de la operación serializado, fecha y hora de creación local, estado de sincronización inicial (“pendiente”), número de intentos de sincronización (inicial: cero) y versión del esquema de datos de la operación. 

96 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-15 - Procesamiento cronológico de la cola** 

**Descripción:** El sistema debe respetar el orden cronológico de creación al procesar las operaciones de la cola durante la sincronización, transmitiendo primero las operaciones más antiguas para preservar la integridad causal de las secuencias de eventos. Una apertura de turno debe sincronizarse antes que las ventas de ese turno; las ventas deben sincronizarse antes que el cierre del turno correspondiente. 

## **RF-SYNC-16 - Restricción de eliminación manual de operaciones en cola** 

**Descripción:** El sistema debe impedir eliminar manualmente una operación de la cola local a menos que sea el administrador quien lo haga de forma explícita y documentada, dado que cada operación pendiente puede tener implicaciones en el inventario, la caja o el estado fiscal del sistema. 

## **4.8.5 Identificadores únicos e idempotencia** 

## **RF-SYNC-17 - Generación globalmente única de identificadores de operación** 

**Descripción:** El sistema debe generar el identificador único de cada operación usando un esquema que garantice unicidad global entre todas las estaciones de trabajo del sistema, sin requerir coordinación con el servidor central en el momento de la generación. 

## **RF-SYNC-18 - Inclusión del identificador único en cada transmisión** 

**Descripción:** El sistema debe incluir el identificador único de la operación en cada transmisión al servidor central, tanto en el primer intento como en todos los reintentos subsiguientes de la misma operación. 

## **RF-SYNC-19 - Procesamiento idempotente en servidor central** 

**Descripción:** El sistema debe garantizar que el servidor central rechace sin procesar y devuelva como exitosa toda operación recibida cuyo identificador único ya esté registrado como procesado anteriormente, sin generar ningún efecto secundario adicional como duplicados en inventario, caja o ventas. 

## **RF-SYNC-20 - Retención de identificadores procesados en servidor** 

**Descripción:** El sistema debe conservar en el servidor central el registro de identificadores de operaciones procesadas durante al menos 90 días para permitir la 

97 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

detección de reintentos tardíos dentro de ese período. 

## **4.8.6 Sincronización automática** 

## **RF-SYNC-21 - Inicio automático de sincronización al reconectar** 

**Descripción:** El sistema debe iniciar automáticamente la sincronización de las operaciones pendientes en la cola local en cuanto detecte que el estado de conectividad transiciona a “conectado”, sin requerir ninguna acción del cajero o del administrador. 

## **RF-SYNC-22 - Procesamiento por lotes configurables** 

**Descripción:** El sistema debe procesar la cola de sincronización en lotes de tamaño configurable por el administrador, con un valor predeterminado de 10 operaciones por lote, para evitar saturar la red o el servidor central en escenarios de reconexión con grandes cantidades de operaciones acumuladas. 

## **RF-SYNC-23 - Marcado individual de operación sincronizada** 

**Descripción:** El sistema debe marcar cada operación con estado “sincronizada” en la cola local inmediatamente después de recibir confirmación exitosa del servidor central para esa operación específica, sin esperar a que todo el lote sea procesado. 

## **RF-SYNC-24 - Marcado de error no recuperable en sincronización** 

**Descripción:** El sistema debe marcar cada operación con estado “error de sincronización” en la cola local cuando el servidor central devuelva un error no recuperable para esa operación, registrando el código de error y el mensaje de respuesta recibido. 

## **RF-SYNC-25 - Reintentos automáticos con espera exponencial** 

**Descripción:** El sistema debe reintentar automáticamente la sincronización de operaciones con estado de error recuperable usando un esquema de espera exponencial: el primer reintento ocurre 30 segundos después del error, el segundo después de 2 minutos, el tercero después de 5 minutos y los subsiguientes con un intervalo máximo de 30 minutos, todos configurables por el administrador. 

98 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-26 - Paso a error permanente por límite de intentos** 

**Descripción:** El sistema debe detener los reintentos automáticos de una operación cuando el número de intentos fallidos alcance el límite máximo configurable por el administrador, con un valor predeterminado de 10 intentos. La operación debe quedar en estado “error permanente” y generar una alerta en la bandeja de administración. 

## **RF-SYNC-27 - Clasificación entre errores recuperables y no recuperables** 

**Descripción:** El sistema debe diferenciar entre errores recuperables (falla temporal de red, timeout, servidor no disponible temporalmente) y errores no recuperables (datos inválidos, operación rechazada por regla de negocio, conflicto de datos) para decidir si corresponde reintento automático o intervención manual. 

## **4.8.7 Sincronización del catálogo y datos de referencia** 

## **RF-SYNC-28 - Sincronización previa de datos de referencia** 

**Descripción:** El sistema debe sincronizar los datos de referencia locales -catálogo de productos, precios, impuestos, clientes y configuraciones- al detectar que el estado de conectividad transiciona a “conectado”, antes de procesar la cola de operaciones pendientes. 

## **RF-SYNC-29 - Solicitud incremental de datos modificados** 

**Descripción:** El sistema debe solicitar al servidor central únicamente los registros de datos de referencia que hayan sido modificados desde la marca de tiempo de la última sincronización exitosa, usando un mecanismo de sincronización incremental basado en versiones o marcas de tiempo. 

## **RF-SYNC-30 - Aplicación transaccional de cambios de referencia** 

**Descripción:** El sistema debe aplicar los cambios de datos de referencia recibidos del servidor central al almacenamiento local de forma transaccional: todos los cambios del lote deben aplicarse completamente o ninguno debe aplicarse, para evitar estados inconsistentes en el almacenamiento local. 

## **RF-SYNC-31 - Actualización inmediata de precios e impuestos locales** 

**Descripción:** El sistema debe actualizar los precios e impuestos del catálogo local inmediatamente después de una sincronización de datos de referencia exitosa, de 

99 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

modo que las ventas posteriores usen los precios e impuestos más recientes disponibles en el servidor central. 

## **RF-SYNC-32 - Inmutabilidad de precio e impuesto en ventas ya registradas** 

**Descripción:** El sistema debe conservar el precio e impuesto vigente en el momento de registro de una venta en el payload de la operación de la cola, de modo que la sincronización posterior no altere retroactivamente los valores de ventas ya confirmadas localmente. 

## **4.8.8 Reconciliación de inventario tras sincronización** 

## **RF-SYNC-33 - Reconciliación del stock local con el servidor central** 

**Descripción:** El sistema debe reconciliar el stock local de cada producto con el stock calculado por el servidor central al completar la sincronización de todas las operaciones pendientes, para corregir posibles discrepancias acumuladas durante el período offline. 

## **RF-SYNC-34 - Sustitución del stock local por valor autoritativo del servidor** 

**Descripción:** El sistema debe actualizar el stock local del producto con el valor calculado por el servidor central tras la reconciliación, reemplazando el stock local previamente almacenado con el valor autoritativo del servidor. 

## **RF-SYNC-35 - Detección de incidentes de reconciliación con stock negativo** 

**Descripción:** El sistema debe detectar y registrar como incidente de reconciliación los casos en los que el stock resultante de la reconciliación sea negativo para algún lote, indicando el producto afectado, el lote, el stock local previo y el stock calculado por el servidor, según RF-INV-69. 

## **RF-SYNC-36 - Notificación administrativa de incidentes de reconciliación** 

**Descripción:** El sistema debe notificar al administrador sobre cada incidente de reconciliación de inventario detectado durante la sincronización, con el detalle del producto y lote afectados, para que el administrador decida la acción correctiva mediante un ajuste de inventario documentado. 

100 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.8.9 Resolución de conflictos** 

## **RF-SYNC-37 - Conflicto de creación de cliente duplicado offline** 

**Descripción:** El sistema debe manejar el siguiente tipo de conflicto de creación de cliente: cuando un cliente creado localmente en modo offline tenga la misma identificación que un cliente creado en el servidor central durante el mismo período offline. En ese caso, el sistema debe marcar el registro local como “conflicto de cliente” en la bandeja de administración y no fusionar los registros automáticamente. 

## **RF-SYNC-38 - Visualización comparativa de versiones en conflicto** 

**Descripción:** El sistema debe presentar al administrador, en la bandeja de conflictos, los datos de ambas versiones del registro en conflicto -la local y la del servidor- para que el administrador decida cuál versión conservar o si debe realizarse una fusión manual. 

## **RF-SYNC-39 - Marcado de ventas con cliente pendiente de resolución** 

**Descripción:** El sistema debe marcar las ventas asociadas a un cliente en conflicto como “cliente pendiente de resolución” hasta que el administrador resuelva el conflicto de cliente, sin impedir que esas ventas sean sincronizadas con el servidor central usando el identificador local provisional. 

## **RF-SYNC-40 - Resolución automática de conflicto por actualización concurrente de precio** 

**Descripción:** El sistema debe resolver automáticamente conflictos de tipo “actualización concurrente de precio” aplicando la regla “último escritor gana” basada en marca de tiempo, registrando en la auditoría cuál versión fue descartada y cuál fue conservada. 

## **4.8.10 Bandeja de administración de sincronización** 

## **RF-SYNC-41 - Bandeja de administración de sincronización por estados** 

**Descripción:** El sistema debe proporcionar al administrador una bandeja de administración de sincronización que muestre todas las operaciones en la cola local clasificadas por estado: pendiente, en proceso, sincronizada, error recuperable, error permanente y conflicto. 

101 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-42 - Datos visibles por operación en la bandeja** 

**Descripción:** El sistema debe mostrar en la bandeja para cada operación: tipo de operación, identificador de operación, fecha y hora de creación local, estado de sincronización, número de intentos realizados, fecha y hora del último intento y mensaje del último error si existe. 

## **RF-SYNC-43 - Reintento manual de operación con error permanente** 

**Descripción:** El sistema debe permitir al administrador reintentar manualmente una operación con estado “error permanente” después de revisar y documentar la causa del error. El reintento manual debe reiniciar el contador de intentos. 

## **RF-SYNC-44 - Descarte manual documentado de operación permanente** 

**Descripción:** El sistema debe permitir al administrador descartar manualmente una operación con estado “error permanente” ingresando un motivo documentado obligatorio. El descarte debe registrarse en la auditoría con todos los datos de la operación descartada, incluyendo su payload completo, para trazabilidad futura. 

## **RF-SYNC-45 - Resumen numérico por estado en bandeja** 

**Descripción:** El sistema debe mostrar en la bandeja un resumen numérico de operaciones por estado para que el administrador tenga una visión inmediata de la situación de sincronización de la estación sin necesidad de revisar el detalle de cada operación. 

## **RF-SYNC-46 - Alerta prioritaria por errores permanentes o conflictos** 

**Descripción:** El sistema debe generar una alerta de alta prioridad en el panel del administrador cuando existan operaciones con estado “error permanente” o “conflicto” en la bandeja de sincronización, manteniendo la alerta activa hasta que todas las operaciones en esos estados sean resueltas. 

102 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.8.11 Sincronización manual** 

## **RF-SYNC-47 - Inicio manual de sincronización completa** 

**Descripción:** El sistema debe permitir al administrador iniciar manualmente una sincronización completa desde la bandeja de administración, incluyendo tanto la actualización de datos de referencia locales como el procesamiento de la cola de operaciones pendientes, sin esperar al ciclo automático. 

## **RF-SYNC-48 - Progreso en tiempo real de sincronización manual** 

**Descripción:** El sistema debe mostrar el progreso de la sincronización manual en tiempo real, indicando: número total de operaciones a sincronizar, número de operaciones procesadas exitosamente, número de errores encontrados y estado actual del proceso. 

## **RF-SYNC-49 - Cancelación de sincronización manual en curso** 

**Descripción:** El sistema debe permitir al administrador cancelar una sincronización manual en curso. Las operaciones ya sincronizadas exitosamente antes de la cancelación deben conservar su estado “sincronizada” y no deben ser reprocesadas en la siguiente sincronización. 

## **4.8.12 Seguridad e integridad de la cola** 

## **RF-SYNC-50 - Verificación de integridad de operaciones en cola** 

**Descripción:** El sistema debe verificar la integridad de cada operación almacenada en la cola local usando un mecanismo de verificación de integridad de datos que detecte modificaciones no autorizadas o corrupción del payload desde el momento de su registro. 

## **RF-SYNC-51 - Manejo de error de integridad en cola** 

**Descripción:** El sistema debe rechazar la sincronización de cualquier operación cuya verificación de integridad falle, marcarla como “error de integridad” en la cola y generar una alerta al administrador con los datos de la operación afectada. 

103 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-52 - Transmisión cifrada al servidor central** 

**Descripción:** El sistema debe transmitir las operaciones al servidor central usando un canal de comunicación cifrado. Si el cifrado del canal no puede establecerse, el sistema debe suspender la transmisión y registrar el intento fallido sin enviar datos en texto plano. 

## **RF-SYNC-53 - Autenticación de transmisiones con credenciales activas** 

**Descripción:** El sistema debe autenticar cada transmisión de operaciones al servidor central usando las credenciales de la sesión activa de la estación de trabajo, de modo que el servidor central pueda validar el origen de cada lote de sincronización. 

## **4.8.13 Sincronización entre múltiples estaciones** 

## **RF-SYNC-54 - Reconciliación concurrente entre estaciones offline** 

**Descripción:** El sistema debe garantizar que las ventas registradas en diferentes estaciones de trabajo durante un período de operación offline sean reconciliadas correctamente en el servidor central sin generar conflictos de inventario no detectados al sincronizar concurrentemente. 

## **RF-SYNC-55 - Aplicación cronológica de movimientos entre estaciones** 

**Descripción:** El sistema debe aplicar en el servidor central los movimientos de inventario de múltiples estaciones en el orden cronológico de sus marcas de tiempo locales cuando se reciban en la misma sincronización, para preservar la secuencia temporal de los eventos de inventario. 

## **RF-SYNC-56 - Alerta por stock negativo en sincronización concurrente** 

**Descripción:** El sistema debe notificar al administrador cuando la sincronización concurrente de múltiples estaciones genere un stock resultante negativo en algún lote, según RF-SYNC-35, para que el administrador aplique el ajuste correctivo correspondiente. 

104 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.8.14 Limpieza de datos locales** 

## **RF-SYNC-57 - Limpieza automática de operaciones sincronizadas antiguas** 

**Descripción:** El sistema debe limpiar automáticamente del almacenamiento local las operaciones con estado “sincronizada” que tengan más de 30 días desde su sincronización exitosa, conservando únicamente el identificador de la operación y su estado para referencia futura. 

## **RF-SYNC-58 - Protección de operaciones no sincronizadas en limpieza automática** 

**Descripción:** El sistema debe impedir que la limpieza automática definida en RFSYNC-57 afecte operaciones con estados diferentes a “sincronizada”, garantizando que operaciones pendientes, en error o en conflicto nunca sean eliminadas por el proceso automático de limpieza. 

## **RF-SYNC-59 - Limpieza manual de datos sincronizados** 

**Descripción:** El sistema debe permitir al administrador ejecutar manualmente la limpieza de datos sincronizados, con la opción de seleccionar el rango de antigüedad de los registros a eliminar. 

## **4.8.15 Monitoreo y reportes de sincronización** 

## **RF-SYNC-60 - Reporte de actividad de sincronización por período** 

**Descripción:** El sistema debe generar un reporte de actividad de sincronización por período, mostrando: número de operaciones sincronizadas exitosamente, número de errores recuperables, número de errores permanentes, número de conflictos detectados, duración promedio de sincronización y períodos de mayor duración offline. 

## **RF-SYNC-61 - Log detallado de eventos de sincronización** 

**Descripción:** El sistema debe registrar en el log de sincronización cada evento de sincronización con los siguientes datos: fecha y hora de inicio, fecha y hora de fin, número de operaciones procesadas por tipo, número de errores, resultado general y duración total. 

105 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-62 - Consulta filtrable del log de sincronización** 

**Descripción:** El sistema debe permitir al administrador consultar el log de sincronización filtrando por rango de fechas, estación de trabajo y resultado general (exitoso, con errores o con conflictos). 

## **RF-SYNC-63 - Indicador de salud de sincronización por estación** 

**Descripción:** El sistema debe mostrar en el panel del administrador un indicador de salud de sincronización para cada estación de trabajo registrada, indicando: última sincronización exitosa, operaciones pendientes actuales y si existe algún error o conflicto activo en esa estación. 

## **4.8.16 Comportamiento ante fallas del almacenamiento local** 

## **RF-SYNC-64 - Bloqueo operativo ante falla de lectura o escritura local** 

**Descripción:** El sistema debe detectar y notificar al cajero cuando el almacenamiento local de la estación presente errores de escritura o lectura que impidan el registro seguro de nuevas operaciones. En ese caso, el sistema debe bloquear el inicio de nuevas ventas e informar que la operación no puede continuar hasta que el problema sea resuelto. 

## **RF-SYNC-65 - Recuperación desde copia de seguridad de cola local** 

**Descripción:** El sistema debe intentar recuperar la cola de operaciones pendientes desde una copia de seguridad local cuando detecte corrupción en el archivo principal de la cola, antes de reportar pérdida de datos al administrador. 

## **RF-SYNC-66 - Generación de copia de seguridad local de la cola** 

**Descripción:** El sistema debe generar una copia de seguridad local de la cola de operaciones pendientes cada vez que se agregue una nueva operación a la cola, para minimizar la pérdida de datos ante fallos de almacenamiento. 

106 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.8.17 Configuración del módulo de sincronización** 

## **RF-SYNC-67 - Parámetros configurables del módulo de sincronización** 

**Descripción:** El sistema debe permitir al administrador configurar los siguientes parámetros del módulo de sincronización desde el panel de administración: intervalo de verificación de conectividad, tamaño del lote de sincronización, número máximo de reintentos por operación, intervalos del esquema de espera exponencial, período de retención de operaciones sincronizadas y umbral de alerta por cantidad de pendientes. 

## **RF-SYNC-68 - Aplicación diferida de cambios de configuración** 

**Descripción:** El sistema debe aplicar los cambios de configuración del módulo de sincronización en la siguiente ejecución del ciclo de sincronización, sin requerir reinicio de la aplicación para que los nuevos valores sean efectivos. 

## **RF-SYNC-69 - Validación de coherencia entre parámetros configurados** 

**Descripción:** El sistema debe validar que los valores ingresados en la configuración del módulo de sincronización sean coherentes entre sí: el intervalo mínimo de reintento no debe ser mayor que el intervalo máximo, el tamaño del lote no debe ser menor que uno, y el período de retención no debe ser menor que siete días. 

## **4.8.18 Auditoría del módulo de sincronización** 

## **RF-SYNC-70 - Auditoría de descarte manual de operaciones de cola** 

**Descripción:** El sistema debe registrar en la auditoría general del sistema cada operación de descarte manual de operaciones de la cola, incluyendo: identificador de la operación descartada, tipo de operación, payload completo, motivo documentado por el administrador, usuario responsable, fecha y hora. 

## **RF-SYNC-71 - Auditoría de resolución manual de conflictos** 

**Descripción:** El sistema debe registrar en la auditoría cada resolución manual de conflicto de sincronización, incluyendo: tipo de conflicto, versión local descartada, versión conservada, usuario administrador responsable y fecha y hora de la resolución. 

107 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-SYNC-72 - Auditoría de cambios de configuración de sincronización** 

**Descripción:** El sistema debe registrar en la auditoría cada cambio de configuración del módulo de sincronización, incluyendo: parámetro modificado, valor anterior, valor nuevo, usuario administrador responsable, fecha y hora. 

## **RF-SYNC-73 - Auditoría de incidentes de integridad de datos en cola** 

**Descripción:** El sistema debe registrar en la auditoría cada incidente de integridad de datos detectado en la cola local, incluyendo: identificador de la operación afectada, tipo de operación, resultado de la verificación de integridad y fecha y hora de la detección. 

## **RF-SYNC-74 - Auditoría de períodos prolongados de operación offline** 

**Descripción:** El sistema debe registrar en la auditoría cada período de operación offline que supere el umbral de duración configurable por el administrador, incluyendo: estación de trabajo, fecha y hora de inicio del período offline, duración total, número de operaciones generadas durante el período y fecha y hora de reconexión. 

## **4.9 Módulo 9: Facturación Electrónica DIAN** 

## **4.9.1 Contexto del módulo** 

Este módulo regula la generación, firma, transmisión y gestión de los documentos electrónicos exigidos por la DIAN para el establecimiento: la factura electrónica de venta, el tiquete de caja electrónico (documento equivalente POS), la nota crédito electrónica y la nota débito electrónica. Todos estos documentos deben cumplir los requisitos del Anexo Técnico 1.9 de Factura Electrónica de Venta vigente en Colombia, en formato UBL 2.1. 

La relación entre este módulo y el módulo de ventas es de dependencia unidireccional: una venta confirmada en el Módulo 6 genera siempre un documento fiscal, pero el estado del documento fiscal no determina el estado operacional de la venta. Una venta puede estar confirmada operacionalmente aunque su documento fiscal esté pendiente de validación, en contingencia o rechazado. Ambos estados son independientes y deben gestionarse por separado, tal como se establece en RF-POS-59. 

El proveedor tecnológico (PT) es el intermediario habilitado por la DIAN a través del cual el sistema transmite los documentos electrónicos para su validación previa. El sistema no transmite directamente a la DIAN sino a través del PT, y es el PT quien devuelve la 

108 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

respuesta de validación. La configuración del PT es un parámetro del sistema y no un dato de cada documento. 

## **4.9.2 Control de acceso al módulo fiscal** 

## **RF-DIAN-01 - Configuración fiscal restringida al administrador** 

**Descripción:** El sistema debe permitir configurar los datos del emisor, las resoluciones de numeración y los parámetros del proveedor tecnológico únicamente a usuarios con rol de administrador. Ningún otro rol debe tener acceso a la configuración fiscal del sistema. 

## **RF-DIAN-02 - Consulta restringida del repositorio y reportes fiscales** 

**Descripción:** El sistema debe permitir consultar el repositorio de documentos electrónicos y los reportes fiscales a usuarios con rol de administrador y contador. Un cajero o auxiliar de inventario no debe tener acceso al repositorio fiscal fuera del flujo de venta. 

## **RF-DIAN-03 - Emisión de notas crédito y débito solo por administrador** 

**Descripción:** El sistema debe permitir emitir notas crédito y notas débito únicamente a usuarios con rol de administrador. Un cajero no debe poder iniciar la emisión de estos documentos de forma directa. 

## **4.9.3 Configuración del emisor** 

## **RF-DIAN-04 - Registro global de datos del emisor** 

**Descripción:** El sistema debe permitir al administrador registrar los datos del emisor como configuración global del sistema, con los siguientes campos obligatorios: NIT del establecimiento sin dígito de verificación, dígito de verificación, razón social, nombre comercial, tipo de organización jurídica, régimen tributario, responsabilidades fiscales ante la DIAN, dirección del establecimiento, municipio, departamento y código postal. 

109 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-05 - Validación del dígito de verificación del NIT** 

**Descripción:** El sistema debe validar el dígito de verificación del NIT usando el algoritmo oficial de la DIAN para su cálculo. Si el dígito ingresado no corresponde al calculado para el NIT registrado, el sistema debe informar el valor correcto e impedir guardar la configuración. 

## **RF-DIAN-06 - Validación de responsabilidades fiscales DIAN** 

**Descripción:** El sistema debe validar que los campos de responsabilidades fiscales correspondan a una combinación válida según los tipos definidos por la DIAN. Si se ingresa una combinación inválida, el sistema debe informar el error e impedir guardar la configuración. 

## **RF-DIAN-07 - Auditoría de modificaciones de datos del emisor** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de los datos del emisor, incluyendo campo modificado, valor anterior, valor nuevo, usuario administrador responsable, fecha y hora. 

## **4.9.4 Configuración del proveedor tecnológico** 

## **RF-DIAN-08 - Configuración de conexión con el proveedor tecnológico** 

**Descripción:** El sistema debe permitir al administrador configurar la conexión con el proveedor tecnológico (PT) habilitado por la DIAN, registrando al menos: URL del endpoint de transmisión, credenciales de autenticación del PT, tiempo máximo de espera de respuesta (timeout) configurable, y ambiente de operación (habilitación o producción). 

## **RF-DIAN-09 - Confirmación explícita para pasar a producción** 

**Descripción:** El sistema debe impedir que el ambiente de operación sea cambiado de “habilitación” a “producción” sin que el administrador confirme explícitamente la transición, dado que este cambio implica que todos los documentos subsiguientes tendrán validez fiscal real ante la DIAN. 

## **RF-DIAN-10 - Prueba de conexión con el proveedor tecnológico** 

**Descripción:** El sistema debe permitir al administrador probar la conexión con el PT desde el panel de configuración antes de guardar o después de modificar cualquier 

110 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

parámetro de conexión. El resultado de la prueba debe mostrar si la conexión fue exitosa o el tipo de error encontrado. 

## **RF-DIAN-11 - Auditoría de cambios en configuración del PT** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de la configuración del PT, incluyendo: parámetro modificado, valor anterior enmascarado para credenciales, valor nuevo enmascarado para credenciales, usuario responsable, fecha y hora. 

## **4.9.5 Gestión de resoluciones de numeración** 

## **RF-DIAN-12 - Registro de resoluciones de numeración** 

**Descripción:** El sistema debe permitir al administrador registrar las resoluciones de numeración otorgadas por la DIAN, con los siguientes campos obligatorios: número de resolución, fecha de expedición, prefijo si aplica, rango desde, rango hasta, fecha de vigencia desde y fecha de vigencia hasta, y tipo de documento al que aplica (factura electrónica de venta o tiquete de caja electrónico). 

## **RF-DIAN-13 - Validación del rango numérico de resolución** 

**Descripción:** El sistema debe validar que el rango “desde” sea menor que el rango “hasta” al registrar una resolución. Si la condición no se cumple, el sistema debe informar el error e impedir guardar la resolución. 

## **RF-DIAN-14 - Validación de fechas de vigencia de resolución** 

**Descripción:** El sistema debe validar que la fecha de vigencia “desde” sea anterior a la fecha de vigencia “hasta”. Si no se cumple, el sistema debe informar el error e impedir guardar la resolución. 

## **RF-DIAN-15 - Estados automáticos de resolución** 

**Descripción:** El sistema debe manejar los siguientes estados para cada resolución: activa, próxima a vencer, agotada y vencida. El sistema debe actualizar automáticamente el estado de una resolución cuando su fecha de vigencia expire o cuando su rango de numeración sea completamente consumido. 

111 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-16 - Alerta por baja disponibilidad de consecutivos** 

**Descripción:** El sistema debe emitir una alerta al administrador cuando el número de documentos restantes en una resolución activa sea igual o inferior al umbral de alerta configurable, con un valor predeterminado de 100 documentos. La alerta debe mantenerse activa hasta que se registre una nueva resolución vigente. 

## **RF-DIAN-17 - Alerta por vencimiento próximo de resolución** 

**Descripción:** El sistema debe emitir una alerta al administrador cuando queden 30 días o menos para la fecha de vencimiento de una resolución activa. La alerta debe indicar la fecha exacta de vencimiento y el número de documentos restantes en el rango. 

## **RF-DIAN-18 - Prohibición de uso de resolución vencida o agotada** 

**Descripción:** El sistema debe impedir asignar a una venta un número de resolución vencida o agotada. Si al momento de generar un documento no existe resolución activa del tipo correspondiente, el sistema debe informar al cajero que no es posible emitir el documento y registrar la venta en modo de contingencia según RF-DIAN-49. 

## **RF-DIAN-19 - Auditoría de resoluciones de numeración** 

**Descripción:** El sistema debe registrar en la auditoría el registro y cualquier modificación de resoluciones de numeración, incluyendo todos los datos de la resolución, usuario administrador responsable, fecha y hora. 

## **4.9.6 Numeración de documentos** 

## **RF-DIAN-20 - Asignación secuencial estricta de consecutivos** 

**Descripción:** El sistema debe asignar el número consecutivo de cada documento electrónico de forma estrictamente secuencial dentro del rango de la resolución activa, sin saltos, sin repeticiones y sin que el cajero pueda influir en la asignación. 

## **RF-DIAN-21 - Asignación del número al confirmar la venta** 

**Descripción:** El sistema debe asignar el número de documento en el momento exacto de la confirmación de la venta, según RF-POS-55, garantizando que dos ventas confirmadas simultáneamente en diferentes estaciones no reciban el mismo número. 

112 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-22 - Inmutabilidad del número de documento asignado** 

**Descripción:** El sistema debe conservar el número de documento asignado a una venta de forma inmutable, incluso si el documento fiscal es posteriormente rechazado, dado que el número ya fue comprometido fiscalmente y no debe reutilizarse. 

## **RF-DIAN-23 - Registro de números anulados en el consecutivo** 

**Descripción:** El sistema debe registrar cualquier número de documento que quede sin transmitir por una anulación de venta ocurrida antes de la transmisión pero después de la asignación del número, marcándolo como “número anulado” en el consecutivo de la resolución y reportándolo en la auditoría. 

## **4.9.7 Tipos de documentos electrónicos** 

## **RF-DIAN-24 - Tipos de documentos electrónicos soportados** 

**Descripción:** El sistema debe generar los siguientes tipos de documentos electrónicos: factura electrónica de venta (código DIAN 01), tiquete de caja electrónico (código DIAN 03), nota crédito (código DIAN 91) y nota débito (código DIAN 92). 

## **RF-DIAN-25 - Regla de generación de factura electrónica de venta** 

**Descripción:** El sistema debe generar una factura electrónica de venta cuando la venta tenga un cliente con datos de identificación completos y válidos para facturación, y el cajero haya seleccionado este tipo de documento o el sistema esté configurado para generarlo por defecto para montos superiores al umbral configurado por el administrador. 

## **RF-DIAN-26 - Regla de generación de tiquete de caja electrónico** 

**Descripción:** El sistema debe generar un tiquete de caja electrónico cuando la venta sea de tipo consumidor final, cuando el cliente no tenga datos de identificación suficientes para factura electrónica de venta, o cuando el cajero seleccione explícitamente este tipo de documento. 

## **RF-DIAN-27 - Restricción de factura para consumidor final** 

**Descripción:** El sistema debe impedir emitir una factura electrónica de venta cuando el cliente tenga tipo de identificación “consumidor final”, según RF-CLI-07, e informar al cajero que ese tipo de cliente solo admite tiquete de caja electrónico. 

113 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.9.8 Generación del documento electrónico** 

## **RF-DIAN-28 - Generación de XML UBL 2.1 conforme al anexo técnico** 

**Descripción:** El sistema debe generar el documento electrónico en formato XML bajo el estándar UBL 2.1 con la estructura definida en el Anexo Técnico 1.9 de la DIAN vigente, incluyendo todos los campos obligatorios del tipo de documento correspondiente. 

## **RF-DIAN-29 - Inclusión de datos del emisor en el documento** 

**Descripción:** El sistema debe incluir en el documento electrónico los siguientes datos del emisor tomados de la configuración registrada en la sección 9.2: NIT con dígito de verificación, razón social, nombre comercial, régimen tributario, responsabilidades fiscales, dirección, municipio y departamento. 

## **RF-DIAN-30 - Inclusión de datos completos de la venta en el documento** 

**Descripción:** El sistema debe incluir en el documento electrónico los siguientes datos de la venta: número y prefijo de la resolución, número consecutivo asignado, fecha y hora de generación, lista de ítems con descripción, cantidad, precio unitario, descuentos por ítem, base gravable e impuesto por ítem y tarifa, subtotal sin impuestos, total de descuentos, total de cada tarifa de impuesto, total de impuestos y total del documento. 

## **RF-DIAN-31 - Inclusión de datos del adquirente en factura electrónica** 

**Descripción:** El sistema debe incluir en la factura electrónica de venta los datos del adquirente tomados del perfil del cliente registrado: tipo de identificación en código DIAN, número de identificación, nombre completo o razón social, régimen tributario y correo electrónico cuando esté disponible. 

## **RF-DIAN-32 - Mapeo de medios de pago a códigos DIAN** 

**Descripción:** El sistema debe incluir en el documento electrónico los medios de pago usados en la venta con los códigos de forma de pago definidos por la DIAN: efectivo (código 10), tarjeta débito (código 42), tarjeta crédito (código 48) y transferencia (código 20), mapeando cada medio de pago interno del sistema a su código DIAN correspondiente según la tabla de configuración del administrador. 

114 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-33 - Cálculo de CUFE o CUDE con SHA-384** 

**Descripción:** El sistema debe calcular el CUFE (Código Único de Factura Electrónica) para facturas de venta o el CUDE (Código Único de Documento Electrónico) para tiquetes de caja y notas, usando el algoritmo SHA-384 con los campos y el valor técnico (clave técnica) definidos en el Anexo Técnico 1.9 para cada tipo de documento. 

## **RF-DIAN-34 - Validación XSD previa a la firma digital** 

**Descripción:** El sistema debe validar que el XML generado cumpla el esquema XSD definido por la DIAN para el tipo de documento antes de proceder a la firma digital. Si la validación del esquema falla, el sistema debe registrar el error con el detalle de la discrepancia, asignar estado “error de generación” al documento y notificar al administrador. 

## **4.9.9 Firma digital del documento** 

## **RF-DIAN-35 - Firma digital XAdES-BES del XML** 

**Descripción:** El sistema debe firmar digitalmente el documento XML usando el certificado digital del emisor con algoritmo de firma XAdES-BES, tal como lo requiere el Anexo Técnico 1.9 de la DIAN. 

## **RF-DIAN-36 - Verificación de vigencia y revocación del certificado** 

**Descripción:** El sistema debe verificar que el certificado digital vigente no esté vencido ni revocado antes de usarlo para firmar. Si el certificado está vencido o su fecha de vencimiento es igual o inferior a la fecha actual, el sistema debe impedir la firma, asignar estado “error de firma” al documento y emitir una alerta de alta prioridad al administrador. 

## **RF-DIAN-37 - Registro y validación del certificado digital del emisor** 

**Descripción:** El sistema debe permitir al administrador registrar y actualizar el certificado digital del emisor desde el panel de configuración. El sistema debe validar que el certificado ingresado corresponda al NIT del emisor configurado antes de aceptarlo. 

115 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-38 - Alerta por vencimiento próximo del certificado** 

**Descripción:** El sistema debe emitir una alerta al administrador cuando queden 30 días o menos para el vencimiento del certificado digital activo, indicando la fecha exacta de vencimiento. 

## **RF-DIAN-39 - Conservación íntegra e inmutable del XML firmado** 

**Descripción:** El sistema debe conservar el documento XML firmado de forma íntegra e inmutable después de su generación. Ninguna modificación al documento firmado debe ser posible sin invalidar la firma, y cualquier intento de modificación debe generar un registro en la auditoría. 

## **4.9.10 Transmisión al proveedor tecnológico** 

## **RF-DIAN-40 - Transmisión inmediata tras firma exitosa** 

**Descripción:** El sistema debe transmitir el documento XML firmado al proveedor tecnológico inmediatamente después de que la firma digital sea completada exitosamente, usando la conexión configurada en la sección 9.3. 

## **RF-DIAN-41 - Manejo de timeout de transmisión** 

**Descripción:** El sistema debe esperar la respuesta del proveedor tecnológico durante el tiempo máximo de espera (timeout) configurado en RF-DIAN-08. Si el tiempo de espera se agota sin recibir respuesta, el sistema debe registrar el intento como “timeout de transmisión” y proceder al mecanismo de reintento definido en RF-DIAN-43. 

## **RF-DIAN-42 - Interpretación de respuestas del proveedor tecnológico** 

**Descripción:** El sistema debe interpretar y procesar las siguientes respuestas del proveedor tecnológico: documento validado exitosamente, documento rechazado con errores, documento recibido y en proceso de validación (respuesta asíncrona) y error de comunicación. 

## **RF-DIAN-43 - Reintentos automáticos de transmisión** 

**Descripción:** El sistema debe reintentar automáticamente la transmisión de un documento con estado “error de transmisión” o “timeout” usando el mismo esquema de espera exponencial definido en RF-SYNC-25, con los mismos valores configurables. El documento firmado no debe ser regenerado en los reintentos, solo retransmitido. 

116 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-44 - Envío de identificador de lote o acuse en modo asíncrono** 

**Descripción:** El sistema debe transmitir al PT, junto con el documento, el número de acuse de recibo o identificador de lote cuando el PT opere en modo asíncrono, para permitir la consulta posterior del resultado de validación usando ese identificador. 

## **RF-DIAN-45 - Consulta periódica de estado en validación asíncrona** 

**Descripción:** El sistema debe consultar periódicamente al PT el estado de validación de los documentos transmitidos en modo asíncrono que aún no tengan respuesta definitiva, usando el identificador de lote recibido en RF-DIAN-44, con un intervalo configurable por el administrador. 

## **4.9.11 Estados del documento fiscal** 

## **RF-DIAN-46 - Estados fiscales independientes del estado operacional** 

**Descripción:** El sistema debe manejar los siguientes estados para cada documento fiscal, de forma independiente al estado operacional de la venta asociada: pendiente de generación, error de generación, pendiente de firma, error de firma, pendiente de transmisión, en transmisión, pendiente de respuesta, validado, rechazado, contingencia y anulado. 

## **RF-DIAN-47 - Registro de transiciones de estado fiscal** 

**Descripción:** El sistema debe registrar cada transición de estado de un documento fiscal con los siguientes datos: estado anterior, estado nuevo, fecha y hora de la transición, causa o mensaje de respuesta del PT cuando aplique y número de intento cuando sea aplicable. 

## **RF-DIAN-48 - Paso a estado validado con CUFE o CUDE** 

**Descripción:** El sistema debe actualizar el estado del documento fiscal a “validado” cuando el PT devuelva una respuesta de validación exitosa, registrando el CUFE o CUDE devuelto por la DIAN junto al documento. 

## **RF-DIAN-49 - Paso a estado rechazado con detalle de errores** 

**Descripción:** El sistema debe actualizar el estado del documento fiscal a “rechazado” cuando el PT devuelva una respuesta con errores de validación, registrando los códigos de error y los mensajes descriptivos devueltos por el PT para cada error 

117 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

encontrado, sin modificar el documento XML original. 

## **RF-DIAN-50 - Alerta por rechazo o agotamiento de reintentos** 

**Descripción:** El sistema debe notificar al administrador cuando un documento alcance el estado “rechazado” o cuando supere el número máximo de reintentos de transmisión sin obtener validación, manteniendo la alerta activa hasta que el documento sea corregido o gestionado manualmente. 

## **4.9.12 Modo de contingencia** 

## **RF-DIAN-51 - Activación automática de contingencia por indisponibilidad prolongada** 

**Descripción:** El sistema debe activar automáticamente el modo de contingencia cuando detecte que no es posible transmitir documentos al proveedor tecnológico por un período superior al umbral configurable por el administrador, con un valor predeterminado de 4 horas de indisponibilidad continua. 

## **RF-DIAN-52 - Activación manual documentada del modo de contingencia** 

**Descripción:** El sistema debe permitir al administrador activar el modo de contingencia manualmente desde el panel de configuración, documentando el motivo de la activación manual. 

## **RF-DIAN-53 - Uso de resolución de contingencia autorizada** 

**Descripción:** El sistema debe registrar en el documento de contingencia el número de la resolución de contingencia habilitada por la DIAN para el establecimiento, cuando el modo de contingencia haya sido autorizado previamente por la DIAN. 

## **RF-DIAN-54 - Generación local de documentos en contingencia** 

**Descripción:** El sistema debe continuar generando y registrando localmente los documentos durante el modo de contingencia, asignándoles el estado “contingencia” y conservando el XML firmado para su transmisión posterior al PT cuando la disponibilidad se restablezca. 

118 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-55 - Transmisión posterior de acumulados en contingencia** 

**Descripción:** El sistema debe transmitir automáticamente al PT todos los documentos acumulados en estado “contingencia” cuando la conectividad con el PT se restablezca, en orden cronológico de generación y usando el mecanismo de reintento definido en RF-DIAN-43. 

## **RF-DIAN-56 - Auditoría de activación y desactivación de contingencia** 

**Descripción:** El sistema debe registrar en la auditoría la activación y desactivación del modo de contingencia, incluyendo: causa de la activación (automática o manual), motivo documentado si fue manual, número de documentos generados durante el período de contingencia, fecha y hora de activación y desactivación. 

## **4.9.13 Notas crédito electrónicas** 

## **RF-DIAN-57 - Nota crédito por anulación de documento validado** 

**Descripción:** El sistema debe generar una nota crédito electrónica cuando se anule una venta cuyo documento fiscal tenga estado “validado” ante la DIAN, según la restricción definida en RF-POS-72. La nota crédito debe referenciar el CUFE o CUDE del documento original que anula. 

## **RF-DIAN-58 - Nota crédito por devolución parcial validada** 

**Descripción:** El sistema debe generar una nota crédito electrónica cuando se registre una devolución parcial de cliente sobre una factura electrónica de venta con estado “validado”, según RF-POS-76 a RF-POS-83. La nota crédito debe incluir únicamente los ítems devueltos con sus cantidades y valores correspondientes. 

## **RF-DIAN-59 - Concepto DIAN de la nota crédito** 

**Descripción:** El sistema debe incluir en la nota crédito el concepto de la nota según la tabla de conceptos de notas crédito definida por la DIAN en el Anexo Técnico 1.9, seleccionando automáticamente el concepto correspondiente al motivo registrado en la anulación o devolución. 

## **RF-DIAN-60 - Proceso fiscal completo aplicado a notas crédito** 

**Descripción:** El sistema debe aplicar el mismo proceso de generación, firma y transmisión definido en las secciones 9.7 a 9.9 a las notas crédito, usando la numeración 

119 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

de la resolución activa para notas crédito si existe una separada, o la misma resolución de la factura si la normativa vigente lo permite. 

## **RF-DIAN-61 - Trazabilidad de la nota crédito en repositorio** 

**Descripción:** El sistema debe registrar la nota crédito en el repositorio de documentos electrónicos referenciada tanto al documento original que afecta como a la venta o devolución que la originó, para permitir la trazabilidad completa del ciclo del documento. 

## **4.9.14 Notas débito electrónicas** 

## **RF-DIAN-62 - Generación administrativa de nota débito** 

**Descripción:** El sistema debe permitir al administrador generar una nota débito electrónica sobre una factura electrónica de venta con estado “validado”, para corregir diferencias a favor del emisor como intereses, gastos de cobro o ajustes de precio pactados contractualmente. 

## **RF-DIAN-63 - Formulario obligatorio de nota débito** 

**Descripción:** El sistema debe presentar al administrador el formulario de nota débito con los siguientes campos obligatorios: número de la factura electrónica de referencia, concepto de la nota débito según la tabla definida por la DIAN, descripción libre del ajuste y valor del ajuste expresado en moneda local. 

## **RF-DIAN-64 - Contenido obligatorio de la nota débito** 

**Descripción:** El sistema debe incluir en la nota débito el CUFE de la factura electrónica de referencia, la identificación del emisor, la identificación del adquirente tomada de la factura original y el valor del ajuste con su base gravable e impuesto calculado. 

## **RF-DIAN-65 - Proceso fiscal completo aplicado a notas débito** 

**Descripción:** El sistema debe aplicar el mismo proceso de generación, firma y transmisión definido en las secciones 9.7 a 9.9 a las notas débito. 

120 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.9.15 Representación gráfica del documento** 

## **RF-DIAN-66 - Representación gráfica definitiva del documento validado** 

**Descripción:** El sistema debe generar la representación gráfica de cada documento electrónico validado, que incluya al menos: datos del emisor, datos del adquirente cuando aplique, número del documento con prefijo y resolución, CUFE o CUDE, fecha de generación, lista de ítems con cantidades y valores, totales, impuestos desagregados, medios de pago, leyenda “Documento validado por la DIAN” y código QR con el contenido definido en el Anexo Técnico 1.9. 

## **RF-DIAN-67 - Comprobante provisional pendiente de validación** 

**Descripción:** El sistema debe generar la representación gráfica del comprobante provisional, diferente a la representación gráfica definitiva, para los documentos que aún no hayan sido validados por la DIAN. El comprobante provisional debe incluir la leyenda “Comprobante provisional - Pendiente de validación DIAN” de forma visible y no puede incluir el CUFE ni el código QR de validación. 

## **RF-DIAN-68 - Impresión posterior desde repositorio** 

**Descripción:** El sistema debe permitir imprimir la representación gráfica de cualquier documento electrónico desde el repositorio de documentos, en cualquier momento posterior a su generación, independientemente de su estado fiscal. 

## **RF-DIAN-69 - Envío por correo de representación gráfica validada** 

**Descripción:** El sistema debe permitir enviar la representación gráfica del documento validado al correo electrónico del cliente cuando este dato esté disponible en el perfil del cliente y cuando el cliente lo solicite, según RF-POS-65. 

## **4.9.16 Repositorio de documentos electrónicos** 

## **RF-DIAN-70 - Retención mínima legal del XML firmado** 

**Descripción:** El sistema debe conservar en el repositorio de documentos electrónicos el XML firmado de cada documento generado durante un período mínimo de 5 años contados desde la fecha de generación, en cumplimiento con la normativa tributaria colombiana. 

121 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-71 - Prohibición de eliminación o modificación por usuarios** 

**Descripción:** El sistema debe impedir la eliminación o modificación de cualquier documento del repositorio por parte de cualquier usuario, independientemente de su rol. La eliminación de documentos solo puede realizarse mediante procesos automáticos de depuración después del período de retención legal. 

## **RF-DIAN-72 - Consulta filtrable del repositorio fiscal** 

**Descripción:** El sistema debe permitir al administrador y al contador consultar el repositorio de documentos filtrando por: tipo de documento, estado fiscal, rango de fechas, número de documento, CUFE o CUDE, y datos del adquirente. 

## **RF-DIAN-73 - Datos visibles en el listado del repositorio** 

**Descripción:** El sistema debe mostrar en el listado del repositorio los siguientes datos por cada documento: tipo, número con prefijo, fecha de generación, adquirente si aplica, total del documento, estado fiscal y fecha de la última transición de estado. 

## **RF-DIAN-74 - Descarga de XML y PDF desde repositorio** 

**Descripción:** El sistema debe permitir descargar el XML firmado de cualquier documento del repositorio en formato XML y su representación gráfica en formato PDF. 

## **RF-DIAN-75 - Exportación CSV del resultado de consulta del repositorio** 

**Descripción:** El sistema debe permitir al administrador y al contador exportar el resultado de una consulta del repositorio como listado en formato CSV, con los datos de cabecera de cada documento sin incluir el XML completo. 

## **4.9.17 Reportes fiscales** 

## **RF-DIAN-76 - Reporte de documentos electrónicos por período** 

**Descripción:** El sistema debe generar un reporte de documentos electrónicos por período, agrupado por tipo de documento y estado fiscal, mostrando: número de documentos emitidos, número de documentos validados, número de documentos rechazados, número de documentos en contingencia y valores totales por cada grupo. 

122 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-DIAN-77 - Reporte de IVA por período** 

**Descripción:** El sistema debe generar un reporte de IVA por período que muestre, para cada tarifa de impuesto: base gravable total, valor de IVA total y número de documentos que incluyeron esa tarifa. Este reporte debe estar disponible para el contador y el administrador. 

## **RF-DIAN-78 - Reporte de documentos rechazados** 

**Descripción:** El sistema debe generar un reporte de documentos rechazados por período, mostrando para cada documento rechazado: número de documento, fecha, adquirente si aplica, valor, código de error DIAN, descripción del error y número de intentos de retransmisión. 

## **RF-DIAN-79 - Reporte de consecutivos por resolución** 

**Descripción:** El sistema debe generar un reporte de consecutivos de numeración por resolución, mostrando: resolución, rango total, documentos emitidos, documentos anulados, documentos en contingencia, documentos disponibles restantes y fecha de vencimiento de la resolución. 

## **4.9.18 Auditoría del módulo fiscal** 

## **RF-DIAN-80 - Auditoría del ciclo de vida del documento electrónico** 

**Descripción:** El sistema debe registrar en la auditoría cada evento del ciclo de vida de un documento electrónico que represente una transición de estado, incluyendo: identificador del documento, tipo de documento, número de documento, estado anterior, estado nuevo, causa o código de respuesta del PT, fecha y hora y usuario cuando la transición sea originada por una acción manual. 

## **RF-DIAN-81 - Auditoría de consultas al repositorio fiscal** 

**Descripción:** El sistema debe registrar en la auditoría cada consulta al repositorio de documentos realizada por el administrador o el contador, incluyendo: usuario, filtros aplicados, número de documentos en el resultado y fecha y hora de la consulta, para garantizar la trazabilidad del acceso a información fiscal sensible. 

## **4.10 Módulo 10: Reportes y Contabilidad** 

123 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.10.1 Contexto del módulo** 

Este módulo centraliza la generación, consulta y exportación de información agregada del sistema para apoyar la toma de decisiones operativas, administrativas, contables y fiscales del establecimiento. A diferencia de los módulos transaccionales, este módulo no genera datos propios: consume y consolida datos producidos por los módulos de ventas, inventario, compras, caja y facturación electrónica. 

El módulo tiene dos perfiles de uso diferenciados. El perfil operativo, orientado al administrador, cubre reportes de ventas, turnos, inventario y compras para la gestión diaria del establecimiento. El perfil contable, orientado al contador, cubre reportes de ingresos, impuestos, documentos fiscales y conciliaciones necesarias para el cumplimiento tributario ante la DIAN y para la preparación de estados financieros. 

Principio fundamental de este módulo: ningún reporte debe modificar datos del sistema. Los reportes son de solo lectura. Cualquier discrepancia detectada en un reporte debe corregirse mediante los módulos transaccionales correspondientes, no desde este módulo. 

## **4.10.2 Control de acceso al módulo de reportes** 

## **RF-REP-01 - Acceso restringido a reportes operativos** 

**Descripción:** El sistema debe permitir acceder a los reportes operativos de ventas, caja, inventario y compras únicamente a usuarios con rol de administrador. Un cajero o auxiliar de inventario no debe tener acceso al módulo de reportes fuera de los resúmenes de turno definidos en el Módulo 2. 

## **RF-REP-02 - Acceso restringido a reportes fiscales y contables** 

**Descripción:** El sistema debe permitir acceder a los reportes fiscales, de impuestos, de ingresos y de documentos electrónicos únicamente a usuarios con rol de administrador o contador. Un auxiliar de inventario o cajero no debe tener acceso a información fiscal consolidada. 

## **RF-REP-03 - Acceso diferenciado al panel de indicadores** 

**Descripción:** El sistema debe permitir acceder al panel de indicadores de gestión (dashboard) a usuarios con rol de administrador. El contador debe tener acceso únicamente a los indicadores de tipo fiscal y contable del panel. 

124 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-04 - Auditoría de reportes generados o exportados** 

**Descripción:** El sistema debe registrar en la auditoría cada reporte generado o exportado, incluyendo: tipo de reporte, filtros aplicados, usuario responsable, fecha y hora de generación y formato de exportación si aplica. 

## **4.10.3 Reportes de ventas** 

## **RF-REP-05 - Reporte de ventas por período** 

**Descripción:** El sistema debe generar un reporte de ventas por período que incluya todas las ventas con estado operacional “confirmada” en el rango de fechas seleccionado, con los siguientes datos por cada venta: número de venta, fecha y hora, cajero, estación de trabajo, número de ítems, subtotal sin impuestos, total de descuentos, total de impuestos, total de la venta, medios de pago usados, estado fiscal del documento asociado y cliente si está registrado. 

## **RF-REP-06 - Filtros combinables del reporte de ventas por período** 

**Descripción:** El sistema debe permitir filtrar el reporte de ventas por período de forma combinada por: cajero, estación de trabajo, medio de pago, tipo de documento fiscal emitido, estado fiscal del documento, cliente y rango de montos. 

## **RF-REP-07 - Reporte de ventas por producto** 

**Descripción:** El sistema debe generar un reporte de ventas por producto en un período seleccionado, mostrando para cada producto: nombre comercial, código interno, categoría, número de unidades vendidas, valor total vendido sin impuestos, valor total de impuestos, descuentos aplicados y margen estimado basado en el CPP según RF-COM-39. 

## **RF-REP-08 - Filtros del reporte de ventas por producto** 

**Descripción:** El sistema debe permitir filtrar el reporte de ventas por producto por: categoría, laboratorio fabricante, forma farmacéutica, tipo de venta (libre o con receta) y cajero. 

125 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-09 - Reporte de ventas por cajero** 

**Descripción:** El sistema debe generar un reporte de ventas por cajero en un período seleccionado, mostrando para cada cajero: número de ventas confirmadas, número de anulaciones, número de devoluciones, total de recaudo por medio de pago, total de descuentos otorgados y promedio de valor por venta. 

## **RF-REP-10 - Reporte de ventas por hora del día** 

**Descripción:** El sistema debe generar un reporte de ventas por hora del día, agrupando las ventas de un período en franjas horarias de una hora, mostrando para cada franja: número de transacciones y valor total vendido. Este reporte debe permitir identificar los horarios de mayor demanda del establecimiento. 

## **RF-REP-11 - Reporte de ventas por día de la semana** 

**Descripción:** El sistema debe generar un reporte de ventas por día de la semana para un período seleccionado, mostrando para cada día: número de transacciones y valor total vendido, para apoyar la planificación de turnos y abastecimiento. 

## **RF-REP-12 - Reporte de anulaciones de ventas** 

**Descripción:** El sistema debe generar un reporte de anulaciones de ventas en un período, mostrando para cada anulación: número de venta original, fecha de la venta, fecha de la anulación, cajero que registró la venta, usuario que ejecutó la anulación, motivo y valor anulado. 

## **RF-REP-13 - Reporte de devoluciones de clientes** 

**Descripción:** El sistema debe generar un reporte de devoluciones de clientes en un período, mostrando para cada devolución: número de devolución, número de venta original, fecha de la venta, fecha de la devolución, productos devueltos con cantidades, motivo, valor reembolsado y medio de reembolso. 

## **RF-REP-14 - Reporte de productos con receta médica vendidos** 

**Descripción:** El sistema debe generar un reporte de productos con receta médica vendidos en un período, mostrando para cada venta que incluya al menos un producto de este tipo: número de venta, fecha, cajero, productos con receta incluidos y si el cajero confirmó la presentación de la receta. 

126 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-15 - Totales agregados en encabezado del reporte de ventas** 

**Descripción:** El sistema debe calcular y mostrar en el encabezado del reporte de ventas los siguientes totales del período consultado: número total de ventas confirmadas, número de anulaciones, número de devoluciones, valor total neto vendido (ventas menos anulaciones y devoluciones), total de descuentos otorgados y total de impuestos recaudados. 

## **4.10.4 Reportes de caja y turnos** 

## **RF-REP-16 - Reporte de turnos por período** 

**Descripción:** El sistema debe generar un reporte de turnos por período que incluya todos los turnos cerrados en el rango de fechas seleccionado, con los siguientes datos por cada turno: identificador del turno, cajero, estación de trabajo, fecha y hora de apertura, fecha y hora de cierre, monto base declarado, total de recaudo por medio de pago, diferencia de cierre y observaciones. 

## **RF-REP-17 - Filtros del reporte de turnos** 

**Descripción:** El sistema debe permitir filtrar el reporte de turnos por cajero, estación de trabajo, presencia de diferencias de cierre (con diferencia, sin diferencia o todos) y rango de montos de diferencia. 

## **RF-REP-18 - Reporte de diferencias de cierre de turno** 

**Descripción:** El sistema debe generar un reporte de diferencias de cierre de turno por período, listando únicamente los turnos cuya diferencia total sea diferente de cero, mostrando: cajero, fecha, diferencia por medio de pago y diferencia total. El reporte debe permitir identificar patrones de diferencias recurrentes por cajero o estación. 

## **RF-REP-19 - Acumulado de diferencias por cajero** 

**Descripción:** El sistema debe calcular en el reporte de diferencias de cierre el acumulado de diferencias por cajero en el período seleccionado, mostrando el total de sobrantes, el total de faltantes y la diferencia neta por cada cajero. 

127 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-20 - Reporte de recaudo por medio de pago** 

**Descripción:** El sistema debe generar un reporte de recaudo por medio de pago en un período seleccionado, mostrando para cada medio de pago: número de transacciones, valor total recaudado en ventas, valor total reembolsado en devoluciones y valor neto recaudado. 

## **RF-REP-21 - Reporte de turnos con duración extendida** 

**Descripción:** El sistema debe generar un reporte de turnos con duración extendida, listando los turnos que hayan superado el límite de duración configurado en RFCAJA-42, con indicación de la duración real del turno, el cajero y la estación de trabajo. 

## **4.10.5 Reportes de inventario** 

## **RF-REP-22 - Reporte de inventario valorizado con filtros ampliados** 

**Descripción:** El sistema debe generar el reporte de inventario valorizado definido en RF-INV-60, con la opción adicional de filtrar por categoría, laboratorio, forma farmacéutica y rango de fechas de vencimiento de los lotes incluidos. 

## **RF-REP-23 - Reporte de rotación de inventario por período** 

**Descripción:** El sistema debe generar un reporte de rotación de inventario por período que muestre para cada producto: unidades vendidas en el período, stock promedio del período calculado como el promedio entre el stock al inicio y al final del período, índice de rotación calculado como unidades vendidas dividido entre stock promedio, y días de inventario calculados como 365 dividido entre el índice de rotación. 

## **RF-REP-24 - Reporte de productos de baja rotación con umbral local** 

**Descripción:** El sistema debe generar el reporte de productos de baja rotación definido en RF-INV-71, con la posibilidad de configurar el umbral de días sin movimiento directamente desde la pantalla del reporte sin necesidad de cambiar la configuración global del sistema. 

128 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-25 - Reporte de movimientos de inventario con resumen por producto** 

**Descripción:** El sistema debe generar un reporte de movimientos de inventario por período filtrables por producto, lote, tipo de movimiento y usuario, tal como se define en RF-INV-61, con la adición de un resumen de entradas y salidas totales por producto en el período. 

## **RF-REP-26 - Reporte de lotes próximos a vencer con días restantes** 

**Descripción:** El sistema debe generar el reporte de lotes próximos a vencer definido en RF-INV-27, con la adición de un campo que indique los días restantes hasta el vencimiento para cada lote, calculados como la diferencia entre la fecha de vencimiento y la fecha del reporte. 

## **RF-REP-27 - Reporte de lotes vencidos con pérdida estimada** 

**Descripción:** El sistema debe generar el reporte de lotes vencidos con existencias definido en RF-INV-63, añadiendo el valor estimado de la pérdida calculado como la cantidad restante multiplicada por el CPP vigente del producto. 

## **RF-REP-28 - Reporte de lotes bloqueados con valor estimado** 

**Descripción:** El sistema debe generar el reporte de lotes bloqueados activos definido en RF-INV-62, añadiendo el valor estimado de las existencias bloqueadas calculado como la cantidad bloqueada multiplicada por el CPP vigente del producto. 

## **RF-REP-29 - Reporte de ajustes de inventario por período** 

**Descripción:** El sistema debe generar un reporte de ajustes de inventario por período, mostrando para cada ajuste: producto, lote, tipo de ajuste, cantidad, motivo documentado, usuario responsable y fecha. El reporte debe incluir un resumen de ajustes positivos y negativos totales por producto. 

## **4.10.6 Reportes de compras** 

## **RF-REP-30 - Reportes de compras con datos consolidados adicionales** 

**Descripción:** El sistema debe generar los reportes de compras definidos en RFCOM-54 a RF-COM-58, con la adición de los siguientes datos consolidados al inicio de cada reporte: total de unidades recibidas, valor total de compras en el período, número de órdenes creadas, número de órdenes completamente recibidas, número de 

129 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

órdenes parcialmente recibidas y número de órdenes anuladas. 

## **RF-REP-31 - Reporte comparativo de precios de compra por producto** 

**Descripción:** El sistema debe generar un reporte de comparación de precios de compra por producto en un período seleccionado, mostrando para cada producto las recepciones del período con su costo unitario real, permitiendo identificar variaciones de precio entre recepciones del mismo proveedor o entre proveedores distintos. 

## **RF-REP-32 - Reporte de cumplimiento de órdenes por proveedor** 

**Descripción:** El sistema debe generar un reporte de cumplimiento de órdenes de compra por proveedor en un período, mostrando para cada proveedor: número de órdenes creadas, número de órdenes completamente recibidas, número de órdenes parcialmente recibidas, porcentaje de cumplimiento y tiempo promedio entre la fecha de la orden y la fecha de recepción completa. 

## **4.10.7 Reportes de clientes** 

## **RF-REP-33 - Reporte de clientes activos por clasificación** 

**Descripción:** El sistema debe generar un reporte de clientes activos por clasificación, mostrando para cada clasificación (particular, frecuente, institucional): número de clientes, número de compras en el período seleccionado, valor total comprado y ticket promedio por cliente. 

## **RF-REP-34 - Reporte de clientes con mayor valor de compras** 

**Descripción:** El sistema debe generar un reporte de clientes con mayor valor de compras en un período seleccionado, ordenado de mayor a menor valor total acumulado, mostrando para cada cliente: nombre, identificación, clasificación, número de transacciones y valor total comprado. 

## **RF-REP-35 - Reporte de clientes sin compras en el período** 

**Descripción:** El sistema debe generar un reporte de clientes sin compras en un período seleccionado, listando los clientes activos que no registren ninguna venta confirmada en el período, con la fecha de su última compra registrada. 

130 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.10.8 Reportes fiscales y contables** 

## **RF-REP-36 - Reporte de IVA con comparación contra documentos DIAN** 

**Descripción:** El sistema debe generar el reporte de IVA por período definido en RF-DIAN-77, añadiendo la siguiente información: comparación entre el IVA calculado por el sistema en las ventas y el IVA reportado en los documentos fiscales validados por la DIAN, con indicación de cualquier discrepancia detectada. 

## **RF-REP-37 - Reporte de ingresos brutos por período** 

**Descripción:** El sistema debe generar un reporte de ingresos brutos por período que muestre: total de ventas confirmadas antes de descuentos, total de descuentos otorgados, total de ventas netas (ingresos brutos menos descuentos), desagregado por tipo de documento fiscal (factura electrónica y tiquete de caja) y por tarifa de IVA. 

## **RF-REP-38 - Reporte de conciliación entre ventas y documentos fiscales** 

**Descripción:** El sistema debe generar un reporte de conciliación entre ventas operacionales y documentos fiscales en un período, identificando: ventas confirmadas sin documento fiscal asociado, ventas con documento en estado “rechazado” o “error”, ventas en contingencia sin transmisión posterior y documentos fiscales validados sin venta asociada en el sistema. 

## **RF-REP-39 - Reporte de documentos electrónicos con desglose por adquirente** 

**Descripción:** El sistema debe generar el reporte de documentos electrónicos por período definido en RF-DIAN-76, con la adición de un desglose por tipo de adquirente (persona natural, persona jurídica y consumidor final) para las facturas electrónicas de venta. 

## **RF-REP-40 - Reporte de consecutivos con proyección de agotamiento** 

**Descripción:** El sistema debe generar el reporte de consecutivos de numeración por resolución definido en RF-DIAN-79, añadiendo una proyección de la fecha estimada de agotamiento del rango basada en el promedio diario de documentos emitidos en los últimos 30 días. 

## **RF-REP-41 - Reporte de notas crédito y notas débito** 

**Descripción:** El sistema debe generar un reporte de notas crédito y notas débito por período, mostrando para cada nota: número del documento, tipo (crédito o débito), 

131 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

documento de referencia, fecha, adquirente, concepto, valor y estado fiscal. 

## **RF-REP-42 - Reporte de ventas por régimen tributario del cliente** 

**Descripción:** El sistema debe generar un reporte de ventas por régimen tributario del cliente en un período, mostrando el total vendido y el total de IVA discriminado entre clientes del régimen simplificado y clientes del régimen común, para apoyar la preparación de la declaración de IVA. 

## **RF-REP-43 - Reporte de margen bruto por período** 

**Descripción:** El sistema debe generar un reporte de margen bruto por período que muestre para cada producto vendido: unidades vendidas, ingresos netos por el producto, costo estimado de lo vendido calculado como unidades vendidas multiplicadas por el CPP vigente, margen bruto en moneda y margen bruto porcentual. El reporte debe incluir el margen bruto total del establecimiento para el período. 

## **RF-REP-44 - Libro auxiliar de ventas compatible con exógena DIAN** 

**Descripción:** El sistema debe generar un reporte de libro auxiliar de ventas compatible con los requerimientos del sistema de información exógena de la DIAN, agrupando las ventas del período por tipo de documento, número de documento, fecha, adquirente, base gravable, tarifa de IVA y valor de IVA. 

## **4.10.9 Panel de indicadores de gestión** 

## **RF-REP-45 - Dashboard de indicadores operativos y fiscales** 

**Descripción:** El sistema debe presentar al administrador un panel de indicadores de gestión (dashboard) que muestre de forma consolidada y visual los indicadores más relevantes del establecimiento para el día actual y los últimos 30 días, actualizados en tiempo real durante las horas de operación. 

## **RF-REP-46 - Indicadores operativos del dashboard** 

**Descripción:** El sistema debe incluir en el panel de indicadores de gestión los siguientes indicadores operativos: número de ventas del día, valor total de ventas del día, ticket promedio del día, número de turnos activos en este momento, número de productos con alerta de stock mínimo activa y número de lotes con alerta de vencimiento próximo activa. 

132 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-47 - Indicadores de inventario del dashboard** 

**Descripción:** El sistema debe incluir en el panel de indicadores de gestión los siguientes indicadores de inventario: valor total del inventario valorizado al CPP vigente, número de productos activos, número de lotes próximos a vencer en los próximos 30 días y número de lotes vencidos con existencias mayores a cero. 

## **RF-REP-48 - Indicadores fiscales del dashboard** 

**Descripción:** El sistema debe incluir en el panel de indicadores de gestión los siguientes indicadores fiscales: número de documentos fiscales pendientes de transmisión, número de documentos rechazados sin resolver, número de documentos en contingencia y porcentaje de documentos validados sobre el total emitido en el mes en curso. 

## **RF-REP-49 - Indicadores de sincronización del dashboard** 

**Descripción:** El sistema debe incluir en el panel de indicadores de gestión los siguientes indicadores de sincronización: número de operaciones pendientes de sincronización en todas las estaciones, número de operaciones con error permanente y número de conflictos sin resolver en la bandeja de sincronización. 

## **RF-REP-50 - Configuración de visibilidad y orden del dashboard** 

**Descripción:** El sistema debe permitir al administrador configurar qué indicadores del panel son visibles y en qué orden se presentan, seleccionando de la lista completa de indicadores disponibles definidos en RF-REP-46 a RF-REP-49. 

## **RF-REP-51 - Selección de período comparativo por indicador** 

**Descripción:** El sistema debe permitir al administrador seleccionar el período de comparación de cada indicador del panel entre las siguientes opciones: día anterior, semana anterior, mes anterior y año anterior, mostrando la variación porcentual respecto al período comparado. 

133 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.10.10 Comparativos y tendencias** 

## **RF-REP-52 - Reporte comparativo de ventas entre dos períodos** 

**Descripción:** El sistema debe generar un reporte comparativo de ventas entre dos períodos definidos por el administrador, mostrando para cada período: valor total de ventas, número de transacciones, ticket promedio, total de descuentos, total de impuestos y variación porcentual entre ambos períodos para cada indicador. 

## **RF-REP-53 - Evolución mensual de ventas por año** 

**Descripción:** El sistema debe generar un reporte de evolución mensual de ventas para un año seleccionado, mostrando mes a mes: valor total de ventas, número de transacciones, ticket promedio y variación porcentual respecto al mismo mes del año anterior cuando los datos estén disponibles. 

## **RF-REP-54 - Evolución mensual de inventario por año** 

**Descripción:** El sistema debe generar un reporte de evolución mensual de inventario para un año seleccionado, mostrando mes a mes: valor del inventario al cierre de cada mes, número de entradas (unidades y valor), número de salidas por ventas (unidades y valor) y diferencia de ajustes. 

## **4.10.11 Configuración de reportes** 

## **RF-REP-55 - Configuraciones guardadas de reportes frecuentes** 

**Descripción:** El sistema debe permitir al administrador guardar configuraciones de reporte frecuentes con un nombre descriptivo, almacenando el tipo de reporte y todos los filtros aplicados. Las configuraciones guardadas deben estar disponibles para reutilizarlas sin necesidad de configurar los filtros nuevamente. 

## **RF-REP-56 - Eliminación confirmada de configuraciones guardadas** 

**Descripción:** El sistema debe permitir al administrador eliminar una configuración de reporte guardada. La eliminación debe solicitar confirmación explícita y no debe afectar los reportes previamente generados con esa configuración. 

134 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-57 - Período predeterminado por tipo de reporte** 

**Descripción:** El sistema debe permitir al administrador definir el período predeterminado de consulta para cada tipo de reporte entre las siguientes opciones: hoy, ayer, semana actual, semana anterior, mes actual, mes anterior y personalizado. El período predeterminado debe cargarse automáticamente al abrir el reporte. 

## **4.10.12 Exportación de reportes** 

## **RF-REP-58 - Exportación universal a CSV** 

**Descripción:** El sistema debe permitir exportar cualquier reporte generado en formato CSV con todos los registros del resultado, sin límite de filas, usando punto y coma como separador y codificación UTF-8 para garantizar la compatibilidad con herramientas de ofimática y contabilidad. 

## **RF-REP-59 - Exportación universal a PDF con encabezado estructurado** 

**Descripción:** El sistema debe permitir exportar cualquier reporte generado en formato PDF con presentación estructurada, incluyendo en el encabezado del documento: nombre del establecimiento, tipo de reporte, filtros aplicados, fecha y hora de generación y usuario que lo generó. 

## **RF-REP-60 - Consistencia entre vista en pantalla y exportación** 

**Descripción:** El sistema debe garantizar que los datos exportados en CSV o PDF correspondan exactamente al resultado mostrado en pantalla para los mismos filtros aplicados, sin omitir ni agregar registros respecto a la vista en pantalla. 

## **RF-REP-61 - Historial reciente de exportaciones por usuario** 

**Descripción:** El sistema debe conservar en el historial de exportaciones los últimos 30 archivos exportados por usuario, con la posibilidad de descargar nuevamente cualquiera de ellos sin necesidad de regenerar el reporte. 

135 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.10.13 Programación automática de reportes** 

## **RF-REP-62 - Programación automática de reportes guardados** 

**Descripción:** El sistema debe permitir al administrador programar la generación automática de cualquier reporte guardado como configuración según RF-REP-55, con las siguientes frecuencias disponibles: diaria, semanal (seleccionando el día de la semana) y mensual (seleccionando el día del mes). 

## **RF-REP-63 - Ejecución programada con notificación de fallos** 

**Descripción:** El sistema debe generar el reporte programado en el horario configurado por el administrador y almacenarlo en el historial de exportaciones. Si la generación falla por cualquier motivo, el sistema debe registrar el error y notificar al administrador. 

## **RF-REP-64 - Envío automático por correo de reportes programados** 

**Descripción:** El sistema debe enviar automáticamente el reporte programado al correo electrónico configurado por el administrador como destinatario, adjuntando el archivo en el formato seleccionado (CSV o PDF) en el momento de su generación. Si el envío falla, el sistema debe conservar el archivo en el historial y notificar al administrador del fallo. 

## **RF-REP-65 - Desactivación temporal de reportes programados** 

**Descripción:** El sistema debe permitir al administrador desactivar temporalmente un reporte programado sin eliminarlo, y reactivarlo posteriormente conservando toda su configuración. 

## **RF-REP-66 - Auditoría de ejecuciones programadas** 

**Descripción:** El sistema debe registrar en la auditoría cada ejecución de reporte programado, incluyendo: nombre del reporte, filtros aplicados, fecha y hora de generación, resultado (exitoso o fallido) y si el envío por correo fue exitoso cuando aplique. 

136 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.10.14 Restricciones de integridad de los reportes** 

## **RF-REP-67 - Consistencia interna de totales en reportes de ventas** 

**Descripción:** El sistema debe garantizar que los totales mostrados en cualquier reporte de ventas sean consistentes con los totales calculables a partir del detalle incluido en el mismo reporte. Si existe discrepancia entre el total calculado a partir de los ítems y el total mostrado en el encabezado, el sistema debe reportar la discrepancia como un error de generación y no mostrar el reporte con datos inconsistentes. 

## **RF-REP-68 - Consistencia del IVA en reportes fiscales** 

**Descripción:** El sistema debe garantizar que el total de IVA mostrado en los reportes fiscales sea consistente con los valores registrados en los documentos electrónicos validados para el mismo período. Si existe diferencia entre el IVA calculado por el sistema y el reportado en los documentos DIAN, el sistema debe señalar la discrepancia de forma explícita en el reporte de conciliación definido en RF-REP-38. 

## **RF-REP-69 - Consistencia del inventario valorizado en reportes** 

**Descripción:** El sistema debe garantizar que el inventario valorizado mostrado en los reportes sea consistente con los movimientos registrados en el Módulo 4 para el mismo período. El stock inicial más las entradas menos las salidas del período debe ser igual al stock final reportado para cada producto. 

## **4.10.15 Rendimiento de generación de reportes** 

## **RF-REP-70 - Tiempo máximo de generación para reportes estándar** 

**Descripción:** El sistema debe generar cualquier reporte con un período de hasta 31 días y un volumen de hasta 10.000 transacciones en un tiempo máximo de 30 segundos desde que el usuario confirma los filtros. Si el tiempo de generación supera este límite, el sistema debe informar al usuario que el reporte está siendo procesado y notificarle cuando esté disponible. 

## **RF-REP-71 - Generación en segundo plano para reportes grandes** 

**Descripción:** El sistema debe permitir al administrador solicitar la generación en segundo plano de reportes con períodos superiores a 31 días o volúmenes estimados superiores a 10.000 transacciones, notificando al administrador cuando el reporte 

137 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

esté disponible para su consulta o descarga. 

## **RF-REP-72 - Cancelación de generación en segundo plano** 

**Descripción:** El sistema debe permitir al administrador cancelar una generación de reporte en segundo plano que aún no haya completado, sin afectar la disponibilidad del sistema para otras operaciones. 

## **4.10.16 Auditoría del módulo de reportes** 

## **RF-REP-73 - Auditoría de acceso al panel de indicadores** 

**Descripción:** El sistema debe registrar en la auditoría cada acceso al panel de indicadores de gestión, incluyendo: usuario, fecha y hora de acceso y configuración de indicadores activa en ese momento. 

## **RF-REP-74 - Auditoría de generación de reportes en pantalla** 

**Descripción:** El sistema debe registrar en la auditoría cada reporte generado en pantalla, incluyendo: tipo de reporte, filtros aplicados, número de registros en el resultado, usuario responsable, fecha y hora de generación y tiempo de generación. 

## **RF-REP-75 - Auditoría de exportación de reportes** 

**Descripción:** El sistema debe registrar en la auditoría cada exportación de reporte, incluyendo: tipo de reporte, filtros aplicados, formato exportado, número de registros exportados, usuario responsable, fecha y hora. 

## **RF-REP-76 - Auditoría de configuraciones guardadas o eliminadas** 

**Descripción:** El sistema debe registrar en la auditoría cada configuración de reporte guardada o eliminada, incluyendo: nombre de la configuración, tipo de reporte, filtros almacenados, usuario responsable y fecha y hora. 

## **RF-REP-77 - Auditoría de programación de reportes** 

**Descripción:** El sistema debe registrar en la auditoría cada programación de reporte creada, modificada, desactivada, reactivada o eliminada, incluyendo: nombre del reporte, frecuencia configurada, correo destinatario, formato, usuario responsable y fecha y hora. 

138 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-REP-78 - Auditoría de consulta del historial de exportaciones** 

**Descripción:** El sistema debe registrar en la auditoría cada consulta del historial de exportaciones, incluyendo: usuario, fecha y hora de la consulta y si se descargó algún archivo desde el historial. 

## **RF-REP-79 - Inmutabilidad de la auditoría del módulo de reportes** 

**Descripción:** El sistema debe impedir que cualquier usuario modifique, elimine o altere registros del historial de auditoría del módulo de reportes. El historial de auditoría debe ser de solo lectura para todos los roles, incluyendo el administrador. 

## **4.11 Módulo 11: Configuración General del Sistema** 

## **4.11.1 Contexto del módulo** 

Este módulo centraliza todos los parámetros globales que controlan el comportamiento del sistema en sus demás módulos. A diferencia de los módulos transaccionales, este módulo no procesa operaciones comerciales: establece las reglas bajo las cuales el resto del sistema opera. Cualquier cambio de configuración debe quedar registrado en la auditoría con el valor anterior y el nuevo, dado que un parámetro mal configurado puede afectar simultáneamente múltiples módulos. 

El administrador es el único rol autorizado para modificar la configuración del sistema. Ningún otro rol puede acceder a este módulo, salvo que se indique explícitamente lo contrario para operaciones de consulta puntuales. Todos los parámetros tienen un valor predeterminado que el sistema aplica desde la instalación y que el administrador puede modificar. Ningún parámetro debe quedar sin valor en ningún momento: si el administrador borra un valor, el sistema debe restaurar el predeterminado o impedir dejar el campo vacío. 

Principio fundamental: un cambio de configuración nunca debe afectar retroactivamente operaciones ya confirmadas. Los nuevos valores aplican únicamente a las operaciones que se inicien después del momento exacto en que el cambio sea guardado. 

139 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.11.2 Control de acceso al módulo de configuración** 

## **RF-CFG-01 - Acceso exclusivo al módulo de configuración** 

**Descripción:** El sistema debe permitir acceder al módulo de configuración general únicamente a usuarios con rol de administrador. Si un usuario con cualquier otro rol intenta acceder, el sistema debe bloquear el acceso e informar que la operación no está autorizada para su rol. 

## **RF-CFG-02 - Reingreso de contraseña para parámetros críticos** 

**Descripción:** El sistema debe exigir al administrador que reingrese su contraseña antes de guardar cambios en los siguientes parámetros críticos: datos del emisor fiscal, configuración del proveedor tecnológico DIAN, ambiente de operación fiscal (habilitación o producción), políticas de contraseñas y parámetros de bloqueo de sesión. Si la contraseña no coincide, el sistema debe rechazar el cambio sin revelar si el error fue de usuario o contraseña. 

## **RF-CFG-03 - Auditoría de accesos al módulo de configuración** 

**Descripción:** El sistema debe registrar en la auditoría cada acceso al módulo de configuración, incluyendo: usuario, fecha y hora de acceso, sección consultada y si se realizó algún cambio durante la sesión de configuración. 

## **4.11.3 Datos generales del establecimiento** 

## **RF-CFG-04 - Registro de datos generales del establecimiento** 

**Descripción:** El sistema debe permitir al administrador registrar y modificar los datos generales del establecimiento con los siguientes campos obligatorios: nombre comercial del establecimiento, dirección, municipio, departamento, teléfono principal y correo electrónico de contacto. 

## **RF-CFG-05 - Registro del logotipo del establecimiento** 

**Descripción:** El sistema debe permitir al administrador registrar el logotipo del establecimiento en formato de imagen, con un tamaño máximo de 2 MB y en uno de los siguientes formatos admitidos: PNG o JPG. El logotipo debe utilizarse en los comprobantes de venta, representaciones gráficas de documentos fiscales y reportes exportados en PDF. 

140 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-06 - Validación del correo electrónico del establecimiento** 

**Descripción:** El sistema debe validar que el correo electrónico del establecimiento cumpla el formato estándar al ser ingresado. Si el formato es inválido, el sistema debe informar el error e impedir guardar la configuración. 

## **RF-CFG-07 - Uso del nombre comercial en documentos y comprobantes** 

**Descripción:** El sistema debe usar el nombre comercial del establecimiento registrado en esta sección como el nombre que aparece en los comprobantes de caja, documentos fiscales y reportes. Si el nombre comercial se modifica, el cambio debe reflejarse únicamente en los documentos generados después del momento del cambio, sin alterar documentos previos. 

## **RF-CFG-08 - Auditoría de datos generales del establecimiento** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de los datos generales del establecimiento, incluyendo campo modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **4.11.4 Parámetros de operación general** 

## **RF-CFG-09 - Configuración de la moneda de operación** 

**Descripción:** El sistema debe permitir al administrador configurar la moneda de operación del sistema desde una lista de monedas admitidas. La moneda de operación debe aplicarse uniformemente en todos los módulos del sistema para la expresión de precios, costos, totales e impuestos. 

## **RF-CFG-10 - Configuración del número de decimales** 

**Descripción:** El sistema debe permitir al administrador configurar el número de decimales a usar en los cálculos y presentación de montos, con un valor mínimo de 0 y un máximo de 4. El cambio de decimales debe aplicarse únicamente a operaciones nuevas y no debe recalcular operaciones ya confirmadas. 

## **RF-CFG-11 - Regla de redondeo de ventas** 

**Descripción:** El sistema debe permitir al administrador configurar la regla de redondeo de totales de venta entre las siguientes opciones: redondeo al entero más cercano, redondeo hacia arriba o redondeo hacia abajo. La regla seleccionada debe 

141 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

aplicarse al total final de cada venta antes del cobro. 

## **RF-CFG-12 - Límite máximo para ventas sin identificación** 

**Descripción:** El sistema debe permitir al administrador configurar el límite máximo de monto de venta para ventas sin identificación de cliente, con un valor expresado en moneda local y un valor predeterminado configurable. Este parámetro es referenciado por RF-POS-42. 

## **RF-CFG-13 - Máximo de ventas en espera simultáneas** 

**Descripción:** El sistema debe permitir al administrador configurar el número máximo de ventas en espera simultáneas por estación de trabajo, con un valor mínimo de 1 y un máximo de 10. Este parámetro es referenciado por RF-POS-67. 

## **RF-CFG-14 - Tiempo máximo de inactividad de una venta en espera** 

**Descripción:** El sistema debe permitir al administrador configurar el tiempo de inactividad máximo de una venta en espera antes de ser descartada automáticamente, expresado en minutos con un valor mínimo de 5 y un máximo de 120. Este parámetro es referenciado por RF-POS-69. 

## **RF-CFG-15 - Confirmación de receta médica obligatoria** 

**Descripción:** El sistema debe permitir al administrador configurar si la confirmación de receta médica obligatoria en productos de venta restringida es una alerta informativa o un bloqueo que exige confirmación explícita del cajero. Este parámetro es referenciado por RF-POS-38. 

## **RF-CFG-16 - Auditoría de parámetros de operación general** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de parámetros de operación general, incluyendo: parámetro modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

142 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.11.5 Estaciones de trabajo** 

## **RF-CFG-17 - Registro de estaciones de trabajo** 

**Descripción:** El sistema debe permitir al administrador registrar las estaciones de trabajo del sistema con los siguientes datos obligatorios: nombre o código identificador de la estación, descripción y estado (activa o inactiva). 

## **RF-CFG-18 - Unicidad del nombre o código de estación** 

**Descripción:** El sistema debe validar que el nombre o código de cada estación de trabajo sea único en el sistema. Si se intenta registrar una estación con un nombre ya existente, el sistema debe informar el conflicto e impedir completar el registro. 

## **RF-CFG-19 - Inactivación de estaciones de trabajo** 

**Descripción:** El sistema debe permitir al administrador inactivar una estación de trabajo. Una estación inactiva no debe poder abrir turnos ni registrar ventas. Si existe un turno activo en la estación al momento de inactivarla, el sistema debe impedir la inactivación e informar que el turno debe cerrarse primero. 

## **RF-CFG-20 - Reactivación de estaciones de trabajo** 

**Descripción:** El sistema debe permitir al administrador reactivar una estación de trabajo inactiva sin requerir ninguna configuración adicional. Al reactivarse, la estación debe quedar disponible para apertura de turno de forma inmediata. 

## **RF-CFG-21 - Asociación de medios de pago por estación** 

**Descripción:** El sistema debe permitir al administrador asociar a cada estación los medios de pago habilitados para esa estación, seleccionando de la lista global de medios de pago configurados. Esta asociación determina qué medios de pago están disponibles en el cobro de ventas para esa estación específica. 

## **RF-CFG-22 - Asociación de impresora por estación** 

**Descripción:** El sistema debe permitir al administrador asociar a cada estación la impresora de tickets configurada para esa estación. Si la estación no tiene impresora asociada, el sistema debe informar al cajero que la impresión automática no está disponible y permitir la impresión manual según RF-POS-63. 

143 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-23 - Auditoría de estaciones de trabajo** 

**Descripción:** El sistema debe registrar en la auditoría el registro, modificación e inactivación de cada estación de trabajo, incluyendo todos los datos afectados, usuario responsable, fecha y hora. 

## **4.11.6 Medios de pago** 

## **RF-CFG-24 - Registro de medios de pago** 

**Descripción:** El sistema debe permitir al administrador registrar los medios de pago disponibles en el sistema con los siguientes campos obligatorios: nombre del medio de pago, código interno, tipo (efectivo, tarjeta débito, tarjeta crédito, transferencia u otro) y estado (activo o inactivo). 

## **RF-CFG-25 - Existencia obligatoria de efectivo activo** 

**Descripción:** El sistema debe garantizar que exista siempre al menos un medio de pago de tipo “efectivo” con estado activo en el sistema. Si el administrador intenta inactivar el único medio de pago de tipo efectivo, el sistema debe impedir la operación e informar el motivo. 

## **RF-CFG-26 - Unicidad del código interno de medio de pago** 

**Descripción:** El sistema debe validar que el código interno de cada medio de pago sea único en el sistema. Si se intenta registrar un medio de pago con un código ya existente, el sistema debe informar el conflicto e impedir completar el registro. 

## **RF-CFG-27 - Configuración del código DIAN del medio de pago** 

**Descripción:** El sistema debe requerir que cada medio de pago tenga configurado su código DIAN correspondiente según la tabla definida en RF-DIAN-32, para garantizar su correcta inclusión en los documentos fiscales. Si el código DIAN no está configurado, el sistema debe impedir activar el medio de pago e informar que el mapeo fiscal es obligatorio. 

## **RF-CFG-28 - Inactivación de medios de pago** 

**Descripción:** El sistema debe permitir al administrador inactivar un medio de pago existente. Un medio de pago inactivo no debe aparecer como opción en la pantalla de cobro de ninguna estación. Las ventas históricas que usaron ese medio de pago 

144 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

deben conservar el registro del mismo sin alteración. 

## **RF-CFG-29 - Auditoría de medios de pago** 

**Descripción:** El sistema debe registrar en la auditoría el registro, modificación e inactivación de cada medio de pago, incluyendo todos los datos afectados, usuario responsable, fecha y hora. 

## **4.11.7 Configuración de impuestos** 

## **RF-CFG-30 - Registro de esquemas de impuesto** 

**Descripción:** El sistema debe permitir al administrador registrar los esquemas de impuesto disponibles para asignar a productos, con los siguientes campos obligatorios: nombre del esquema, tipo de impuesto (IVA u otro tributo aplicable), tarifa porcentual y estado (activo o inactivo). 

## **RF-CFG-31 - Validación de la tarifa porcentual de impuesto** 

**Descripción:** El sistema debe validar que la tarifa porcentual de cada esquema de impuesto sea un valor numérico mayor o igual a cero y menor o igual a 100. Si la validación falla, el sistema debe informar el error e impedir guardar el esquema. 

## **RF-CFG-32 - Esquema activo de exento de IVA o IVA 0 %** 

**Descripción:** El sistema debe garantizar que la lista de esquemas de impuesto incluya siempre al menos un esquema activo de tipo “exento de IVA” o “IVA 0 %“, dado que los medicamentos de uso terapéutico en Colombia pueden estar exentos de este impuesto. Si el administrador intenta inactivar el único esquema de este tipo, el sistema debe impedir la operación e informar el motivo. 

## **RF-CFG-33 - Restricción para modificar tarifas con productos activos** 

**Descripción:** El sistema debe impedir modificar la tarifa porcentual de un esquema de impuesto que tenga productos activos asignados, dado que ese cambio afectaría el cálculo de todas las ventas de esos productos de forma inmediata. En ese caso, el sistema debe informar cuántos productos tienen el esquema asignado y sugerir la creación de un esquema nuevo. 

145 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-34 - Inactivación de esquemas de impuesto sin productos activos** 

**Descripción:** El sistema debe permitir al administrador inactivar un esquema de impuesto únicamente si no tiene productos activos asignados. Si existen productos activos con ese esquema, el sistema debe informar la cantidad e impedir la inactivación. 

## **RF-CFG-35 - Auditoría de esquemas de impuesto** 

**Descripción:** El sistema debe registrar en la auditoría el registro y modificación de cada esquema de impuesto, incluyendo todos los datos afectados, usuario responsable, fecha y hora. 

## **4.11.8 Políticas de descuento** 

## **RF-CFG-36 - Límite de descuento por rol** 

**Descripción:** El sistema debe permitir al administrador configurar de forma independiente para cada rol de usuario (cajero y administrador) el porcentaje máximo de descuento por ítem y el porcentaje máximo de descuento global por venta. Estos parámetros son referenciados por RF-POS-31, RF-POS-32 y RF-POS-33. 

## **RF-CFG-37 - Validación de porcentajes máximos de descuento** 

**Descripción:** El sistema debe validar que el porcentaje máximo de descuento por ítem y el porcentaje máximo de descuento global sean valores numéricos entre 0 y 100 inclusive. Si algún valor está fuera de este rango, el sistema debe informar el error e impedir guardar la configuración. 

## **RF-CFG-38 - Descuento automático por clasificación de cliente** 

**Descripción:** El sistema debe permitir al administrador configurar el porcentaje de descuento automático asociado a cada clasificación de cliente (frecuente e institucional) de forma independiente, referenciado por RF-CLI-41. Un valor de cero en este parámetro indica que no aplica descuento automático para esa clasificación. 

## **RF-CFG-39 - Validación de descuentos automáticos por clasificación** 

**Descripción:** El sistema debe validar que los porcentajes de descuento automático por clasificación de cliente sean valores numéricos entre 0 y 100 inclusive. Si algún valor está fuera de este rango, el sistema debe informar el error e impedir guardar la configuración. 

146 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-40 - Auditoría de políticas de descuento** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de políticas de descuento, incluyendo: parámetro modificado, rol o clasificación afectada, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **4.11.9 Configuración de alertas operativas** 

## **RF-CFG-41 - Umbral de alerta de vencimiento de lotes** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de alerta de vencimiento próximo de lotes, expresado en días, con un valor mínimo de 1 y un máximo de 365. Este parámetro es referenciado por RF-INV-25 y RF-INV-26. 

## **RF-CFG-42 - Umbral de alerta de diferencia de cierre** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de alerta de diferencia máxima de cierre de turno, expresado en valor absoluto de moneda local. Este parámetro es referenciado por RF-CAJA-40. 

## **RF-CFG-43 - Duración máxima de turno antes de alerta** 

**Descripción:** El sistema debe permitir al administrador configurar la duración máxima de un turno antes de emitir alerta, expresada en horas con un valor mínimo de 1 y un máximo de 24. Este parámetro es referenciado por RF-CAJA-42. 

## **RF-CFG-44 - Umbral de documentos restantes en resolución DIAN** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de alerta por cantidad de documentos restantes en una resolución DIAN, con un valor mínimo de 10 y un máximo de 1.000. Este parámetro es referenciado por RF-DIAN-16. 

## **RF-CFG-45 - Umbral de días para alertas de resolución y certificado** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de días de anticipación para la alerta de vencimiento de resolución DIAN y de vencimiento de certificado digital, ambos con un valor mínimo de 7 días y un máximo de 90 días, de forma independiente entre sí. Estos parámetros son referenciados por RF-DIAN-17 y RF-DIAN-38. 

147 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-46 - Auditoría de alertas operativas** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de parámetros de alertas operativas, incluyendo: parámetro modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **4.11.10 Parámetros de seguridad y sesión** 

## **RF-CFG-47 - Política de contraseñas configurable** 

**Descripción:** El sistema debe permitir al administrador configurar la política de contraseñas con los siguientes parámetros individuales: longitud mínima (valor mínimo 6, valor máximo 20), exigencia de mayúsculas (activado o desactivado), exigencia de minúsculas (activado o desactivado), exigencia de dígitos numéricos (activado o desactivado) y exigencia de caracteres especiales (activado o desactivado). Estos parámetros son referenciados por RF-AUTH-05. 

## **RF-CFG-48 - Vigencia de contraseñas** 

**Descripción:** El sistema debe permitir al administrador configurar el período de vigencia de las contraseñas en días, con un valor mínimo de 30 días y un máximo de 365 días, y la opción de desactivar el vencimiento de contraseñas. Cuando el vencimiento esté activo, el sistema debe exigir al usuario que cambie su contraseña al vencer el período, antes de permitirle acceder al sistema. 

## **RF-CFG-49 - Máximo de intentos fallidos de inicio de sesión** 

**Descripción:** El sistema debe permitir al administrador configurar el número máximo de intentos de inicio de sesión fallidos consecutivos antes de bloquear temporalmente al usuario, con un valor mínimo de 3 y un máximo de 10. Este parámetro es referenciado por RF-AUTH-25. 

## **RF-CFG-50 - Duración del bloqueo temporal por intentos fallidos** 

**Descripción:** El sistema debe permitir al administrador configurar la duración del bloqueo temporal por intentos fallidos, expresada en minutos con un valor mínimo de 1 y un máximo de 60. Este parámetro es referenciado por RF-AUTH-25. 

148 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-51 - Período de inactividad para cierre automático de sesión** 

**Descripción:** El sistema debe permitir al administrador configurar el período de inactividad antes del cierre automático de sesión, con un valor mínimo de 1 minuto y un máximo de 60 minutos. Este parámetro es referenciado por RF-AUTH-29 y RF-AUTH-30. 

## **RF-CFG-52 - Restricción de seguridad mínima obligatoria** 

**Descripción:** El sistema debe impedir guardar una configuración de seguridad que resulte menos restrictiva que los requisitos mínimos exigidos por la normativa de protección de datos aplicable al establecimiento. Si la configuración intenta reducir la longitud mínima de contraseñas por debajo de 6 caracteres o el período de vigencia por debajo de 30 días, el sistema debe informar el límite mínimo aceptable e impedir guardar el cambio. 

## **RF-CFG-53 - Auditoría de parámetros de seguridad y sesión** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de parámetros de seguridad y sesión, incluyendo: parámetro modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **4.11.11 Configuración de dispositivos periféricos** 

## **RF-CFG-54 - Registro de impresoras de tickets** 

**Descripción:** El sistema debe permitir al administrador registrar y configurar las impresoras de tickets disponibles en el sistema, con los siguientes datos obligatorios: nombre de la impresora, tipo de conexión (USB, red o Bluetooth), dirección o puerto de conexión, ancho de papel en milímetros y estado (activa o inactiva). 

## **RF-CFG-55 - Prueba de impresión desde la configuración** 

**Descripción:** El sistema debe permitir al administrador ejecutar una prueba de impresión desde la configuración de cada impresora registrada, imprimiendo un ticket de prueba con los datos del establecimiento. El resultado de la prueba (exitoso o con error) debe mostrarse inmediatamente al administrador. 

149 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **RF-CFG-56 - Registro de lectores de código de barras** 

**Descripción:** El sistema debe permitir al administrador registrar y configurar los lectores de código de barras disponibles para cada estación de trabajo, con los siguientes datos: nombre del dispositivo, tipo de conexión y estación a la que está asociado. 

## **RF-CFG-57 - Formato predeterminado del comprobante por estación** 

**Descripción:** El sistema debe permitir al administrador configurar el formato predeterminado del comprobante de venta para cada estación, seleccionando entre los formatos disponibles configurados en el sistema. El formato determina el ancho del ticket, la información incluida y la disposición de los datos en el comprobante impreso. 

## **RF-CFG-58 - Auditoría de dispositivos periféricos** 

**Descripción:** El sistema debe registrar en la auditoría el registro, modificación e inactivación de cada dispositivo periférico, incluyendo todos los datos afectados, usuario responsable, fecha y hora. 

## **4.11.12 Respaldo y restauración** 

## **RF-CFG-59 - Respaldo completo automático de la base de datos** 

**Descripción:** El sistema debe generar automáticamente un respaldo completo de la base de datos central en el horario configurado por el administrador, con una frecuencia mínima de una vez al día. El respaldo debe incluir todos los datos transaccionales, de configuración y de auditoría del sistema. 

## **RF-CFG-60 - Retención de respaldos automáticos** 

**Descripción:** El sistema debe conservar los respaldos automáticos durante el período de retención configurable por el administrador, con un valor mínimo de 7 días y un máximo de 365 días. Los respaldos más antiguos que el período de retención deben eliminarse automáticamente. 

## **RF-CFG-61 - Respaldo manual bajo demanda** 

**Descripción:** El sistema debe permitir al administrador generar un respaldo manual del sistema en cualquier momento desde el panel de configuración, con la opción de 

150 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

descargar el archivo de respaldo o almacenarlo en la ubicación configurada. 

## **RF-CFG-62 - Información de estado de respaldos en el panel** 

**Descripción:** El sistema debe mostrar al administrador en el panel de configuración la fecha y hora del último respaldo automático exitoso, la fecha y hora del próximo respaldo programado, y el número de respaldos disponibles dentro del período de retención configurado. 

## **RF-CFG-63 - Alerta por fallo en respaldo automático** 

**Descripción:** El sistema debe emitir una alerta al administrador cuando el proceso de respaldo automático falle por cualquier causa, indicando la causa del fallo y el número de días consecutivos sin respaldo exitoso. 

## **RF-CFG-64 - Restauración desde respaldo** 

**Descripción:** El sistema debe permitir al administrador restaurar el sistema desde un respaldo disponible, exigiendo confirmación explícita antes de iniciar el proceso de restauración y advirtiendo que la operación reemplazará todos los datos actuales con los datos del respaldo seleccionado. 

## **RF-CFG-65 - Restricción de restauración con turnos activos** 

**Descripción:** El sistema debe impedir que el proceso de restauración sea iniciado si existe al menos un turno de caja con estado activo en cualquier estación de trabajo, dado que la restauración interrumpiría operaciones en curso. El sistema debe informar cuántos turnos activos existen e impedir continuar hasta que sean cerrados. 

## **RF-CFG-66 - Auditoría de respaldos y restauraciones** 

**Descripción:** El sistema debe registrar en la auditoría cada respaldo generado (automático o manual) y cada restauración ejecutada, incluyendo: tipo de operación, fecha y hora de ejecución, resultado (exitoso o fallido), causa del fallo si aplica y usuario responsable para las operaciones manuales. 

151 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.11.13 Configuración del log de auditoría** 

## **RF-CFG-67 - Retención del log de auditoría** 

**Descripción:** El sistema debe conservar el log de auditoría general del sistema durante un período mínimo de 5 años contados desde la fecha de cada registro, en cumplimiento con la normativa tributaria y de protección de datos aplicable en Colombia. 

## **RF-CFG-68 - Restricción sobre el log de auditoría** 

**Descripción:** El sistema debe impedir la eliminación, modificación o exportación selectiva de registros individuales del log de auditoría. El log de auditoría solo puede ser consultado y exportado en su totalidad o por período, nunca modificado. 

## **RF-CFG-69 - Umbral de alerta por volumen del log** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de alerta de volumen del log de auditoría, expresado en porcentaje del espacio de almacenamiento asignado, con un valor predeterminado del 80 

## **RF-CFG-70 - Exportación del log de auditoría en CSV** 

**Descripción:** El sistema debe permitir al administrador exportar el log de auditoría por período en formato CSV para su archivado externo. La exportación no debe eliminar los registros del log interno del sistema. 

## **RF-CFG-71 - Auditoría de exportaciones del log de auditoría** 

**Descripción:** El sistema debe registrar en la auditoría cada exportación del log de auditoría, incluyendo: usuario, período exportado, fecha y hora de la exportación y formato del archivo generado. 

152 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **4.11.14 Parámetros de sincronización y offline** 

## **RF-CFG-72 - Configuración de parámetros de sincronización** 

**Descripción:** El sistema debe permitir al administrador configurar desde el panel de configuración general todos los parámetros del Módulo 8 de Sincronización definidos en RF-SYNC-67, aplicando las validaciones de coherencia definidas en RF-SYNC-69. 

## **RF-CFG-73 - Umbral de operación offline para contingencia fiscal** 

**Descripción:** El sistema debe permitir al administrador configurar el umbral de duración de operación offline a partir del cual el sistema activa automáticamente el modo de contingencia fiscal, con un valor mínimo de 1 hora y un máximo de 8 horas. Este parámetro es referenciado por RF-DIAN-51. 

## **RF-CFG-74 - Auditoría de parámetros de sincronización y offline** 

**Descripción:** El sistema debe registrar en la auditoría cada modificación de parámetros de sincronización y offline, incluyendo: parámetro modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **4.11.15 Historial de cambios de configuración** 

## **RF-CFG-75 - Historial inmutable de cambios de configuración** 

**Descripción:** El sistema debe mantener un historial completo e inmutable de todos los cambios de configuración realizados en el sistema, accesible únicamente para el administrador, que muestre para cada cambio: sección de configuración afectada, parámetro modificado, valor anterior, valor nuevo, usuario responsable, fecha y hora. 

## **RF-CFG-76 - Consulta y exportación del historial de configuración** 

**Descripción:** El sistema debe permitir al administrador consultar el historial de cambios de configuración filtrando por sección de configuración, usuario responsable y rango de fechas, y exportarlo en formato CSV para auditoría externa o revisión periódica. 

153 

## **Capítulo 5** 

## **Requisitos no funcionales** 

## **5.1 Requisitos No Funcionales de Seguridad y Control** 

Esta sección detalla las restricciones, cualidades y salvaguardas técnicas que gobiernan el sistema para garantizar la confidencialidad, integridad, disponibilidad y auditabilidad de la información transaccional y los datos personales bajo el marco legal colombiano. 

## **Requisito No Funcional: RNF-SC-01: Control de acceso por roles** 

El sistema debe permitir el acceso a cada funcionalidad únicamente a los usuarios cuyo rol esté autorizado para ejecutarla, impidiendo el acceso a opciones o módulos no permitidos para su perfil. 

## **Requisito No Funcional: RNF-SC-02: Reautenticación para operaciones críticas** 

El sistema debe solicitar reautenticación al usuario antes de ejecutar operaciones críticas relacionadas con configuración, seguridad o información sensible. 

## **Requisito No Funcional: RNF-SC-03: Bloqueo por intentos fallidos** 

El sistema debe bloquear temporalmente el acceso de un usuario después de un número configurable de intentos fallidos de inicio de sesión consecutivos, de acuerdo con la política de seguridad definida. 

## **Requisito No Funcional: RNF-SC-04: Política mínima de contraseñas** 

El sistema debe exigir que las contraseñas cumplan con una política mínima de complejidad definida por el administrador, incluyendo longitud mínima, uso de 

154 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

mayúsculas, minúsculas, dígitos y caracteres especiales, según corresponda. 

## **Requisito No Funcional: RNF-SC-05: Vigencia de contraseñas** 

El sistema debe exigir el cambio de contraseña cuando esta haya superado el período de vigencia configurado por la política de seguridad. 

## **Requisito No Funcional: RNF-SC-06: Cierre automático de sesión** 

El sistema debe cerrar automáticamente la sesión de un usuario después de un período de inactividad configurado por el administrador. 

## **Requisito No Funcional: RNF-SC-07: Protección de información sensible** 

El sistema debe proteger la información sensible de clientes, usuarios y parámetros de seguridad mediante mecanismos de control de acceso y almacenamiento seguro, evitando su exposición a usuarios no autorizados. 

## **Requisito No Funcional: RNF-SC-08: Integridad de la configuración** 

El sistema debe impedir que se guarden configuraciones que debiliten la política mínima de seguridad establecida para el sistema. 

## **Requisito No Funcional: RNF-SC-09: Auditoría de acciones críticas** 

El sistema debe registrar en el log de auditoría toda acción de acceso, modificación, eliminación, exportación o intento fallido sobre información sensible o configuración crítica. 

## **Requisito No Funcional: RNF-SC-10: Auditoría inalterable** 

El sistema debe impedir la modificación o eliminación de registros individuales del log de auditoría, garantizando su integridad e inmutabilidad. 

## **Requisito No Funcional: RNF-SC-11: Trazabilidad del usuario responsable** 

El sistema debe conservar la identificación del usuario responsable en todo evento de seguridad, acceso, cambio de configuración o acción administrativa registrada. 

## **Requisito No Funcional: RNF-SC-12: Respaldo de información crítica** 

El sistema debe generar respaldos automáticos de la información crítica del sistema con una periodicidad mínima diaria, asegurando la recuperación ante pérdida de 

155 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

datos o fallos del sistema. 

## **Requisito No Funcional: RNF-SC-13: Restauración controlada** 

El sistema debe permitir la restauración de respaldos únicamente a usuarios autorizados y bajo confirmación explícita, evitando restauraciones accidentales o no permitidas. 

## **Requisito No Funcional: RNF-SC-14: Restricción de exportaciones sensibles** 

El sistema debe restringir la exportación de información sensible únicamente a usuarios autorizados y registrar toda exportación realizada. 

## **Requisito No Funcional: RNF-SC-15: Conservación de registros de seguridad** 

El sistema debe conservar los registros de seguridad y auditoría durante el período mínimo definido por la normativa aplicable y por la política interna del establecimiento. 

## **Requisito No Funcional: RNF-SC-16: Consistencia de permisos** 

El sistema debe aplicar de forma consistente los permisos de acceso en todas las interfaces y módulos, sin permitir bypass por rutas alternativas, dispositivos distintos o cambios de estación de trabajo. 

## **5.2 Requisitos No Funcionales de Rendimiento** 

Esta sección define las restricciones de tiempo, capacidad y eficiencia computacional que debe cumplir el sistema para garantizar una experiencia fluida y evitar retrasos en el flujo diario de la droguería. 

## **Requisito No Funcional: RNF-REN-01: Tiempo de respuesta en operaciones frecuentes** 

El sistema debe responder a las operaciones frecuentes de consulta y navegación en un tiempo adecuado para el uso operativo, evitando demoras que interrumpan el trabajo del usuario. 

156 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **Requisito No Funcional: RNF-REN-02: Generación de reportes en tiempo aceptable** 

El sistema debe generar los reportes de consulta habitual dentro de un tiempo razonable para la operación diaria, de modo que el usuario pueda continuar su trabajo sin bloqueos prolongados. 

## **Requisito No Funcional: RNF-REN-03: Fluidez en el punto de venta** 

El sistema debe mantener un comportamiento fluido en la pantalla de venta, permitiendo registrar productos, calcular totales y confirmar cobros sin retrasos perceptibles en condiciones normales de operación. 

## **Requisito No Funcional: RNF-REN-04: Concurrencia controlada** 

El sistema debe mantener un desempeño estable cuando varias estaciones trabajen de forma simultánea, sin degradación significativa de la respuesta ni pérdida de operaciones. 

## **Requisito No Funcional: RNF-REN-05: Procesamiento asíncrono de procesos pesados** 

El sistema debe ejecutar en segundo plano los procesos de mayor carga computacional o documental, de forma que no afecten la operación interactiva del usuario. 

## **5.3 Requisitos No Funcionales de Disponibilidad y Continuidad** 

Esta sección establece los criterios de tolerancia a fallos y resiliencia de la plataforma, asegurando el funcionamiento continuo del establecimiento bajo contingencias de red. 

## **Requisito No Funcional: RNF-DIS-01: Disponibilidad operativa del sistema** 

El sistema debe permanecer disponible durante la jornada de operación del establecimiento, permitiendo el uso continuo de sus funciones críticas. 

157 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **Requisito No Funcional: RNF-DIS-02: Operación sin interrupción por fallos de red** 

El sistema debe continuar operando en las funciones críticas locales aun cuando exista pérdida temporal de conectividad con servicios externos o con el servidor central, siempre que la arquitectura del módulo lo permita. 

## **Requisito No Funcional: RNF-DIS-03: Recuperación automática ante reconexión** 

El sistema debe recuperar de forma automática la sincronización y el flujo normal de operación una vez restablecida la conectividad, sin exigir intervención manual innecesaria. 

## **Requisito No Funcional: RNF-DIS-04: Continuidad frente a fallas parciales** 

El sistema debe aislar las fallas de componentes no esenciales para evitar que una interrupción localizada comprometa el funcionamiento general del establecimiento. 

## **Requisito No Funcional: RNF-DIS-05: Respaldo y restauración como soporte de continuidad** 

El sistema debe contar con mecanismos de respaldo y restauración que permitan recuperar la operación en caso de pérdida de datos o fallo grave de la infraestructura. 

## **5.4 Requisitos No Funcionales de Integridad y Trazabilidad** 

Esta sección abarca las directrices técnicas dirigidas a salvaguardar la exactitud, consistencia, inmutabilidad y el historial histórico inalterable de los registros del negocio. 

## **Requisito No Funcional: RNF-INT-01: Integridad de los datos transaccionales** 

El sistema debe conservar la integridad de los datos generados por ventas, compras, inventario, caja y facturación electrónica, evitando alteraciones no autorizadas o inconsistencias entre módulos. 

## **Requisito No Funcional: RNF-INT-02: Inmutabilidad de los registros históricos** 

El sistema debe impedir la modificación directa de registros históricos ya confirmados, garantizando que toda corrección se realice mediante los procesos definidos para tal 

158 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

fin. 

## **Requisito No Funcional: RNF-INT-03: Trazabilidad completa de operaciones** 

El sistema debe permitir rastrear cada operación relevante desde su origen hasta su efecto final en el sistema, incluyendo usuario, fecha, hora, estación y módulo involucrado. 

## **Requisito No Funcional: RNF-INT-04: Consistencia entre módulos** 

El sistema debe mantener consistencia entre la información registrada en los módulos transaccionales, los reportes y los documentos fiscales generados. 

## **Requisito No Funcional: RNF-INT-05: Registro de eventos relevantes** 

El sistema debe registrar los eventos relevantes del ciclo operativo de manera que sea posible reconstruir el historial de una transacción, ajuste, anulación, devolución o cambio de estado. 

## **Requisito No Funcional: RNF-INT-06: Exactitud de los totales mostrados** 

El sistema debe asegurar que los totales presentados en pantallas, reportes y documentos exportados correspondan a los valores calculados a partir de los registros fuente del sistema. 

## **Requisito No Funcional: RNF-INT-07: Conservación de referencias cruzadas** 

El sistema debe conservar las relaciones entre documentos, movimientos y entidades asociadas para permitir la verificación posterior de cada operación. 

## **5.5 Requisitos No Funcionales de Respaldo y Recuperación** 

Esta sección establece las directrices técnicas para la salvaguarda de la base de datos y la continuidad del negocio ante fallos de hardware o pérdida de información catastrófica. 

## **Requisito No Funcional: RNF-BR-01: Respaldo automático periódico** 

El sistema debe generar copias de respaldo automáticas de la información crítica con una periodicidad definida por la configuración del sistema, asegurando la posibilidad de recuperación ante fallos o pérdida de datos. 

159 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **Requisito No Funcional: RNF-BR-02: Respaldo manual bajo demanda** 

El sistema debe permitir la generación manual de respaldos completos cuando el administrador lo requiera, sin afectar la operación normal del sistema. 

## **Requisito No Funcional: RNF-BR-03: Conservación de respaldos** 

El sistema debe conservar los respaldos durante un período suficiente para permitir la recuperación de información histórica, de acuerdo con la política interna y la normativa aplicable. 

## **Requisito No Funcional: RNF-BR-04: Restauración controlada de información** 

El sistema debe permitir la restauración de respaldos únicamente bajo autorización y confirmación explícita del usuario responsable, evitando restauraciones accidentales. 

## **Requisito No Funcional: RNF-BR-05: Prevención de restauración en operación activa** 

El sistema debe impedir el inicio de una restauración cuando existan operaciones activas que puedan verse interrumpidas por el proceso. 

## **Requisito No Funcional: RNF-BR-06: Notificación de fallos de respaldo** 

El sistema debe informar oportunamente al administrador cuando falle un proceso de respaldo automático, indicando que se requiere revisión o intervención. 

## **Requisito No Funcional: RNF-BR-07: Recuperación de la operación** 

El sistema debe permitir recuperar el funcionamiento normal del entorno a partir de un respaldo válido, reduciendo al mínimo la pérdida de información. 

## **5.6 Requisitos No Funcionales de Compatibilidad Técnica** 

Esta sección define los criterios de acoplamiento, interoperabilidad y consistencia que debe mantener el sistema frente al hardware, software y periféricos homologados. 

160 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **Requisito No Funcional: RNF-CT-01: Compatibilidad con el entorno operativo definido** 

El sistema debe ejecutarse correctamente en el entorno tecnológico definido para el proyecto, sin requerir software no contemplado en la arquitectura aprobada. 

## **Requisito No Funcional: RNF-CT-02: Compatibilidad entre módulos** 

El sistema debe garantizar interoperabilidad entre sus módulos internos, manteniendo compatibilidad de datos, formatos y estructuras compartidas. 

## **Requisito No Funcional: RNF-CT-03: Compatibilidad con dispositivos periféricos** 

El sistema debe funcionar con los dispositivos periféricos definidos para su operación, incluyendo impresoras de tickets, lectores de código de barras y demás equipos configurados. 

## **Requisito No Funcional: RNF-CT-04: Compatibilidad con exportaciones estándar** 

El sistema debe generar exportaciones en formatos ampliamente compatibles con herramientas de oficina y contabilidad, de manera que puedan ser consultadas fuera del sistema sin conversiones adicionales. 

## **Requisito No Funcional: RNF-CT-05: Compatibilidad con mecanismos fiscales definidos** 

El sistema debe mantener compatibilidad con los mecanismos técnicos requeridos para la generación y transmisión de documentos fiscales según la arquitectura definida para el proyecto. 

## **Requisito No Funcional: RNF-CT-06: Compatibilidad con navegadores y estaciones autorizadas** 

El sistema debe operar correctamente en los navegadores y estaciones de trabajo autorizados para cada componente, sin presentar diferencias funcionales relevantes entre entornos equivalentes. 

## **Requisito No Funcional: RNF-CT-07: Compatibilidad evolutiva** 

El sistema debe permitir la actualización de componentes técnicos sin romper la compatibilidad de los datos ni de las interfaces internas definidas en la arquitectura. 

161 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **5.7 Requisitos No Funcionales de Usabilidad y Operación** 

Esta sección establece los criterios de diseño de interfaz, experiencia de usuario y flujos operativos orientados a minimizar el error humano, garantizar una curva de aprendizaje reducida y agilizar la atención en el mostrador. 

## **Requisito No Funcional: RNF-UO-01: Facilidad de aprendizaje** 

El sistema debe presentar una interfaz comprensible y consistente que permita a un usuario nuevo aprender las operaciones básicas sin necesidad de entrenamiento técnico avanzado. 

## **Requisito No Funcional: RNF-UO-02: Consistencia de interfaz** 

El sistema debe mantener criterios uniformes de navegación, nombres, mensajes, botones y flujos de interacción en todos sus módulos, para reducir errores de operación y facilitar el uso cotidiano. 

## **Requisito No Funcional: RNF-UO-03: Claridad de mensajes al usuario** 

El sistema debe mostrar mensajes de confirmación, advertencia y error en lenguaje claro, indicando la causa del problema cuando sea posible y evitando mensajes ambiguos o puramente técnicos. 

## **Requisito No Funcional: RNF-UO-04: Minimización de errores operativos** 

El sistema debe diseñarse de forma que reduzca la probabilidad de errores de captura, selección o confirmación por parte del usuario durante la operación normal. 

## **Requisito No Funcional: RNF-UO-05: Soporte a la operación continua** 

El sistema debe permitir que las tareas operativas frecuentes puedan ejecutarse con una cantidad reducida de pasos, favoreciendo la rapidez de atención en el punto de venta y en la gestión administrativa. 

## **Requisito No Funcional: RNF-UO-06: Accesibilidad operativa básica** 

El sistema debe garantizar que los elementos principales de interacción sean legibles, distinguibles y utilizables en condiciones normales de operación del establecimiento. 

162 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **Requisito No Funcional: RNF-UO-07: Retroalimentación inmediata** 

El sistema debe informar al usuario de manera visible cuando una operación haya sido aceptada, rechazada, puesta en espera o enviada a procesamiento posterior. 

## **5.8 Requisitos No Funcionales de Mantenibilidad y Soporte** 

Esta sección define las directrices de arquitectura y diseño de software orientadas a mitigar el impacto de los cambios técnicos, agilizar el diagnóstico de fallos en producción y facilitar la evolución del sistema. 

## **Requisito No Funcional: RNF-MS-01: Modularidad técnica** 

El sistema debe estar estructurado en componentes desacoplados que permitan modificar, corregir o ampliar un módulo sin obligar a rediseñar el sistema completo. 

## **Requisito No Funcional: RNF-MS-02: Facilidad de actualización** 

El sistema debe permitir la aplicación controlada de cambios correctivos, evolutivos o normativos sin afectar de forma innecesaria la operación de módulos no relacionados. 

## **Requisito No Funcional: RNF-MS-03: Trazabilidad de cambios técnicos** 

El sistema debe permitir identificar qué componente, configuración o dependencia fue modificada en cada cambio relevante del software, para facilitar soporte, revisión y diagnóstico. 

## **Requisito No Funcional: RNF-MS-04: Diagnóstico de fallos** 

El sistema debe generar registros técnicos suficientes para facilitar la identificación de errores, incidencias de sincronización, fallos de integración y eventos anómalos durante la operación. 

## **Requisito No Funcional: RNF-MS-05: Mantenibilidad de reglas de negocio** 

El sistema debe permitir ajustar parámetros, catálogos, configuraciones fiscales y políticas operativas sin requerir cambios directos en el código fuente para cada modificación menor. 

163 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **Requisito No Funcional: RNF-MS-06: Aislamiento de cambios normativos** 

El sistema debe diseñarse de forma que los cambios normativos, especialmente los relacionados con facturación electrónica y documentos fiscales, puedan implementarse con el menor impacto posible sobre los demás módulos. 

## **Requisito No Funcional: RNF-MS-07: Soporte para evolución controlada** 

El sistema debe permitir la incorporación futura de nuevas capacidades funcionales sin comprometer la estabilidad de los procesos ya implementados. 

## **5.9 Requisitos No Funcionales de Cumplimiento Normativo Conservación y** 

Esta sección formaliza las restricciones legales y regulatorias que el software debe forzar a nivel de base de datos e infraestructura para asegurar la validez jurídica de la operación en Colombia. 

## **Requisito No Funcional: RNF-CN-01: Cumplimiento regulatorio aplicable** 

El sistema debe operar de conformidad con la normativa tributaria, sanitaria y de protección de datos aplicable al contexto de una droguería en Colombia, en todo lo que afecte su funcionamiento y la gestión de información. 

## **Requisito No Funcional: RNF-CN-02: Conservación de documentos y registros** 

El sistema debe conservar durante el tiempo exigido por la normativa aplicable los documentos, registros de auditoría, comprobantes y evidencias electrónicas generadas por la operación. 

## **Requisito No Funcional: RNF-CN-03: Protección de datos personales** 

El sistema debe tratar los datos personales de clientes, usuarios y terceros conforme a las restricciones de acceso, confidencialidad y conservación definidas por la regulación aplicable. 

## **Requisito No Funcional: RNF-CN-04: Evidencia verificable para auditoría** 

El sistema debe mantener evidencia suficiente y verificable de sus operaciones críticas para permitir procesos de auditoría interna, revisión contable y verificación 

164 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

regulatoria. 

## **Requisito No Funcional: RNF-CN-05: No alteración retroactiva de información regulada** 

El sistema debe impedir la modificación retroactiva de documentos, datos o configuraciones cuando ello comprometa la validez histórica, fiscal o auditiva de la operación registrada. 

## **Requisito No Funcional: RNF-CN-06: Exportación para revisión externa** 

El sistema debe permitir exportar la información requerida para revisión contable, fiscal o administrativa en formatos utilizables fuera del sistema sin perder consistencia ni trazabilidad. 

165 

## **Capítulo 6** 

## **Arquitectura de código del sistema** 

Con la información técnica del documento de requisitos, disponemos de los elementos suficientes para diseñar la arquitectura de código de forma coherente con las tres capas definidas. La solución propuesta consiste en un monorepo gestionado con Turborepo que separa los siguientes componentes: 

- Servidor central en `NestJS` . 

- POS de escritorio en `Tauri` . 

- Backoffice en `React/Vite` . 

- Motor fiscal en `Node.js` . 

Todos ellos comparten tipos TypeScript a través de paquetes internos, garantizando la consistencia y la trazabilidad entre módulos. 

## **6.1 Estructura del general monorepo** 

El proyecto se organiza como un monorepo gestionado con `Turborepo` , con una carpeta `apps/` para las aplicaciones desplegables y una carpeta `packages/` para el código compartido. Esta decisión no es solo de conveniencia, sino que responde a los requisitos RNF-CT-02 (compatibilidad entre módulos) y RNF-MS-01 (modularidad técnica), que exigen componentes desacoplados pero con compatibilidad de tipos y estructuras. 

|1|`drogueria -system/`|`drogueria -system/`|||
|---|---|---|---|---|
|2|`+-- `|`apps/`|||
|3|`|`|`+-- server/`|`# NestJS + Prisma + PostgreSQL (fuente de`||
|||`verdad)`|||
|4|`|`|`+-- backoffice/`|`# React + Vite + TanStack`|`Table + Recharts`|



166 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

5 `| +-- pos -desktop/ # Tauri 2 + Rust + React + SQLite/SQLCipher` 6 `| +-- fiscal -engine/ # Node.js + BullMQ + firmador XAdES -BES` 7 `+-- packages/` 8 `| +-- shared -types/ # Entidades TypeScript compartidas (Producto , Venta , DocumentoFiscal ...)` 9 `| +-- shared -validation/ # Esquemas Zod reutilizables entre POS , backoffice y server` 10 `| +-- ui -kit/ # Componentes React compartidos (backoffice + pos -desktop)` 11 `| +-- config/ # ESLint , TSConfig , Tailwind base compartidos` 12 `+-- turbo.json` 13 `+-- package.json` 14 `+-- pnpm -workspace.yaml` 

Listing 6.1: Estructura del monorepo 

El paquete `packages/shared-types` garantiza que las entidades _producto_ , _cliente_ , _venta_ y _documento fiscal_ se definan una sola vez y viajen sin duplicación entre el POS, el backoffice y el servidor, tal como se describe en la sección de infraestructura compartida del documento de requisitos. 

## **6.2 Aplicaciones** 

## **6.2.1 apps/server (NestJS + Prisma)** 

Dado que el servidor es la fuente de verdad y cuenta con 11 módulos funcionales que agrupan 741 requisitos, se opta por una estructura por módulos de dominio siguiendo la convención modular nativa de `NestJS` , en lugar de una división por capas técnicas transversales. Cada módulo funcional del documento se traduce en un módulo `NestJS` independiente, lo que satisface directamente los requisitos RNF-MS-01 (modularidad técnica) y RNF-MS-06 (aislamiento de cambios normativos). 

1 2 3 4 5 6 7 8 9 10 11 

|`apps/server/src/`|`apps/server/src/`|||||
|---|---|---|---|---|---|
|`+-- `|`modules/`|||||
|`|`|`+-- auth/`|`# controller , service , guards , strategies`||||
|`|`|`+-- caja -turnos/`|||||
|`|`|`+-- catalogo/`|||||
|`|`|`+-- inventario -lotes/`|||||
|`|`|`+-- compras/`|||||
|`|`|`+-- ventas -pos/`|||||
|`|`|`+-- clientes/`|||||
|`|`|`+-- sincronizacion /`|`# endpoints de recepcion de cola`||`offline`||
|`|`|`+-- facturacion -dian/`|`# publica`|`eventos a BullMQ , no firma`||`aqui`|



167 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

|12|`|`|`+-- reportes/`||||
|---|---|---|---|---|---|
|13|`|`|`+-- configuracion/`||||
|14|`+-- `|`common/`||||
|15|`|`|`+-- decorators/`|`# @Roles (), @Auditable ()`|||
|16|`|`|`+-- guards/`|`# RolesGuard , `|`JwtAuthGuard`||
|17|`|`|`+-- interceptors/`|`# AuditLogInterceptor `||`(inmutable , RNF -INT`|
|||`-02)`||||
|18|`|`|`+-- filters/`|`# excepciones`|`normalizadas`||
|19|`|`|`+-- pipes/`||||
|20|`+-- `|`infrastructure /`||||
|21|`|`|`+-- prisma/`|`# PrismaService , migraciones`|||
|22|`|`|`+-- queue/`|`# productores`|`BullMQ`|`hacia fiscal -engine`|
|23|`|`|`+-- storage/`|`# repositorio`|`XML (5 `|`anos , RF -DIAN -70)`|
|24|`+-- `|`main.ts`||||



Listing 6.2: Estructura del servidor 

Cada módulo interno (por ejemplo, `catalogo/` ) debe seguir el patrón `controller.ts` , `service.ts` , `module.ts` , `dto/` , `entities/` y `repository.ts` si se decide desacoplar el acceso a datos del servicio. El `AuditLogInterceptor` a nivel de `common/` es clave, ya que prácticamente cada requisito funcional exige registrar auditoría inmutable, y este enfoque transversal evita duplicar esa lógica en los 741 requisitos. 

## **6.2.2 apps/pos-desktop (Tauri + Rust + React)** 

La arquitectura refleja la naturaleza _local-first_ : existe una capa `Rust` que gestiona persistencia, cola de sincronización e integridad de datos, y una capa `React/TypeScript` para la interfaz. La separación es más estricta que en una aplicación web convencional, porque el backend en `Rust` se ejecuta en el mismo binario, pero debe tratarse como un servicio independiente. 

1 

2 3 4 5 6 7 8 9 10 11 12 

|`apps/pos`|`apps/pos`|`-desktop/`|||||||||
|---|---|---|---|---|---|---|---|---|---|---|
|`+-- `|`src -tauri/`||`# `|`Rust`|||||||
|`|`|`+-- `|`src/`|||||||||
|`|`|`|`|`+-- db/`|`# `|`SQLite + `||`SQLCipher , `|`migraciones`|||`locales`|
|`|`|`|`|`+-- sync/`|`# `|`cola`|`persistente , UUID`|||`idempotencia ,`|||
||`backoff`<br>`exponencial`||||||||||
|`|`|`|`|`+-- commands/`|`# `|`comandos`||`invocables`|`desde`||`React `|`(Tauri`|
||`commands)`||||||||||
|`|`|`|`|`+-- main.rs`|||||||||
|`|`|`+-- `|`Cargo.toml`|||||||||
|`+-- `|`src/`||`# React + `|||`TypeScript`|||||
|`|`|`+-- `|`features/`|||||||||
|`|`|`|`|`+-- pos -venta/`|`# `|`carrito , `||`búsqueda , `|`cobro`||||
|`|`|`|`|`+-- caja -turno/`|||||||||



168 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

**==> picture [475 x 97] intentionally omitted <==**

**----- Start of picture text -----**<br>
13 | | +-- inventario - local /<br>14 | | +-- sync -status/ # bandeja de sincronización visible al<br>cajero<br>15 | +-- store/ # Zustand slices por feature<br>16 | +-- hooks/<br>17 | +-- components/<br>18 +-- package.json<br>**----- End of picture text -----**<br>


Listing 6.3: Estructura del POS de escritorio 

La carpeta `sync/` en `Rust` es la pieza más delicada de todo el sistema, ya que implementa el Módulo 8 completo (cola con UUID, reintentos exponenciales, reconciliación). Por ello, conviene aislarla como un submódulo `Rust` con pruebas unitarias dedicadas, en línea con el requisito RNF-DIS-03 de recuperación automática tras reconexión. 

## **6.2.3 apps/backoffice** 

El backoffice, al no tener persistencia local, presenta una estructura más sencilla: organización por características con `React Query` (o similar) contra la API REST del servidor, `TanStack Table` para listados administrativos y `Recharts` para el panel de indicadores. 

**==> picture [475 x 165] intentionally omitted <==**

**----- Start of picture text -----**<br>
1 apps/backoffice/<br>2 +-- src/<br>3 | +-- features/<br>4 | | +-- dashboard/<br>5 | | +-- productos/<br>6 | | +-- ventas/<br>7 | | +-- clientes/<br>8 | | +-- reportes/<br>9 | +-- api/ # clientes API (React Query)<br>10 | +-- components/ # componentes reutilizables<br>11 | +-- main.tsx<br>12 +-- package.json<br>**----- End of picture text -----**<br>


Listing 6.4: Estructura del backoffice (esquema orientativo) 

## **6.2.4 apps/fiscal-engine** 

El motor fiscal se organiza alrededor del pipeline documental descrito en el Módulo 9: generación XML, firma XAdES-BES, transmisión y gestión de estados. Cada una de estas etapas se implementa como un worker `BullMQ` independiente, de modo que una actualización del Anexo Técnico de la DIAN solo afecte al paso de generación sin alterar la 

169 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

firma o la transmisión, lo que constituye el argumento de desacoplamiento que subyace en el propio documento. 

1 2 3 4 5 

6 7 8 9 

10 

```
apps/fiscal -engine/src/
+--workers/
|+--generate -xml.worker.ts#UBL2.1segúnAnexoTécnico1.9
|+--sign -document.worker.ts#XAdES -BES
|+--transmit.worker.ts#clienteAPIdelproveedortecnológico
|+--status -poller.worker.ts#consultaasíncronadeestados
+--domain/
|+--cufe -cude.ts#cálculoSHA -384
|+--contingencia.ts
+--queue/consumers.ts
```

Listing 6.5: Estructura del motor fiscal 

170 

## **Capítulo 7** 

## **Modelo de datos** 

171 

Sistema Integral de Gestión para Droguería 

v0.1.0 — Borrador 

## **7.1 Modelo Entidad-Relación** 

172 

Figura 7.1: Modelo ER 

