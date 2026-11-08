# Whitebird WoW Role Sync

[Release notes](RELEASE_NOTES.md)

El panel de configuración se mantiene en el repositorio independiente `whitebird-control-panel`. Administra WoW Role Sync, Recruitment y Ruleta mediante rutas a sus archivos de configuración; no forma parte del código ni del despliegue de este bot.

Bot de Discord para Whitebird: vincula mains del roster de Blizzard, sincroniza roles de rango y profesión, mantiene los nombres de los canales Raider y gestiona calderos. Opcionalmente integra informes de WoWAudit, avisos de encantamientos y gemas y propuestas de listas BIS de Method o Blingtron.

Funciona para un único servidor de Discord (`DISCORD_GUILD_ID`) y guarda su estado en SQLite. Es independiente del bot de recruitment y del bot de la ruleta de alters.

## Índice

- [Flujo y horarios](#flujo)
- [Comandos](#comandos)
- [Configuración](#configuración)
- [Ascensos a Raider](#felicitación-al-ascender-de-recluta-a-raider)
- [Calderos](#reparto-y-avisos-de-calderos)
- [Pruebas](#pruebas-automáticas)
- [Docker Compose](#despliegue-con-docker-compose)
- [Node.js](#ejecución-directa-con-nodejs)
- [WoWAudit y listas BIS](#informe-de-raiders-de-wowaudit)
- [Persistencia y mantenimiento](#persistencia-y-mantenimiento)
- [Estructura del código](#estructura-del-código)

## Flujo

1. Cada miembro usa `/vinculacion-buscar` para encontrar su main en el roster de Blizzard y confirmar el vínculo.
2. Si no hay una coincidencia clara, un oficial asigna el main con `/vinculacion-asignar`.
3. La sincronización de roles se ejecuta automáticamente a las 4:00; un oficial también puede iniciarla con `/sincronizacion-ejecutar` o limitarla a una persona con `/sincronizacion-usuario`.
4. Los oficiales gestionan vínculos, auditan el estado y consultan el historial con los comandos de la tabla.
5. Los avisos de calderos y equipo se publican en los canales Raider asociados. `/bis-proponer` envía una propuesta BIS que el raider puede editar, aceptar o rechazar.

### Horarios automáticos

| Tarea | Horario | Configuración |
|---|---|---|
| Sincronización de roles y canales; informe a oficiales | Todos los días, 04:00 por defecto | `WOW_SYNC_HOUR` y `WOW_SYNC_TIMEZONE` |
| Avisos de calderos del día | 22:00; solo se envían si hay asignaciones ese día | Usa `WOW_SYNC_TIMEZONE` (por defecto `Europe/Madrid`); la hora está fijada en el código |
| Avisos de encantamientos y gemas | Todos los días, 22:00 | `Europe/Madrid`, fijo en el código; requiere clave y equipo de WoWAudit |
| Informe de raiders (incluye loot) | Miércoles, 20:00 | `Europe/Madrid`, fijo en el código; requiere clave y destino guardado |

Las tareas se ejecutan dentro del proceso del bot, sin cron. Las zonas IANA respetan los cambios de horario de verano/invierno. La sincronización y los avisos diarios esperan a su próxima hora tras arrancar; no recuperan envíos perdidos durante una parada. El informe semanal puede recuperarse dentro de su ventana del miércoles, de 20:00 a 20:59.

## Comandos

| Comando | Uso |
|---|---|
| `/vinculacion-buscar` | Busca y propone al usuario su main del roster. |
| `/vinculacion-asignar` | Vincula un usuario con personaje y reino (oficiales). |
| `/vinculacion-quitar` | Elimina el vínculo de un usuario (oficiales). |
| `/vinculacion-listar` | Muestra vínculos, canales Raider, personajes sin vincular y propuestas pendientes (oficiales). |
| `/sincronizacion-ejecutar` | Sincroniza roles y canales de todas las vinculaciones (oficiales). |
| `/sincronizacion-usuario` | Sincroniza solo al usuario elegido (oficiales). |
| `/auditoria-revisar` | Comprueba vínculos, roles, roster, canales y calderos (oficiales). |
| `/historial-cambios` | Consulta cambios de roles recientes, opcionalmente filtrados por usuario (oficiales). |
| `/equipo-comprobar usuario enviar` | Comprueba en privado encantamientos, gemas y coincidencia del rol de un usuario (oficiales). Con `enviar:true`, envía el aviso real al canal Raider y menciona al usuario; por defecto no envía. |
| `/informe-raiders` | Actualiza la tabla de raiders y elige su canal de publicación (oficiales). |
| `/bis-proponer` | Envía una propuesta BIS a un raider vinculado (oficiales). |
| `/calderos-asignar` | Asigna una persona al caldero de un día y tipo (oficiales). |
| `/calderos-publicar` | Publica o cambia el canal del panel de calderos (oficiales). |
| `/calderos-ver` | Muestra en privado el reparto actual de calderos (oficiales). |


Salvo `/vinculacion-buscar`, todos los comandos requieren **Gestionar servidor** o uno de los roles de `OFFICER_ROLE_IDS`. Las respuestas de los comandos son privadas; los paneles, informes, propuestas BIS y recordatorios se publican en sus canales de destino.

Las vinculaciones se guardan en `data/whitebird-wow-roles.sqlite`, incluidos el ID de usuario de Discord, main, reino y, si se creó con el bot de recruitment, el ID del canal personal de Raider. Se guarda el ID del canal para que el vínculo siga siendo correcto aunque se cambie su nombre. Blizzard valida que el personaje forma parte del roster y proporciona el rango; la API de perfil de Blizzard proporciona las profesiones. Los acentos cuentan como parte del nombre: `Agô` y `Agó` se consideran personajes distintos, también en la búsqueda automática. Al vincular manualmente, el nombre debe coincidir respetando sus acentos y el bot guarda la grafía exacta del roster de Blizzard. Si Blizzard no tiene profesiones disponibles, el bot conserva los roles de profesión que ya tuviera esa persona.

El bot de recruitment puede compartir este mismo archivo SQLite y guardar automáticamente el personaje main y reino del apply al aceptarlo. En ese caso, monta la misma carpeta de datos del servidor en ambos contenedores; no copies la base de datos a otra ubicación. Después de la aceptación, ejecuta `/sincronizacion-ejecutar` o espera al siguiente ciclo automático para asignar los roles.

## Configuración

1. Crea una aplicación de Discord y un bot en [Discord Developer Portal](https://discord.com/developers/applications). Copia el token y el Application ID.
2. Invita el bot al servidor con los scopes `bot` y `applications.commands`, y permisos `View Channels`, `Read Message History`, `Send Messages`, `Manage Roles`, `Manage Channels` e `Embed Links`. Coloca su rol por encima de todos los roles que sincronizará y dale acceso a la categoría/canales privados de Raider para que pueda renombrarlos y publicar avisos. No le concedas Administrador. No necesita activar **Server Members Intent**.
3. Crea una aplicación en el [portal de desarrolladores de Battle.net](https://develop.battle.net/access/) y copia el Client ID y Client Secret.
4. Copia `.env.example` a `.env` y completa:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
OFFICER_ROLE_IDS=id_rol_oficial,id_rol_oficial2
OFFICER_REPORT_CHANNEL_ID=id_canal_de_informes
RELEASE_NOTES_CHANNEL_ID=id_canal_entrada
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
# Opcional: ruta dentro del proceso/contenedor
DATABASE_PATH=./data/whitebird-wow-roles.sqlite
```

`WOW_DEFAULT_RANK_ROLE_ID` no figura en `.env.example`, pero el código lo admite y usa `1463652921898963147` si se omite. Configúralo explícitamente si tu rol por defecto tiene otro ID. Todos los IDs de rango, profesión y rol por defecto deben ser distintos, corresponder a roles existentes, no gestionados por otra integración y estar por debajo del rol del bot. Si alguno incumple estas condiciones, la sincronización se cancela antes de aplicar cambios.

Los rangos son las posiciones numéricas del roster de Blizzard (0 es Guild Master). Si el rango actual no tiene entrada en `WOW_RANK_ROLE_IDS`, el bot quita los roles de rango configurados que tenga la persona y le asigna el rol por defecto `WOW_DEFAULT_RANK_ROLE_ID` (Viajante). Si un personaje vinculado deja de aparecer en el roster, `/sincronizacion-ejecutar` le quita los roles de rango y profesión configurados y le asigna Viajante; conserva el vínculo guardado. Las profesiones se configuran con sus nombres ingleses y requieren `WOW_LOCALE=en_US`. Sustituye los ejemplos por IDs de roles que ya existan en el servidor. El bot no crea, cambia de nombre ni elimina roles. Para los rangos, mantiene un único rol correspondiente al rango actual; los roles de profesión solo se añaden y no se retiran mientras el personaje siga en el roster, porque pueden corresponder a profesiones de alters. La vinculación automática solo busca entre miembros actuales del roster de la guild configurada.

La sincronización automática diaria se configura con `WOW_SYNC_HOUR` (hora de 0 a 23) y `WOW_SYNC_TIMEZONE` (zona IANA, por ejemplo `Europe/Madrid`). `/sincronizacion-ejecutar` también mantiene los canales asociados con el formato `rol-nombre-reino`: obtiene el nombre del rol actual a partir de los IDs configurados en `WOW_RANK_ROLE_IDS` y, si corresponde, de `WOW_DEFAULT_RANK_ROLE_ID`. Si no encuentra uno de esos roles en el miembro, usa `raider`. Primero busca por el ID guardado; si no encuentra un canal de texto válido, busca uno cuyo nombre termine en `-nombre-reino` y guarda su ID. No crea canales Raider. El bot debe poder ver y gestionar el canal. Los cambios y los fallos de permisos aparecen en el informe.

Al cambiar el main de una cuenta ya vinculada, el bot renombra de inmediato el canal Raider asociado y publica allí el personaje anterior, el nuevo y el cambio de nombre del canal. Para ello necesita gestionar el canal y enviar mensajes. La respuesta privada indica si hubo algún problema con el canal.

Configura `OFFICER_REPORT_CHANNEL_ID` con un canal de texto privado para oficiales. Cada sincronización diaria publicará allí el resumen de cambios de roles, canales renombrados y omisiones. El bot necesita permiso para ver y enviar mensajes en ese canal.

Configura `RELEASE_NOTES_CHANNEL_ID` con el ID del canal de entrada. Al arrancar, el bot publica la primera sección (`## ...`) de `RELEASE_NOTES.md` una sola vez por contenido y servidor; guarda el identificador de la nota en SQLite para no repetirla tras reiniciar. Cuando prepares otra versión, añade su sección al principio del archivo y despliega el bot. Si cambia el título o el cuerpo de esa sección, se considera una nota nueva. El anuncio completo debe caber en 2000 caracteres. Dale permiso para ver y enviar mensajes en el canal.

## Rol conjunto roster

Crea en Discord un rol llamado `roster`, sin permisos adicionales, y colócalo debajo del rol del bot. Configura `WOW_ROSTER_ROLE_ID=ID_DEL_ROL` en el `.env` de OCI y recrea el contenedor para aplicar la variable. Si quieres que cualquier miembro pueda mencionar `@roster`, activa «Permitir que cualquiera mencione este rol» en Discord.

Configura `WOW_ROSTER_MIN_RANK=4` para incluir los rangos de Blizzard 0, 1, 2, 3 y 4: los números menores representan rangos superiores y 0 es Guild Master. El valor por defecto es 4 y debe ser un entero no negativo. La sincronización manual o diaria añade `roster` a personas con personaje vinculado que cumpla ese umbral, independientemente del nombre del rol de Discord o de su mapeo en `WOW_RANK_ROLE_IDS`. Retira `roster` si pasan a un rango inferior (número mayor que el mínimo configurado) o salen de la guild. El comando `/vinculacion-quitar` lo retira antes de eliminar la vinculación. No se recorren los miembros sin vinculación ni se cambian sus roles; no asignes `roster` manualmente a esas personas si quieres mantener esta condición.

El ID debe ser distinto de los roles de rango, profesión y Viajante. Se valida su existencia y jerarquía antes de aplicar cambios y los cambios aparecen en el historial. Sin `WOW_ROSTER_ROLE_ID`, esta función queda desactivada. Tras desplegar y configurar el ID, ejecuta `/sincronizacion-ejecutar` para asignarlo a los miembros que ya están vinculados.

## Felicitación al ascender de Recluta a Raider

Cuando una sincronización automática, `/sincronizacion-ejecutar` o `/sincronizacion-usuario` aplica el cambio de **Recluta** a **Raider**, el bot publica una felicitación en el canal Raider personal y menciona únicamente al miembro ascendido. Ambos roles deben estar incluidos en `WOW_RANK_ROLE_IDS` y llamarse `Recluta` y `Raider` (sin distinguir mayúsculas ni espacios exteriores). No necesita una variable adicional.

El mensaje explica las ventajas acordadas para Whitebird:

> 🎉 ¡Enhorabuena! Has pasado de **Recluta** a **Raider** de Whitebird. ¡Gracias por tu compromiso con la guild!
>
> 📅 **Asistencia a raid:** en WoWAudit contamos contigo por defecto. Solo tendrás que notificar cuando **no puedas venir**.
>
> 🔧 **Reparaciones de guild:** cuando se activen, podrás reparar tu equipo a cargo de la hermandad.
>
> ¡A por muchas más raids juntos! 💜

Este aviso comunica las condiciones de la guild; no cambia la configuración de asistencia de WoWAudit ni los permisos de reparación dentro del juego. La detección utiliza los roles de Discord anteriores a la sincronización y el rango obtenido de Blizzard: no envía mensajes retroactivos a raiders existentes ni considera ascenso la primera vinculación de alguien sin el rol Recluta. Los cambios de rol hechos fuera de la sincronización no generan por sí solos este aviso.

`wow_raider_promotions` guarda el estado del aviso para enviar como máximo una felicitación por miembro y servidor, incluso después de reiniciar o de un nuevo ascenso de la misma persona. Si falta un canal accesible, permanece pendiente y se intenta en una sincronización posterior mientras el mismo main siga vinculado y su rango corresponda a Raider. Los rechazos confirmados por permisos o canal ausente permiten reintentar; una entrega incierta o un fallo al guardar el ID del mensaje conserva la marca de envío para evitar duplicados y requiere revisar los logs. El resumen de sincronización muestra los envíos y los fallos sin detener el resto de tareas.

## Reparto y avisos de calderos

El bot guarda las asignaciones semanales en SQLite. Al iniciar por primera vez para un servidor, precarga este reparto definido en `src/index.js`; no sobrescribe los cambios posteriores:

| Día | Potis | Frascos |
|---|---|---|
| Lunes | Asherrna | Yaihy |
| Martes | Daphne | TheAngel |
| Miércoles | Zness | Sacelean |
| Jueves | Darkmur | TheAngel |

 Los oficiales pueden cambiar una asignación con `/calderos-asignar dia tipo usuario`; el miembro seleccionado debe tener un main vinculado y un canal Raider asociado. El mensaje público muestra el nombre de ese main y se genera desde esos mismos datos.

Los avisos de calderos se envían al canal Raider a las **22:00 de `WOW_SYNC_TIMEZONE`** (`Europe/Madrid` por defecto), cuando hay asignaciones para ese día. La sincronización automática de roles permanece a las **4:00** por defecto (`WOW_SYNC_HOUR`); esa tarea ya no envía avisos de calderos.

El encabezado muestra la mención del rol de Alquimista configurado como `Alchemy` en `WOW_PROFESSION_ROLE_IDS`, sin enviar una notificación masiva. El bot solo referencia ese rol existente; no crea ni modifica roles.

Para publicar el mensaje inicial, ejecuta `/calderos-publicar canal:#canal-de-crafteos`. Después, cada cambio de asignación actualiza ese mensaje del bot. Discord no permite que el bot edite un mensaje escrito por una persona, así que la primera publicación crea un mensaje nuevo; el mensaje manual anterior se puede borrar.

Los recordatorios de calderos son independientes de la sincronización de roles. Si una persona lleva ambos tipos de caldero, recibe un único mensaje con los dos. La asignación se resuelve por nombre de personaje: si no hay un vínculo único con canal Raider, se omite el aviso y se registra en los logs. Menciona únicamente a la persona correspondiente. Requiere que el bot pueda ver y enviar mensajes en el canal de crafteos y en los canales privados Raider.

Las propuestas pendientes de `/vinculacion-buscar` se guardan temporalmente en memoria, caducan a los cinco minutos y se muestran en `/vinculacion-listar`. Si se reinicia el bot, esas propuestas desaparecen; los vínculos confirmados sí permanecen guardados en SQLite.

## Pruebas automáticas

El proyecto incluye pruebas de detección y entrega de felicitaciones de ascenso, deduplicación tras reinicios y fallos de canal/permisos/red, de los seis órdenes del informe de raiders, enlaces a canales, migración del destino, persistencia del informe y concurrencia entre actualizaciones y ordenación, además de la sincronización de rangos y profesiones, salidas del roster y de Discord, conservación de roles cuando Blizzard falla, nombres con acentos, renombrado de canales Raider, avisos diarios y sus horarios, persistencia de vinculaciones y calderos, propuestas y decisiones BIS, y recuperación de paneles. No necesitan credenciales reales ni hacen llamadas a servicios externos.

Ejecuta las pruebas dentro del contenedor:

```sh
docker compose build bot
docker compose run --rm --no-deps bot npm test
```

También puedes ejecutarlas directamente con Node.js 22 o posterior mediante `npm test`. Usa la misma versión principal que el contenedor para que `better-sqlite3` cargue su binario nativo compatible.

## Despliegue con Docker Compose

Desde este directorio, en el servidor Ubuntu, crea el archivo de configuración y completa sus valores:

```sh
cp .env.example .env
mkdir -p data
# El usuario node del contenedor (UID 1000) necesita escribir en data/.
# Edita .env y completa los valores antes de seguir.
docker compose build bot
docker compose run --rm --no-deps bot npm run register
docker compose up -d
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

La base de datos permanece en `data/` aunque se reconstruya o se pare el contenedor. Añade `OFFICER_REPORT_CHANNEL_ID` al `.env` del servidor para habilitar los informes diarios y `RELEASE_NOTES_CHANNEL_ID` para anunciar las versiones.

La carpeta `data/` del host contiene `whitebird-wow-roles.sqlite`. Para que el bot de recruitment comparta los vínculos de los applies aceptados, configura allí `WOW_ROLE_SYNC_DATA_DIR` con la ruta absoluta a esta carpeta; ambos contenedores deben montar esa misma carpeta.

## Pipeline de GitHub Actions a OCI

El workflow `.github/workflows/deploy.yml` construye la imagen y ejecuta `npm test` en cada pull request y push a `main`. Si pasan las pruebas, los pushes a `main` despliegan por SSH. También puedes lanzarlo desde **Actions → Test and deploy to OCI → Run workflow**, seleccionando `main`. Otras ramas no despliegan. Los despliegues se ejecutan de uno en uno y no se interrumpen al llegar otro push.

### Preparación del servidor (una vez)

Usa una carpeta **dedicada exclusivamente a este repositorio**, con el `.env` configurado y `data/` con permisos para UID 1000. Puede ser la carpeta en la que ya ejecutas este bot. El despliegue sincroniza el código con `rsync --delete`: elimina los archivos que no estén en GitHub, salvo `.git/`, `.env`, `data/`, `node_modules/`, `.deploy.lock` y `.allow-github-deploy`. No guardes copias de seguridad, otros bots ni configuraciones adicionales en esa carpeta.

El usuario SSH debe poder escribir en esa carpeta y ejecutar `docker` y `docker compose` sin sudo ni preguntas interactivas. El servidor necesita Bash, rsync y flock (util-linux), además de Docker con Compose v2. El puerto SSH debe ser accesible desde los runners de GitHub tanto en las reglas de OCI como en el firewall del sistema.

Tras revisar la ruta, crea el marcador que permite desplegar en ella:

```sh
cd /home/ubuntu/whitebird-wow-role-sync
test -f .env && test -d data && touch .allow-github-deploy
chmod 600 .env
```

Sustituye la ruta del ejemplo por la real. Si `data/` aún no existe, créala y asigna permisos para UID 1000 antes de continuar; no cambies los permisos de una base compartida sin revisar los otros contenedores.

Crea una clave SSH exclusiva para Actions, sin contraseña, y añade su **clave pública** al `~/.ssh/authorized_keys` del usuario del servidor. Guarda la privada únicamente en el secret indicado abajo. No necesitas instalar Git ni dar acceso del servidor al repositorio privado: el runner envía el código por rsync.

### Secrets en GitHub

En **Settings → Secrets and variables → Actions → Repository secrets**, añade:

| Secret | Valor |
|---|---|
| `OCI_HOST` | `130.162.51.21` |
| `OCI_USER` | `ubuntu` |
| `OCI_SSH_KEY` | Clave privada completa de despliegue, con sus saltos de línea. |
| `OCI_KNOWN_HOSTS` | Entrada SSH de host verificada del servidor. |
| `OCI_DEPLOY_PATH` | `/home/ubuntu/whitebird-wow-role-sync` |
| `OCI_SSH_PORT` | Opcional; por defecto `22`. |

Para preparar `OCI_KNOWN_HOSTS`, desde un equipo de confianza ejecuta `ssh-keyscan -p 22 -H 130.162.51.21`. **Verifica la huella** con la obtenida desde la consola de OCI usando `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` antes de guardar la línea correspondiente a esa clave. Usa el puerto real si es distinto. La pipeline exige verificar el host y no acepta automáticamente claves nuevas.

No subas el `.env` ni las credenciales de Discord/Blizzard a GitHub: permanecen en OCI. Usa secrets del repositorio para que la configuración también sirva en repositorios privados con GitHub Free.

### Comportamiento y comprobación

La pipeline comprueba la configuración, construye la imagen en OCI (también si la máquina es ARM), registra los comandos de Discord y recrea solo el servicio `bot`. Conserva la base de datos y espera hasta 60 segundos a que el nuevo contenedor se conecte a Discord sin reinicios. Si falla la construcción o el registro, no recrea el bot que estaba en ejecución. El cambio de contenedor produce una breve interrupción.

Si falla el arranque, Actions marca el despliegue como fallido; no hay rollback automático. Revisa `docker compose logs bot` en OCI. La comprobación confirma la conexión a Discord, no el funcionamiento de todas las integraciones. Para volver a una versión anterior, revierte el commit en `main` y deja que la pipeline vuelva a desplegar.

Configura en GitHub el presupuesto de Actions con bloqueo del consumo adicional si quieres impedir cargos fuera de la cuota gratuita. La pipeline no almacena artefactos ni publica imágenes en un registro.

## Ejecución directa con Node.js

Requiere Node.js 22 o posterior; `.nvmrc` selecciona la versión principal 22 y el Dockerfile fija `22.23.4-bookworm-slim`. `better-sqlite3` incluye un módulo nativo: si no hay un binario precompilado para tu plataforma, la instalación necesita Python, make y un compilador C++.

```sh
cp .env.example .env
# Edita .env
npm ci
npm run register
npm start
```

Mantén `data/` y `.env` en el servidor y fuera de Git. Este proyecto puede desplegarse y reiniciarse sin afectar al bot de la ruleta.

## Informe de raiders de WoWAudit

Integración opcional: miércoles a las **20:00 Europe/Madrid**, con cambios de horario de verano/invierno. No requiere cron ni otra automatización. Configura en `.env`:

```dotenv
WOWAUDIT_API_KEY=<clave del equipo de WoWAudit>
# Necesario para los avisos diarios de encantamientos y gemas
WOWAUDIT_TEAM_ID=66082
WOWAUDIT_LOOT_WINDOW_DAYS=
WOWAUDIT_LOOT_CATEGORIES=BIS,Mejora de stats,set 4p,Catalizar
WOWAUDIT_LOOT_RANKS=Oficiales,Fijo,Rotativo,Trial
```

La clave selecciona el equipo de WoWAudit. Guarda `.env` solo en el servidor (`chmod 600 .env`); nunca en Git ni en la imagen. Las variables `WOWAUDIT_LOOT_*` siguen configurando el recuento de la columna Loot del informe de raiders. Para actualizar la tabla y elegir el canal del informe de raiders, ejecuta `/informe-raiders canal:#tu-canal`; si omites `canal`, se reutiliza el destino guardado en SQLite. Sin destino, la tarea semanal espera a que se seleccione uno. El bot necesita Ver canal, Enviar mensajes, Leer historial e Insertar enlaces en el destino. Sin clave la integración WoWAudit queda desactivada; los errores no detienen Blizzard.

### Propuestas de listas BIS para raiders

Un oficial ejecuta `/bis-proponer raider:@miembro actividad:Raid` (también están disponibles General y Mítico+). El miembro debe tener un personaje main vinculado y un canal Raider asociado; el bot obtiene su clase del roster de WoWAudit. En el canal Raider, el destinatario elige especialización y después la fuente, actualmente Method o Blingtron. El valor de `actividad` selecciona la lista General/Overall, Raid o Mítico+/Mythic+ correspondiente. El bot consulta esa guía, comprueba que la tabla y sus objetos se puedan interpretar y publica una propuesta con los objetos enlazados a Wowhead y su procedencia. De Blingtron muestra como máximo los cuatro abalorios mejor clasificados por puntuación. Si Method proporciona al menos cuatro abalorios en la clasificación del contexto elegido, muestra sus cuatro primeros en el orden de la guía; si no, conserva las ranuras Abalorio 1 y 2 de la tabla de equipo. Si la página cambia, la respuesta es incompleta o falta un ID de objeto, cancela sin guardar una lista parcial. El raider puede editar, aceptar o rechazar la propuesta; solo ese usuario puede usar los controles. Para editar, selecciona el objeto/ranura y escribe el nombre, ID de Wowhead y procedencia del reemplazo; el embed y la lista guardada se actualizan y la sustitución queda marcada como manual.

El feed de Blingtron no publica una recomendación de ranura Dedo para Priest Holy. Cuando se elige esa fuente, el bot muestra la ranura vacía, sin inventar un objeto, y permite rellenarla desde **Editar objeto**.

Al aceptar, Whitebird guarda en SQLite la especialización, actividad, objetos, fuentes y datos de la guía como una lista asociada al raider; esa lista pasa a ser su lista activa. Los reemplazos que haga el raider actualizan la lista activa y se guardan en el historial de ediciones. Al rechazar, Whitebird borra la referencia activa del raider y conserva el registro de la decisión. La lista activa anterior también deja de estar activa al rechazar una nueva propuesta. Al crear otra propuesta, las anteriores en selección de especialización, construcción o revisión pasan a estar sustituidas. En la implementación actual, una propuesta que esté esperando la selección de fuente no se invalida en ese paso. Las propuestas BIS se guardan en SQLite y no tienen la caducidad de cinco minutos de las búsquedas de vinculación.

La fuente seleccionada y la fecha de consulta se conservan con la lista; Method también guarda el parche indicado por la guía. La aceptación guarda la lista en SQLite de Whitebird; el código no la sube a WoWAudit. La selección requiere `WOWAUDIT_API_KEY` para consultar la clase del personaje y que WoWAudit devuelva una ficha única del main vinculado. El bot necesita Ver canal, Enviar mensajes e Insertar enlaces en cada canal Raider. El catálogo de especializaciones se consulta en Blingtron incluso cuando se elige Method. Las guías no son simulaciones personalizadas y sus cambios de formato pueden impedir preparar una propuesta.

### Columnas y orden del informe

El **informe de raiders** es el único informe semanal de WoWAudit. Se publica como un único mensaje sin embed ni paginación, usando un bloque de texto de Discord (Text Display) con una tabla en un único bloque de código con las columnas `Nombre`, `Loot`, `Keys`, `Raid` e `iLvl`. Una línea horizontal separa la cabecera de los datos. No incluye canales Raider: dentro del bloque de código las menciones no son clicables y se omite la lista separada.

Por defecto se ordena por iLvl de mayor a menor. El selector **Ordenar informe** permite a los oficiales elegir **loot, iLvl o nombre**, en sentido **ascendente o descendente**. El cambio afecta al mensaje compartido, no realiza nuevas consultas a WoWAudit y conserva los datos de la última actualización. El orden y esos datos se guardan en SQLite; el orden elegido se mantiene al reiniciar y en las siguientes actualizaciones. Los iLvl desconocidos siempre aparecen al final; los empates numéricos se resuelven por nombre/reino.

`/informe-raiders canal:#tu-canal` publica o actualiza el informe y guarda el destino; sin `canal` reutiliza el guardado. El proceso también lo actualiza los miércoles a las 20:00 Europe/Madrid.

### Avisos de encantamientos y gemas

Con `WOWAUDIT_API_KEY` y `WOWAUDIT_TEAM_ID` configurados, cada día a las **22:00 Europe/Madrid** el bot consulta el roster `/v1/characters` y el perfil `/api/characters/{id}` de los personajes vinculados. Compara el rol de raid del roster con el rol de la especialización identificada por `currentSpec.id` (o `currentSpecId`), usando la tabla local `SPECIALIZATION_ROLES` en `src/combat-roles.js`, sin utilizar `default_role`: Tank corresponde a tank, Heal/Healer a healer y Melee/Ranged a DPS. Si no coinciden, falta la especialización o el rol es desconocido, omite la comprobación y registra el motivo. Por ejemplo, un healer con especialización Shadow no recibe avisos. El equipo, los encantamientos y las gemas se leen de `details.gear` de la misma respuesta que contiene la especialización; son los últimos datos guardados por WoWAudit, no información en directo. Estas rutas de perfil son internas y su formato puede cambiar. Los avisos se envían al canal Raider asociado, mencionando al propietario y agrupando sus personajes. Se incluyen todos los rangos, también Trial. Las vinculaciones ambiguas o sin canal no se notifican.

Los encantamientos de baja calidad tienen un aviso separado. Si el perfil indica alguno, el bot consulta `/api/teams/{id}/overview_data` para identificar las piezas. Si los datos de calidad difieren, muestra o registra que no pudo verificarlos y conserva las incidencias de encantamientos ausentes y gemas. `/equipo-comprobar` muestra las incidencias en privado incluso si falta el canal Raider.

En cada sincronización de rangos (manual o automática), con `WOWAUDIT_API_KEY` configurada, también se actualizan los roles de combate desde el **rol del roster de WoWAudit**, independientemente de la especialización del equipo: Tank → **Tankes**, Heal/Healer → **Healers**, Melee/Ranged → **DPS**. Debe existir exactamente un rol de cada nombre en Discord (sin distinguir mayúsculas) y los tres deben estar por debajo del bot en la jerarquía. Se añade el correspondiente y se retiran los otros dos, registrándolo en el historial como combate. Si falta el personaje o el rol de WoWAudit, hay ambigüedad o falla la consulta, se conservan los roles de combate actuales y el informe registra el motivo. Los errores de esta integración no impiden actualizar rangos y profesiones. Si el personaje sale del roster de Blizzard o deja de cumplir el umbral del rol de Discord configurado en `WOW_ROSTER_ROLE_ID`, la sincronización retira sus roles de combate gestionables aunque WoWAudit no esté disponible. `/vinculacion-quitar` también retira los roles de combate cuando retira el rol de roster.

`WOWAUDIT_TEAM_ID` es el identificador numérico del equipo en WoWAudit (`.env.example` incluye `66082`; comprueba que corresponda a tu equipo). Esta consulta usa una ruta JSON interna de WoWAudit que no aparece en su API pública documentada; el formato puede cambiar sin aviso. Si WoWAudit no responde con el esquema esperado, el bot no envía avisos parciales. Si falta el canal o el bot no puede escribir en él, ese aviso falla y los demás canales se procesan igualmente.

**Consultas utilizadas por el código:** `GET /v1/period` selecciona `current_season.keystone_season_id` si existe o, en su ausencia, `current_season.id`. `GET /v1/characters` obtiene el roster y `GET /v1/loot_history/{id}` devuelve `history_items`. El destinatario se toma de `character_id`. Las peticiones usan `Authorization: Bearer ...`; el filtro temporal se aplica localmente. Las pruebas incluyen ejemplos de contrato y una respuesta de período guardada en `test/fixtures/`; no equivalen a una comprobación en vivo del equipo actual.

**Cálculo:** número de adjudicaciones registradas y no descartadas, una por objeto, solo con `difficulty=mythic` y la categoría final en BIS, Mejora de stats, set 4p o Catalizar: se usa `response_type.propagated_to.name` cuando hay una fusión, y `response_type.name` en caso contrario. `WOWAUDIT_LOOT_CATEGORIES` permite ajustar los nombres al equipo; se ignoran mayúsculas y espacios repetidos, sin coincidencias parciales. Categorías nulas no cuentan. Se respeta la categoría final de las fusiones configuradas en WoWAudit, como hace su tabla de estadísticas; no se cuenta también la categoría original. El indicador `excluded` no altera la selección explícita de nombres. Por defecto desde `current_season.start_date` a las 00:00 UTC hasta el miércoles a las 20:00 Madrid, extremo final excluido. La fecha oficial no trae zona; UTC es una convención explícita. `WOWAUDIT_LOOT_WINDOW_DAYS=N` (entero entre 1 y 3660) limita a las últimas N×24 horas, siempre dentro de la temporada actual: no consulta temporadas anteriores. El cierre se mantiene fijo durante los reintentos.

**Tabla de raiders:** obtiene `current_period` y `GET /v1/historical_data?period=...`. Keys muestra los niveles de las mejores runs que cuentan para los umbrales 1/4/8; Raid Vault muestra los niveles de objeto de sus tres opciones, porque WoWAudit no da directamente la etiqueta M/H. El iLvl actual se lee de `details.currentItemLevel` en el JSON de perfil `GET /api/characters/{id}`. Esta ruta interna no forma parte de la API `/v1` documentada y su formato puede cambiar. Su `currentItemLevel` evita el cálculo incorrecto de promediar otra vez campos internos de `best_gear`. La columna Loot muestra solo el total Mythic de las categorías seleccionadas. El resumen incluye los rangos, el número de personajes y objetos y los filtros aplicados; no incluye asistencia ni progreso de raid. Si falta el iLvl se muestra `—`; sin actividad semanal, Keys muestra `—/—/—` y Raid `-/-/-`. Cuando hay datos semanales, un umbral de Keys no completado aparece como `0` y una opción de raid nula como `-`. Una estructura incompatible cancela la actualización. Las consultas de perfiles se limitan a cuatro peticiones simultáneas.

El roster relevante es el **roster actual del equipo de WoWAudit**, con `status=tracking` y rangos Oficiales, Fijo, Rotativo y Trial. `WOWAUDIT_LOOT_RANKS` permite ajustar esta selección (sin distinguir mayúsculas ni espacios repetidos). Se inicializa con cero antes de contar. Cada personaje seleccionado se cuenta independientemente; no se suma loot de alts. No reconstruye rosters históricos ni divide por asistencia: recién incorporados pueden tener cero. No infiere propietarios de alts. La base existente solo vincula un main por usuario. El canal Raider se resuelve por nombre y reino normalizados, únicamente si la coincidencia es única. Un duplicado de identidad en WoWAudit cancela el informe; el informe no muestra canales Raider.

Se deduplica por `id` y por `rclootcouncil_id` cuando existe; duplicados incompatibles cancelan el informe. Dos objetos iguales adjudicados legítimamente cuentan dos veces. Se incluyen todos los personajes seleccionados, incluidos los que tienen cero loot. Si el informe completo supera los límites de Discord, se cancela la actualización sin recortar el roster ni sobrescribir el mensaje anterior.

### Actualización y recuperación de paneles

Conserva el volumen y ejecuta una sola instancia del bot. `wowaudit_raider_panels` guarda el ID del mensaje, estado de creación y última semana actualizada; `wowaudit_raider_views` guarda los datos mostrados y el orden. El primer envío crea el mensaje y los siguientes lo editan, también después de reiniciar.

Al actualizar desde la versión anterior, se conserva el destino configurado y el mensaje de raiders. Se eliminan de SQLite las tablas obsoletas del informe separado de loot. Los mensajes de loot ya publicados en Discord no se borran automáticamente; puedes borrarlos manualmente.

Consulta al arrancar y cada minuto: entre las 20:00 y las 20:59 del miércoles actualiza el informe una vez esa semana, con cierre fijo a las 20:00. Fuera de esa hora espera a la semana siguiente. Fallos anteriores a crear o durante una edición se reintentan cada cinco minutos durante esa hora. La API tiene timeout de 15 segundos por petición y hasta tres intentos para fallos transitorios/429. No registra claves ni cuerpos de error.

Si el mensaje guardado fue borrado (Discord Unknown Message), crea un reemplazo y guarda su nuevo ID. Fallos de acceso/permisos/red no generan un mensaje nuevo. Una creación incierta conserva el estado `creating` para evitar duplicados. Primero revisa `docker compose logs --tail=200 bot`: la entrada `[WoWAudit/Discord]` indica operación, estado HTTP, código Discord/red/SQLite y rutas de campos rechazados, sin tokens ni cuerpos completos. Una entrada `blocked-creation` describe la marca pendiente y no demuestra la causa del fallo original. Si el proceso antiguo no registró el error original, no se puede recuperarlo del aviso genérico. No se desbloquea el estado por ensayo: cualquier reparación requiere investigar primero la causa y confirmar la entrega real. Si falla la persistencia tras enviar, los logs incluyen el ID devuelto por Discord para recuperar ese mensaje. Respaldar la base antes de corregir manualmente.


Validación automática con fixtures y respuestas simuladas. Para validar datos reales, configura la clave del equipo y comprueba una adjudicación conocida, un personaje con cero y el roster antes del primer miércoles.

La categoría **set 4p** es independiente de **Catalizar**. Si tu `.env` ya contiene el antiguo valor `set 4p Catalizar`, cámbialo a `WOWAUDIT_LOOT_CATEGORIES=BIS,Mejora de stats,set 4p,Catalizar` y recrea el contenedor para cargarlo.

El sitio web puede agrupar loot de alts por propietario; este bot sigue contando por personaje y solo para el roster/rangos seleccionados. Al contrastar resultados, comprueba ese alcance además de dificultad, categorías y período. La API devuelve la respuesta original del botón RCLootCouncil en `response_type` y su destino de fusión en `propagated_to`; filtrar solo el nombre original puede omitir adjudicaciones que la web muestra en BIS o Mejora de stats.

Para inspeccionar los paneles de raiders y sus permisos sin enviar ni editar mensajes ni modificar SQLite:

```sh
docker compose exec -T bot node src/raider-inspect.js
```

La inspección abre SQLite en modo de solo lectura y hace consultas GET a Discord. Muestra IDs/estado del panel, permisos actuales y si el mensaje guardado pertenece al bot. No demuestra por sí sola la causa de un fallo pasado; se contrasta con los logs originales. No muestra tokens ni contenido de mensajes.


## Persistencia y mantenimiento

Por defecto se usa `./data/whitebird-wow-roles.sqlite`, relativo al directorio desde el que se ejecuta Node.js. `DATABASE_PATH` permite cambiarlo; con Docker debe apuntar a una ubicación del volumen persistente (`/app/data`), para conservar los datos al recrear el contenedor.

SQLite utiliza WAL y crea o migra las tablas al cargar `src/database.js`. Guarda vínculos y canales Raider, historial de roles, felicitaciones de ascenso, reparto y panel de calderos, notas publicadas, destino y estado de los informes y propuestas, decisiones y ediciones BIS. Las búsquedas de vinculación sin confirmar son el único estado descrito aquí que permanece exclusivamente en memoria.

Para una copia sencilla, para el bot y cualquier otro proceso que comparta la base, copia la carpeta `data/` completa y vuelve a arrancarlos. Si haces una copia en caliente, utiliza un mecanismo de backup de SQLite compatible con WAL; copiar solo el archivo `.sqlite` mientras está en uso puede omitir cambios pendientes.

Ejecuta una sola instancia de este bot: las tareas diarias no guardan una marca de envío persistente y varias instancias podrían duplicar avisos. Conserva `.env` y `data/` fuera de Git; ambos están excluidos también del contexto de construcción Docker.

`/vinculacion-quitar` elimina únicamente el vínculo: no retira roles ni borra canales, listas BIS o asignaciones de calderos. Al crear o cambiar un vínculo, los roles se actualizan en la siguiente sincronización automática o al ejecutar uno de los comandos de sincronización.

Si aparece un error de escritura de SQLite en Docker, comprueba los permisos de la carpeta `data/` del host: el contenedor se ejecuta como `node` (UID 1000). El bind mount exige que la carpeta exista antes de iniciar el servicio. Tras cambiar `.env`, recrea el contenedor con `docker compose up -d`; reiniciarlo sin recrearlo no actualiza las variables inyectadas por Compose.

## Estructura del código

| Archivo | Responsabilidad |
|---|---|
| `src/index.js` | Arranque, autorización de oficiales, interacciones, auditoría y programación diaria de roles y calderos. |
| `src/register-commands.js` | Definición y registro de los 14 comandos del servidor. |
| `src/raider-promotion.js` | Detección de Recluta → Raider, mensaje de felicitación y entrega sin duplicados. |
| `src/wow-sync.js` | Blizzard OAuth, roster, búsqueda de personajes, roles y nombres de canales Raider. |
| `src/database.js` | Esquema, migraciones y persistencia SQLite. |
| `src/daily-cauldron.js` | Resolución de asignaciones, agrupación de avisos y cálculo del siguiente horario diario. |
| `src/cauldron-panel.js` | Presentación y actualización del panel de calderos. |
| `src/wowaudit.js` | Cliente WoWAudit, validación, recuento de loot y tabla de raiders. |
| `src/raider-scheduler.js` | Ejecución semanal y reintentos del informe de raiders. |
| `src/raider-render.js` | Tabla del informe con separador de cabecera y los seis órdenes disponibles. |
| `src/raider-report.js` | Actualización y ordenación con bloqueo y persistencia del informe mostrado. |
| `src/raider-panel.js` | Creación y edición de informes con estado persistente y control de duplicados. |
| `src/raider-diagnostics.js` | Diagnósticos de Discord/SQLite con códigos y campos de validación. |
| `src/raider-inspect.js` | Inspección de paneles de raiders y permisos en modo de solo lectura. |
| `src/gear-reminders.js` | Consulta de auditoría y avisos diarios de encantamientos/gemas. |
| `src/bis-lists.js` | Consulta de Method/Blingtron, extracción de objetos y presentación BIS. |
| `src/release-notes.js` | Lectura, identificación por contenido y anuncio de la primera nota de versión. |
| `test/` | Pruebas y fixtures sin credenciales reales. |
