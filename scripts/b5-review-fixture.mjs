import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const mode = process.argv[2];
assert.ok(['seed', 'employee', 'owner', 'verify'].includes(mode), 'Use seed, employee, owner, or verify.');
const dir = fileURLToPath(new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url));
const files = readdirSync(dir).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
assert.equal(files.length, 1, 'Expected one isolated local D1 database.');
const sql = new DatabaseSync(join(dir, files[0]));
sql.exec('PRAGMA foreign_keys=ON');

const companyId = 'b5-fictional-cafe';
const recipeId = 'b5000000-0000-4000-8000-000000000001';
const cutoff = '2026-01-01T00:00:00.000Z';
const mappingKey = JSON.stringify(['Fictional POS', 'location-a', 'latte-item']);

if (mode === 'seed') {
  assert.equal(sql.prepare('SELECT count(*) AS n FROM companies').get().n, 0, 'Use a fresh B5 worktree database.');
  sql.exec('BEGIN');
  try {
    sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(companyId, 'Fictional B5 Cafe', cutoff);
    sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('local_seedy', companyId, 'owner');
    sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('b5-fixture-owner', companyId, 'owner');
    for (const [productId, dimension, onHand, display] of [
      ['b5-milk', 'volume', '100000000', 100],
      ['b5-cup', 'count', '10', 10],
    ]) {
      sql.prepare('INSERT INTO products VALUES (?,?,?)').run(companyId, productId, JSON.stringify({ id: productId, name: productId, supplier: 'Fictional supplier', sku: productId, pack: 'unit', unit: 'unit', price: 0, category: 'Test only', url: '', sample: true }));
      sql.prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)').run(companyId, productId, 'canonical', 1, 'curated', dimension, 'canonical', '1', '1', 'b5-fixture', cutoff);
      sql.prepare('INSERT INTO inventory_config_versions VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)').run(companyId, productId, 'active', 1, 'active', 'canonical', 1, 'unit', '1', cutoff, 'b5-fixture', cutoff);
      sql.prepare('INSERT INTO inventory VALUES (?,?,?,?)').run(companyId, productId, JSON.stringify({ productId, settings: { unit: 'canonical' }, onHand: display, incoming: 0, lastCount: cutoff, updated: cutoff, version: 1, estimatedUsed: 0 }), 1);
      sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)").run(companyId, productId, 'active', dimension, onHand, 1, cutoff, cutoff);
    }
    sql.prepare('INSERT INTO recipes VALUES (?,?,?)').run(companyId, recipeId, JSON.stringify({ id: recipeId, name: 'Fictional latte', ingredients: [{ productId: 'b5-milk', quantity: 10, unit: 'canonical' }, { productId: 'b5-cup', quantity: 1, unit: 'canonical' }] }));
    sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run(companyId, recipeId, 'b5-fixture', cutoff);
    sql.prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)").run(companyId, recipeId, 'b5-latte-v1', 'Fictional latte', 'b5-fixture', cutoff);
    sql.prepare("INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)").run(companyId, recipeId, 'b5-latte-v1', 0, 'b5-milk', 'volume', '10000000', '10');
    sql.prepare("INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)").run(companyId, recipeId, 'b5-latte-v1', 1, 'b5-cup', 'count', '1', '1');
    sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id=?").run(cutoff, companyId, recipeId);
    sql.prepare('INSERT INTO register_mappings VALUES (?,?,?)').run(companyId, mappingKey, JSON.stringify({ key: mappingKey, recipeId }));
    sql.exec('COMMIT');
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
} else if (mode === 'employee' || mode === 'owner') {
  const changed = sql.prepare('UPDATE memberships SET role=? WHERE user_id=? AND company_id=?').run(mode, 'local_seedy', companyId).changes;
  assert.equal(changed, 1);
} else {
  assert.equal(sql.prepare('SELECT role FROM memberships WHERE user_id=? AND company_id=?').get('local_seedy', companyId)?.role, 'owner');
  assert.equal(sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get(companyId, 'b5-milk')?.on_hand_minor, '90000000');
  assert.equal(sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get(companyId, 'b5-cup')?.on_hand_minor, '9');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications WHERE company_id=?').get(companyId).n, 2);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE company_id=? AND action='replay'").get(companyId).n, 1);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM sales_event_correction_results WHERE company_id=?').get(companyId).n, 1);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM sales_event_correction_adjustments WHERE company_id=?').get(companyId).n, 2);
  const stored = sql.prepare('SELECT e.normalized_json,e.source_payload_sha256,e.received_at,f.fragment_json,f.expires_at FROM sales_events e JOIN sales_event_fragments f ON f.company_id=e.company_id AND f.event_key=e.event_key WHERE e.company_id=?').all(companyId);
  assert.equal(stored.length, 2);
  for (const row of stored) {
    assert.match(row.source_payload_sha256, /^[a-f0-9]{64}$/);
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.received_at), 30 * 24 * 60 * 60 * 1000);
    const fragment = JSON.parse(row.fragment_json);
    assert.deepEqual(Object.keys(fragment).sort(), ['eventType', 'external', 'lines', 'occurredAt', 'orderStatus', 'preparationStatus', 'receivedAt', 'source']);
    const payload = row.normalized_json + row.fragment_json;
    assert.doesNotMatch(payload, /authorization|access_token|customer|payment|card_number|cookie/i);
  }
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
}

sql.close();
console.log(`PASS: B5 local fixture ${mode}.`);
