# Whitebird WoW Role Sync

Bot de Discord independiente para vincular mains del roster de la guild en Blizzard y sincronizar roles de rango y profesión. No contiene comandos ni código de la ruleta de alters.

## Flujo

1. Cada miembro ejecuta `/wow-vincular-auto`. El bot compara su apodo y nombres de Discord con los personajes del roster de la guild publicado por Blizzard.
2. Si encuentra una coincidencia clara, pide confirmación. Si hay varias, la persona elige una y confirma. No guarda nada antes de la confirmación.
3. Un oficial puede ejecutar `/wow-vincular-masivo` para probar coincidencias del roster con todos los miembros aún sin vincular. Solo guarda coincidencias con una puntuación alta y suficientemente separadas de la segunda opción; casos ambiguos o dudosos quedan intactos para revisión. No reemplaza vínculos existentes ni enlaza bots.
4. Si el nombre no coincide, un oficial puede usar `/wow-vincular usuario:@miembro personaje:Nombre reino:Reino`.
5. Un oficial ejecuta `/syncwow` para sincronizar roles. También se puede activar una frecuencia automática.
6. Los oficiales pueden ejecutar `/wow-desvincular usuario:@miembro` para retirar el vínculo de una persona.
7. Los oficiales consultan `/wow-vinculaciones` para ver los vínculos guardados, el rol de rango que tiene cada miembro y el canal privado de Raider cuando se conoce. Los vínculos se ordenan del rango más bajo al más alto (el rango por defecto aparece primero), seguidos por personajes del roster sin vincular y propuestas pendientes.

Las vinculaciones se guardan en `data/whitebird-wow-roles.sqlite`, incluidos el ID de usuario de Discord, main, reino y, si se creó con el bot de recruitment, el ID del canal personal de Raider. Se guarda el ID del canal para que el vínculo siga siendo correcto aunque se cambie su nombre. Blizzard valida que el personaje forma parte del roster y proporciona el rango; la API de perfil de Blizzard proporciona las profesiones. Los acentos cuentan como parte del nombre: `Agô` y `Agó` se consideran personajes distintos, también en la búsqueda automática. Al vincular manualmente, el nombre debe coincidir respetando sus acentos y el bot guarda la grafía exacta del roster de Blizzard. Si Blizzard no tiene profesiones disponibles, el bot conserva los roles de profesión que ya tuviera esa persona.

El bot de recruitment puede compartir este mismo archivo SQLite y guardar automáticamente el personaje main y reino del apply al aceptarlo. En ese caso, monta la misma carpeta de datos del servidor en ambos contenedores; no copies la base de datos a otra ubicación. Después de la aceptación, ejecuta `/syncwow` o espera al siguiente ciclo automático para asignar los roles.

## Configuración

1. Crea una aplicación de Discord y un bot en [Discord Developer Portal](https://discord.com/developers/applications). Copia el token y el Application ID.
2. Invita el bot al servidor con los scopes `bot` y `applications.commands`, y permisos `View Channels`, `Send Messages` y `Manage Roles`. Coloca su rol por encima de todos los roles que sincronizará. No le concedas Administrador. En **Developer Portal → Bot → Privileged Gateway Intents**, activa **Server Members Intent**; se usa para revisar los miembros del servidor en `/wow-vincular-masivo`.
3. Crea una aplicación en el [portal de desarrolladores de Battle.net](https://develop.battle.net/access/) y copia el Client ID y Client Secret.
4. Copia `.env.example` a `.env` y completa:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
OFFICER_ROLE_IDS=id_rol_oficial,id_rol_oficial2
BLIZZARD_CLIENT_ID=...
BLIZZARD_CLIENT_SECRET=...
WOW_REGION=eu
WOW_LOCALE=en_US
WOW_GUILD_REALM_SLUG=slug-del-reino
WOW_GUILD_SLUG=slug-de-la-guild
WOW_DEFAULT_RANK_ROLE_ID=1463652921898963147
WOW_RANK_ROLE_IDS={"0":"id_rol_gm","1":"id_rol_oficial","2":"id_rol_raider"}
WOW_PROFESSION_ROLE_IDS={"Alchemy":"id_rol_alquimia","Blacksmithing":"id_rol_herreria"}
WOW_SYNC_INTERVAL_MINUTES=0
```

Los rangos son las posiciones numéricas del roster de Blizzard (0 es Guild Master). Si el rango actual no tiene entrada en `WOW_RANK_ROLE_IDS`, el bot quita los roles de rango configurados que tenga la persona y le asigna el rol por defecto `WOW_DEFAULT_RANK_ROLE_ID` (Viajante). Las profesiones se configuran con sus nombres ingleses y requieren `WOW_LOCALE=en_US`. Sustituye los ejemplos por IDs de roles que ya existan en el servidor. El bot no crea, cambia de nombre ni elimina roles. Para los rangos, mantiene un único rol correspondiente al rango actual; los roles de profesión solo se añaden y nunca se retiran, porque pueden corresponder a profesiones de alters. La vinculación automática solo busca entre miembros actuales del roster de la guild configurada.

`WOW_SYNC_INTERVAL_MINUTES=0` mantiene la sincronización manual. Para sincronizar cada seis horas, usa `360`.

Las propuestas pendientes de `/wow-vincular-auto` se guardan temporalmente en memoria, caducan a los cinco minutos y se muestran en `/wow-vinculaciones`. Si se reinicia el bot, esas propuestas desaparecen; los vínculos confirmados sí permanecen guardados en SQLite.

`/wow-vincular-masivo` solo considera personajes y miembros que aún no estén vinculados. Usa coincidencias de nombre estrictas (≥90%) y exige una diferencia mínima frente a la siguiente alternativa. No usa coincidencias basadas únicamente en quitar acentos, ni modifica vínculos existentes. Revisa los resultados ambiguos y confirma manualmente los vínculos con `/wow-vincular`.


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

`docker compose run --rm bot npm run register` registra o actualiza los comandos de Discord. Hay que repetirlo cuando se modifiquen los comandos. Para parar el bot sin borrar sus datos:

```sh
docker compose down
```

Para actualizar el código, trae los cambios del proyecto y ejecuta `docker compose run --rm bot npm run register` si cambiaron los comandos, seguido de `docker compose up -d --build`. La base de datos permanece en `data/` aunque se reconstruya o se pare el contenedor.

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
