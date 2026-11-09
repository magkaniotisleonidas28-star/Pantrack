import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPrivate } from '../scripts/po-cart-worker/private-files.mjs';
import { recordWorkerRequests, freePort } from '../scripts/po-cart-worker/rehearsal-recorder.mjs';
import { validateRecording } from '../scripts/po-cart-worker/rehearsal-manifest.mjs';
import { phasesFor, extractionRequest, metadataRequest } from './helpers/rehearsal-recording.mjs';

const root = mkdtempSync(join(tmpdir(), 'pantrack-rehearsal-record-')),
  source = { files: 3, sha256: 'a'.repeat(64) },
  catalog = ['DEMO-COFFEE', 'DEMO-OAT', 'DEMO-CUPS'].map((sku, i) => ({
    sku,
    description: sku,
    unitLabel: 'pack ' + i,
    unitMinor: String(100 + i),
  }));
let n = 0;

// The real recorder orchestration, with every resource factory injected. The fake
// worker drives the recorder's provider exactly as the reader does: Extraction,
// then Metadata, for each phase the real worker reads.
async function record(fault = {}) {
  const workRoot = join(root, String(++n)),
    log = [];
  let caseNo = 0,
    sends = 0;
  const d = {
    workRoot,
    sdk: { stagehand: '4.1.0', playwright: 'test' },
    catalog,
    fixtureCatalog: () => catalog,
    enqueue: () => ({}),
    sourceNow: () => (fault.drift && sends > 20 ? { ...source, sha256: 'b'.repeat(64) } : source),
    freePort: async () => {
      if (fault.port === caseNo) throw Error('listen EADDRINUSE');
      return 4000 + caseNo;
    },
    workerFixture: async () => {
      const no = ++caseNo,
        f = {
          state: 'queued',
          authorized: async () => ({}),
          jobs: () => ({
            enqueue: async () => ({
              current: {
                job: { id: 'job-' + no, companyId: 'c', supplierId: 's', accountId: 'a' },
              },
            }),
          }),
          credential: () => ({ secret: 'fictional' }),
          api: {},
          issuedCredentials: [],
          sql: {
            prepare: () => ({ get: () => ({ state: f.state }) }),
            close: () => log.push(no + ':database'),
          },
        };
      d.current = f;
      return f;
    },
    BrowserFixtureStore: class {
      provision() {
        return { token: 'token', entries: [] };
      }
    },
    startFixture: async () => ({
      closeAllConnections() {},
      close(done) {
        log.push(caseNo + ':fixture');
        done(fault.fixtureClose === caseNo ? Error('close failed') : undefined);
      },
    }),
    StagehandCartReader: class {
      constructor(provider) {
        this.provider = provider;
      }
    },
    LocalBrowserCartWorker: class {
      constructor(o) {
        this.o = o;
        this.state = { calls: [] };
      }
      async tick() {
        const job = Object.values(readPrivate(this.o.fixtureFile).jobs)[0],
          kase = job.layout + '/' + job.scenario,
          ready = /normal|malicious/.test(job.scenario),
          f = d.current;
        assert.ok(this.o.profileRoot.startsWith(workRoot), 'Private profile root required');
        for (const phase of phasesFor(kase)) {
          if (fault.skipFinal && phase === 'final') continue;
          sends++;
          await this.o.reader.provider.request(extractionRequest(kase, phase), {
            phase: phase + ':Extraction',
          });
          await this.o.reader.provider.request(metadataRequest(kase, phase), {
            phase: phase + ':Metadata',
          });
        }
        f.state = ready && fault.wrongOutcome !== caseNo ? 'ready' : 'review_needed';
        this.state.calls = ready ? [1, 2, 3] : [];
        if (!ready) throw Error('Browser preparation stopped; private evidence retained.');
      }
      close() {}
    },
    finishOfflineFixture: async ({ worker }) => {
      log.push(caseNo + ':worker');
      worker?.close();
      return { cleanupVerified: fault.cleanup !== caseNo };
    },
  };
  let result, error;
  try {
    result = await recordWorkerRequests(d);
  } catch (e) {
    error = e.message;
  }
  const files = existsSync(workRoot) ? readdirSync(workRoot) : [];
  return { result, error, log, files, workRoot, cases: caseNo };
}

try {
  // A complete recording: twelve cases, 36 captures, exclusive private output, work removed.
  const ok = await record();
  assert.equal(ok.error, undefined);
  assert.equal(ok.result.recording.captures.length, 36);
  assert.equal(validateRecording(ok.result.recording), ok.result.recording);
  assert.deepEqual(ok.files, [ok.result.path.split('/').pop()]);
  assert.equal(
    createHash('sha256').update(readFileSync(ok.result.path)).digest('hex'),
    ok.result.sha256,
  );
  if (process.platform !== 'win32') assert.equal(statSync(ok.result.path).mode & 0o777, 0o600);
  assert.ok(ok.result.recording.captures.every((c) => c.extraction.expected));
  // Each case's resources are each closed, in order.
  assert.deepEqual(ok.log.slice(0, 3), ['1:worker', '1:fixture', '1:database']);
  assert.equal(ok.log.length, 36);

  // A failure in any cleanup leaves the others attempted, stops recording, and
  // retains the work directory and its report; nothing is published.
  for (const [fault, failedCase, expectLog] of [
    [{ cleanup: 3 }, 3, ['3:worker', '3:fixture', '3:database']],
    [{ fixtureClose: 2 }, 2, ['2:worker', '2:fixture', '2:database']],
    [{ port: 1 }, 1, ['1:worker', '1:database']],
    [{ wrongOutcome: 2 }, 2, ['2:worker', '2:fixture', '2:database']],
  ]) {
    const r = await record(fault);
    assert.match(r.error, /Recording failed; evidence retained/);
    assert.equal(r.cases, failedCase);
    assert.deepEqual(
      r.log.filter((x) => x.startsWith(failedCase + ':')),
      expectLog,
      JSON.stringify(fault),
    );
    assert.ok(r.files.every((f) => !f.startsWith('recording-')));
    const work = r.files.find((f) => f.startsWith('record-')),
      report = readPrivate(join(r.workRoot, work, 'report.json'));
    assert.equal(report.failed, true);
    assert.ok(report.cases.at(-1).error || report.cases.at(-1).cleanup.length);
  }
  // Source drift or incomplete coverage refuses publication.
  for (const fault of [{ drift: true }, { skipFinal: true }]) {
    const r = await record(fault);
    assert.match(r.error, /Recording failed/);
    assert.ok(r.files.every((f) => !f.startsWith('recording-')));
  }
  // The port probe reports a real listening port.
  assert.ok(Number.isSafeInteger(await freePort()));
  console.log(
    'PASS rehearsal recording: twelve-case worker capture with private profile root, independent per-resource cleanup, retained failure evidence, and refused publication on cleanup, port, outcome, source or coverage failure.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
