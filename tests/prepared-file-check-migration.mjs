import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const entries = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
assert.equal(entries.at(-1).tag, '0045_prepared_file_checks');
for (const entry of entries.slice(0, -1))
  for (const sql of unstable_splitSqlQuery(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8')))
    db.exec(sql);
db.exec(
  "INSERT INTO companies VALUES('a','Fictional checks','2026-11-02'),('b','Other fictional checks','2026-11-02'); INSERT INTO memberships VALUES('manager','a','manager'),('owner','a','owner'),('spare-owner','a','owner'),('employee','a','employee'),('b-owner','b','owner');",
);
const id = crypto.randomUUID(),
  token = crypto.randomUUID(),
  at = '2026-11-02T00:00:00.000Z',
  time = '2026-11-02T00:00:01.000Z',
  operationId = crypto.randomUUID();
const request = {
  companyId: 'a',
  operationId: crypto.randomUUID(),
  format: 'pdf',
  source: { kind: 'draft', orderId: 'fictional', revision: 1 },
};
const manifest = {
  contract: 'pantrack.document-archive.v1',
  id,
  companyId: 'a',
  actorId: 'manager',
  format: 'pdf',
  template: 'pantrack.saved-draft.pdf.v1',
  requestedAt: at,
  size: 20,
  sha256: 'a'.repeat(64),
  retention: 'retain-until-explicit-policy',
  source: {
    kind: 'draft',
    fingerprint: 'd'.repeat(64),
    records: [{ id: 'fictional', revision: 1, status: 'draft' }],
  },
};
db.prepare(
  `INSERT INTO document_archive_intents(company_id,id,operation_id,actor_id,fingerprint,request_json,template,requested_at,state,token,lease_until,write_id,updated_at)
 VALUES('a',?,?,?,'${'b'.repeat(64)}',?,?,?,'reserved',?,'2026-11-02T00:03:00.000Z',?,?)`,
).run(
  id,
  request.operationId,
  'manager',
  JSON.stringify(request),
  manifest.template,
  at,
  token,
  crypto.randomUUID(),
  at,
);
db.prepare(
  "UPDATE document_archive_intents SET manifest_json=?,state='prepared',write_id=?,updated_at=? WHERE id=?",
).run(JSON.stringify(manifest), crypto.randomUUID(), time, id);
const event = (stage, extra = {}) => ({
  kind: 'prepared_check',
  contract: 'pantrack.prepared-file-check.v1',
  operationId,
  manifestFingerprint: 'c'.repeat(64),
  stage,
  ...extra,
});
const add = (
  payload,
  {
    who = 'owner',
    eventId = crypto.randomUUID(),
    documentId = id,
    companyId = 'a',
    lease = null,
  } = {},
) =>
  db
    .prepare('INSERT INTO document_archive_observations VALUES(?,?,?,?,?,?,?)')
    .run(companyId, documentId, eventId, who, lease, JSON.stringify(payload), time);
assert.throws(
  () => add(event('requested', { manifest }), { eventId: operationId }),
  /Invalid archive observation/,
  'Old schema must reproduce the missing capability',
);
const snapshot = JSON.parse(readFileSync('drizzle/meta/0044_snapshot.json', 'utf8'));
const rows = () =>
  JSON.stringify(
    Object.keys(snapshot.tables)
      .sort()
      .map((name) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
  );
const before = rows(),
  migration = unstable_splitSqlQuery(readFileSync('drizzle/0045_prepared_file_checks.sql', 'utf8'));
assert.equal(migration.length, 2, 'Wrangler keeps the new trigger as one statement');
assert.ok(migration[1].includes('CREATE TRIGGER document_archive_observation_guard'));
for (const sql of migration) db.exec(sql);
assert.equal(rows(), before, 'Migration preserves all populated application rows');
assert.deepEqual(
  JSON.parse(readFileSync('drizzle/meta/0045_snapshot.json', 'utf8')).tables,
  snapshot.tables,
  'Trigger-only migration changes no tables',
);
for (const who of ['employee', 'b-owner'])
  assert.throws(
    () => add(event('requested', { manifest }), { eventId: operationId, who }),
    /Invalid archive observation/,
  );
assert.throws(
  () => add(event('requested', { manifest: { ...manifest, size: 21 } }), { eventId: operationId }),
  /Invalid archive observation/,
);
assert.throws(
  () => add(event('requested', { manifest }), { eventId: crypto.randomUUID() }),
  /Invalid archive observation/,
);
add(event('requested', { manifest }), { eventId: operationId });
assert.throws(
  () => add(event('requested', { manifest }), { eventId: operationId }),
  /Invalid archive observation/,
);
const observedId = crypto.randomUUID(),
  observation = {
    kind: 'object',
    present: true,
    reportedSize: 20,
    byteLength: 20,
    sha256: 'a'.repeat(64),
  };
db.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='owner'");
add(event('observed', { observation }), { eventId: observedId });
assert.throws(
  () => add(event('completed', { observationId: observedId })),
  /Invalid archive observation/,
  'Audit inputs persist after revocation but cannot authorize a result',
);
db.exec("UPDATE memberships SET role='owner' WHERE company_id='a' AND user_id='owner'");
for (const payload of [
  event('observed', { observation: { kind: 'generation' } }),
  event('observed', { observation: { ...observation, byteLength: -1 } }),
  event('observed', { observation: { ...observation, sha256: 'private' } }),
  { ...event('observed', { observation }), operationId: crypto.randomUUID() },
  event('completed', { observationId: crypto.randomUUID() }),
])
  assert.throws(() => add(payload), /Invalid archive observation/);
assert.throws(
  () => add(event('observed', { observation }), { who: 'manager' }),
  /Invalid archive observation/,
  'A different actor cannot use the admitted check',
);
assert.throws(
  () => add(event('observed', { observation }), { lease: token }),
  /Invalid archive observation/,
  'Check events are always tokenless',
);
add(event('completed', { observationId: observedId }));
assert.throws(
  () => add(event('completed', { observationId: observedId })),
  /Invalid archive observation/,
  'One immutable terminal result per check',
);
assert.throws(
  () =>
    db
      .prepare(
        "UPDATE document_archive_intents SET artifact_json=json_set(manifest_json,'$.issuedAt',?),state='ready',lease_until=NULL,reason=NULL,write_id=?,updated_at=? WHERE id=?",
      )
      .run(time, crypto.randomUUID(), time, id),
  /Immutable archive identity/,
  'A matching check cannot authorize publication',
);
assert.throws(
  () => add(observation),
  /Invalid archive observation/,
  'Ordinary unissued tokenless observations remain forbidden',
);
add({ kind: 'read_unknown' }, { who: 'manager', lease: token });
assert.throws(
  () => add({ kind: 'read_unknown' }, { who: 'owner', lease: token }),
  /Invalid archive observation/,
  'Save lease ownership remains strict',
);
assert.throws(
  () => db.exec('UPDATE document_archive_observations SET at=at'),
  /Immutable archive observation/,
);
assert.throws(
  () => db.exec('DELETE FROM document_archive_observations'),
  /Retain archive observation/,
);
const retained = rows();
const oldGuard = unstable_splitSqlQuery(
  readFileSync('drizzle/0042_document_archive_journal.sql', 'utf8'),
).find((sql) => sql.includes('CREATE TRIGGER document_archive_observation_guard'));
db.exec('DROP TRIGGER document_archive_observation_guard');
db.exec(oldGuard);
assert.equal(rows(), retained, 'Reinstalling the old guard retains every existing check');
assert.throws(
  () => add({ ...event('requested', { manifest }), operationId: crypto.randomUUID() }),
  /Invalid archive observation/,
);
for (const sql of migration) db.exec(sql);
assert.equal(rows(), retained, 'Forward repair preserves all retained evidence');
db.close();
console.log(
  'PASS: old-rule reproduction, Wrangler trigger splitting, fresh/populated 0045 compatibility, admitted current-role checks, retained inputs after revocation, actor/lease isolation, strict references, one terminal result, no check-based publication, immutable history and non-destructive forward repair.',
);
