import assert from 'node:assert/strict';

export async function checkArchiveContinuation({
  core,
  db,
  bucket,
  state,
  request,
  command,
  tables,
  setUser,
  setAfterPut,
  setBeforeGet,
  io,
  drafts,
  input,
}) {
  const rows = async (names) =>
    JSON.stringify(
      (await db.batch(names.map((name) => db.prepare(`SELECT * FROM "${name}"`)))).map(
        (r) => r.results,
      ),
    );
  const appTables = [
    ...tables,
    'document_archive_intents',
    'document_archive_leases',
    'document_archive_observations',
  ].sort();
  const query = (id, source, extra = {}) =>
    '?' +
    new URLSearchParams({
      companyId: 'a',
      id,
      kind: source.kind,
      ...(source.kind === 'draft' ? { orderId: source.orderId } : {}),
      view: 'continuation',
      ...extra,
    });
  const get = (id, source, extra = {}, headers = {}) =>
    request(query(id, source, extra), undefined, {
      'X-Pantrack-Archive-Viewer': state.user ?? '',
      ...headers,
    });
  const row = (operationId) =>
    db
      .prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?')
      .bind('a', operationId)
      .first();
  const detail = async (id, source) => {
    const response = await request(
      '?' +
        new URLSearchParams({
          companyId: 'a',
          id,
          kind: source.kind,
          ...(source.kind === 'draft' ? { orderId: source.orderId } : {}),
          view: 'review-detail',
        }),
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const reserve = async (selected, expired = false) => {
    const at = new Date(Date.now() - (expired ? 240_000 : 0)).toISOString();
    const journal = new core.D1DocumentArchiveJournal(db, {
      clock: { now: () => new Date(at), sqlNow: "'" + at + "'" },
    });
    const result = await journal.begin({
      request: selected,
      actorId: 'manager',
      requestFingerprint: await core.historyExportFingerprint({
        request: selected,
        actorId: 'manager',
      }),
      template: core.archiveTemplate(selected.source.kind, selected.format),
      requestedAt: at,
      leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
    });
    assert.equal(result.kind, 'claim');
    return result.claim.id;
  };
  const active = command('pdf'),
    activeId = await reserve(active),
    expired = command('xlsx'),
    expiredId = await reserve(expired, true);
  const beforeRows = await rows(appTables),
    beforeIo = io();
  assert.equal((await detail(activeId, active.source)).canContinue, true);
  const contextResponse = await get(activeId, active.source);
  assert.equal(contextResponse.status, 200);
  assert.deepEqual((await contextResponse.json()).request, active);
  setUser('owner');
  assert.equal(
    (await request('', active)).status,
    409,
    'Another owner cannot impersonate the original requester',
  );
  assert.equal((await detail(activeId, active.source)).canContinue, false);
  assert.equal((await get(activeId, active.source)).status, 403);
  for (const who of [null, 'employee', 'b-manager']) {
    setUser(who);
    assert.equal((await get(activeId, active.source)).status, who ? 403 : 401);
  }
  setUser('manager');
  assert.equal((await request('', active, { origin: 'https://outside.invalid' })).status, 403);
  await db
    .prepare("UPDATE memberships SET role='owner' WHERE company_id='a' AND user_id='manager'")
    .run();
  assert.equal(
    (await get(activeId, active.source)).status,
    200,
    'The same original actor may now hold the owner role',
  );
  await db
    .prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'")
    .run();
  assert.equal(
    (await get(activeId, active.source, {}, { 'X-Pantrack-Archive-Viewer': 'owner' })).status,
    403,
  );
  for (const extra of [
    { companyId: 'b' },
    { orderId: 'other-draft' },
    { kind: 'history', orderId: '' },
  ])
    assert.ok([400, 403].includes((await get(activeId, active.source, extra)).status));
  for (const extra of [{ actorId: 'manager' }, { token: 'PRIVATE_TOKEN' }, { offset: '0' }])
    assert.equal((await get(activeId, active.source, extra)).status, 400);
  assert.equal(
    (
      await request(query(activeId, active.source) + '&companyId=a', undefined, {
        'X-Pantrack-Archive-Viewer': 'manager',
      })
    ).status,
    400,
  );
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'disabled';
  assert.equal((await get(activeId, active.source)).status, 404);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'enabled';
  const binding = state.env.DOCUMENT_ARCHIVE;
  delete state.env.DOCUMENT_ARCHIVE;
  assert.equal((await get(activeId, active.source)).status, 200);
  state.env.DOCUMENT_ARCHIVE = binding;
  assert.equal(
    await rows(appTables),
    beforeRows,
    'Lookup/review never changes any application/archive row',
  );
  assert.deepEqual(io(), beforeIo, 'Lookup never reaches R2');
  assert.equal((await request('', active)).status, 409);
  assert.equal(io().puts, beforeIo.puts, 'Active lease never competes with a renderer');
  const expiredContext = await (await get(expiredId, expired.source)).json(),
    beforeExpired = io().puts;
  const expiredReplies = await Promise.all([
    request('', expiredContext.request),
    request('', expiredContext.request),
  ]);
  assert.ok(expiredReplies.some((r) => r.status === 200));
  assert.ok(expiredReplies.every((r) => [200, 409].includes(r.status)));
  const expiredArtifact = (await (await request('', expired)).json()).artifact;
  assert.equal(expiredArtifact.id, expiredId);
  assert.equal(io().puts, beforeExpired + 1);
  assert.equal((await get(expiredId, expired.source)).status, 409);
  const history = await new core.D1PurchaseOrderHistoryExports(db, {
    identity: async () => state.user,
  }).get({ companyId: 'a' });
  const prepared = [];
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
        throw Error('PRIVATE_LOST_WRITE_ACK');
      });
      assert.equal((await request('', selected)).status, 409);
      const intent = await row(selected.operationId),
        manifest = JSON.parse(intent.manifest_json),
        key = await core.archiveObjectKey(manifest),
        original = new Uint8Array(await (await bucket.get(key)).arrayBuffer());
      const context = await (await get(intent.id, selected.source)).json();
      assert.deepEqual(context.request, selected);
      assert.equal(context.documentId, intent.id);
      assert.equal(context.viewerId, 'manager');
      assert.ok(!JSON.stringify(context).includes('PRIVATE_'));
      const business = await rows(tables),
        puts = io().puts;
      const response = await request('', context.request);
      assert.equal(response.status, 200, await response.clone().text());
      const artifact = (await response.json()).artifact;
      assert.equal(artifact.id, intent.id);
      assert.equal(io().puts, puts, 'Prepared continuation never puts again');
      assert.equal(await rows(tables), business);
      assert.equal(
        await core.documentByteDigest(new Uint8Array(await (await bucket.get(key)).arrayBuffer())),
        await core.documentByteDigest(original),
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) n FROM document_archive_intents WHERE company_id=? AND operation_id=?',
            )
            .bind('a', selected.operationId)
            .first()
        ).n,
        1,
      );
      prepared.push({ selected, artifact });
    }
  // Full client -> real GET/POST/metadata lifecycle, with no original browser recovery record.
  const selected = command('pdf');
  setAfterPut(async () => {
    throw Error('PRIVATE_UNKNOWN_WRITE');
  });
  assert.equal((await request('', selected)).status, 409);
  const intent = await row(selected.operationId),
    item = (await detail(intent.id, selected.source)).item,
    store = new Map(),
    states = [],
    posted = [];
  let lose = true,
    saved = 0;
  const dependencies = {
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    uuid: () => assert.fail('Continuation must not create an operation ID'),
    saved: () => saved++,
    download: () => assert.fail('No automatic download'),
    fetch: async (url, options = {}) => {
      const body = options.method === 'POST' ? JSON.parse(options.body) : undefined;
      if (body) posted.push(body);
      const response = await request(new URL(url, 'http://app.test').search, body, options.headers);
      if (body && lose) {
        lose = false;
        assert.equal(response.status, 200);
        throw Error('PRIVATE_LOST_HTTP_REPLY');
      }
      return response;
    },
  };
  const putsBefore = io().puts,
    businessBefore = await rows(tables),
    clientSelection = { companyId: 'a', source: selected.source };
  const first = new core.PurchaseOrderArchiveClient(clientSelection, 'manager', dependencies, (s) =>
    states.push(s),
  );
  await first.continueSave(item);
  assert.equal(states.at(-1).pending, true);
  assert.equal(store.size, 1);
  assert.equal(saved, 0);
  first.dispose();
  const restarted = new core.PurchaseOrderArchiveClient(
    clientSelection,
    'manager',
    dependencies,
    (s) => states.push(s),
  );
  await restarted.retry();
  assert.deepEqual(posted, [selected, selected]);
  assert.equal(saved, 1);
  assert.equal(store.size, 0);
  assert.equal(io().puts, putsBefore);
  assert.equal(await rows(tables), businessBefore);
  restarted.dispose();
  // Revoke at the actual D1 lookup boundary and then between its two guarded reads.
  for (const afterFirst of [false, true]) {
    let batches = 0;
    state.db = {
      prepare: (...args) => db.prepare(...args),
      batch: async (statements) => {
        batches++;
        if (!afterFirst)
          await db
            .prepare(
              "UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'",
            )
            .run();
        const result = await db.batch(statements);
        if (afterFirst && batches === 1)
          await db
            .prepare(
              "UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'",
            )
            .run();
        return result;
      },
    };
    const before = io();
    try {
      assert.equal((await get(activeId, active.source)).status, 403);
      assert.deepEqual(io(), before);
    } finally {
      state.db = db;
      await db
        .prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'")
        .run();
    }
  }
  let batches = 0;
  state.db = {
    prepare: (...args) => db.prepare(...args),
    batch: async (statements) => {
      const result = await db.batch(statements);
      if (++batches === 2) setUser('owner');
      return result;
    },
  };
  try {
    assert.equal((await get(activeId, active.source)).status, 403);
  } finally {
    state.db = db;
    setUser('manager');
  }
  // An existing prepared object is never regenerated when it is missing, corrupt, or unreadable.
  for (const problem of ['missing', 'damaged', 'unavailable']) {
    const selected = command('pdf');
    setAfterPut(async () => {
      throw Error('PRIVATE_UNKNOWN_WRITE');
    });
    assert.equal((await request('', selected)).status, 409);
    const intent = await row(selected.operationId),
      manifest = JSON.parse(intent.manifest_json),
      key = await core.archiveObjectKey(manifest);
    if (problem === 'missing') await bucket.delete(key);
    if (problem === 'damaged') await bucket.put(key, new Uint8Array(manifest.size));
    if (problem === 'unavailable')
      setBeforeGet(async () => {
        throw Error('PRIVATE_READ_FAILURE');
      });
    const context = await (await get(intent.id, selected.source)).json(),
      before = io().puts,
      response = await request('', context.request);
    assert.ok([409, 503].includes(response.status));
    assert.equal(io().puts, before);
    assert.equal((await row(selected.operationId)).artifact_json, null);
    assert.ok(
      (
        await db
          .prepare('SELECT count(*) n FROM document_archive_observations WHERE document_id=?')
          .bind(intent.id)
          .first()
      ).n > 0,
    );
  }
  // Final browser access guard runs against the actual issued metadata route.
  const originalFetch = dependencies.fetch;
  const roleCommand = command('xlsx');
  setAfterPut(async () => {
    throw Error('PRIVATE_UNKNOWN_WRITE');
  });
  assert.equal((await request('', roleCommand)).status, 409);
  const roleIntent = await row(roleCommand.operationId),
    roleItem = (await detail(roleIntent.id, roleCommand.source)).item;
  lose = false;
  dependencies.fetch = async (url, options) => {
    if (new URL(url, 'http://app.test').searchParams.get('view') === 'metadata')
      await db
        .prepare(
          "UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'",
        )
        .run();
    return originalFetch(url, options);
  };
  const roleClient = new core.PurchaseOrderArchiveClient(
      clientSelection,
      'manager',
      dependencies,
      (s) => states.push(s),
    ),
    beforeSaved = saved;
  try {
    await roleClient.continueSave(roleItem);
    assert.equal(saved, beforeSaved);
    assert.equal(states.at(-1).pending, true);
  } finally {
    await db
      .prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'")
      .run();
    dependencies.fetch = originalFetch;
  }
  await roleClient.retry();
  assert.equal(saved, beforeSaved + 1);
  roleClient.dispose();
  // Explicit edits/cancellation invalidate unissued publication, with the old file retained.
  for (const change of ['edit', 'cancel']) {
    const other = await drafts.create(input()),
      cancelCommand = {
        ...command('pdf'),
        source: { kind: 'draft', orderId: other.snapshot.id, revision: other.revision },
      };
    setAfterPut(async () => {
      throw Error('PRIVATE_UNKNOWN_WRITE');
    });
    assert.equal((await request('', cancelCommand)).status, 409);
    const cancelIntent = await row(cancelCommand.operationId),
      key = await core.archiveObjectKey(JSON.parse(cancelIntent.manifest_json)),
      oldHash = await core.documentByteDigest(
        new Uint8Array(await (await bucket.get(key)).arrayBuffer()),
      );
    if (change === 'edit')
      await drafts.edit({
        ...input(),
        action: 'edit',
        orderId: other.snapshot.id,
        expectedRevision: other.revision,
        reason: 'Continuation fixture edit',
        notes: 'Changed after the interrupted save',
      });
    else
      await drafts.cancel({
        action: 'cancel',
        companyId: 'a',
        operationId: crypto.randomUUID(),
        orderId: other.snapshot.id,
        expectedRevision: other.revision,
        reason: 'Continuation fixture cancellation',
      });
    const business = await rows(tables),
      writes = io().puts,
      context = await (await get(cancelIntent.id, cancelCommand.source)).json(),
      response = await request('', context.request);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'source_changed');
    assert.equal(io().puts, writes);
    assert.equal(await rows(tables), business);
    assert.equal((await row(cancelCommand.operationId)).artifact_json, null);
    assert.equal(
      await core.documentByteDigest(new Uint8Array(await (await bucket.get(key)).arrayBuffer())),
      oldHash,
    );
  }
  console.log(
    'PASS: native original-actor continuation, read-only scoped lookup, active/expired lease races, both formats/sources, prepared/no-repeat writes, lost reply client restart, session/membership/final access refusal, missing/damaged/unavailable holds and canceled-source preservation.',
  );
}
