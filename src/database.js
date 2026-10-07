import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const databasePath = resolve(process.env.DATABASE_PATH || './data/whitebird-wow-roles.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS wow_links (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    character_name TEXT NOT NULL,
    realm_slug TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id),
    UNIQUE (guild_id, character_name, realm_slug)
  );
`);

export function saveWowLink(guildId, userId, characterName, realmSlug) {
  return db.prepare(`INSERT INTO wow_links (guild_id, user_id, character_name, realm_slug)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET character_name=excluded.character_name,
    realm_slug=excluded.realm_slug, updated_at=CURRENT_TIMESTAMP`)
    .run(guildId, userId, characterName, realmSlug);
}

export function getWowLinks(guildId) {
  return db.prepare('SELECT user_id, character_name, realm_slug FROM wow_links WHERE guild_id = ? ORDER BY character_name').all(guildId);
}

export function getWowLink(guildId, userId) {
  return db.prepare('SELECT character_name, realm_slug FROM wow_links WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

export function removeWowLink(guildId, userId) {
  return db.prepare('DELETE FROM wow_links WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes;
}
