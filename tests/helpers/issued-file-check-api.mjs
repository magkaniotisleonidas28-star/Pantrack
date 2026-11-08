import assert from 'node:assert/strict';

export async function checkIssuedFileApi({
  core,
  db,
  bucket,
  state,
  request,
  command,
  tables,
  setUser,
  setAfterGet,
  setBeforeGet,
  io,
}) {
  const copies = [];
  for (const format of ['pdf', 'xlsx'])
    copies.push((await (await request('', command(format))).json()).artifact);
  const history = await new core.D1PurchaseOrderHistoryExports(db, {
    identity: async () => 'manager',
  }).get({ companyId: 'a' });
  for (const format of ['pdf', 'xlsx'])
    copies.push(
      (
        await (
          await request('', {
            companyId: 'a',
            operationId: crypto.randomUUID(),
            format,
            source: { kind: 'history', filters: history.filters, fingerprint: history.fingerprint },
          })
        ).json()
      ).artifact,
    );
  assert.ok(copies.every(Boolean));
  const selected = (artifact = copies[0], operationId = crypto.randomUUID()) => ({
    companyId: 'a',
    documentId: artifact.id,
    operationId,
  });
  const check = async (command, status = 200, headers = {}) => {
    const response = await request('/check', command, headers);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const rows = async () =>
    JSON.stringify(
      (
        await db.batch(
          [...tables, 'document_archive_intents', 'document_archive_leases']
            .sort()
            .map((name) => db.prepare(`SELECT * FROM "${name}"`)),
        )
      ).map((r) => r.results),
    );
  const count = async (id) =>
    (
      await db
        .prepare('SELECT count(*) n FROM document_archive_observations WHERE company_id=? AND id=?')
        .bind('a', id)
        .first()
    ).n;
  const before = await rows(),
    writes = io().puts,
    originals = [];
  for (const artifact of copies) {
    const key = await core.archiveObjectKey(artifact);
    originals.push({ key, bytes: new Uint8Array(await (await bucket.get(key)).arrayBuffer()) });
  }
  for (const artifact of copies) {
    const input = selected(artifact),
      result = await check(input);
    assert.equal(result.check.outcome, 'verified');
    assert.equal(result.viewerId, 'manager');
    assert.equal(result.check.actorId, 'manager');
    assert.equal(result.replayed, false);
    const reads = io().gets,
      replay = await check(input);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.check, result.check);
    assert.equal(io().gets, reads);
    assert.equal(await count(input.operationId), 1);
    const receipt = await db
      .prepare('SELECT payload_json FROM document_archive_observations WHERE company_id=? AND id=?')
      .bind('a', input.operationId)
      .first();
    assert.ok(JSON.parse(receipt.payload_json).check.observationId);
    setUser('owner');
    await check(input, 409);
    const own = await check(selected(artifact));
    assert.equal(own.check.actorId, 'owner');
    setUser('manager');
  }
  // A replay reports the original time/result even when the underlying file changes.
  const saved = selected(),
    first = await check(saved);
  await bucket.put(originals[0].key, new Uint8Array(copies[0].size));
  const getCount = io().gets;
  assert.deepEqual((await check(saved)).check, first.check);
  assert.equal(io().gets, getCount);
  assert.equal((await check(selected())).check.outcome, 'damaged');
  await bucket.put(originals[0].key, originals[0].bytes);
  const missingInput = selected(copies[1]);
  await bucket.delete(originals[1].key);
  assert.equal((await check(missingInput)).check.outcome, 'missing');
  await bucket.put(originals[1].key, originals[1].bytes);
  assert.equal((await check(missingInput)).check.outcome, 'missing');
  assert.equal((await check(selected(copies[1]))).check.outcome, 'verified');
  // Keep a real native body, but report an over-limit size. The adapter runtime
  // suite separately verifies real oversized-body refusal with a smaller bound.
  const originalBinding = state.env.DOCUMENT_ARCHIVE;
  state.env.DOCUMENT_ARCHIVE = {
    ...originalBinding,
    get: async (...args) => {
      const object = await originalBinding.get(...args);
      return { key: object.key, size: core.DOCUMENT_ARCHIVE_MAX_BYTES + 1, body: object.body };
    },
  };
  try {
    assert.equal((await check(selected())).check.outcome, 'damaged');
  } finally {
    state.env.DOCUMENT_ARCHIVE = originalBinding;
  }
  setBeforeGet(async () => {
    throw Error('PRIVATE_PROVIDER_FAILURE');
  });
  const unavailableInput = selected(),
    unavailable = await check(unavailableInput);
  assert.equal(unavailable.check.outcome, 'unavailable');
  const afterUnavailable = io().gets;
  assert.equal((await check(unavailableInput)).check.outcome, 'unavailable');
  assert.equal(io().gets, afterUnavailable);
  assert.equal((await check(selected())).check.outcome, 'verified');
  const binding = state.env.DOCUMENT_ARCHIVE;
  delete state.env.DOCUMENT_ARCHIVE;
  assert.equal((await check(selected())).check.outcome, 'unavailable');
  assert.deepEqual((await check(saved)).check, first.check);
  state.env.DOCUMENT_ARCHIVE = binding;
  for (const who of [null, 'employee', 'b-manager']) {
    setUser(who);
    const noIO = io();
    await check(selected(), who ? 403 : 401);
    assert.deepEqual(io(), noIO);
  }
  setUser('b-manager');
  await check({ ...selected(), companyId: 'b' }, 404);
  setUser('manager');
  const held = await db
    .prepare(
      'SELECT id FROM document_archive_intents WHERE company_id=? AND artifact_json IS NULL LIMIT 1',
    )
    .bind('a')
    .first();
  assert.ok(held);
  await check({ ...selected(), documentId: held.id }, 404);
  const noIO = io();
  await check(selected(), 403, { 'X-Pantrack-Archive-Viewer': 'owner' });
  await check(selected(), 403, { origin: 'https://outside.invalid' });
  for (const extra of [
    { actorId: 'owner' },
    { bytes: [1] },
    { key: 'PRIVATE_KEY' },
    { outcome: 'verified' },
    { source: {} },
  ])
    await check({ ...selected(), ...extra }, 400);
  await check({ ...selected(), operationId: 'invalid' }, 400);
  await check({ ...selected(), documentId: 'invalid' }, 400);
  assert.equal((await request('/check?extra=1', selected())).status, 400);
  assert.deepEqual(io(), noIO);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'disabled';
  await check(selected(), 404);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW = 'enabled';
  // Existing non-check observations may never be reused as check receipts.
  const legacy = await db
    .prepare(
      'SELECT id FROM document_archive_observations WHERE company_id=? AND token IS NOT NULL LIMIT 1',
    )
    .bind('a')
    .first();
  const beforeConflict = io().gets;
  await check(selected(copies[0], legacy.id), 409);
  assert.equal(io().gets, beforeConflict);
  const conflictId = crypto.randomUUID();
  await check(selected(copies[0], conflictId));
  await check(selected(copies[1], conflictId), 409);
  // Actual concurrent calls settle on one immutable receipt, including cross-document collisions.
  const duplicate = selected(),
    both = await Promise.all([check(duplicate), check(duplicate)]);
  assert.deepEqual(both[0].check, both[1].check);
  assert.equal(await count(duplicate.operationId), 1);
  const crossId = crypto.randomUUID(),
    cross = await Promise.all([
      request('/check', selected(copies[0], crossId)),
      request('/check', selected(copies[1], crossId)),
    ]);
  assert.deepEqual(cross.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await count(crossId), 1);
  // Inputs survive access loss, while no success receipt is authorized afterward.
  const revoked = selected(),
    observationsBefore = (
      await db.prepare('SELECT count(*) n FROM document_archive_observations').first()
    ).n;
  setAfterGet(async () =>
    db
      .prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'")
      .run(),
  );
  await check(revoked, 403);
  assert.equal(await count(revoked.operationId), 0);
  assert.ok(
    (await db.prepare('SELECT count(*) n FROM document_archive_observations').first()).n >
      observationsBefore,
  );
  await db
    .prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'")
    .run();
  await check(revoked);
  const changed = selected();
  setAfterGet(async () => setUser('owner'));
  await check(changed, 403);
  assert.equal(await count(changed.operationId), 0);
  setUser('manager');
  // Inject faults into the actual native D1 batch lifecycle, not helper-return mocks.
  async function withBatchHook(hook, work) {
    const queries = new WeakMap();
    state.db = {
      prepare: (query) => ({
        bind: (...args) => {
          const bound = db.prepare(query).bind(...args);
          queries.set(bound, query);
          return bound;
        },
      }),
      batch: async (statements) =>
        hook(
          statements.map((s) => queries.get(s) ?? ''),
          () => db.batch(statements),
        ),
    };
    try {
      return await work();
    } finally {
      state.db = db;
      await db
        .prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'")
        .run();
    }
  }
  const sqlReceipt = (query) =>
    query.includes('INSERT INTO document_archive_observations') && query.includes('NOT EXISTS');
  const ack = selected();
  let lost = false;
  await withBatchHook(
    async (queries, run) => {
      const result = await run();
      if (!lost && queries.some(sqlReceipt)) {
        lost = true;
        throw Error('PRIVATE_LOST_D1_ACK');
      }
      return result;
    },
    async () => assert.equal((await check(ack)).check.outcome, 'verified'),
  );
  assert.equal(await count(ack.operationId), 1);
  const atCommit = selected();
  await withBatchHook(
    async (queries, run) => {
      if (queries.some(sqlReceipt))
        await db
          .prepare(
            "UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'",
          )
          .run();
      return run();
    },
    async () => await check(atCommit, 403),
  );
  assert.equal(await count(atCommit.operationId), 0);
  const noAudit = selected();
  await withBatchHook(
    async (queries, run) => {
      if (
        queries.some(
          (q) => q.includes('INSERT INTO document_archive_observations') && !sqlReceipt(q),
        )
      )
        throw Error('PRIVATE_AUDIT_FAILURE');
      return run();
    },
    async () => await check(noAudit, 503),
  );
  assert.equal(await count(noAudit.operationId), 0);
  // A late old receipt cannot override a newer observed failure in review.
  let reached, release;
  const waitingReceipt = new Promise((r) => (reached = r)),
    released = new Promise((r) => (release = r));
  let delayed = false;
  await withBatchHook(
    async (queries, run) => {
      if (!delayed && queries.some(sqlReceipt)) {
        delayed = true;
        reached();
        await released;
      }
      return run();
    },
    async () => {
      const oldCheck = check(selected());
      await waitingReceipt;
      await bucket.put(originals[0].key, new Uint8Array(copies[0].size));
      try {
        assert.equal((await check(selected())).check.outcome, 'damaged');
      } finally {
        release();
      }
      assert.equal((await oldCheck).check.outcome, 'verified');
      const url =
        '?' +
        new URLSearchParams({
          companyId: 'a',
          view: 'review-detail',
          kind: 'draft',
          orderId: copies[0].source.records[0].id,
          id: copies[0].id,
        });
      const review = await (await request(url)).json();
      assert.equal(review.item.status, 'damaged');
      const canonicalIds = (
        await db
          .prepare(
            "SELECT id FROM document_archive_observations WHERE company_id=? AND json_extract(payload_json,'$.check.contract') IS NOT NULL",
          )
          .bind('a')
          .all()
      ).results.map((r) => r.id);
      assert.ok(
        review.events.every((event) => !canonicalIds.includes(event.id)),
        'History shows real observations, not duplicated receipt summaries',
      );
    },
  );
  await bucket.put(originals[0].key, originals[0].bytes);
  assert.equal((await check(selected())).check.outcome, 'verified');
  // The actual browser client can recover a committed result after its HTTP reply is lost.
  const storageMap = new Map(),
    storage = {
      getItem: (k) => storageMap.get(k) ?? null,
      setItem: (k, v) => storageMap.set(k, v),
      removeItem: (k) => storageMap.delete(k),
    },
    posts = [];
  let loseReply = true;
  const deps = {
    storage,
    uuid: () => crypto.randomUUID(),
    recorded: () => {},
    fetch: async (url, options = {}) => {
      if (options.method === 'POST') {
        const command = JSON.parse(options.body);
        posts.push(command);
        const response = await request('/check', command, options.headers);
        if (loseReply) {
          loseReply = false;
          throw Error('PRIVATE_LOST_HTTP_REPLY');
        }
        return response;
      }
      return request(url.slice(url.indexOf('?')));
    },
  };
  const states = [],
    client = new core.IssuedFileCheckClient(
      { companyId: 'a', documentId: copies[0].id },
      'manager',
      deps,
      (s) => states.push(s),
    );
  await client.check();
  assert.equal(states.at(-1).pending, true);
  client.dispose();
  const readCount = io().gets,
    restarted = new core.IssuedFileCheckClient(
      { companyId: 'a', documentId: copies[0].id },
      'manager',
      deps,
      (s) => states.push(s),
    );
  await restarted.retry();
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(io().gets, readCount);
  assert.equal(states.at(-1).replayed, true);
  assert.equal(storageMap.size, 0);
  restarted.dispose();
  assert.equal(await rows(), before, 'Only observation/check records may append');
  assert.equal(io().puts, writes, 'No check creates or replaces a file');
  for (let i = 0; i < copies.length; i++)
    assert.equal(
      await core.documentByteDigest(
        new Uint8Array(await (await bucket.get(originals[i].key)).arrayBuffer()),
      ),
      copies[i].sha256,
    );
  console.log(
    'PASS: native issued-file checks, exact receipt replay/concurrency/collisions, diagnostic-before-refusal, role/session/CSRF isolation, lost D1/HTTP acknowledgments and unchanged files/business records.',
  );
  return async () => {
    for (const artifact of copies)
      assert.equal(
        (await check(selected(artifact))).check.outcome,
        'verified',
        'Historical copies remain checkable after edit/cancellation',
      );
  };
}
