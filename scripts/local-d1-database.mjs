import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// A state directory can contain databases from several Wrangler bindings.
// Locate the one the local app used by a unique fixture created through its API.
export function findLocalD1Database(stateDir, {companyId, productId}) {
  assert.ok(companyId && productId, 'A unique company and product fixture is required');
  const matches = [];
  for (const file of readdirSync(stateDir, {withFileTypes: true})) {
    if (!file.isFile() || !file.name.endsWith('.sqlite') || file.name === 'metadata.sqlite') continue;
    const path = join(stateDir, file.name);
    const db = new DatabaseSync(path, {readOnly: true});
    try {
      const hasInventory = db.prepare(`SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='inventory_config_versions'`).get();
      if (hasInventory && db.prepare(`SELECT 1 FROM inventory_config_versions
        WHERE company_id=? AND product_id=? AND status='active'`)
        .get(companyId, productId)) matches.push(path);
    } finally {
      db.close();
    }
  }
  assert.equal(matches.length, 1,
    `Expected exactly one local D1 database containing the newly created fixture; found ${matches.length}. No database was selected for direct writes.`);
  return matches[0];
}
