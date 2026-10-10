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

Configura `OFFICER_REPORT_CHANNEL_ID` con un canal de texto privado para oficiales. Cada sincronización diaria publicará allí el resumen de cambios de roles, canales renombrados, omisiones y resultado de los avisos de calderos. El bot necesita permiso para ver y enviar mensajes en ese canal.

## Reparto y avisos de calderos

El bot guarda las asignaciones semanales en SQLite. Al iniciar por primera vez, precarga las asignaciones indicadas en el reparto actual. Los oficiales pueden cambiar una asignación con `/wow-caldero-asignar dia tipo usuario`; el miembro seleccionado debe tener un main vinculado y un canal Raider asociado. El mensaje público muestra el nombre de ese main y se genera desde esos mismos datos.

El encabezado muestra la mención del rol de Alquimista configurado como `Alchemy` en `WOW_PROFESSION_ROLE_IDS`, sin enviar una notificación masiva. El bot solo referencia ese rol existente; no crea ni modifica roles.

Para publicar el mensaje inicial, ejecuta `/wow-calderos-panel canal:#canal-de-crafteos`. Después, cada cambio de asignación actualiza ese mensaje del bot. Discord no permite que el bot edite un mensaje escrito por una persona, así que la primera publicación crea un mensaje nuevo; el mensaje manual anterior se puede borrar.

Cada día a la hora configurada, además de sincronizar roles, el bot envía recordatorios a los canales Raider de las personas asignadas ese día. Menciona únicamente a la persona correspondiente. Requiere que el bot pueda ver y enviar mensajes en el canal de crafteos y en los canales privados Raider.

Las propuestas pendientes de `/wow-vincular-auto` se guardan temporalmente en memoria, caducan a los cinco minutos y se muestran en `/wow-vinculaciones`. Si se reinicia el bot, esas propuestas desaparecen; los vínculos confirmados sí permanecen guardados en SQLite.

## Pruebas automáticas

El proyecto incluye pruebas de la sincronización de rangos y profesiones, salidas del roster y de Discord, conservación de roles cuando Blizzard falla, nombres con acentos, renombrado de canales Raider, avisos diarios y sus horarios, persistencia de vinculaciones y calderos, y recuperación del panel si se borró el mensaje guardado. No necesitan credenciales reales ni hacen llamadas a Discord o Blizzard.

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
