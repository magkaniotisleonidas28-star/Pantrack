import assert from 'node:assert/strict';

export async function checkPreparedFileApi({
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
  setAfterGet,
  setBeforeGet,
  io,
}) {
  const journal = new core.D1DocumentArchiveJournal(db),
    prepared = [];
  const history = await new core.D1PurchaseOrderHistoryExports(db, {
    identity: async () => state.user,
  }).get({ companyId: 'a' });
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
        throw Error('PRIVATE_PREPARED_ACK');
      });
      assert.equal((await request('', selected)).status, 409);
      const row = await db
        .prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?')
        .bind('a', selected.operationId)
        .first();
      const manifest = JSON.parse(row.manifest_json),
        key = await core.archiveObjectKey(manifest),
        bytes = new Uint8Array(await (await bucket.get(key)).arrayBuffer());
      prepared.push({ id: row.id, manifest, key, bytes, request: JSON.parse(row.request_json) });
    }
  const activeRequest = command('pdf'),
    active = await journal.begin({
      request: activeRequest,
      actorId: 'manager',
      requestFingerprint: await core.historyExportFingerprint({
        request: activeRequest,
        actorId: 'manager',
      }),
      template: core.archiveTemplate('draft', 'pdf'),
      requestedAt: new Date().toISOString(),
      leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
    });
  assert.equal(active.kind, 'claim');
  await journal.prepare(active.claim, {
    ...prepared[0].manifest,
    id: active.claim.id,
    requestedAt: active.claim.requestedAt,
  });
  const activeKey = await core.archiveObjectKey({
    ...prepared[0].manifest,
    id: active.claim.id,
    requestedAt: active.claim.requestedAt,
  });
  await bucket.put(activeKey, prepared[0].bytes);
  const rawRequest = command('pdf'),
    unprepared = await journal.begin({
      request: rawRequest,
      actorId: 'manager',
      requestFingerprint: await core.historyExportFingerprint({
        request: rawRequest,
        actorId: 'manager',
      }),
      template: core.archiveTemplate('draft', 'pdf'),
      requestedAt: new Date().toISOString(),
      leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
    });
  assert.equal(unprepared.kind, 'claim');
  await journal.hold(unprepared.claim, 'generation_failed');
  const names = [...tables, 'document_archive_intents', 'document_archive_leases'].sort(),
    rows = async () =>
      JSON.stringify(
        (await db.batch(names.map((name) => db.prepare(`SELECT * FROM "${name}"`)))).map(
          (result) => result.results,
        ),
      );
  const before = await rows(),
    putCount = io().puts;
  const selected = (copy = prepared[0], operationId = crypto.randomUUID()) => ({
    companyId: 'a',
    documentId: copy.id,
    operationId,
  });
  const check = async (input, status = 200, headers = {}) => {
    const response = await request('/check-prepared', input, headers);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const events = async (operationId) => {
    return (
      await db
        .prepare(
          "SELECT * FROM document_archive_observations WHERE company_id='a' AND json_extract(payload_json,'$.kind')='prepared_check' AND json_extract(payload_json,'$.operationId')=? ORDER BY rowid",
        )
        .bind(operationId)
        .all()
    ).results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
  };
  const originals = [];
  for (const copy of prepared) {
    const input = selected(copy),
      result = core.preparedFileCheckResponse.parse(await check(input));
    assert.equal(result.check.outcome, 'verified');
    assert.equal(result.check.actorId, 'manager');
    assert.equal(result.replayed, false);
    const reads = io().gets;
    assert.deepEqual((await check(input)).check, result.check);
    assert.equal(io().gets, reads);
    assert.deepEqual(
      (await events(input.operationId)).map((row) => row.payload.stage),
      ['requested', 'observed', 'completed'],
    );
    originals.push({ copy, input, result });
    const source = copy.request.source,
      detail = await (
        await request(
          '?' +
            new URLSearchParams({
              companyId: 'a',
              id: copy.id,
              kind: source.kind,
              ...(source.kind === 'draft' ? { orderId: source.orderId } : {}),
              view: 'review-detail',
            }),
        )
      ).json();
    assert.equal(detail.item.issued, false);
    assert.equal(detail.preparation.latestStorageEvidence.outcome, 'matched');
    assert.equal(detail.preparation.latestStorageEvidence.at, result.check.checkedAt);
    assert.equal(
      (await request('?companyId=a&id=' + copy.id)).status,
      404,
      'Checking matching bytes never issues or downloads the copy',
    );
    setUser('owner');
    await check(input, 409);
    assert.equal((await check(selected(copy))).check.actorId, 'owner');
    setUser('manager');
  }
  const target = prepared[0],
    saved = originals[0];
  await bucket.delete(target.key);
  let reads = io().gets;
  assert.deepEqual((await check(saved.input)).check, saved.result.check);
  assert.equal(io().gets, reads);
  const missing = selected();
  assert.equal((await check(missing)).check.outcome, 'missing');
  await bucket.put(target.key, target.bytes);
  assert.equal((await check(missing)).check.outcome, 'missing');
  assert.equal((await check(selected())).check.outcome, 'verified');
  await bucket.put(target.key, new Uint8Array(target.bytes.length));
  assert.equal((await check(selected())).check.outcome, 'damaged');
  await bucket.put(target.key, target.bytes);
  setBeforeGet(async () => {
    throw Error('PRIVATE_READ_FAILURE');
  });
  const unavailable = selected();
  assert.equal((await check(unavailable)).check.outcome, 'unavailable');
  reads = io().gets;
  assert.equal((await check(unavailable)).check.outcome, 'unavailable');
  assert.equal(io().gets, reads);
  const binding = state.env.DOCUMENT_ARCHIVE;
  delete state.env.DOCUMENT_ARCHIVE;
  assert.equal((await check(selected())).check.outcome, 'unavailable');
  assert.deepEqual((await check(saved.input)).check, saved.result.check);
  state.env.DOCUMENT_ARCHIVE = binding;
  state.env.DOCUMENT_ARCHIVE = {
    ...binding,
    get: async (...args) => {
      const object = await binding.get(...args);
      return { key: object.key, size: core.DOCUMENT_ARCHIVE_MAX_BYTES + 1, body: object.body };
    },
  };
  assert.equal((await check(selected())).check.outcome, 'damaged');
  state.env.DOCUMENT_ARCHIVE = binding;
  const activeBefore = await db
    .prepare('SELECT * FROM document_archive_intents WHERE id=?')
    .bind(active.claim.id)
    .first();
  assert.equal((await check(selected({ id: active.claim.id }))).check.outcome, 'verified');
  assert.deepEqual(
    await db
      .prepare('SELECT * FROM document_archive_intents WHERE id=?')
      .bind(active.claim.id)
      .first(),
    activeBefore,
    'A read does not claim, release or renew the active save',
  );
  for (const who of [null, 'employee', 'b-manager']) {
    setUser(who);
    const noIO = io();
    await check(selected(), who ? 403 : 401);
    assert.deepEqual(io(), noIO);
  }
  setUser('b-manager');
  await check({ ...selected(), companyId: 'b' }, 404);
  setUser('manager');
  const noIO = io();
  await check(selected(), 403, { 'X-Pantrack-Archive-Viewer': 'owner' });
  await check(selected(), 403, { origin: 'https://outside.invalid' });
  for (const extra of [
    { actorId: 'owner' },
    { bytes: [1] },
    { source: {} },
    { key: 'PRIVATE' },
    { outcome: 'verified' },
  ])
    await check({ ...selected(), ...extra }, 400);
  await check({ ...selected(), operationId: 'invalid' }, 400);
  assert.equal((await request('/check-prepared?extra=1', selected())).status, 400);
  await check(selected(artifacts[0]), 404);
  await check(selected({ id: unprepared.claim.id }), 404);
  await check(selected({ id: crypto.randomUUID() }), 404);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'disabled';
  await check(selected(), 404);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'enabled';
  assert.deepEqual(io(), noIO);
  const legacy = await db
    .prepare(
      "SELECT id FROM document_archive_observations WHERE company_id='a' AND token IS NOT NULL LIMIT 1",
    )
    .first();
  reads = io().gets;
  await check(selected(target, legacy.id), 409);
  assert.equal(io().gets, reads);
  const collision = crypto.randomUUID();
  await check(selected(target, collision));
  await check(selected(prepared[1], collision), 409);
  const duplicate = selected(),
    both = await Promise.all([check(duplicate), check(duplicate)]);
  assert.deepEqual(both[0].check, both[1].check);
  assert.equal(
    (await events(duplicate.operationId)).filter((row) => row.payload.stage === 'completed').length,
    1,
  );
  const crossId = crypto.randomUUID(),
    cross = await Promise.all([
      request('/check-prepared', selected(target, crossId)),
      request('/check-prepared', selected(prepared[1], crossId)),
    ]);
  assert.deepEqual(cross.map((response) => response.status).sort(), [200, 409]);
  const revoked = selected();
  setAfterGet(async () =>
    db
      .prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'")
      .run(),
  );
  await check(revoked, 403);
  assert.deepEqual(
    (await events(revoked.operationId)).map((row) => row.payload.stage),
    ['requested', 'observed'],
  );
  await db
    .prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'")
    .run();
  assert.equal((await check(revoked)).check.outcome, 'verified');
  const changed = selected();
  setAfterGet(async () => setUser('owner'));
  await check(changed, 403);
  assert.deepEqual(
    (await events(changed.operationId)).map((row) => row.payload.stage),
    ['requested', 'observed'],
  );
  setUser('manager');
  await check(changed);
  // Lose acknowledgments after actual native D1 commits, not simulated receipts.
  for (const phase of ['requested', 'observed', 'completed']) {
    const input = selected();
    let injected = false;
    const wrap = (statement, values = []) => ({
      original: statement,
      bind(...args) {
        return wrap(statement.bind(...args), args);
      },
      first: (...args) => statement.first(...args),
      all: (...args) => statement.all(...args),
      async run() {
        const result = await statement.run();
        if (
          !injected &&
          values.some(
            (value) => typeof value === 'string' && value.includes('"stage":"' + phase + '"'),
          )
        ) {
          injected = true;
          throw Error('PRIVATE_D1_ACK');
        }
        return result;
      },
    });
    state.db = {
      prepare: (sql) => wrap(db.prepare(sql)),
      batch: (statements) =>
        db.batch(statements.map((statement) => statement.original ?? statement)),
    };
    try {
      assert.equal((await check(input)).check.outcome, 'verified');
      assert.equal(injected, true);
    } finally {
      state.db = db;
    }
    assert.equal(
      (await events(input.operationId)).filter((row) => row.payload.stage === 'completed').length,
      1,
    );
  }
  const lost = selected(),
    original = await check(lost);
  reads = io().gets;
  assert.deepEqual((await check(lost)).check, original.check);
  assert.equal(io().gets, reads);
  assert.equal(
    await rows(),
    before,
    'Only declared check events append; every existing application/intent/lease row stays unchanged',
  );
  assert.equal(io().puts, putCount);
  for (const copy of prepared) {
    assert.deepEqual(new Uint8Array(await (await bucket.get(copy.key)).arrayBuffer()), copy.bytes);
    const row = await db
      .prepare('SELECT manifest_json,artifact_json FROM document_archive_intents WHERE id=?')
      .bind(copy.id)
      .first();
    assert.equal(row.artifact_json, null);
    assert.deepEqual(JSON.parse(row.manifest_json), copy.manifest);
  }
  await journal.hold(active.claim, 'held');
  // A real continuation publishes while a fresh check is reading. Retain that
  // check's inputs, refuse its result, and keep prepared evidence out of issued health.
  const raceRequest = command('pdf');
  setAfterPut(async () => {
    throw Error('PRIVATE_RACE_WRITE_ACK');
  });
  assert.equal((await request('', raceRequest)).status, 409);
  const raceRow = await db
      .prepare('SELECT * FROM document_archive_intents WHERE operation_id=?')
      .bind(raceRequest.operationId)
      .first(),
    raceManifest = JSON.parse(raceRow.manifest_json),
    raceCopy = { id: raceRow.id };
  const priorInput = selected(raceCopy),
    prior = await check(priorInput);
  const continued = await journal.begin({
    request: raceRequest,
    actorId: 'manager',
    requestFingerprint: await core.historyExportFingerprint({
      request: raceRequest,
      actorId: 'manager',
    }),
    template: raceManifest.template,
    requestedAt: new Date().toISOString(),
    leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
  });
  assert.equal(continued.kind, 'claim');
  setAfterGet(async () => {
    const proof = await journal.observe(continued.claim, {
      kind: 'object',
      present: true,
      reportedSize: raceManifest.size,
      byteLength: raceManifest.size,
      sha256: raceManifest.sha256,
    });
    await journal.publish(continued.claim, proof);
  });
  state.env.DOCUMENT_ARCHIVE = {
    ...binding,
    get: async (...args) => {
      const object = await binding.get(...args);
      return { key: object.key, size: core.DOCUMENT_ARCHIVE_MAX_BYTES + 1, body: object.body };
    },
  };
  const raced = selected(raceCopy);
  try {
    await check(raced, 404);
  } finally {
    state.env.DOCUMENT_ARCHIVE = binding;
  }
  assert.deepEqual(
    (await events(raced.operationId)).map((row) => row.payload.stage),
    ['requested', 'observed'],
  );
  assert.equal(
    (await events(raced.operationId))[1].payload.observation.reportedSize,
    core.DOCUMENT_ARCHIVE_MAX_BYTES + 1,
  );
  const issuedReview = await (
    await request(
      '?' +
        new URLSearchParams({
          companyId: 'a',
          id: raceRow.id,
          kind: 'draft',
          orderId: raceRequest.source.orderId,
          view: 'review-detail',
        }),
    )
  ).json();
  assert.equal(issuedReview.item.issued, true);
  assert.equal(issuedReview.item.status, 'issued');
  assert.equal(issuedReview.item.lastCheckedAt, null);
  reads = io().gets;
  assert.deepEqual((await check(priorInput)).check, prior.check);
  assert.equal(
    io().gets,
    reads,
    'A completed check still replays after a later authorized publication',
  );
  console.log(
    'PASS: fresh native prepared-file API checks, all sources/formats, missing/damaged/oversized/unknown evidence, immutable replay and actual concurrent collisions, current role/actor/CSRF isolation, admission-before-read, retained inputs after refusal, actual lost D1 acknowledgments, untouched leases/business rows/files and no publication.',
  );
  return async () => {
    for (const copy of prepared) {
      assert.equal((await check(selected(copy))).check.outcome, 'verified');
      assert.deepEqual(
        JSON.parse(
          (
            await db
              .prepare('SELECT manifest_json FROM document_archive_intents WHERE id=?')
              .bind(copy.id)
              .first()
          ).manifest_json,
        ),
        copy.manifest,
      );
    }
    console.log(
      'PASS: fresh prepared checks retain original bytes and source proof after order edits/cancellation.',
    );
  };
}
