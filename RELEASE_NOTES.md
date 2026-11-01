# Release notes — Whitebird WoW Role Sync

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

