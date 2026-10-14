# Whitebird WoW Role Sync

Bot de Discord independiente para vincular mains del roster de la guild en Blizzard y sincronizar roles de rango y profesión. No contiene comandos ni código de la ruleta de alters.

## Flujo

1. Cada miembro ejecuta `/wow-vincular-auto`. El bot compara su apodo y nombres de Discord con los personajes del roster de la guild publicado por Blizzard.
2. Si encuentra una coincidencia clara, pide confirmación. Si hay varias, la persona elige una y confirma. No guarda nada antes de la confirmación.
3. Si el nombre no coincide, un oficial puede usar `/wow-vincular usuario:@miembro personaje:Nombre reino:Reino`.
4. Un oficial ejecuta `/syncwow` para sincronizar roles. El bot también sincroniza automáticamente todos los días a las 4:00 (hora peninsular española).
5. Los oficiales pueden ejecutar `/wow-desvincular usuario:@miembro` para retirar el vínculo de una persona.
6. Los oficiales consultan `/wow-vinculaciones` para ver los vínculos guardados, el rol de rango que tiene cada miembro y el canal privado de Raider cuando se conoce. Los vínculos se ordenan del rango más alto al más bajo (el rol por defecto aparece al final), seguidos por personajes del roster sin vincular y propuestas pendientes.
7. `/wow-sincronizar-revisar` muestra los cambios previstos y exige confirmación; `/wow-sync-usuario` sincroniza solo una persona. `/wow-auditoria` revisa roles, vínculos, roster, canales y calderos. `/wow-historial` consulta los cambios de roles guardados.
8. `/wow-calderos-vista` enseña el reparto actual en privado. `/wow-caldero-probar dia tipo` envía un aviso de prueba al canal Raider de la persona asignada.
9. Un oficial puede ejecutar `/wow-bis-proponer raider actividad` para enviar una propuesta BIS al canal Raider vinculado. El raider elige especialización, revisa objetos y procedencia y acepta o rechaza. Solo la aceptación guarda una lista activa en Whitebird.

Las vinculaciones se guardan en `data/whitebird-wow-roles.sqlite`, incluidos el ID de usuario de Discord, main, reino y, si se creó con el bot de recruitment, el ID del canal personal de Raider. Se guarda el ID del canal para que el vínculo siga siendo correcto aunque se cambie su nombre. Blizzard valida que el personaje forma parte del roster y proporciona el rango; la API de perfil de Blizzard proporciona las profesiones. Los acentos cuentan como parte del nombre: `Agô` y `Agó` se consideran personajes distintos, también en la búsqueda automática. Al vincular manualmente, el nombre debe coincidir respetando sus acentos y el bot guarda la grafía exacta del roster de Blizzard. Si Blizzard no tiene profesiones disponibles, el bot conserva los roles de profesión que ya tuviera esa persona.

El bot de recruitment puede compartir este mismo archivo SQLite y guardar automáticamente el personaje main y reino del apply al aceptarlo. En ese caso, monta la misma carpeta de datos del servidor en ambos contenedores; no copies la base de datos a otra ubicación. Después de la aceptación, ejecuta `/syncwow` o espera al siguiente ciclo automático para asignar los roles.

## Configuración

1. Crea una aplicación de Discord y un bot en [Discord Developer Portal](https://discord.com/developers/applications). Copia el token y el Application ID.
2. Invita el bot al servidor con los scopes `bot` y `applications.commands`, y permisos `View Channels`, `Read Message History`, `Send Messages`, `Manage Roles` y `Manage Channels`. Coloca su rol por encima de todos los roles que sincronizará y dale acceso a la categoría/canales privados de Raider para que pueda renombrarlos y publicar avisos. No le concedas Administrador. No necesita activar **Server Members Intent**.
3. Crea una aplicación en el [portal de desarrolladores de Battle.net](https://develop.battle.net/access/) y copia el Client ID y Client Secret.
4. Copia `.env.example` a `.env` y completa:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
OFFICER_ROLE_IDS=id_rol_oficial,id_rol_oficial2
OFFICER_REPORT_CHANNEL_ID=id_canal_de_informes
BLIZZARD_CLIENT_ID=...
BLIZZARD_CLIENT_SECRET=...
WOW_REGION=eu
WOW_LOCALE=en_US
WOW_GUILD_REALM_SLUG=slug-del-reino
WOW_GUILD_SLUG=slug-de-la-guild
WOW_DEFAULT_RANK_ROLE_ID=1463652921898963147
WOW_RANK_ROLE_IDS={"0":"id_rol_gm","1":"id_rol_oficial","2":"id_rol_raider"}
WOW_PROFESSION_ROLE_IDS={"Alchemy":"id_rol_alquimia","Blacksmithing":"id_rol_herreria"}
WOW_SYNC_HOUR=4
WOW_SYNC_TIMEZONE=Europe/Madrid
```

Los rangos son las posiciones numéricas del roster de Blizzard (0 es Guild Master). Si el rango actual no tiene entrada en `WOW_RANK_ROLE_IDS`, el bot quita los roles de rango configurados que tenga la persona y le asigna el rol por defecto `WOW_DEFAULT_RANK_ROLE_ID` (Viajante). Si un personaje vinculado deja de aparecer en el roster, `/syncwow` le quita los roles de rango y profesión configurados y le asigna Viajante; conserva el vínculo guardado. Las profesiones se configuran con sus nombres ingleses y requieren `WOW_LOCALE=en_US`. Sustituye los ejemplos por IDs de roles que ya existan en el servidor. El bot no crea, cambia de nombre ni elimina roles. Para los rangos, mantiene un único rol correspondiente al rango actual; los roles de profesión solo se añaden y no se retiran mientras el personaje siga en el roster, porque pueden corresponder a profesiones de alters. La vinculación automática solo busca entre miembros actuales del roster de la guild configurada.

La sincronización automática diaria se configura con `WOW_SYNC_HOUR` (hora de 0 a 23) y `WOW_SYNC_TIMEZONE` (zona IANA, por ejemplo `Europe/Madrid`). `/syncwow` también mantiene los canales asociados con el formato `rol-nombre-reino`: obtiene el nombre del rol actual a partir de los IDs configurados en `WOW_RANK_ROLE_IDS` y, si corresponde, de `WOW_DEFAULT_RANK_ROLE_ID`. Si no encuentra uno de esos roles en el miembro, usa `raider`. El bot debe poder ver y gestionar el canal. Los cambios y los fallos de permisos aparecen en el informe.

Configura `OFFICER_REPORT_CHANNEL_ID` con un canal de texto privado para oficiales. Cada sincronización diaria publicará allí el resumen de cambios de roles, canales renombrados y omisiones. El bot necesita permiso para ver y enviar mensajes en ese canal.

## Reparto y avisos de calderos

El bot guarda las asignaciones semanales en SQLite. Al iniciar por primera vez, precarga las asignaciones indicadas en el reparto actual. Los oficiales pueden cambiar una asignación con `/wow-caldero-asignar dia tipo usuario`; el miembro seleccionado debe tener un main vinculado y un canal Raider asociado. El mensaje público muestra el nombre de ese main y se genera desde esos mismos datos.

Los avisos privados de calderos se envían cada día a las **22:00 Europe/Madrid**. La sincronización automática de roles permanece a las **4:00** por defecto (`WOW_SYNC_HOUR`); esa tarea ya no envía avisos de calderos.

El encabezado muestra la mención del rol de Alquimista configurado como `Alchemy` en `WOW_PROFESSION_ROLE_IDS`, sin enviar una notificación masiva. El bot solo referencia ese rol existente; no crea ni modifica roles.

Para publicar el mensaje inicial, ejecuta `/wow-calderos-panel canal:#canal-de-crafteos`. Después, cada cambio de asignación actualiza ese mensaje del bot. Discord no permite que el bot edite un mensaje escrito por una persona, así que la primera publicación crea un mensaje nuevo; el mensaje manual anterior se puede borrar.

Cada día a la hora configurada, además de sincronizar roles, el bot envía recordatorios a los canales Raider de las personas asignadas ese día. Menciona únicamente a la persona correspondiente. Requiere que el bot pueda ver y enviar mensajes en el canal de crafteos y en los canales privados Raider.

Las propuestas pendientes de `/wow-vincular-auto` se guardan temporalmente en memoria, caducan a los cinco minutos y se muestran en `/wow-vinculaciones`. Si se reinicia el bot, esas propuestas desaparecen; los vínculos confirmados sí permanecen guardados en SQLite.

## Pruebas automáticas

El proyecto incluye pruebas de la sincronización de rangos y profesiones, salidas del roster y de Discord, conservación de roles cuando Blizzard falla, nombres con acentos, renombrado de canales Raider, avisos diarios y sus horarios, persistencia de vinculaciones y calderos, propuestas y decisiones BIS, y recuperación de paneles. No necesitan credenciales reales ni hacen llamadas a servicios externos.

Ejecuta las pruebas dentro del contenedor:

```sh
docker compose build bot
docker compose run --rm --no-deps bot npm test
```

También puedes ejecutarlas directamente con Node.js 20.11 o posterior mediante `npm test`.

## Despliegue con Docker Compose

Desde este directorio, en el servidor Ubuntu, crea el archivo de configuración y completa sus valores:

```sh
cp .env.example .env
mkdir -p data
# Edita .env y completa los valores antes de seguir.
docker compose run --rm bot npm run register
docker compose up -d --build
docker compose logs -f bot
```

`docker compose run --rm bot npm run register` registra o actualiza los comandos de Discord y elimina los comandos que ya no estén en el proyecto. Hay que repetirlo cuando se modifiquen los comandos. Para parar el bot sin borrar sus datos:

```sh
docker compose down
```

Para actualizar el código, trae los cambios del proyecto y reconstruye primero la imagen para que el registro use la versión nueva de los comandos:

```sh
docker compose build bot
docker compose run --rm --no-deps bot npm run register
docker compose up -d
```

La base de datos permanece en `data/` aunque se reconstruya o se pare el contenedor. Añade `OFFICER_REPORT_CHANNEL_ID` al `.env` del servidor para habilitar los informes diarios.

La carpeta `data/` del host contiene `whitebird-wow-roles.sqlite`. Para que el bot de recruitment comparta los vínculos de los applies aceptados, configura allí `WOW_ROLE_SYNC_DATA_DIR` con la ruta absoluta a esta carpeta; ambos contenedores deben montar esa misma carpeta.

## Ejecución directa con Node.js

Requiere Node.js 20.11 o posterior.

```sh
cp .env.example .env
# Edita .env
npm install
npm run register
npm start
```

Mantén `data/` y `.env` en el servidor y fuera de Git. Este proyecto puede desplegarse y reiniciarse sin afectar al bot de la ruleta.

## Informes semanales de WoWAudit

Integración opcional: miércoles a las **20:00 Europe/Madrid**, con cambios de horario de verano/invierno. No requiere cron ni otra automatización. Configura en `.env`:

```dotenv
WOWAUDIT_API_KEY=<clave del equipo de WoWAudit>
WOWAUDIT_LOOT_WINDOW_DAYS=
WOWAUDIT_LOOT_CATEGORIES=BIS,Mejora de stats,set 4p,Catalizar
WOWAUDIT_LOOT_RANKS=Oficiales,Fijo,Rotativo
```

La clave selecciona el equipo de WoWAudit. Guarda `.env` solo en el servidor (`chmod 600 .env`); nunca en Git ni en la imagen. El bot necesita Ver canal y Enviar mensajes en el destino. La integración requiere la clave. Elige el destino con `/wow-loot-actualizar canal:#tu-canal`; tras publicar correctamente se guarda en SQLite para las siguientes actualizaciones, también las semanales y tras reiniciar. El parámetro `canal` es opcional cuando ya hay un destino guardado. Sin destino, el proceso semanal espera a que se seleccione uno. No hay nombres predeterminados. El bot necesita también Leer historial de mensajes e Insertar enlaces. Sin configuración WoWAudit queda desactivada; errores de configuración no detienen Blizzard.

### Propuestas de listas BIS para raiders

Un oficial ejecuta `/wow-bis-proponer raider:@miembro actividad:Raid` (también están disponibles General y Mítico+). El miembro debe tener un personaje main vinculado y un canal Raider asociado; el bot obtiene su clase del roster de WoWAudit. En el canal Raider, el destinatario elige especialización y después la fuente, actualmente Method o Blingtron. El valor de `actividad` selecciona la lista General/Overall, Raid o Mítico+/Mythic+ correspondiente. El bot consulta esa guía, comprueba que la tabla y sus objetos se puedan interpretar y publica una propuesta con los objetos enlazados a Wowhead y su procedencia. De Blingtron muestra como máximo los cuatro abalorios mejor clasificados por puntuación. Si Method proporciona una clasificación de abalorios para el contexto elegido, muestra sus cuatro primeros por nivel; si no, conserva las ranuras Abalorio 1 y 2 de la tabla de equipo. Si la página cambia, la respuesta es incompleta o falta un ID de objeto, cancela sin guardar una lista parcial. El raider puede editar, aceptar o rechazar la propuesta; solo ese usuario puede usar los controles. Para editar, selecciona el objeto/ranura y escribe el nombre, ID de Wowhead y procedencia del reemplazo; el embed y la lista guardada se actualizan y la sustitución queda marcada como manual.

El feed de Blingtron no publica una recomendación de ranura Dedo para Priest Holy. Cuando se elige esa fuente, el bot muestra la ranura vacía, sin inventar un objeto, y permite rellenarla desde **Editar objeto**.

Al aceptar, Whitebird guarda en SQLite la especialización, actividad, objetos, fuentes y datos de la guía como una lista asociada al raider; esa lista pasa a ser su lista activa. Los reemplazos que haga el raider actualizan la lista activa y se guardan en el historial de ediciones. Al rechazar, Whitebird borra la referencia activa del raider y conserva el registro de la decisión. La lista activa anterior también deja de estar activa al rechazar una nueva propuesta. Si se crea otra propuesta antes de decidir la anterior, la anterior caduca.

La fuente seleccionada y la fecha de consulta se conservan con la lista; Method también guarda el parche indicado por la guía. La aceptación guarda la lista en SQLite de Whitebird, pero no la sube a WoWAudit: su API pública documentada no ofrece una operación para crear wishlists arbitrarias. La selección requiere `WOWAUDIT_API_KEY` para consultar la clase del personaje y que WoWAudit devuelva una ficha única del main vinculado. El bot necesita Ver canal, Enviar mensajes e Insertar enlaces en cada canal Raider. Las guías no son simulaciones personalizadas; Method recomienda simular el personaje para afinar la elección. Revisa los [términos de uso de cada sitio](https://www.method.gg/terms) antes de usar su contenido en Discord; los términos de Method restringen copiar y republicar material salvo los usos que Method permita.

El informe de loot y el **resumen de raiders** son dos mensajes separados, cada uno con su propio ID y estado. El resumen muestra bóveda de la semana, nivel medio calculado a partir de `best_gear`, asistencia del período, loot por categoría y objetos por raid asistida. Ambos se publican en el destino guardado y se actualizan los miércoles a las 20:00. Para actualizar solo la tabla al momento, usa `/wow-raiders-actualizar canal:#tu-canal`; comparte el destino guardado con el informe de loot.

### Avisos privados de encantamientos y gemas

Con `WOWAUDIT_API_KEY` y `WOWAUDIT_TEAM_ID` configurados, cada día a las **22:00 Europe/Madrid** el bot consulta el JSON `GET /api/teams/{id}/overview_data` de WoWAudit. Envía un mensaje privado a cada usuario vinculado si el resumen marca encantamientos ausentes o huecos de gema vacíos. Se consideran todos los rangos del equipo, incluidos Trial; no se filtra el roster por rango. Si una persona tiene varios personajes vinculados con incidencias, recibe un único mensaje agrupado. Los personajes sin una vinculación única no se notifican y quedan registrados en los logs.

`WOWAUDIT_TEAM_ID` es el identificador numérico del equipo en WoWAudit (el equipo actual de Whitebird usa `66082`). Esta consulta usa una ruta JSON interna de WoWAudit que no aparece en su API pública documentada; el formato puede cambiar sin aviso. Si WoWAudit no responde con el esquema esperado, el bot no envía avisos parciales. Los mensajes privados pueden fallar si la persona bloquea DMs; los demás destinatarios se procesan igualmente.

**Contrato verificado el 13-10-2026:** [API oficial](https://wowaudit.com/api), Swagger integrado en su aplicación web. El ejemplo Swagger antiguo de `GET /v1/period` incluye `current_season.keystone_season_id`; si existe se utiliza ese campo. La respuesta real comprobada del equipo no lo incluye: se utiliza `current_season.id` (18), y se ha confirmado HTTP 200 con 546 registros en `/v1/loot_history/18`. No se confunde este ID con `pvp_season_id` ni `tier_id`. `GET /v1/characters` devuelve un array del roster. `GET /v1/loot_history/{id}` devuelve `history_items`; el destinatario es `character_id`, no `awarded_by_character_id` ni `awarded_by_name`. Autenticación mediante `Authorization: Bearer ...`. La documentación describe el historial completo de temporada, sin paginación ni filtros por fecha; el filtro temporal se aplica localmente. `test/fixtures/wowaudit.json` contiene ejemplos oficiales; `wowaudit-period-live.json` reproduce únicamente los metadatos públicos de temporada comprobados, sin clave ni historial del equipo.

**Cálculo:** número de adjudicaciones registradas y no descartadas, una por objeto, solo con `difficulty=mythic` y la categoría final en BIS, Mejora de stats, set 4p o Catalizar: se usa `response_type.propagated_to.name` cuando hay una fusión, y `response_type.name` en caso contrario. `WOWAUDIT_LOOT_CATEGORIES` permite ajustar los nombres al equipo; se ignoran mayúsculas y espacios repetidos, sin coincidencias parciales. Categorías nulas no cuentan. Se respeta la categoría final de las fusiones configuradas en WoWAudit, como hace su tabla de estadísticas; no se cuenta también la categoría original. El indicador `excluded` no altera la selección explícita de nombres. Por defecto desde `current_season.start_date` a las 00:00 UTC hasta el miércoles a las 20:00 Madrid, extremo final excluido. La fecha oficial no trae zona; UTC es una convención explícita. `WOWAUDIT_LOOT_WINDOW_DAYS=N` limita a las últimas N×24 horas, siempre dentro de la temporada actual: no consulta temporadas anteriores. El cierre se mantiene fijo durante los reintentos.

**Tabla de raiders:** obtiene `current_period` y `GET /v1/historical_data?period=...`. Keys muestra los niveles de las mejores runs que cuentan para los umbrales 1/4/8; Raid Vault muestra los niveles de objeto de sus tres opciones, porque la API no da directamente la etiqueta M/H. El iLvl es el promedio calculado de los `ilvl` devueltos en `best_gear` por `GET /v1/historical_data/{id}`; no es una media histórica. La asistencia se pide por el mismo intervalo que el loot y muestra asistidas/raids totales. El loot se presenta como total y desglose BIS/Mejora de stats/set 4p/Catalizar, más el total por raid asistida. Si WoWAudit no devuelve un valor para una columna, se muestra `—`; el bot no lo deduce. La consulta de equipo se limita a cuatro peticiones simultáneas.

El roster relevante es el **roster actual del equipo de WoWAudit**, con `status=tracking` y rangos Oficiales, Fijo y Rotativo; Trial queda fuera. `WOWAUDIT_LOOT_RANKS` permite ajustar esta selección (sin distinguir mayúsculas ni espacios repetidos). La respuesta real comprobada tiene 3 Oficiales, 17 Fijo, 3 Rotativo y 7 Trial: con estos rangos entran 23 personajes. Se inicializa con cero antes de contar. Cada personaje seleccionado se cuenta independientemente; no se suma loot de alts. No reconstruye rosters históricos ni divide por asistencia: recién incorporados pueden tener cero. No infiere propietarios de alts. La base existente solo vincula un main por usuario: las menciones se resuelven por nombre y reino normalizados, únicamente si la coincidencia es única, sin ping. Personajes sin vínculo aparecen por nombre/reino. Un nombre ambiguo o un duplicado de identidad en WoWAudit cancela el informe para evitar atribuciones incorrectas.

Se deduplica por `id` y por `rclootcouncil_id` cuando existe; duplicados con destinatario/objeto/fecha/estado/categorías incompatibles cancelan el informe. No se deduplica por ID de objeto: dos objetos iguales adjudicados legítimamente cuentan dos veces. El mensaje muestra **todos los personajes seleccionados**, ordenados de mayor a menor loot, incluidos los ceros. La lista se presenta de forma continua dentro de un único mensaje con embed, sin pings. Si excediera los límites de Discord, cancela la actualización sin recortar el roster ni sobrescribir el informe anterior. Un historial vacío válido genera ceros con advertencia de cobertura: no prueba que no haya habido loot. El informe solo representa lo importado en WoWAudit, no todo el loot del juego.

**Docker:** utiliza el `compose.yaml` existente con `.env` y el volumen persistente `./data`. Tras configurar:

```sh
docker compose build
docker compose run --rm bot npm test
docker compose run --rm bot npm run register
docker compose up -d
docker compose logs --tail=100 bot
```

Conserva el volumen y ejecuta una sola instancia del bot. SQLite guarda cada panel en su propia tabla: `wowaudit_loot_panels` para loot y `wowaudit_raider_panels` para la tabla. Cada una conserva ID de mensaje, estado de creación y última semana actualizada. El primer envío crea cada mensaje; los siguientes lo editan, también después de reiniciar. No borra mensajes antiguos.

Consulta al arrancar y cada minuto: entre las 20:00 y las 20:59 del miércoles actualiza ambos mensajes una vez esa semana, con cierre fijo a las 20:00. Fuera de esa hora espera a la semana siguiente. Fallos anteriores a crear o durante una edición se reintentan cada cinco minutos durante esa hora. La API tiene timeout de 15 segundos por petición y hasta tres intentos para fallos transitorios/429. No registra claves ni cuerpos de error.

Si el mensaje guardado fue borrado (Discord Unknown Message), crea un reemplazo y guarda su nuevo ID. Fallos de acceso/permisos/red no generan un mensaje nuevo. Una creación incierta conserva el estado `creating` para evitar duplicados. Primero revisa `docker compose logs --tail=200 bot`: la entrada `[WoWAudit/Discord]` indica operación, estado HTTP, código Discord/red/SQLite y rutas de campos rechazados, sin tokens ni cuerpos completos. Una entrada `blocked-creation` describe la marca pendiente y no demuestra la causa del fallo original. Si el proceso antiguo no registró el error original, no se puede recuperarlo del aviso genérico. No se desbloquea el estado por ensayo: cualquier reparación requiere investigar primero la causa y confirmar la entrega real. Si falla la persistencia tras enviar, los logs incluyen el ID devuelto por Discord para recuperar ese mensaje. Respaldar la base antes de corregir manualmente.


Validación automática con ejemplos oficiales y respuestas simuladas. Para validar datos reales, configura la clave del equipo y comprueba una adjudicación conocida, un personaje con cero y el roster antes del primer miércoles. No se ha calculado ni publicado un ranking real de Whitebird durante el desarrollo.

### Publicar y actualizar el informe

Para publicar por primera vez o actualizarlo al momento, ejecuta **`/wow-loot-actualizar canal:#tu-canal`** (permiso Gestionar servidor o un rol de `OFFICER_ROLE_IDS`). Puedes omitir `canal` para reutilizar el destino guardado, o seleccionar otro para cambiarlo. Genera el informe hasta ahora, crea o edita el mismo mensaje público en el canal configurado y devuelve su enlace en una respuesta privada. Comparte la misma persistencia y protección ante duplicados con la actualización semanal. Una actualización manual no consume la actualización del miércoles. El nuevo destino solo se guarda tras publicar correctamente; si falla, conserva la elección anterior. Al cambiar de canal, crea o reutiliza el panel de ese canal y conserva el anterior sin seguir actualizándolo.

Para publicar o actualizar solo la tabla, ejecuta **`/wow-raiders-actualizar canal:#tu-canal`**. También puedes omitir el canal para reutilizar el destino guardado. La tabla se edita como un mensaje separado del loot y tiene su propia persistencia; las actualizaciones semanales mantienen ambos mensajes.

Después de desplegar esta versión, registra el nuevo comando:

```sh
docker compose run --rm bot npm run register
docker compose up -d --build
```

El registro requiere `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` y `DISCORD_TOKEN` en `.env` y actualiza la lista de comandos del bot para el servidor configurado.

La categoría **set 4p** es independiente de **Catalizar**. Si tu `.env` ya contiene el antiguo valor `set 4p Catalizar`, cámbialo a `WOWAUDIT_LOOT_CATEGORIES=BIS,Mejora de stats,set 4p,Catalizar` y recrea el contenedor para cargarlo.

El sitio web puede agrupar loot de alts por propietario; este bot sigue contando por personaje y solo para el roster/rangos seleccionados. Al contrastar resultados, comprueba ese alcance además de dificultad, categorías y período. La API devuelve la respuesta original del botón RCLootCouncil en `response_type` y su destino de fusión en `propagated_to`; filtrar solo el nombre original puede omitir adjudicaciones que la web muestra en BIS o Mejora de stats.

Para comprobar el estado guardado y los permisos **sin enviar ni editar mensajes ni modificar SQLite**, tras desplegar esta versión:

```sh
docker compose exec -T bot node src/loot-inspect.js
```

La inspección abre SQLite en modo de solo lectura y hace consultas GET a Discord. Muestra IDs/estado del panel, permisos actuales y si el mensaje guardado pertenece al bot. No demuestra por sí sola la causa de un fallo pasado; se contrasta con los logs originales. No muestra tokens ni contenido de mensajes.
