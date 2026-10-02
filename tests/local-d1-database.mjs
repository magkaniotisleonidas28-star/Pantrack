import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {findLocalD1Database} from '../scripts/local-d1-database.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pantrack-local-d1-selection-'));
const fixture = {companyId: 'unique-company', productId: 'unique-product'};
function createDatabase(name, records = null) {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  try {
    if (records !== null) {
      db.exec(`CREATE TABLE inventory_config_versions
        (company_id TEXT, product_id TEXT, status TEXT)`);
      for (const record of records) {
        db.prepare('INSERT INTO inventory_config_versions VALUES (?,?,?)').run(...record);
      }
    }
  } finally {
    db.close();
  }
  return path;
}

try {
  const empty = createDatabase('empty.sqlite');
  const unrelated = createDatabase('another-binding.sqlite', [
    ['another-company', fixture.productId, 'active'],
    [fixture.companyId, 'another-product', 'active'],
    [fixture.companyId, fixture.productId, 'archived'],
  ]);
  const selected = createDatabase('served-binding.sqlite', [
    [fixture.companyId, fixture.productId, 'active'],
  ]);
  // Metadata is not a D1 candidate, and may not be a SQLite database.
  writeFileSync(join(dir, 'metadata.sqlite'), 'ignored metadata');
  const before = [empty, unrelated, selected].map(path => readFileSync(path));
  assert.equal(findLocalD1Database(dir, fixture), selected);
  assert.deepEqual([empty, unrelated, selected].map(path => readFileSync(path)), before,
    'Finding the served database must not change candidate data');
  assert.throws(() => findLocalD1Database(dir, {...fixture, companyId: 'missing'}), /found 0/);
  createDatabase('duplicate-fixture.sqlite', [[fixture.companyId, fixture.productId, 'active']]);
  assert.throws(() => findLocalD1Database(dir, fixture), /found 2/,
    'An ambiguous fixture must never select an arbitrary database');
  console.log('PASS: local D1 selection uses the served fixture, preserves unrelated data, and rejects missing or ambiguous matches.');
} finally {
  rmSync(dir, {recursive: true, force: true});
}
