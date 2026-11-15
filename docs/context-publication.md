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
