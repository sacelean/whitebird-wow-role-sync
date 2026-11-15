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


## Documentación publicada para el chatbot

Al cambiar funcionalidades, comandos, permisos, configuración o integraciones,
actualizar docs/knowledge.json en este mismo repositorio y la documentación técnica.
Registrar reviewedAt y source; mantener topics en el orden del enrutador del agente.
Validar con node scripts/publish-knowledge.mjs --validate.
La pipeline publica una copia en la rama knowledge-published solo después de verificar
el despliegue. El SHA se añade automáticamente. Whitebird-context recoge esa copia
con acceso de solo lectura y genera el catálogo. No editar el catálogo agregado ni
registrar despliegues directamente en otro repositorio. No guardar secretos o datos
personales en la documentación. Los cambios de arquitectura/operación siguen
registrándose en Whitebird-context/STATUS.md con fecha y evidencia.
Ver docs/context-publication.md para activación y comprobaciones.
