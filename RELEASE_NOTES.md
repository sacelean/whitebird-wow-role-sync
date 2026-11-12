# Release notes — Whitebird WoW Role Sync

## 2026-11-12 · Doble comprobación antes de retirar roles

- Si un personaje falta en el roster de la guild, la sincronización consulta su perfil de Blizzard antes de retirarle roles por salida de la hermandad. Si sigue en la guild o no se puede verificar, conserva los roles y el canal e informa del motivo.

## 2026-11-08 · Auditoría de equipo, cambios de main y roles de roster

- Los avisos de equipo incluyen los encantamientos de baja calidad detectados por WoWAudit, indicando las piezas afectadas. Si no se pueden verificar, se informa del problema y se mantienen los avisos de encantamientos ausentes y huecos de gema vacíos.
- `/equipo-comprobar` muestra las incidencias en el diagnóstico privado incluso cuando el usuario no tiene un canal Raider asociado.
- Al cambiar el main de una cuenta vinculada, el bot renombra de inmediato su canal Raider y publica allí el personaje anterior, el nuevo y el cambio de nombre del canal. Si hay problemas con el canal o sus permisos, los indica en la respuesta privada.
- Al salir de la guild o dejar de cumplir el rango requerido para el rol `roster`, la sincronización retira también los roles de combate gestionables (**Tankes**, **Healers** y **DPS**), aunque WoWAudit no esté disponible. `/vinculacion-quitar` también los retira cuando elimina el rol de roster.

## 2026-11-02 · Roles de combate y avisos por especialización

- Nuevo comando de oficiales `/equipo-comprobar usuario` para revisar en privado encantamientos, gemas y coincidencia de roles. Con `enviar:true`, envía el aviso real al canal Raider mencionando al usuario; sin esa opción solo muestra el diagnóstico.

- La sincronización manual y automática actualiza los roles **Tankes**, **Healers** y **DPS** según el rol de raid del personaje en WoWAudit. Requiere `WOWAUDIT_API_KEY` y un único rol de cada nombre en Discord, situado por debajo del bot. Si no se puede determinar el rol, se conservan los roles actuales y se registra el motivo.
- Los avisos de encantamientos y gemas solo se comprueban cuando la especialización del equipo guardado en WoWAudit coincide con el rol de raid. Si no coincide o no se puede identificar, se omite el aviso y se registra el motivo; por ejemplo, un healer con especialización Shadow no recibe avisos.

## 2026-11-01 · Rol conjunto roster

- Añadida sincronización opcional del rol `roster` para mencionar conjuntamente a los miembros vinculados con el rango mínimo de Blizzard configurado o uno superior (`WOW_ROSTER_MIN_RANK`, por defecto 4: incluye del 0 al 4).
- El rol se retira al bajar del rango mínimo configurado, salir de la guild o quitar la vinculación. Requiere configurar el ID del nuevo rol en el servidor.

## 2026-11-01 · Ajuste visual de la tabla de raiders

- Recuperada la línea de separación entre la cabecera y los datos.
- Retirada la lista de canales Raider para mantener el informe centrado en una única tabla alineada, sin embed ni paginación.

## 2026-11-01 · Informe de raiders y felicitaciones de ascenso

- El informe de raiders sustituye al informe separado de loot. Se publica en un único mensaje sin embed ni paginación, con una tabla alineada y los enlaces a los canales Raider aparecen debajo, numerados según las filas, para evitar saltos de línea dentro de la tabla.
- Nuevo selector para ordenar por loot, iLvl o nombre, en sentido ascendente o descendente. Los oficiales pueden cambiar el orden del mensaje compartido; se conserva tras reinicios y futuras actualizaciones.
- Se mantiene el mensaje y el destino de raiders y se retiran las tablas antiguas del informe de loot. Los mensajes de loot ya publicados se pueden borrar manualmente.

- Nueva felicitación en el canal personal cuando el bot sincroniza el ascenso de Recluta a Raider: recuerda la asistencia por defecto en WoWAudit y las reparaciones de guild cuando se activen. El aviso se guarda para evitar duplicados.

## 2026-10-25 · Actualización de seguridad

### Cambios

- Actualizada la imagen base a Node.js **22.23.4** (node:22.23.4-bookworm-slim), que incluye las correcciones de seguridad publicadas el 21 de octubre de 2026, incluida **CVE-2026-111497** en el decodificador Brotli.
- No cambia el comportamiento funcional del bot.

