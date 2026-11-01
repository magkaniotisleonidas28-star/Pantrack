import assert from 'node:assert/strict';

export async function checkPreparationEvidence({
  core,
  db,
  bucket,
  state,
  request,
  command,
  tables,
  artifacts,
  setUser,
  setAfterPut,
  io,
}) {
  const names = [
    ...tables,
    'document_archive_intents',
    'document_archive_leases',
    'document_archive_observations',
  ].sort();
  const rows = async () =>
    JSON.stringify(
      (await db.batch(names.map((name) => db.prepare(`SELECT * FROM "${name}"`)))).map(
        (result) => result.results,
      ),
    );
  const journal = new core.D1DocumentArchiveJournal(db);
  const query = (id, source, extra = {}) =>
    '?' +
    new URLSearchParams({
      companyId: 'a',
      id,
      kind: source.kind,
      ...(source.kind === 'draft' ? { orderId: source.orderId } : {}),
      view: 'review-detail',
      ...extra,
    });
  const read = async (id, source) => {
    const before = await rows(),
      beforeIO = io(),
      response = await request(query(id, source));
    assert.equal(response.status, 200, await response.clone().text());
    const result = core.archiveReviewDetail.parse(await response.json());
    assert.equal(await rows(), before, 'Evidence reads preserve every application/archive row');
    assert.deepEqual(io(), beforeIO, 'Evidence reads never call R2');
    return result;
  };
  const begin = async (selected) => {
    const result = await journal.begin({
      request: selected,
      actorId: 'manager',
      requestFingerprint: await core.historyExportFingerprint({
        request: selected,
        actorId: 'manager',
      }),
      template: core.archiveTemplate(selected.source.kind, selected.format),
      requestedAt: new Date().toISOString(),
      leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
    });
    assert.equal(result.kind, 'claim');
    return result.claim;
  };
  const unprepared = await begin(command('pdf'));
  await journal.observe(unprepared, { kind: 'generation', size: 12, signature: 'pdf' });
  await journal.hold(unprepared, 'generation_failed');
  assert.deepEqual((await read(unprepared.id, unprepared.request.source)).preparation, {
    state: 'not_recorded',
  });
  const history = await new core.D1PurchaseOrderHistoryExports(db, {
      identity: async () => state.user,
    }).get({ companyId: 'a' }),
    prepared = [];
  for (const kind of ['draft', 'history'])
    for (const format of ['pdf', 'xlsx']) {
      const selected =
        kind === 'draft'
          ? command(format)
          : {
              companyId: 'a',
              operationId: crypto.randomUUID(),
              format,
              source: {
                kind: 'history',
                filters: history.filters,
                fingerprint: history.fingerprint,
              },
            };
      setAfterPut(async () => {
        throw Error('PRIVATE_UNKNOWN_PREPARED_WRITE');
      });
      assert.equal((await request('', selected)).status, 409);
      const row = await db
          .prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?')
          .bind('a', selected.operationId)
          .first(),
        manifest = JSON.parse(row.manifest_json),
        storedRequest = JSON.parse(row.request_json);
      const initial = await read(row.id, storedRequest.source);
      assert.equal(initial.item.issued, false);
      assert.equal(initial.preparation.state, 'prepared');
      assert.equal(initial.preparation.latestStorageEvidence.outcome, 'write_unconfirmed');
      assert.deepEqual(initial.preparation.expected, {
        format: manifest.format,
        template: manifest.template,
        size: manifest.size,
        sha256: manifest.sha256,
        requestedAt: manifest.requestedAt,
        sourceKind: manifest.source.kind,
        sourceFingerprint: manifest.source.fingerprint,
        sourceRecordCount: manifest.source.records.length,
      });
      // Persist an observation from the actual native object, retaining an unissued hold.
      const claim = await begin(storedRequest),
        key = await core.archiveObjectKey(manifest),
        object = await bucket.get(key),
        bytes = new Uint8Array(await object.arrayBuffer());
      await journal.observe(claim, {
        kind: 'object',
        present: true,
        reportedSize: object.size,
        byteLength: bytes.length,
        sha256: await core.documentByteDigest(bytes),
      });
      await journal.hold(claim, 'held');
      const matched = await read(row.id, storedRequest.source);
      assert.equal(matched.item.status, 'held');
      assert.equal(matched.item.issued, false);
      assert.equal(matched.preparation.latestStorageEvidence.outcome, 'matched');
      assert.equal(
        (await request('?companyId=a&id=' + row.id)).status,
        404,
        'Evidence cannot download an unissued file, even with matching native bytes',
      );
      assert.equal(
        (
          await db
            .prepare('SELECT artifact_json FROM document_archive_intents WHERE id=?')
            .bind(row.id)
            .first()
        ).artifact_json,
        null,
      );
      prepared.push({ id: row.id, request: storedRequest, manifest, claim, key, bytes, matched });
    }
  const target = prepared[0],
    originalEvidence = target.matched.preparation;
  await bucket.delete(target.key);
  assert.deepEqual(
    (await read(target.id, target.request.source)).preparation,
    originalEvidence,
    'Current physical absence cannot rewrite an earlier stored match',
  );
  await journal.observe(target.claim, {
    kind: 'object',
    present: false,
    reportedSize: null,
    byteLength: null,
    sha256: null,
  });
  const missing = await read(target.id, target.request.source);
  assert.equal(missing.preparation.latestStorageEvidence.outcome, 'missing');
  await bucket.put(target.key, target.bytes);
  assert.deepEqual(
    (await read(target.id, target.request.source)).preparation,
    missing.preparation,
    'Restoring an object cannot silently update stored evidence',
  );
  const damaged = prepared[1],
    bad = new Uint8Array(damaged.bytes.length);
  await bucket.put(damaged.key, bad);
  await journal.observe(damaged.claim, {
    kind: 'object',
    present: true,
    reportedSize: bad.length,
    byteLength: bad.length,
    sha256: await core.documentByteDigest(bad),
  });
  assert.equal(
    (await read(damaged.id, damaged.request.source)).preparation.latestStorageEvidence.outcome,
    'damaged',
  );
  await journal.observe(damaged.claim, { kind: 'read_unknown' });
  assert.equal(
    (await read(damaged.id, damaged.request.source)).preparation.latestStorageEvidence.outcome,
    'unavailable',
  );
  const active = await begin(command('pdf'));
  await journal.prepare(active, {
    ...target.manifest,
    id: active.id,
    actorId: 'manager',
    requestedAt: active.requestedAt,
  });
  const activeBefore = await db
      .prepare('SELECT token,lease_until,state FROM document_archive_intents WHERE id=?')
      .bind(active.id)
      .first(),
    activeResult = await read(active.id, active.request.source);
  assert.equal(activeResult.item.status, 'pending');
  assert.equal(activeResult.preparation.state, 'prepared');
  assert.equal(activeResult.preparation.latestStorageEvidence, null);
  assert.deepEqual(
    await db
      .prepare('SELECT token,lease_until,state FROM document_archive_intents WHERE id=?')
      .bind(active.id)
      .first(),
    activeBefore,
    'Inspection never claims, renews or releases an active lease',
  );
  await journal.hold(active, 'held');
  const issued = artifacts[0],
    issuedSource = { kind: 'draft', orderId: issued.source.records[0].id };
  assert.deepEqual((await read(issued.id, issuedSource)).preparation, { state: 'issued' });
  setUser('owner');
  const otherOwner = await read(target.id, target.request.source);
  assert.equal(otherOwner.canContinue, false);
  assert.equal(otherOwner.preparation.state, 'prepared');
  setUser('manager');
  const before = await rows(),
    beforeIO = io();
  for (const who of [null, 'employee', 'b-manager']) {
    setUser(who);
    assert.equal((await request(query(target.id, target.request.source))).status, who ? 403 : 401);
  }
  setUser('manager');
  assert.equal(
    (await request(query(target.id, target.request.source, { companyId: 'b' }))).status,
    403,
  );
  assert.equal(
    (await request(query(target.id, target.request.source, { orderId: 'different' }))).status,
    404,
  );
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'disabled';
  assert.equal((await request(query(target.id, target.request.source))).status, 404);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'enabled';
  const binding = state.env.DOCUMENT_ARCHIVE;
  delete state.env.DOCUMENT_ARCHIVE;
  await read(target.id, target.request.source);
  state.env.DOCUMENT_ARCHIVE = binding;
  assert.equal(await rows(), before);
  assert.deepEqual(io(), beforeIO);
  // The real client rejects incompatible metadata and clears previously displayed private evidence.
  const selection = { companyId: 'a', kind: 'draft', orderId: target.request.source.orderId },
    states = [];
  let mutate = null;
  const client = new core.DocumentArchiveReviewClient(
    selection,
    'manager',
    {
      fetch: async (url) => {
        const response = await request(new URL(url, 'http://app.test').search);
        if (!mutate) return response;
        const value = await response.json();
        mutate(value);
        return Response.json(value);
      },
    },
    (state) => states.push(state),
  );
  await client.detail(target.id);
  assert.equal(states.at(-1).detail.preparation.state, 'prepared');
  for (const change of [
    (value) => (value.preparation.expected.size = -1),
    (value) => (value.preparation.expected.sha256 = 'PRIVATE_HASH'),
    (value) => (value.preparation.expected.template = 'pantrack.draft-history.pdf.v1'),
    (value) => (value.preparation.expected.requestedAt = '2020-01-01T00:00:00.000Z'),
    (value) => (value.preparation.latestStorageEvidence.at = '2020-01-01T00:00:00.000Z'),
    (value) => (value.preparation = { state: 'issued' }),
    (value) => (value.preparation.expected.sourceRecordCount = 2),
    (value) => (value.preparation.expected.objectKey = 'PRIVATE_KEY'),
  ]) {
    mutate = change;
    await client.detail(target.id);
    assert.equal(states.at(-1).detail, null);
    assert.equal(states.at(-1).page, null);
    assert.ok(!states.at(-1).message.includes('PRIVATE_'));
  }
  mutate = null;
  await client.detail(target.id);
  assert.equal(states.at(-1).detail.preparation.state, 'prepared');
  client.dispose();
  // Later order edits/cancellation cannot replace the original prepared identity in review.
  return async () => {
    for (const original of prepared) {
      const result = await read(original.id, original.request.source);
      assert.deepEqual(result.preparation.expected, original.matched.preparation.expected);
      assert.equal(result.item.issued, false);
      const stored = await db
        .prepare('SELECT manifest_json,artifact_json FROM document_archive_intents WHERE id=?')
        .bind(original.id)
        .first();
      assert.equal(stored.artifact_json, null);
      assert.deepEqual(JSON.parse(stored.manifest_json), original.manifest);
    }
    console.log(
      'PASS: native prepared/unprepared/issued evidence, frozen metadata across source changes, matched/missing/damaged/unknown records, stale-versus-live storage distinction, active lease and row preservation, role/company refusal, no R2 calls and actual client DTO refusal.',
    );
  };
}
