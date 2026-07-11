# Compartir configuración entre estaciones de trabajo

Cuando tienes varias estaciones de trabajo con el mismo modelo de impresoras, puedes exportar la configuración de una estación e importarla en las demás.

## Exportar configuración

1. Ve a "Impresoras" en el menú de administración
2. Haz clic en "Exportar"
3. Guarda el archivo JSON en una ubicación accesible (USB, carpeta compartida)

## Importar configuración

1. En la nueva estación, ve a "Impresoras" en el menú de administración
2. Haz clic en "Importar configuración" y selecciona el archivo JSON
3. El sistema detectará automáticamente las impresoras disponibles y las emparejará con la configuración importada
4. Revisa los resultados: las impresoras que coinciden se configuran automáticamente

## Qué se exporta

- Nombres descriptivos
- Tipos de impresora y conexión
- Configuración de tamaño de papel
- Asignaciones de trabajos (qué tipo de documento imprime cada impresora)
- Configuración de respaldo (fallback)
- Configuración del cajón monedero (si aplica)
- Configuración de la pantalla del cliente (si aplica)

## Qué NO se exporta

- El nombre del sistema (systemName) — es específico de cada estación
- Los IDs internos — se regeneran en la importación
- La cola de impresión

## Solución de problemas

Si al importar ves impresoras "sin coincidencia", significa que el modelo de impresora no se encontró en la nueva estación. Puedes:
1. Conectar la impresora faltante y volver a importar
2. Configurar manualmente la impresora que falta
