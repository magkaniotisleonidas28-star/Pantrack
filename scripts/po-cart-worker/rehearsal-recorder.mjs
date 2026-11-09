import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as portProbe } from 'node:net';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { writePrivate } from './private-files.mjs';
import { rehearsalCases, requestHash, validateRecording } from './rehearsal-manifest.mjs';

export function freePort(timeoutMs = 5000) {
  return new Promise((ok, fail) => {
    const p = portProbe(),
      timer = setTimeout(() => {
        p.close();
        fail(Error('Port probe timed out.'));
      }, timeoutMs);
    p.once('error', (e) => {
      clearTimeout(timer);
      fail(e);
    });
    p.listen(0, '127.0.0.1', () => {
      const port = p.address().port;
      p.close(() => {
        clearTimeout(timer);
        ok(port);
      });
    });
  });
}
const closeServer = async (server) => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((ok, fail) => server.close((e) => (e ? fail(e) : ok())));
};
const cleanup = async (steps) => {
  const failures = [];
  for (const [name, step] of steps)
    try {
      await step();
    } catch {
      failures.push(name);
    }
  return failures;
};

// Offline: the real worker, reader and Stagehand prepare every matrix case against
// the real fixture in a real browser, with a private profile root. Extraction
// returns the correct value for the page as rendered; Metadata is recorded and
// answered complete. No provider is contacted. A recording is published only after
// every case's cleanup is verified, coverage is complete and the source held.
export async function recordWorkerRequests(d) {
  const runId = randomUUID(),
    work = resolve(d.workRoot, 'record-' + runId),
    before = d.sourceNow(),
    captures = [],
    cases = [];
  let failed = false;
  mkdirSync(work, { recursive: true, mode: 0o700 });
  for (const kase of rehearsalCases) {
    const [layout, scenario] = kase.split('/'),
      dir = join(work, layout + '-' + scenario),
      outcome = { case: kase, state: null, additions: null, cleanup: [] };
    cases.push(outcome);
    let f, fixture, server, worker, origin, profile, session;
    try {
      if (d.sourceNow().sha256 !== before.sha256) throw Error('Source changed while recording.');
      f = await d.workerFixture();
      const store = new d.BrowserFixtureStore(dir + '/store.json'),
        port = await d.freePort(),
        fixtureOrigin = 'http://127.0.0.1:' + port;
      fixture = await d.startFixture(store, port);
      const a = await f.authorized({
        lines: d.catalog.map((l, i) => ({
          kind: 'non_stock',
          sku: l.sku,
          description: l.description,
          unitLabel: l.unitLabel,
          packs: String(i + 1),
          estimatedUnitMinor: l.unitMinor,
        })),
        capMinor: '25000',
      });
      const job = (await f.jobs().enqueue({ ...d.enqueue(a), browser: { layout, scenario } }))
        .current.job;
      session = store.provision(job.id, { layout, scenario });
      server = createServer(async (req, res) => {
        try {
          const chunks = [];
          for await (const b of req) chunks.push(b);
          const raw = Buffer.concat(chunks).toString(),
            r = await f.api[req.method](
              new Request(origin + req.url, {
                method: req.method,
                headers: req.headers,
                ...(raw ? { body: raw } : {}),
              }),
            );
          res.writeHead(r.status, Object.fromEntries(r.headers));
          res.end(await r.text());
        } catch {
          res.writeHead(503);
          res.end('{}');
        }
      });
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', ok);
      });
      origin = 'http://127.0.0.1:' + server.address().port;
      const credentialFile = dir + '/credential.json',
        fixtureFile = dir + '/fixture.json',
        profileRoot = join(work, 'profiles');
      writePrivate(credentialFile, f.credential({ consumerKind: 'local_browser' }));
      writePrivate(fixtureFile, {
        version: 1,
        origin: fixtureOrigin,
        jobs: {
          [job.id]: {
            scope: {
              companyId: job.companyId,
              supplierId: job.supplierId,
              accountId: job.accountId,
            },
            layout,
            scenario,
            token: session.token,
          },
        },
      });
      profile = join(
        profileRoot,
        createHash('sha256')
          .update(JSON.stringify([fixtureOrigin, job.companyId, job.supplierId, job.accountId]))
          .digest('hex'),
      );
      const pending = new Map();
      const provider = {
        request: async (request, context) => {
          const phase = context.phase.replace(/:(Extraction|Metadata)$/, '');
          if (context.phase.endsWith(':Extraction')) {
            const expected = phase.startsWith('product:')
              ? {
                  candidates: d
                    .fixtureCatalog(session)
                    .map((p, index) => ({
                      index,
                      sku: p.sku,
                      unitLabel: p.unitLabel,
                      unitMinor: p.unitMinor,
                      available: !(scenario === 'unavailable' && index === 0),
                    }))
                    .filter((p) => p.sku === phase.slice(8)),
                }
              : { entries: structuredClone(session.entries) };
            pending.set(phase, { request, id: requestHash(request), expected });
            return { value: expected, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
          }
          const extraction = pending.get(phase);
          if (!extraction) throw Error('Metadata before extraction.');
          captures.push({
            case: kase,
            phase,
            kind: phase.startsWith('product:') ? 'catalog' : 'cart',
            extraction,
            metadata: { request, id: requestHash(request) },
          });
          return {
            value: { progress: 'recorded', completed: true },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        },
      };
      worker = new d.LocalBrowserCartWorker({
        credentialFile,
        journalFile: dir + '/journal.json',
        fixtureFile,
        origin,
        reader: new d.StagehandCartReader(provider),
        diagnosticMode: 'off',
        profileRoot,
      });
      try {
        await worker.tick();
      } catch {
        // A review scenario's deterministic hold stops preparation by design.
      }
      outcome.state = f.sql.prepare('SELECT state FROM po_cart_jobs WHERE id=?').get(job.id).state;
      outcome.additions = worker.state.calls.length;
      const ready = scenario === 'normal' || scenario === 'malicious';
      if (
        outcome.state !== (ready ? 'ready' : 'review_needed') ||
        outcome.additions !== (ready ? 3 : 0)
      )
        throw Error('Recorded case did not reach its expected outcome.');
    } catch (e) {
      failed = true;
      outcome.error = e instanceof Error ? e.message.slice(0, 200) : 'record_failed';
    } finally {
      // Every owned resource gets its own attempt; one failure never skips another.
      outcome.cleanup = await cleanup([
        [
          'worker',
          async () => {
            if (!f) return worker?.close();
            const r = await d.finishOfflineFixture({ f, dir, origin, worker, profile });
            if (!r.cleanupVerified) throw Error();
          },
        ],
        ['api', () => closeServer(server)],
        ['fixture', () => closeServer(fixture)],
        ['database', () => f?.sql.close()],
      ]);
      if (outcome.cleanup.length) failed = true;
    }
    if (failed) break;
  }
  const after = d.sourceNow(),
    recording = {
      version: 2,
      evidence: 'offline-recorded-worker-requests',
      runId,
      source: { files: before.files, sha256: before.sha256 },
      sdk: d.sdk,
      recordedAt: new Date().toISOString(),
      cleanupVerified: !failed && cases.length === rehearsalCases.length,
      cases,
      captures,
    };
  const report = { runId, work, cases, captures: captures.length, failed };
  if (after.sha256 !== before.sha256 || after.files !== before.files) {
    report.error = 'Source changed while recording.';
    failed = true;
  }
  if (!failed)
    try {
      validateRecording(recording);
    } catch (e) {
      report.error = e.message;
      failed = true;
    }
  // Failed work, including profiles and saved case state, is retained for review.
  writePrivate(join(work, 'report.json'), report);
  if (failed) throw Error('Recording failed; evidence retained in ' + work);
  const path = resolve(d.workRoot, 'recording-' + runId + '.json'),
    text = JSON.stringify(recording) + '\n';
  exclusive(path, text);
  rmSync(work, { recursive: true, force: true });
  return { path, sha256: createHash('sha256').update(text).digest('hex'), recording };
}

function exclusive(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
