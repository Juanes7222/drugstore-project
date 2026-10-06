# Propuesta de agente autónomo de IA: Agente de Administración

**Proyecto:** PharmaSync — Sistema Integral de Gestión para Droguería
**Materia:** Emprendimiento
**Tipo de entrega:** Propuesta técnica de valor agregado
**Estado:** Sustituye a la propuesta anterior de "El Consejero" (búsqueda de discrepancias)

---

## Resumen ejecutivo

PharmaSync es, por diseño, un sistema de **workflows**: 741 requisitos funcionales en 11
módulos, seis reportes calculados, catorce alertas deterministas y un punto de venta que
debe seguir cobrando aunque se caiga internet. Ese 95% del sistema es correcto y no debe
tocarse con inteligencia artificial.

Este documento propone **un agente de administración**: un rol especializado que audita
precios, audita ventas y proyecta el futuro del negocio, y cuya única aporte es
**decidir qué auditar**. La Contribution no es el cálculo —ese ya existe y es un
`SUM`— sino la elección de la pregunta.

La tesis se sostiene en una frase:

> **El dueño de una droguería sabe tomar decisiones. Lo que no tiene es treinta horas al
> mes para cruzarlas, y ni idea de cuál de ellas es la que le está costando dinero.**

El sistema ya captura lo necesario: cada venta guarda el costo del producto en el
momento en que se cobró (`SaleItem.unitCost`), y cada recepción registra lo que el
proveedor realmente cobró frente a lo esperado (`realUnitCost` frente a
`expectedUnitCost`). **El dato existe. Nadie lo convierte en una decisión.**

De ahí la segunda pregunta, que es la que no tiene fórmula y que es el verdadero valor
del agente:

| Pregunta | Quién la responde |
|---|---|
| ¿Cuánto gané? | Un workflow. Es una suma. Ya existe |
| **¿Qué ni siquiera estoy mirando?** | **El agente. No hay fórmula** |

---

## 1. Marco conceptual

### 1.1 Qué es un agente de IA

Un agente es un sistema capaz de alcanzar un objetivo **sin que le prescriban el camino
completo**. Se apoya en cuatro capacidades:

- **Percepción:** recibe información estructurada y no estructurada del entorno.
- **Razonamiento y decisión:** elige la siguiente acción; aquí se diferencia de un
  modelo predictivo, que solo estima, y de un flujo, que ya sabe qué hace.
- **Herramientas:** ejecuta acciones sobre sistemas externos que amplían lo que el
  modelo puede hacer por sí solo.
- **Autonomía:** itera. Al terminar una tarea evalúa si alcanzó el objetivo, y si no,
  crea tareas nuevas y vuelve a intentarlo.

### 1.2 El bucle del agente

```
Pedir herramienta → Ejecutar → Observar el resultado real → Decidir → (repetir con límite de pasos)
```

Si el sistema **no decide**, es un flujo. Si decide, es agéntico.

### 1.3 Las tres decisiones de diseño

| Decisión | Qué significa | Por qué es obligatoria |
|---|---|---|
| **Entorno** | Qué es lo que el agente ve | Sin un entorno declarado, el modelo improvisa sobre datos que nadie eligió darle |
| **Herramientas** | A través de qué puede actuar | Es lo que le permite salir de la conversación y afectar el mundo real |
| **Verificación** | Cómo sabe que va avanzando | Sin verificación no hay progreso verificable, solo texto plausible |

Todo lo demás es optimización.

---

## 2. El filtro: cuándo **no** usar un agente

Este es el punto que sostiene la propuesta y lo que la hace defendible ante una revisión
técnica seria.

El criterio es: **si puedes fijar el camino por adelantado, ganas un workflow.** Un
agente solo se justifica cuando el camino depende de lo que se observa en cada paso,
pero el progreso todavía se puede verificar.

### 2.1 La prueba binaria

Para cada tarea candidata, una sola pregunta:

> **Antes de observar nada, ¿puedo nombrar la siguiente herramienta que se va a llamar?**

- **Sí** → es un workflow. Gana la automatización.
- **"Depende de lo que vea"** → es un agente.

### 2.2 Lo que PharmaSync ya resuelve sin IA

| Capacidad | Implementación actual |
|---|---|
| Reglas de negocio | 741 requisitos funcionales en 11 módulos (`docs/main.md`, §1.4) |
| Reportes calculados | 6 endpoints: `sales-summary`, `cash-shift-summary`, `inventory-valuation`, `tax-summary`, `fiscal`, `daily` |
| Alertas por condición | 14 reglas deterministas en `suggestion-rules.ts` (fallos de sync, facturas por expirar, turno extendido, lote por vencer, bendiciones rechazadas) |
| Asistente de usuario | Paleta de comandos con ejecución real (`assistant/commands.ts`) |
| Detección de fraude de licencias | 9 detectores con severidad y acción (`licensing/fraud/fraud-detection.service.ts`) |

Todo eso es correcto y debe seguir siendo software determinista. Meter un modelo
generativo ahí es pagar más por hacer lo mismo peor.

### 2.3 El hueco que queda

El agente solo puede existir donde **no hay métrica, no hay umbral, y no se sabe qué
preguntar**. En este dominio, ese hueco tiene un nombre: **la elección de la pregunta.**

---

## 3. La regla de oro: el modelo no calcula

Esta sección es deliberadamente la primera del diseño, porque es lo que separa una
propuesta seria de un chatbot con licencia.

**Un LLM no debe hacer aritmética.** Se equivocan, y un error de centavos en un estado
de resultados es un problema real. Además, un modelo que puede calcular no puede ser
verificado: no hay contra qué comprobarlo.

La arquitectura lo resuelve de forma simple y estricta:

> **Toda aritmética vive en herramientas deterministas. El modelo solo decide qué
> herramienta llamar, con qué argumentos, y qué hacer con el resultado.**

Los cálculos que el dueño ya necesita —margen,Ticket promedio, comparación de
proveedores, disponibilidad por lote— son consultas SQL encapsuladas. **Son workflows,
y deben seguir siéndolo.** El agente no los reemplaza: los invoca.

Esto invierte el roles correctamente: el workflow es el que sabe calcular, y el agente es
el que sabe qué preguntar.

---

## 4. El problema: el dueño no sabe qué preguntar

### 4.1 Lo que el sistema le da hoy

El dueño de una droguería recibe reportes de volumen: cuánto vendió, cuántas unidades,
cómo se repartió por tipo de venta, cuánto entró por cada medio de pago. Todo correcto,
todo inútil para decidir.

Le falta lo que en cualquier negocio se llama **utilidad**: cuánto quedó después de
cobrar lo que costó. Y ese número, contra todo, ya está en la base de datos:

- Cada venta guarda `SaleItem.unitCost`, el costo del producto en el momento del cobro.
- Cada línea de venta guarda `SaleItemLot.unitCostAtSale`, el costo exacto del lote que
  salió.
- Cada recepción guarda `realUnitCost` (lo que el proveedor cobró) frente a
  `expectedUnitCost` (lo que se esperaba pagar).

**El dato existe desde el día uno y nunca se muestra.** En cuarenta y cuatro archivos de
esquema no hay un solo campo que represente margen, utilidad o rotación. El dueño
recibe revenue y jamás recibe utilidad.

### 4.2 Por qué esto no es "un reporte que falta"

Podría parecerlo. Si el margen fuera `precio - costo` por producto, bastaría un reporte
nuevo. Pero hay tres razones por las que el dueño no lo tiene, y ninguna es
"falta un endpoint":

1. **No hay un solo número que valga.** El margen de una droguería no es un agregado;
   es un mosaico donde un producto rentable compensa veinte que no lo son. El dueño
   necesita saber *cuáles* y *desde cuándo*.
2. **Nadie sabe qué preguntas hacer.** El dueño no tiene un panel donde estos números
   aparezcan porque no tiene idea de que existen. Eso es un problema de decisión, no de
   datos.
3. **El dato está disperso y escondido.** Precio en el historial de precios, costo en el
   de costos, descuento en la venta, proveedor en la recepción. Cruzarlos requiere
   decisión sobre qué cruzar.

---

## 5. El Agente de Administración: tres verbos

El agente tiene un rol, no una lista de features. Su trabajo son tres verbos que el
dueño siempre tiene pendientes y nunca hace: **auditar, diagnosticar y proyectar.**

### 5.1 Auditar precios

**Detectar** que un producto se vende bajo el costo es un workflow, y si se quiere, es
trivial. Lo que el agente aporta es lo que viene después:

**Diagnóstico.** Cruza el historial de precios contra el historial de costos y explica
*desde cuándo* y *por qué*. El caso típico en droguería: sube el costo de un
principio activo, el precio no se mueve —porque el sistema aplica los cambios de
precio de forma no retroactiva (RF-CAT-25)— y el margen se erosiona en silencio. Nadie
lo detecta hasta que el dueño, semanas después, revisa a mano.

> **"El ácido fólico subió de costo el 14 de marzo. Tu precio no se movió. Desde esa
> fecha vendes 40 cajas al mes por debajo del costo. Son 186.000 al mes que se están yendo."**

**Alcance de la acción.** No dice "sube el precio": dice "estas 34 referencias están bajo
costo, el más grave es X desde marzo, y las otras 33 son recientes". La diferencia entre
un número y una prioridad accionable es exactamente lo que separa un agente de un
reporte.

**Comparación con el mercado.** Las listas de precios de los mayoristas son datos
públicos que el agente puede consultar como herramienta externa. Un dueño de droguería
nunca va a sitting a comparar su precio con el de la competencia. Eso es un análisis que
solo se hace si alguien lo hace por ti.

### 5.2 Auditar compras

Cada recepción sabe qué se esperaba pagar y qué se pagó. Esa diferencia nunca se compara.

> **"Pediste elixir a 8.400 y te cobraron 9.100. Tres veces este mes. 47.000 que se
> llevó el proveedor sin que nadie lo notara."**

Y en el nivel más amplio, comparando proveedores sobre el mismo producto y el mismo
período:

> **"El proveedor B te cobra 18% más que el A en 40 productos. Si compras solo a B,
> estás dejando 2.1 millones al año sobre la mesa."**

Esta segunda afirmación es más difícil de lo que parece y por eso es agéntica: no hay
una consulta que la produzca directamente, porque "comparable" entre dos proveedores
depende de qué productos comparten, en qué períodos coinciden, y si los precios de uno
son de una promoción pasajera. **El modelo decide qué comparar; la herramienta
calcula.**

### 5.3 Auditar ventas

Cruza descuentos por clasificación de cliente contra margen. El sistema ya guarda el
`discountPercentage` de cada clasificación y lo aplica automáticamente en la venta
(`sales.service.ts:685, 722-737`).

> **"Tus clientes frecuentes se llevan 14 de margen promedio; los particulares, 34. El
> 22% de tus ventas es a clientes de bajo margen con descuento automático. Nadie te dijo
> que tu mejor cliente—el que más compra— es el que menos te deja."**

Este tipo de hallazgo es exactamente el que un dueño nunca va a sacar solo, porque exige
cruzar la clasificación del cliente con el margen real de las líneas que compró.

### 5.4 Diagnosticar: el ejemplo que muestra el bucle

Un dueño dice: *"este mes vendimos menos"*. No sabe por qué.

**Lo que hace un reporte:** "Venta del mes: −8%".

**Lo que hace el agente:**

1. **Hipótesis inicial:** falta de stock. Es la explicación más obvia y la primera que
   todos asumirían.
2. **Verifica.** Reconstruye la disponibilidad diaria por lote, cruza con la demanda
   típica de esas fechas. **Había stock.** Hipótesis descartada.
3. **Siguiente hipótesis:** precio. Los precios no cambiaron. Descartada.
4. **Siguiente:** estacionalidad. El mismo patrón se repite el año pasado. Descartada.
5. **Acotamiento:** la caída se concentra en dos categorías específicas, y dentro de
   ellas, en dos clientes identificados.
6. **Hallazgo:** dos clientes crónicos dejaron de venir. Pérdida estimada de 340.000 al
   mes. **Recomendación: llamarles.**

Fíjate en lo que hace el paso 2: **descarta lo que casi todos asumirían como verdad.**
Ningún reporte chequea si había stock. Y fíjate en el paso 6: el hallazgo no es un
número nuevo, es una **causa concreta con una acción humana**, y se encontró porque en
el paso 2 se descartó algo.

Los cálculos de los pasos 2, 4 y 5 los hizo una herramienta. **El modelo solo decidió qué
mirar, en qué orden y cuándo parar.** Eso es el bucle, y eso no lo tiene un dashboard.

### 5.5 Proyectar

No "predicción con IA"— eso es estadística, y la estadística es una herramienta. Lo que
el agente hace es decidir **qué preguntar, con qué horizonte y bajo qué restricción**, y
traducir la proyección en una decisión concreta.

> **"Si no pides antes del 15, el 28 de mayo te van a faltar 200 unidades de
> amoxicilina. Con tu rotación actual, esas ventas son 4.1 millones al mes."**

Y aquí hay una ventaja de datos que una droguería tiene y un comercio grande no: **el
sistema ya registra lotes y fechas de vencimiento exactas.** Una droguería sabe, con
precisión, cuánto capital tiene fechado para vencer en los próximos 60 días. Un retail
moderno no tiene esa granularidad. **Esa anticipación es la ventaja competitiva del
módulo.**

La proyección es una herramienta. **El criterio sobre qué proyectar, en qué horizonte y
qué hacer si se equivoca, es el agente.**

---

## 6. La segunda pregunta: ¿qué ni siquiera estoy mirando?

Esta es la sección más importante del documento, porque contiene el valor que no se
puede automatizar.

El dueño hace dos preguntas:

1. **"¿Qué me está costando plata?"** — Responde una herramienta. Es un cálculo.
2. **"¿Qué ni siquiera estoy mirando?"** — Responde el agente. No hay fórmula.

La segunda pregunta es la que más plata vale, y es la que ningún dashboard puede hacer,
porque un dashboard **solo puede mostrar lo que ya le pidieron**. Para que exista un
reporte de "utilidad por categoría", alguien tiene que haberlo imaginado antes. Para que
exista un reporte de "qué estoy overlooking", alguien tiene que haber decidido qué es
relevante. **Esa decisión no se puede pre-programar, porque depende de qué le importa a
cada dueño.**

Un Metric Advisor de verdad no solo lee lo que se le pide: **propone qué medir.** Por
ejemplo, si el dueño lleva seis meses mirando ventas por día, el agente señala que
debería estar mirando utilidad por categoría, porque por día le está saliendo bien y por
categoría no. Esa sugerencia no sale de unrequirement: sale de entender qué está mirando
y contrastarlo con lo que sus datos dicen.

---

## 7. Arquitectura

### 7.1 Las tres decisiones, resueltas

**Entorno (qué ve).** Historiales de precios y costos, ventas con su costo en el
momento del cobro, recepciones con su costo real, descuentos por clasificación, turnos,
lotes con vencimiento. El entorno se declara explícitamente; el modelo no recibe "la
base de datos".

**Herramientas (qué puede hacer).** Un MCP del dominio con operaciones tipadas y con
alcance de tenant. La división es explícita: **las de cálculo son deterministas y el
modelo nunca las ejecuta.**

| Herramienta | Tipo | Responde |
|---|---|---|
| `calcular_margen_por_producto(periodo)` | Cálculo | Margen real por referencia, cruzando `unitCostAtSale` |
| `reconstruir_disponibilidad_por_lote(periodo)` | Cálculo | Hubo stock o no, cada día |
| `comparar_costos_entre_proveedores(periodo)` | Cálculo | Quién cobra menos, por producto |
| `historial_de_precio_y_costo(producto)` | Cálculo | Desde cuándo y por qué cambió el margen |
| `consultar_ventas_por_cliente(periodo)` | Cálculo | Historial y ciclo de cada cliente |
| `consultar_lotes_por_vencimiento(horizonte)` | Cálculo | Capital fechado para vencer |
| `consultar_ventas_margen_bajo(periodo)` | Cálculo | Ventas que dejaron poco o nada |
| `proponer_recomendacion(hallazgo, evidencia)` | Escritura | Único mecanismo de escritura, y produce una propuesta |

La regla es dura: **el modelo no escribe SQL, no toca tablas, no altera un precio.** Solo
usa herramientas declaradas, y la única que altera estado produce una propuesta que un
humano aprueba.

**Verificación (cómo sabe que avanza).** Rúbrica de salida:

1. Todo hallazgo declara **fuente**, **cálculo ejecutado** y **evidencia**.
2. Un hallazgo sin evidencia no se emite.
3. Si no puede concluir, **declara que no pudo concluir**. No rellena el hueco con una
   explicación plausible.

### 7.2 Patrones de diseño aplicados

| Patrón | Aplicación en el Agente de Administración |
|---|---|
| **Prompt chaining** | Interpretar pregunta → seleccionar herramientas → evaluar resultado → redactar hallazgo |
| **Enrutamiento** | Herramientas de cálculo económicas; el modelo potente solo interviene para decidir entre hipótesis contradictorias o jerarquizar hallazgos |
| **Paralelización** | Múltiples consultas de contexto se lanzan a la vez; la latencia es la de la más lenta |
| **Orquestador – Worker** | El orquestador decide qué búsqueda hacer y **no tiene herramientas**; workers que ejecutan cálculos y devuelven datos. Así el razonamiento no toca datos y los datos no razonan |
| **Evaluador – Optimizador** | Un evaluador exige la evidencia antes de dejar pasar un hallazgo; si falla, vuelve al orquestador con el motivo del rechazo |

### 7.3 Control operativo

- **Human-in-the-loop sin excepción:** el agente no aprueba nada, no cambia un precio.
- **Límite de pasos** por ejecución, para acotar costo y tiempo.
- **Idempotencia:** reejecutar el mismo objetivo no duplica propuestas.
- **Jitter y reintentos con backoff** ante errores transitorios.
- **Degradación elegante:** si el modelo no está disponible, el dueño sigue recibiendo
  el parte determinista que el sistema ya produce. El agente es una capa, no el piso.

---

## 8. Guardarraíles

| Riesgo | Mitigación |
|---|---|
| Error aritmético del modelo | Prohibido por arquitectura: toda aritmética vive en herramientas deterministas |
| Alucinación de una pérdida inexistente | Rúbrica de evidencia obligatoria; sin evidencia no hay hallazgo |
| Que el modelo "arregle" un precio sin permiso | No existe herramienta de escritura de precios |
| Que el agente invente una||+| filtro | Si no sabe, declara que no sabe; un modelo que no puede decir "no sé" está inventando |
| Sesgo o consejo sanitario | Fuera de alcance: el agente audita el negocio, no da indicaciones de salud ni toca recetas ni datos clínicos |
| Fuga de datos entre droguerías | Alcance de tenant obligatorio en cada herramienta |
| Sesgo o decisión autónoma sobre un paciente | Fuera de alcance: el agente audita el negocio, no da indicaciones de salud ni toca recetas ni datos clínicos |

---

## 9. Diseño del demo (propuesta, no implementado)

Un CLI en TypeScript, sobre el mismo stack del repositorio, con un mes de datos
sembrados.

El escenario: se simula una caída de ventas del 8% y un marginal Mystery. Al ejecutar se
observa:

1. Hipótesis inicial del orquestador: falta de stock (la explicación obvia).
2. Herramienta reconstruye disponibilidad por lote. **Había stock.** Hipótesis descartada.
3. Segunda y tercera hipótesis (precio, estacionalidad) se descartan con herramientas.
4. Cuarta búsqueda: acotar por categoría y cliente. No estaba prevista.
5. Hallazgo: dos clientes crónicos dejaron de venir, pérdida estimada 340.000 al mes.
6. Recomendación: contactarlos. Sin haber escrito nada.

Costo de implementación estimado: bajo. Reutiliza los esquemas Prisma del proyecto, las
herramientas de cálculo son SQL encapsulado, y no requiere dependencias nuevas.

---

## 10. Modelo de negocio

**Propuesta comercial:** módulo **Premium** por encima del plan base, vendido a la
droguería como "el asesor que no puede contratar".

**Ancla de precio:** el trabajo que hoy se le encarga a un contador o a una asesoría
contable, con un costo mensual de referencia de $120.000 COP más IVA. El módulo se
posiciona por debajo de ese valor y se justifica por el hallazgo, no por la licencia.

**Por qué el dueño paga:** no está pagando por un informe. Está pagando porque el agente
le dice, cada mes, una cosa que él no sabía y que le costaba plata. La primera vez que
encuentra $186.000 que se estaban yendo en una referencia concreta, el módulo se pagó
solo.

**Ingresos secundarios:**
- Retención: un cliente que recibe hallazgos reales de su propio negocio tiene motivos
  concretos para renovar.
- Posicionamiento: PharmaSync deja de ser "el que factura" y pasa a ser "el que
  administra".

**Indicadores de éxito del módulo:**

| Indicador | Meta |
|---|---|
| Hallazgos aceptados sin edición | Porcentaje de propuestas aprobadas tal cual |
| Tiempo de cierre contable mensual | Reducción medible frente al proceso manual |
| Hallazgos aceptados por el dueño | Porcentaje de hallazgos sobre los que se actuó |
| Falsos positivos | Porcentaje de hallazgos descartados por el usuario |
| Time-to-value | Días desde la activación hasta el primer hallazgo reportado |

---

## 11. Objeciones previstas

| Objeción | Respuesta |
|---|---|
| "Saber cuánto se gana es un simple workflow" | Correcto, y por eso el cálculo es una herramienta. Lo que es un workflow es el **cálculo**; lo que es un agente es **elegir qué calcular**. El dueño no sabe qué preguntar, y eso no se automatiza |
| "Los LLM se equivocan en cálculos" | Totalmente de acuerdo, y por eso no calculan. Toda la aritmética vive en consultas SQL deterministas; el modelo solo decide qué herramienta llamar. Un error de centavos en un estado de resultados no puede ocurrir porque el modelo nunca toca la aritmética |
| "Esto ya lo hace un dashboard" | Un dashboard responde lo que se le pregunta. El agente propone qué medir. Nadie puede pre-programar "qué está overlooking el dueño" porque depende de qué le importa a cada uno |
| "Un LLM en un sistema financiero es un riesgo" | El modelo no escribe. Su única salida es una propuesta validada, revisada por un humano. El 95% determinista del sistema queda intacto |
| "Los programas son deterministas, esto no aplica" | El cálculo es determinista, y lo es. La elección de la pregunta depende de lo que se observa en cada paso. Ahí está exactamente el no-determinismo que justifica un agente |
| "¿No es mejor que un humano?" | El dueño decide. El agente hace la búsqueda que a un humano le tomaría 30 horas al mes y que solo pagaría si ya sospecha algo. El valor está en la cobertura, no en reemplazar el criterio |
| "La IA no puede garantizar la verdad" | Correcto, y por eso no emite una certeza: emite un hallazgo con evidencia y una propuesta. La rúbrica obliga a que cada afirmación sea verificable por el contador, que es quien la valida |

---

## 12. Conclusión

PharmaSync no necesita inteligencia artificial para funcionar. Necesita inteligencia
artificial para saber **qué preguntar**.

El dueño de una droguería sabe tomar decisiones: es el que lleva el negocio. Lo que no
tiene es tiempo para cruzar cuarenta mil referencias cada mes, ni una intuición que le
diga que la utilidad se le está yendo por el lado del ácido fólico desde marzo.

El agente no le quita el criterio. Le quita la carga de buscar, y le entrega la pregunta
bien hecha, con la evidencia debajo.

> **El 95% del producto debe seguir siendo software determinista, rápido y auditable.
> El 5% restante —elegir la pregunta correcta— es el único trabajo que ninguna regla
> resuelve, y es el que más le cuesta al dueño de una droguería.**

Ese es el valor agregado: no una función nueva, sino **la capacidad de saber qué mirar.**

---

## Anexo: guion de sustentación

Duración aproximada: cinco minutos.

**1. La tesis (60 s).**
PharmaSync tiene 741 requisitos, seis reportes y catorce alertas. Todo eso es un workflow
y hay que dejarlo tranquilo. La pregunta correcta no es "dónde meto IA", sino "qué tarea
no puede ser un workflow". La respuesta: aquella donde el camino depende de lo que se
observa, y no se puede enumerar de antemano.

**2. El problema (90 s).**
Preguntemos: cuando el dueño cierra el mes, ¿sabía si ganó plata? No. Porque el
sistema le dice cuánto vendió, nunca cuánto ganó. Y el chiste es que **el sistema sí tiene
ese número**—cada venta guarda su costo y cada recepción guarda lo que realmente cobró
el proveedor—, pero nunca lo cruza. El dato existe desde el día uno y nadie lo usa.

**3. El ejemplo (90 s).**
El dueño dice "vendi 8% menos". Un reporte dice "-8%". El agente empieza por la explicación
obvia—falta de stock—, verifica, y la descarta: había stock. Prueba precio: no cambió.
Prueba estacionalidad: se repite el año pasado. Acota por categoría y cliente, y
encuentra que dos clientes crónicos dejaron de venir. El hallazgo es una causa concreta
con una acción humana: llámalos. Los cálculos los hizo una herramienta; el modelo solo
decidió qué mirar y cuándo parar.

**4. La segunda pregunta (45 s).**
El dueño hace dos preguntas: "¿qué me está costando plata?"— eso es una suma, es un
workflow— y "¿qué ni siquiera estoy mirando?"— eso no tiene fórmula. Solo el agente
puede proponer qué medir. Nadie puede pre-programar qué le importa a cada dueño.

**5. Negocio y guardarraíles (45 s).**
Módulo Premium por debajo del costo de un contador, justificado por el hallazgo, no por
la licencia. El modelo nunca calcula y nunca toca un precio: solo propone, y el dueño
decide. Corre en el servidor después de que la caja sincronizó: si se cae, la droguería
sigue vendiendo.

**Cierre (15 s).** El 95% del producto es software determinista. El 5% es elegir la
pregunta correcta, y es el trabajo que más le cuesta al dueño de una droguería.
