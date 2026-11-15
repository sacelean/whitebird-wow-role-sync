# Contexto de Whitebird

Antes de trabajar en este proyecto, consultar el contexto compartido en:
https://github.com/sacelean/Whitebird-context

Leer README.md, AGENTS.md, ARCHITECTURE.md, STATUS.md y DEPLOYMENT.md desde una copia local actualizada o mediante la conexión GitHub autorizada.
El repositorio de contexto es privado. Si no hay acceso, indicarlo y continuar con las tareas que puedan resolverse con las fuentes disponibles, sin inventar información.

## Al realizar cambios

- Leer también la documentación e instrucciones específicas de este proyecto.
- Verificar código y estado actual antes de dar por vigente una nota histórica.
- Distinguir lo propuesto, implementado, probado y desplegado.
- Revisar consumidores e integraciones si cambian comandos, variables, contratos o datos compartidos.
- Actualizar el contexto compartido cuando la tarea autorizada cambie arquitectura, operación o estado relevante; registrar fecha y evidencia.
- No desplegar ni modificar otros proyectos solo por estar mencionados en la documentación.
- No guardar secretos, archivos .env, tokens, bases de datos ni datos personales en el contexto.

## Conocimiento del chatbot (2026-11-15)

Al cambiar funcionalidades, comandos, permisos, variables o integraciones, actualizar también Whitebird-context: STATUS.md y la entrada del componente en knowledge/bots.json. Mantener la documentación técnica de este repositorio. El chatbot sincroniza ese catálogo; no interpreta automáticamente el código ni estos Markdown.

Registrar fecha, fuentes y revisión implementada. deployedRevision debe quedar null si no hay evidencia de despliegue; actualizarla solo tras verificar la revisión desplegada. No presentar cambios locales como disponibles en producción. Conservar el orden de topics del catálogo; para nuevos temas coordinar el enrutador del agente. Validar con npm run context:validate -- /ruta/bots.json desde whitebird-ai-agent. Si no hay acceso al contexto, declarar la actualización pendiente al cerrar la tarea. Nunca copiar secretos ni datos personales.

## Publicación mediante pipeline propia del contexto

El agente lee un archivo local publicado por Whitebird-context. Para los textos usar implementedRevision con SHA completo de 40 caracteres. Registrar despliegues verificados en deployments/<id>.json mediante el notificador de CI, no editar deployedRevision para activar texto. Consultar docs/context-publication.md y Whitebird-context/knowledge/README.md. Las explicaciones pendientes no sustituyen las compatibles con la versión desplegada.
