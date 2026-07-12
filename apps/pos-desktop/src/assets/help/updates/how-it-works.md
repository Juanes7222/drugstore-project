# Cómo funcionan las actualizaciones

El sistema POS se actualiza automáticamente para recibir nuevas funcionalidades, mejoras de seguridad y correcciones de errores.

## Canales de actualización

- **STABLE (recomendado)**: Versiones estables probadas. Es el canal predeterminado para todos los puestos.
- **BETA**: Versiones preliminares con funcionalidades nuevas. Solo para pruebas. Disponible solo con autorización del dueño.

## Tipos de actualización

| Tipo | Comportamiento |
|------|----------------|
| **CRITICAL** | Seguridad o bug crítico. Se descarga automáticamente. Se instala al cerrar la app. |
| **MANDATORY** | Actualización obligatoria. Se descarga automáticamente. Se instala al cerrar la app después de la fecha límite. |
| **OPTIONAL** | Nueva funcionalidad. Se descarga solo si la configuraste así. Se instala al cerrar la app. |
| **HOTFIX** | Corrección urgente. Similar a CRITICAL pero para un problema específico. |

## Despliegue gradual (phased rollout)

Las actualizaciones no llegan a todos los puestos al mismo tiempo. Se distribuyen en fases:

1. **5%** de los puestos el primer día
2. **25%** a los 3 días
3. **50%** a la semana
4. **100%** a las 2 semanas

Esto permite detectar problemas antes de que afecten a todos los puestos. Si se detecta una tasa de error alta, el despliegue se pausa automáticamente.
