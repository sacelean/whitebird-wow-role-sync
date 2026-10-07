# Whitebird WoW Role Sync

Bot de Discord independiente para vincular mains del roster de WoWAudit y sincronizar roles de rango de guild y profesión. No contiene comandos ni código de la ruleta de alters.

## Flujo

1. Cada miembro ejecuta `/wow-vincular-auto`. El bot compara su apodo y nombres de Discord con WoWAudit.
2. Si encuentra una coincidencia clara, pide confirmación. Si hay varias, la persona elige una y confirma. No guarda nada antes de la confirmación.
3. Si el nombre no coincide, un oficial puede usar `/wow-vincular usuario:@miembro personaje:Nombre reino:Reino`.
4. Un oficial ejecuta `/syncwow` para sincronizar roles. También se puede activar una frecuencia automática.
5. Cada miembro puede ejecutar `/wow-desvincular` para retirar su vínculo.

Las vinculaciones se guardan en `data/whitebird-wow-roles.sqlite`. WoWAudit valida que el personaje forma parte de su roster; Blizzard proporciona el rango del roster y las profesiones del personaje. Si Blizzard no tiene profesiones disponibles, el bot conserva los roles de profesión que ya tuviera esa persona.

## Configuración

1. Crea una aplicación de Discord y un bot en [Discord Developer Portal](https://discord.com/developers/applications). Copia el token y el Application ID.
2. Invita el bot al servidor con los scopes `bot` y `applications.commands`, y permisos `View Channels`, `Send Messages` y `Manage Roles`. Coloca su rol por encima de todos los roles que sincronizará. No le concedas Administrador.
3. Crea una aplicación en el [portal de desarrolladores de Battle.net](https://develop.battle.net/access/) y copia el Client ID y Client Secret.
4. Copia `.env.example` a `.env` y completa:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
OFFICER_ROLE_IDS=id_rol_oficial,id_rol_oficial2
WOWAUDIT_API_KEY=...
BLIZZARD_CLIENT_ID=...
BLIZZARD_CLIENT_SECRET=...
WOW_REGION=eu
WOW_LOCALE=en_US
WOW_GUILD_REALM_SLUG=slug-del-reino
WOW_GUILD_SLUG=slug-de-la-guild
WOW_RANK_ROLE_IDS={"0":"id_rol_gm","1":"id_rol_oficial","2":"id_rol_raider"}
WOW_PROFESSION_ROLE_IDS={"Alchemy":"id_rol_alquimia","Blacksmithing":"id_rol_herreria"}
WOW_SYNC_INTERVAL_MINUTES=0
```

Obtén la clave de WoWAudit en **Settings → Team → API key**. Los rangos son las posiciones numéricas del roster de Blizzard (0 es Guild Master). Las profesiones se configuran con sus nombres ingleses y requieren `WOW_LOCALE=en_US`. Sustituye los ejemplos por IDs de roles que ya existan en el servidor. El bot no crea, cambia de nombre ni elimina roles; solo añade y retira los IDs enumerados en los dos mapas.

`WOW_SYNC_INTERVAL_MINUTES=0` mantiene la sincronización manual. Para sincronizar cada seis horas, usa `360`.


## Despliegue con Docker Engine (sin Compose)

Desde este directorio, en el servidor Ubuntu:

```sh
cp .env.example .env
# Edita .env y completa los valores antes de seguir.
mkdir -p data
docker build -t whitebird-wow-role-sync .
docker run --rm --env-file .env whitebird-wow-role-sync npm run register
docker run -d --name whitebird-wow-role-sync --restart unless-stopped --env-file .env -v "$(pwd)/data:/app/data" whitebird-wow-role-sync
docker logs -f whitebird-wow-role-sync
```

Para actualizar, guarda una copia de `data/`, trae el proyecto nuevo y ejecuta:

```sh
docker stop whitebird-wow-role-sync
docker rm whitebird-wow-role-sync
docker build -t whitebird-wow-role-sync .
docker run --rm --env-file .env whitebird-wow-role-sync npm run register
docker run -d --name whitebird-wow-role-sync --restart unless-stopped --env-file .env -v "$(pwd)/data:/app/data" whitebird-wow-role-sync
```

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
