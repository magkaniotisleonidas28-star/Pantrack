import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
assert.equal(sql.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
const entries = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
const repair = entries.find(entry => entry.tag.endsWith('_repair_replenishment_state_guard'));
assert.ok(repair, 'The forward guard repair must be journaled.');
assert.ok(repair.idx > 17, 'The repair follows the existing 0017 lifecycle migration.');
for (const entry of entries.filter(entry => entry.idx <= 17)) {
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
}

const at = '2026-10-02T12:00:00.000Z';
for (const company of ['guard-a', 'guard-b']) {
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)')
    .run(company, `Fictional ${company}`, at);
}

// Each proposal has its own fictional product so reservations cannot mask a
// transition failure. Seed both legacy and exact inventory plus settings.
function seedProposal(id, status, company = 'guard-a') {
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)')
    .run(company, id, JSON.stringify({name: `Fictional ${id}`}));
  sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)')
    .run(company, id, '{"legacy":true,"onHand":12}', 3);
  sql.prepare(`INSERT INTO product_unit_versions
    (company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
    VALUES (?,?,'mL',1,'curated','volume','mL','1','1','fictional-manager',?,NULL)`)
    .run(company, id, at);
  sql.prepare(`INSERT INTO inventory_config_versions
    (company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,
     purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
    VALUES (?,?,'config-1',1,'active','mL',1,'case','250000000',NULL,?,NULL,'fictional-manager',?)`)
    .run(company, id, at, at);
  sql.prepare(`INSERT INTO inventory_balances_exact
    (company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,
     version,latest_count_effective_at,updated_at)
    VALUES (?,?,'config-1','volume','200000000','100000000','0',1,?,?)`)
    .run(company, id, at, at);
  sql.prepare(`INSERT INTO replenishment_settings_versions
    (company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,
     dimension,settings_json,changed_by,change_reason,changed_at)
    VALUES (?,?,1,?,'config-1',1,'volume',?,'fictional-manager','Fictional target',?)`)
    .run(company, id, `settings:${id}`, JSON.stringify({
      target: {dimension: 'volume', minor: '1000000000'},
      capacity: null, dailyUse: null, shelfDays: null, countEveryDays: 7,
      minimumPacks: '0', orderMultiplePacks: '1', maximumPacks: '5',
    }), at);
  // Only the frozen recommended quantity is read by the SQL initialization
  // trigger; this suite tests the database guard independently of API writers.
  sql.prepare(`INSERT INTO replenishment_proposal_origins
    (company_id,id,create_id,product_id,initial_status,snapshot_json,created_by,created_at)
    VALUES (?,?,?,?,?,?,'fictional-manager',?)`)
    .run(company, id, `create:${id}`, id, status,
      JSON.stringify({explanation: {recommendedPacks: '2'}}), at);
  return {company, id};
}

const state = ({company, id}) => sql.prepare(`SELECT * FROM replenishment_proposal_states
  WHERE company_id=? AND proposal_id=?`).get(company, id);
const events = ({company, id}) => sql.prepare(`SELECT * FROM replenishment_proposal_events
  WHERE company_id=? AND proposal_id=? ORDER BY revision`).all(company, id).map(row => ({...row}));
function update(proposal, changes) {
  const next = {...state(proposal), ...changes};
  return sql.prepare(`UPDATE replenishment_proposal_states
    SET revision=revision+1,status=?,packs=?,change_id=?,kind=?,changed_by=?,reason=?,changed_at=?,invalidation_reason=?
    WHERE company_id=? AND proposal_id=?`).run(next.status, next.packs, next.change_id,
      next.kind, next.changed_by, next.reason, next.changed_at, next.invalidation_reason,
      proposal.company, proposal.id);
}
function invalidate(proposal, reason, changeId) {
  return update(proposal, {
    status: 'review_required', kind: 'invalidate', change_id: changeId,
    changed_by: 'system', reason: 'Fictional source changed', invalidation_reason: reason,
  });
}
function allRows() {
  return Object.fromEntries(sql.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(({name}) => [
      name, sql.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]));
}
function rejectWithoutWrites(action, pattern = /Invalid replenishment state transition/) {
  const before = allRows();
  assert.throws(action, pattern);
  assert.deepEqual(allRows(), before, 'A rejected update must preserve every state and audit row.');
}

// Upgrade a populated 0017 database with existing edits, invalidations, and
// cancellations, including an independent company with the same proposal ID.
const edited = seedProposal('history-edit', 'draft');
update(edited, {kind: 'edit', change_id: 'history-edit-1', packs: '1', reason: 'Fictional correction'});
const invalidated = seedProposal('history-invalidation', 'draft');
invalidate(invalidated, 'inventory_changed', 'history-invalidate-1');
const canceled = seedProposal('history-cancel', 'review_required');
update(canceled, {kind: 'cancel', status: 'canceled', change_id: 'history-cancel-1', reason: 'Fictional cancellation'});
seedProposal('history-edit', 'review_required', 'guard-b');
assert.equal(state(edited).revision, 2);
assert.equal(events(invalidated).at(-1).kind, 'invalidate');
assert.equal(state(canceled).status, 'canceled');
// Other workstreams may have shipped migrations since 0017. Apply those
// before isolating this repair's effect on the populated upgrade database.
for (const entry of entries.filter(entry => entry.idx > 17 && entry.idx < repair.idx)) {
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
}
const beforeRepair = allRows();
sql.exec(readFileSync(`drizzle/${repair.tag}.sql`, 'utf8'));
assert.deepEqual(allRows(), beforeRepair, 'The repair must preserve origin, state, audit, inventory, and settings data.');
assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
  WHERE type='trigger' AND name='replenishment_state_update_guard'`).get().n, 1);

// SQL NULL must be rejected just like FALSE, with each reason/status tested on
// a clean independent proposal and a valid system actor.
const invalidReasons = [null, '', '   ', 'unsupported_reason'];
const validReasons = ['inventory_changed', 'inventory_config_changed', 'settings_changed', 'source_unavailable'];
for (const status of ['draft', 'review_required']) {
  for (const [index, reason] of invalidReasons.entries()) {
    const proposal = seedProposal(`invalid-${status}-${index}`, status);
    rejectWithoutWrites(() => invalidate(proposal, reason, `invalid-${status}-${index}`));
    assert.equal(state(proposal).status, status);
    assert.equal(state(proposal).revision, 1);
    assert.equal(events(proposal).length, 1);
  }

  for (const reason of validReasons) {
    const proposal = seedProposal(`valid-${status}-${reason}`, status);
    const before = state(proposal);
    const history = events(proposal);
    const changeId = `invalidate-${status}-${reason}`;
    assert.equal(invalidate(proposal, reason, changeId).changes, 1);
    const after = state(proposal);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.packs, before.packs);
    assert.equal(after.status, 'review_required');
    assert.equal(after.invalidation_reason, reason);
    assert.deepEqual(events(proposal), [...history, {
      company_id: proposal.company, proposal_id: proposal.id, revision: before.revision + 1,
      change_id: changeId, kind: 'invalidate', from_status: status, status: 'review_required',
      packs: before.packs, actor: 'system', reason: 'Fictional source changed', at,
      invalidation_reason: reason,
    }]);

    rejectWithoutWrites(() => update(proposal, {kind: 'edit', packs: '1',
      change_id: `edit-${proposal.id}`, changed_by: 'fictional-manager', reason: 'Fictional edit'}));
    rejectWithoutWrites(() => invalidate(proposal, reason, `repeat-${proposal.id}`));
    rejectWithoutWrites(() => invalidate(proposal, null, `repeat-null-${proposal.id}`));
    const beforeCancel = state(proposal);
    const cancelHistory = events(proposal);
    assert.equal(update(proposal, {kind: 'cancel', status: 'canceled',
      change_id: `cancel-${proposal.id}`, changed_by: 'fictional-manager', reason: 'Fictional cancellation'}).changes, 1);
    assert.equal(state(proposal).revision, beforeCancel.revision + 1);
    assert.equal(state(proposal).status, 'canceled');
    assert.equal(state(proposal).packs, beforeCancel.packs);
    assert.equal(state(proposal).invalidation_reason, reason);
    assert.deepEqual(events(proposal).slice(0, -1), cancelHistory);
    assert.equal(events(proposal).length, cancelHistory.length + 1);
    assert.equal(events(proposal).at(-1).kind, 'cancel');
    assert.equal(events(proposal).at(-1).invalidation_reason, reason);
  }

  const clean = seedProposal(`clean-${status}`, status);
  assert.equal(update(clean, {kind: 'edit', packs: '1', change_id: `edit-${clean.id}`,
    reason: 'Fictional correction', invalidation_reason: null}).changes, 1);
  assert.equal(state(clean).revision, 2);
  assert.equal(state(clean).invalidation_reason, null);
  assert.equal(events(clean).at(-1).kind, 'edit');
  assert.equal(update(clean, {kind: 'cancel', status: 'canceled', change_id: `cancel-${clean.id}`,
    reason: 'Fictional cancellation', invalidation_reason: null}).changes, 1);
  assert.equal(state(clean).revision, 3);
  assert.equal(state(clean).status, 'canceled');
  assert.equal(state(clean).invalidation_reason, null);
  assert.equal(events(clean).length, 3);
  assert.equal(events(clean).at(-1).kind, 'cancel');
}

const collision = seedProposal('audit-collision', 'draft');
rejectWithoutWrites(() => invalidate(collision, 'settings_changed', 'history-edit-1'),
  /UNIQUE constraint failed: replenishment_proposal_events.company_id, replenishment_proposal_events.change_id/);
assert.equal(state(collision).revision, 1);
assert.equal(events(collision).length, 1);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
sql.close();
console.log('PASS: A8 guard repair preserves upgraded history, rejects invalid reasons without writes, permits valid lifecycle transitions, and rolls back audit collisions.');
