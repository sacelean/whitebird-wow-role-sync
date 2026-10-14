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
    raider_channel_id TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id),
    UNIQUE (guild_id, character_name, realm_slug)
  );
  CREATE TABLE IF NOT EXISTS wow_cauldron_assignments (
    guild_id TEXT NOT NULL,
    weekday TEXT NOT NULL,
    cauldron_type TEXT NOT NULL,
    character_name TEXT NOT NULL,
    PRIMARY KEY (guild_id, weekday, cauldron_type)
  );
  CREATE TABLE IF NOT EXISTS wow_cauldron_panels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wow_cauldron_setup (
    guild_id TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS wow_sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    character_name TEXT NOT NULL,
    realm_slug TEXT NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    role_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_wow_sync_history_guild_id ON wow_sync_history(guild_id, id DESC);
`);

db.transaction(() => {
  const linkColumns = new Set(db.pragma('table_info(wow_links)').map((column) => column.name));
  if (!linkColumns.has('raider_channel_id')) db.exec('ALTER TABLE wow_links ADD COLUMN raider_channel_id TEXT');
}).immediate();

export function saveWowLink(guildId, userId, characterName, realmSlug, raiderChannelId = null) {
  return db.prepare(`INSERT INTO wow_links (guild_id, user_id, character_name, realm_slug, raider_channel_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET character_name=excluded.character_name,
    realm_slug=excluded.realm_slug, raider_channel_id=COALESCE(excluded.raider_channel_id, wow_links.raider_channel_id),
    updated_at=CURRENT_TIMESTAMP`)
    .run(guildId, userId, characterName, realmSlug, raiderChannelId);
}

export function getWowLinks(guildId) {
  return db.prepare('SELECT user_id, character_name, realm_slug, raider_channel_id FROM wow_links WHERE guild_id = ? ORDER BY character_name').all(guildId);
}

export function getWowLink(guildId, userId) {
  return db.prepare('SELECT character_name, realm_slug FROM wow_links WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

export function removeWowLink(guildId, userId) {
  return db.prepare('DELETE FROM wow_links WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes;
}

export function getCauldronAssignments(guildId) {
  return db.prepare('SELECT weekday, cauldron_type, character_name FROM wow_cauldron_assignments WHERE guild_id = ? ORDER BY weekday, cauldron_type').all(guildId);
}

export function setCauldronAssignment(guildId, weekday, type, characterName) {
  return db.prepare(`INSERT INTO wow_cauldron_assignments (guild_id, weekday, cauldron_type, character_name)
    VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, weekday, cauldron_type)
    DO UPDATE SET character_name=excluded.character_name`).run(guildId, weekday, type, characterName);
}

export function getCauldronPanel(guildId) {
  return db.prepare('SELECT channel_id, message_id FROM wow_cauldron_panels WHERE guild_id = ?').get(guildId) || null;
}

export function setCauldronPanel(guildId, channelId, messageId) {
  return db.prepare(`INSERT INTO wow_cauldron_panels (guild_id, channel_id, message_id) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id, message_id=excluded.message_id`).run(guildId, channelId, messageId);
}

export function recordWowSyncChange(change) {
  return db.prepare(`INSERT INTO wow_sync_history
    (guild_id, user_id, character_name, realm_slug, category, action, role_id, role_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(change.guildId, change.userId, change.characterName, change.realmSlug, change.category, change.action, change.roleId, change.roleName);
}

export function recordWowSyncChanges(changes) {
  if (!changes.length) return 0;
  const insert = db.prepare(`INSERT INTO wow_sync_history
    (guild_id, user_id, character_name, realm_slug, category, action, role_id, role_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const record = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.guildId, item.userId, item.characterName, item.realmSlug, item.category, item.action, item.roleId, item.roleName);
    }
    return items.length;
  });
  return record(changes);
}

export function getWowSyncHistory(guildId, userId = null, limit = 10) {
  const safeLimit = Math.max(1, Math.min(25, Number.parseInt(limit, 10) || 10));
  if (userId) {
    return db.prepare(`SELECT user_id, character_name, realm_slug, category, action, role_name, created_at
      FROM wow_sync_history WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?`).all(guildId, userId, safeLimit);
  }
  return db.prepare(`SELECT user_id, character_name, realm_slug, category, action, role_name, created_at
    FROM wow_sync_history WHERE guild_id = ? ORDER BY id DESC LIMIT ?`).all(guildId, safeLimit);
}

export function seedCauldronAssignments(guildId, assignments) {
  const seed = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM wow_cauldron_setup WHERE guild_id = ?').get(guildId)) return false;
    const insert = db.prepare(`INSERT OR IGNORE INTO wow_cauldron_assignments (guild_id, weekday, cauldron_type, character_name)
      VALUES (?, ?, ?, ?)`);
    for (const assignment of assignments) {
      insert.run(guildId, assignment.weekday, assignment.type, assignment.characterName);
    }
    db.prepare('INSERT INTO wow_cauldron_setup (guild_id) VALUES (?)').run(guildId);
    return true;
  });
  return seed.immediate();
}

// A sending claim survives restarts: ambiguous Discord deliveries need manual review.
db.exec(`CREATE TABLE IF NOT EXISTS wowaudit_reports (
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, slot TEXT NOT NULL,
  status TEXT NOT NULL, message_id TEXT,
  PRIMARY KEY (guild_id, channel_id, slot)
)`);
export function claimLootReport(guildId, channelId, slot) {
  return db.prepare('INSERT OR IGNORE INTO wowaudit_reports VALUES (?, ?, ?, ?, NULL)')
    .run(guildId, channelId, slot, 'sending').changes === 1;
}
export function finishLootReport(guildId, channelId, slot, messageId) {
  db.prepare("UPDATE wowaudit_reports SET status='sent', message_id=? WHERE guild_id=? AND channel_id=? AND slot=?")
    .run(messageId, guildId, channelId, slot);
}
export function hasLootReport(guildId, channelId, slot) {
  return Boolean(db.prepare('SELECT 1 FROM wowaudit_reports WHERE guild_id=? AND channel_id=? AND slot=?').get(guildId, channelId, slot));
}


// One durable panel per guild/channel. A creation claim prevents uncertain sends from duplicating it.
db.exec(`CREATE TABLE IF NOT EXISTS wowaudit_loot_panels (
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
  status TEXT NOT NULL, last_slot TEXT,
  PRIMARY KEY (guild_id, channel_id)
);
INSERT OR IGNORE INTO wowaudit_loot_panels (guild_id, channel_id, message_id, status, last_slot)
SELECT r.guild_id, r.channel_id, r.message_id, 'ready', r.slot FROM wowaudit_reports r
WHERE r.status='sent' AND r.message_id IS NOT NULL AND r.slot=(
  SELECT MAX(p.slot) FROM wowaudit_reports p
  WHERE p.guild_id=r.guild_id AND p.channel_id=r.channel_id AND p.status='sent' AND p.message_id IS NOT NULL
);`);
export function getLootPanel(guildId, channelId) {
  return db.prepare('SELECT message_id, status, last_slot FROM wowaudit_loot_panels WHERE guild_id=? AND channel_id=?').get(guildId, channelId) || null;
}
export function claimLootPanel(guildId, channelId, missingMessageId = null) {
  if (missingMessageId) {
    return db.prepare("UPDATE wowaudit_loot_panels SET message_id=NULL, status='creating' WHERE guild_id=? AND channel_id=? AND message_id=? AND status='ready'")
      .run(guildId, channelId, missingMessageId).changes === 1;
  }
  return db.prepare("INSERT OR IGNORE INTO wowaudit_loot_panels (guild_id, channel_id, status) VALUES (?, ?, 'creating')")
    .run(guildId, channelId).changes === 1;
}
export function saveLootPanel(guildId, channelId, messageId, slot = null) {
  db.prepare(`INSERT INTO wowaudit_loot_panels VALUES (?, ?, ?, 'ready', ?)
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET message_id=excluded.message_id, status='ready',
    last_slot=COALESCE(excluded.last_slot, wowaudit_loot_panels.last_slot)`)
    .run(guildId, channelId, messageId, slot);
}
export const lootPanelStore = { get: getLootPanel, claim: claimLootPanel, save: saveLootPanel };

db.exec(`CREATE TABLE IF NOT EXISTS wowaudit_raider_panels (
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
  status TEXT NOT NULL, last_slot TEXT,
  PRIMARY KEY (guild_id, channel_id)
)`);
export function getRaiderPanel(guildId, channelId) {
  return db.prepare('SELECT message_id, status, last_slot FROM wowaudit_raider_panels WHERE guild_id=? AND channel_id=?').get(guildId, channelId) || null;
}
export function claimRaiderPanel(guildId, channelId, missingMessageId = null) {
  if (missingMessageId) {
    return db.prepare("UPDATE wowaudit_raider_panels SET message_id=NULL, status='creating' WHERE guild_id=? AND channel_id=? AND message_id=? AND status='ready'")
      .run(guildId, channelId, missingMessageId).changes === 1;
  }
  return db.prepare("INSERT OR IGNORE INTO wowaudit_raider_panels (guild_id, channel_id, status) VALUES (?, ?, 'creating')")
    .run(guildId, channelId).changes === 1;
}
export function saveRaiderPanel(guildId, channelId, messageId, slot = null) {
  db.prepare(`INSERT INTO wowaudit_raider_panels VALUES (?, ?, ?, 'ready', ?)
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET message_id=excluded.message_id, status='ready',
    last_slot=COALESCE(excluded.last_slot, wowaudit_raider_panels.last_slot)`)
    .run(guildId, channelId, messageId, slot);
}
export const raiderPanelStore = { get: getRaiderPanel, claim: claimRaiderPanel, save: saveRaiderPanel };


// Raider BIS proposals and accepted item snapshots persist in SQLite. Explicit
// raider replacements are recorded separately so edits retain an audit trail.
db.exec(`CREATE TABLE IF NOT EXISTS wow_bis_lists (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT,
  character_name TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  class_id TEXT,
  class_name TEXT,
  spec_id TEXT,
  spec_name TEXT,
  activity TEXT NOT NULL,
  status TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  page_url TEXT,
  fetched_at TEXT,
  guide_patch TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  accepted_by_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_wow_bis_lists_member ON wow_bis_lists(guild_id, user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS wow_bis_list_items (
  list_id TEXT NOT NULL REFERENCES wow_bis_lists(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  slot TEXT NOT NULL,
  slot_name TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  source_type TEXT,
  source_id INTEGER,
  source_name TEXT NOT NULL,
  wowhead_url TEXT NOT NULL,
  PRIMARY KEY (list_id, ordinal)
);
CREATE TABLE IF NOT EXISTS wow_bis_current (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  list_id TEXT NOT NULL UNIQUE REFERENCES wow_bis_lists(id),
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS wow_bis_item_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id TEXT NOT NULL REFERENCES wow_bis_lists(id),
  ordinal INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  old_item_id INTEGER NOT NULL,
  old_item_name TEXT NOT NULL,
  old_source_name TEXT NOT NULL,
  new_item_id INTEGER NOT NULL,
  new_item_name TEXT NOT NULL,
  new_source_name TEXT NOT NULL,
  edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

db.transaction(() => {
  const bisColumns = new Set(db.pragma('table_info(wow_bis_lists)').map((column) => column.name));
  if (!bisColumns.has('guide_patch')) db.exec('ALTER TABLE wow_bis_lists ADD COLUMN guide_patch TEXT');
}).immediate();

export function createBisProposal(proposal) {
  const create = db.transaction(() => {
    db.prepare(`UPDATE wow_bis_lists SET status='superseded', decided_at=CURRENT_TIMESTAMP
      WHERE guild_id=? AND user_id=? AND status IN ('awaiting_spec','building','pending')`)
      .run(proposal.guildId, proposal.userId);
    db.prepare(`INSERT INTO wow_bis_lists
      (id, guild_id, user_id, character_id, character_name, realm_slug, class_id, class_name, activity, status, channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_spec', ?)`)
      .run(proposal.id, proposal.guildId, proposal.userId, proposal.characterId, proposal.characterName,
        proposal.realmSlug, proposal.classId, proposal.className, proposal.activity, proposal.channelId);
  });
  create.immediate();
}

export function setBisProposalMessage(id, messageId) {
  return db.prepare('UPDATE wow_bis_lists SET message_id=? WHERE id=? AND status=\'awaiting_spec\'').run(messageId, id).changes === 1;
}

export function markBisProposalAwaitingSource(id, specId, specName) {
  return db.prepare(`UPDATE wow_bis_lists SET spec_id=?, spec_name=?, status='awaiting_source'
    WHERE id=? AND status='awaiting_spec'`).run(specId, specName, id).changes === 1;
}

export function getBisProposal(id) {
  const proposal = db.prepare('SELECT * FROM wow_bis_lists WHERE id=?').get(id) || null;
  if (!proposal) return null;
  return {
    ...proposal,
    sources: JSON.parse(proposal.sources_json || '[]'),
    sourceUrls: JSON.parse(proposal.source_urls_json || '[]'),
    sourceIds: JSON.parse(proposal.sources_json || '[]'),
    fetchedAt: proposal.fetched_at,
    patch: proposal.guide_patch,
    pageUrl: proposal.page_url,
    className: proposal.class_name,
    specName: proposal.spec_name,
    activityName: ({ overall: 'General', raid: 'Raid', mythic_plus: 'M+' })[proposal.activity] || proposal.activity,
    items: db.prepare('SELECT slot, slot_name AS slotName, item_id AS itemId, item_name AS itemName, rank, score, source_type AS sourceType, source_id AS sourceId, source_name AS sourceName, wowhead_url AS wowheadUrl FROM wow_bis_list_items WHERE list_id=? ORDER BY ordinal').all(id)
  };
}

export function saveBisProposalList(id, bisList) {
  const save = db.transaction(() => {
    const updated = db.prepare(`UPDATE wow_bis_lists SET class_id=?, class_name=?, spec_id=?, spec_name=?,
      sources_json=?, source_urls_json=?, page_url=?, fetched_at=?, guide_patch=?, status='pending'
      WHERE id=? AND status IN ('awaiting_spec','building')`).run(
      bisList.classId, bisList.className, bisList.specId, bisList.specName,
      JSON.stringify(bisList.sourceIds), JSON.stringify(bisList.sourceUrls), bisList.pageUrl,
      bisList.fetchedAt, bisList.patch || null, id
    );
    if (updated.changes !== 1) return false;
    const insert = db.prepare(`INSERT INTO wow_bis_list_items
      (list_id, ordinal, slot, slot_name, item_id, item_name, rank, score, source_type, source_id, source_name, wowhead_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    bisList.items.forEach((item, ordinal) => insert.run(id, ordinal, item.slot, item.slotName,
      item.itemId, item.itemName, item.rank, item.score, item.sourceType, item.sourceId,
      item.sourceName, item.wowheadUrl));
    return true;
  });
  return save.immediate();
}

export function markBisProposalBuilding(id) {
  return db.prepare(`UPDATE wow_bis_lists SET status='building' WHERE id=? AND status='awaiting_source'`).run(id).changes === 1;
}

export function markBisProposalFailed(id) {
  return db.prepare(`UPDATE wow_bis_lists SET status='failed', decided_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('awaiting_spec','awaiting_source','building','pending')`).run(id).changes === 1;
}

export function acceptBisProposal(guildId, userId, id) {
  const accept = db.transaction(() => {
    const proposal = db.prepare(`SELECT id FROM wow_bis_lists WHERE id=? AND guild_id=? AND user_id=? AND status='pending'`).get(id, guildId, userId);
    if (!proposal) return false;
    const previous = db.prepare('SELECT list_id FROM wow_bis_current WHERE guild_id=? AND user_id=?').get(guildId, userId);
    if (previous) db.prepare(`UPDATE wow_bis_lists SET status='superseded' WHERE id=?`).run(previous.list_id);
    db.prepare('DELETE FROM wow_bis_current WHERE guild_id=? AND user_id=?').run(guildId, userId);
    db.prepare(`UPDATE wow_bis_lists SET status='accepted', decided_at=CURRENT_TIMESTAMP, accepted_by_user_id=? WHERE id=?`).run(userId, id);
    db.prepare('INSERT INTO wow_bis_current (guild_id, user_id, list_id) VALUES (?, ?, ?)').run(guildId, userId, id);
    return true;
  });
  return accept.immediate();
}

export function rejectBisProposal(guildId, userId, id) {
  const reject = db.transaction(() => {
    const proposal = db.prepare(`SELECT id FROM wow_bis_lists WHERE id=? AND guild_id=? AND user_id=? AND status='pending'`).get(id, guildId, userId);
    if (!proposal) return false;
    const previous = db.prepare('SELECT list_id FROM wow_bis_current WHERE guild_id=? AND user_id=?').get(guildId, userId);
    if (previous) db.prepare(`UPDATE wow_bis_lists SET status='cleared' WHERE id=?`).run(previous.list_id);
    db.prepare('DELETE FROM wow_bis_current WHERE guild_id=? AND user_id=?').run(guildId, userId);
    db.prepare(`UPDATE wow_bis_lists SET status='rejected', decided_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
    return true;
  });
  return reject.immediate();
}

export function getCurrentBisList(guildId, userId) {
  const row = db.prepare(`SELECT l.* FROM wow_bis_current c JOIN wow_bis_lists l ON l.id=c.list_id
    WHERE c.guild_id=? AND c.user_id=? AND l.status='accepted'`).get(guildId, userId);
  return row ? getBisProposal(row.id) : null;
}

export function updateBisListItem(guildId, userId, listId, ordinal, replacement) {
  const update = db.transaction(() => {
    const list = db.prepare(`SELECT id FROM wow_bis_lists l WHERE id=? AND guild_id=? AND user_id=?
      AND (status='pending' OR (status='accepted' AND EXISTS (
        SELECT 1 FROM wow_bis_current c WHERE c.list_id=l.id AND c.guild_id=l.guild_id AND c.user_id=l.user_id
      )))`).get(listId, guildId, userId);
    if (!list) return null;
    const previous = db.prepare(`SELECT item_id AS itemId, item_name AS itemName, source_name AS sourceName
      FROM wow_bis_list_items WHERE list_id=? AND ordinal=?`).get(listId, ordinal);
    if (!previous) return null;
    db.prepare(`INSERT INTO wow_bis_item_edits
      (list_id, ordinal, actor_user_id, old_item_id, old_item_name, old_source_name, new_item_id, new_item_name, new_source_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(listId, ordinal, userId, previous.itemId, previous.itemName, previous.sourceName,
        replacement.itemId, replacement.itemName, replacement.sourceName);
    db.prepare(`UPDATE wow_bis_list_items SET item_id=?, item_name=?, score=0, source_type='manual', source_id=NULL,
      source_name=?, wowhead_url=? WHERE list_id=? AND ordinal=?`)
      .run(replacement.itemId, replacement.itemName, replacement.sourceName, replacement.wowheadUrl, listId, ordinal);
    return { ...previous, slotName: db.prepare('SELECT slot_name AS slotName FROM wow_bis_list_items WHERE list_id=? AND ordinal=?').get(listId, ordinal).slotName };
  });
  return update.immediate();
}

db.exec(`CREATE TABLE IF NOT EXISTS wowaudit_loot_destinations (
  guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL
)`);
export function getLootDestination(guildId) {
  return db.prepare('SELECT channel_id FROM wowaudit_loot_destinations WHERE guild_id=?').get(guildId)?.channel_id || null;
}
export function setLootDestination(guildId, channelId) {
  db.prepare(`INSERT INTO wowaudit_loot_destinations VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id`).run(guildId, channelId);
}
