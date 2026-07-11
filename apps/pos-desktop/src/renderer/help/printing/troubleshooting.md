# Solución de problemas de impresión

## La impresora no aparece en el asistente de configuración

1. Verifica que la impresora esté encendida y conectada (USB, red o Bluetooth)
2. Haz clic en "Buscar de nuevo" en el asistente
3. Si es una impresora de red, activa la "Búsqueda en la red local"
4. Verifica que los controladores de la impresora estén instalados en Windows
5. Reinicia la aplicación e intenta de nuevo

## La prueba de impresión falla

1. Verifica que haya papel en la impresora
2. Revisa que la impresora esté encendida y en línea
3. En Windows, abre "Dispositivos e impresoras" y verifica el estado
4. Si la impresora muestra "Sin papel" pero tiene papel, revisa que esté cargado correctamente
5. Intenta imprimir desde otra aplicación (Bloc de notas, Word) para descartar problemas del controlador

## El recibo se imprime cortado o con contenido faltante

1. Verifica que el tamaño de papel configurado coincida con el papel cargado (80mm vs 58mm)
2. En la configuración de la impresora, revisa el tamaño de papel seleccionado
3. Si usas papel de 58mm, cambia la configuración a "Recibo 58mm"
4. Si el contenido sigue siendo más ancho que el papel, considera acortar la plantilla del recibo

## El código QR no se imprime correctamente

1. Algunas impresoras térmicas no soportan códigos QR grandes
2. Reduce el tamaño del módulo QR en la configuración de la plantilla
3. Verifica que la impresora soporte el comando QR de ESC/POS

## La cola de impresión tiene trabajos pendientes que no avanzan

1. Ve a "Cola de impresión" en el menú de administración
2. Revisa el estado de cada trabajo para identificar el error
3. Haz clic en "Reintentar" para los trabajos fallidos
4. Si la impresora está en línea y los trabajos no avanzan, usa "Reintentar todos"
