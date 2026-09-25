import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const origin = 'http://127.0.0.1:5173';
const companyId = 'b5-fictional-cafe';
const recipeId = 'b5000000-0000-4000-8000-000000000001';
const dir = fileURLToPath(new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url));
const files = readdirSync(dir).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
assert.equal(files.length, 1);
const sql = new DatabaseSync(join(dir, files[0]));
sql.exec('PRAGMA foreign_keys=ON');

async function request(path, method = 'GET', body, cookie = '') {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin, 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  return { response, result };
}
function balance(productId) {
  return sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get(companyId, productId).on_hand_minor;
}
function expectStatus(actual, expected, label) { assert.equal(actual.response.status, expected, `${label}: ${JSON.stringify(actual.result)}`); }

try {
  expectStatus(await request(`/api/sales/events?companyId=${companyId}`), 401, 'Anonymous event list');
  const signIn = await fetch(`${origin}/signin-with-chatgpt?return_to=/`, { redirect: 'manual' });
  assert.equal(signIn.status, 302);
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const list = () => request(`/api/sales/events?companyId=${companyId}`, 'GET', undefined, cookie);
  const sale = body => request('/api/sales', 'POST', { companyId, action: 'import', occurredAt: '2026-02-01T12:00:00.000Z', ...body }, cookie);
  const action = body => request('/api/sales/events', 'POST', { companyId, ...body }, cookie);
  expectStatus(await request('/api/sales/events?companyId=other-company', 'GET', undefined, cookie), 403, 'Wrong-company event list');
  const empty = await list(); expectStatus(empty, 200, 'Initial event list');
  assert.equal(empty.result.enabled, true, 'Exact gate must be on only in this isolated server.');
  assert.deepEqual(empty.result.events, []);

  const manualBody = { reference: 'b5-manual', source: 'manual', lines: [{ recipeId, quantity: 1 }] };
  const manual = await sale(manualBody); expectStatus(manual, 200, 'Manual sale');
  assert.equal(manual.result.state, 'applied');
  assert.equal(balance('b5-milk'), '90000000');
  const duplicate = await sale(manualBody); expectStatus(duplicate, 200, 'Duplicate sale');
  assert.equal(duplicate.result.replayed, true);
  assert.equal(balance('b5-milk'), '90000000');

  const unknownKey = JSON.stringify(['Fictional POS', 'location-a', 'unknown-item']);
  const mapped = await sale({ reference: 'b5-mapped', source: 'mapped_csv', lines: [{ mappingKey: unknownKey, quantity: 1 }] });
  expectStatus(mapped, 200, 'Unknown mapped item');
  assert.equal(mapped.result.state, 'held');
  assert.equal(balance('b5-milk'), '90000000', 'Held event must not consume stock.');
  const mapping = await request('/api/sales', 'POST', { companyId, action: 'mapping', mapping: { provider: 'Fictional POS', location: 'location-a', itemId: 'unknown-item', name: 'Fictional latte', recipeId } }, cookie);
  expectStatus(mapping, 200, 'Mapping repair');
  const replay = await action({ action: 'replay', eventKey: mapped.result.eventKey, reason: 'Fictional mapping reviewed' });
  expectStatus(replay, 200, 'Held-event replay');
  assert.equal(replay.result.state, 'applied');
  assert.equal(balance('b5-milk'), '80000000');

  const correction = await action({ action: 'requestCorrection', eventKey: manual.result.eventKey, reason: 'Fictional sale entered in error' });
  expectStatus(correction, 200, 'Correction request');
  const correctionId = correction.result.correction.correctionId;
  const items = correction.result.correction.items.map(item => ({ productId: item.productId, minor: item.suggestedMinor }));
  const applied = await action({ action: 'applyCorrection', correctionId, items });
  expectStatus(applied, 200, 'Correction confirmation');
  assert.equal(applied.result.correction.status, 'applied');
  assert.equal(balance('b5-milk'), '90000000');
  const repeat = await action({ action: 'applyCorrection', correctionId, items });
  expectStatus(repeat, 200, 'Repeated correction');
  assert.equal(balance('b5-milk'), '90000000');

  const ownerList = await list(); expectStatus(ownerList, 200, 'Owner review list');
  assert.deepEqual(ownerList.result.events.map(event => event.state).sort(), ['applied', 'applied']);
  assert.equal(ownerList.result.corrections[0].status, 'applied');
  assert.equal(ownerList.result.events.some(event => event.externalReference === 'b5-manual'), true);

  sql.prepare('UPDATE memberships SET role=? WHERE company_id=? AND user_id=?').run('employee', companyId, 'local_seedy');
  const employeeList = await list(); expectStatus(employeeList, 200, 'Employee status list');
  assert.deepEqual(Object.keys(employeeList.result.events[0]).sort(), ['occurredAt', 'state']);
  assert.deepEqual(employeeList.result.corrections, []);
  assert.deepEqual(employeeList.result.conflicts, []);
  expectStatus(await request(`/api/sales/events?companyId=${companyId}&eventKey=${manual.result.eventKey}`, 'GET', undefined, cookie), 403, 'Employee event detail');
  expectStatus(await action({ action: 'requestCorrection', eventKey: manual.result.eventKey, reason: 'Denied' }), 403, 'Employee correction');
  expectStatus(await sale({ reference: 'employee-denied', source: 'manual', lines: [{ recipeId, quantity: 1 }] }), 403, 'Employee sale');
  sql.prepare('UPDATE memberships SET role=? WHERE company_id=? AND user_id=?').run('owner', companyId, 'local_seedy');
  assert.equal(balance('b5-cup'), '9');
  console.log('PASS: isolated served gate-on B5 flow, exact balances, duplicate, hold/replay, audited correction, anonymous/wrong-company/employee access.');
} finally {
  sql.prepare('UPDATE memberships SET role=? WHERE company_id=? AND user_id=?').run('owner', companyId, 'local_seedy');
  sql.close();
}
