# Publicación de documentación para el chatbot

La fuente de este proyecto es docs/knowledge.json. Mantenerla junto con el código:
funciones, comandos, permisos, configuración, fuentes y fecha reviewedAt.
Los textos iniciales se migran del catálogo existente; requieren revisión cuando
cambie el comportamiento. No contienen estado en vivo ni datos personales.

La pipeline verifica el despliegue y después ejecuta scripts/publish-knowledge.mjs.
Este script escribe published/knowledge.json en la rama knowledge-published DE ESTE
MISMO repositorio con documentación, SHA y evidencia del run. Usa el GITHUB_TOKEN
automático con Contents: write limitado al job de publicación/despliegue.
No necesita un token personal ni permiso sobre Whitebird-context.
No modificar manualmente esa rama; se regenera desde docs/knowledge.json.

Whitebird-context consulta las cinco publicaciones cada cinco minutos (GitHub
puede retrasar las ejecuciones programadas) o con Run workflow. Solo lee los
repositorios de origen. Genera y publica el catálogo del servidor; el agente lo
recarga en hasta diez segundos sin reiniciarse.

Validar localmente:
```sh
node scripts/publish-knowledge.mjs --validate
node --test scripts/check-knowledge.mjs
```

Para comprobar la publicación: confirmar éxito del despliegue y del paso Publish
verified documentation in this repository, y abrir
knowledge-published/published/knowledge.json. El SHA debe ser el del bot desplegado.
Si la rama está protegida, permitir al GITHUB_TOKEN del job actualizarla.
El job de despliegue no se ejecuta en PR.

Ruleta usa un workflow manual porque no tiene pipeline de despliegue: confirmar
tanto la revisión en ejecución como que docs/knowledge.json describe esa revisión.
No despliega el bot ni verifica automáticamente la declaración.

Migración: el anterior secret de escritura al contexto y la variable de activación
de notificaciones ya no se utilizan y pueden eliminarse de este repositorio.
No se crean credenciales ni se despliegan servicios al preparar este cambio.

## Redespliegues, restauraciones y conflictos

El publicador registra la revisión que acaba de verificarse, incluso si se está
reejecutando un workflow antiguo. runNumber identifica el workflow y no decide qué
versión está actualmente desplegada. Cada pipeline serializa despliegue,
comprobación y publicación con su grupo de concurrencia. Mantener esas tres fases
en el mismo bloqueo; un despliegue manual externo requiere comprobar de nuevo
la revisión antes de publicar. Un rollback manual del proceso no publica por sí solo.

La escritura usa el SHA del archivo como control de concurrencia. Si otro proceso
cambia ese documento durante la publicación, falla explícitamente y exige revisar
el despliegue antes de reintentar. Solo se reintenta si el documento no ha cambiado.
Una comprobación correcta acredita el despliegue, no la exactitud semántica de toda
la explicación: el contenido todavía necesita revisión humana y pruebas de contrato.

## Ejecuciones históricas anteriores a la corrección

Reejecutar un workflow histórico usa también su script histórico: un cambio en
main no reescribe esa ejecución. Para corregir la publicación después de restaurar
una revisión con código anterior al arreglo, iniciar UNA EJECUCIÓN NUEVA del
workflow Publish documentation for a verified restored revision desde main.
Indicar el SHA desplegado y confirmar que está comprobado y que la documentación
lo describe. Por defecto se toma docs/knowledge.json de ese SHA; si allí no existe,
indicar otro SHA de documentación cuya correspondencia se haya revisado.
El publicador se carga de main, nunca ejecuta scripts de la revisión documental,
y usa el mismo grupo de concurrencia que el despliegue. No instala ni verifica
automáticamente el bot. Si falta el documento, falla sin publicar.
