"""Fixed single-instance audit. Read-only resources; writes only owned evidence."""
import datetime
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


legacy = module('single_legacy_audit', 'legacy-profile-audit.py')
maintenance = module('single_maintenance_evidence', 'maintenance-observation-audit.py')
ROOT = Path('.sites-runtime/po-cart-workers/single-instance-maintenance-task-20261016')
POLICY = 'fixed-single-instance-maintenance-20261016'
PROFILES = Path('.sites-runtime/po-cart-workers/browser-profiles')
PROFILE = '803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571'
PIDS = [30474, 30480, 30481, 30482, 30484, 30487, 30488, 30493, 30528]
TARGETS = [dict(pid=30474, profile=PROFILE)]
STALE = 'e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf.lock'
HISTORY = Path('.sites-runtime/po-cart-workers/profile-preflight-source-task-20261015/observed-preflight.json')
HISTORY_HASH = '196d88a3cfc163b6742d9a20e2a414deafcf5d7330d30b6ec9f732cbf775571e'
LOCK_HISTORY = Path('.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/worker-locks-before.json')
LOCK_HISTORY_HASH = '84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701'
REFERENCES = dict(historicalEvidence=dict(path=str(HISTORY), sha256=HISTORY_HASH),
                  lockEvidence=dict(path=str(LOCK_HISTORY), sha256=LOCK_HISTORY_HASH))
filehash = legacy.filehash
digest = legacy.digest


def owned_root():
    if not __debug__:
        raise AssertionError('Optimized fixed audit execution is not accepted')
    current = ROOT.lstat()
    assert stat.S_ISDIR(current.st_mode) and not ROOT.is_symlink() and not current.st_mode & 0o077, 'Unsafe audit root'
    assert ROOT.absolute() == ROOT.resolve(), 'Noncanonical audit root'
    identity = dict(dev=current.st_dev, ino=current.st_ino, mode=current.st_mode)
    report_path = ROOT / 'report.json'
    report_stat = report_path.lstat()
    assert stat.S_ISREG(report_stat.st_mode) and not report_stat.st_mode & 0o077, 'Unsafe owning report'
    assert json.loads(report_path.read_text())['rootIdentity'] == identity, 'Audit root identity changed'
    return identity


def path_for(name):
    relative = Path(name)
    assert not relative.is_absolute() and '..' not in relative.parts, 'Unsafe evidence reference'
    owned_root()
    path = ROOT / relative
    assert path.parent.absolute() == path.parent.resolve(), 'Noncanonical evidence directory'
    return path


def read(name):
    path = path_for(name)
    current = path.lstat()
    assert stat.S_ISREG(current.st_mode) and not current.st_mode & 0o077, 'Unsafe evidence file'
    return json.loads(path.read_text())


def save(name, value):
    path = path_for(name)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def frozen_source():
    names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
    excluded = re.compile(r'^(?:\.sites-runtime|node_modules|docs|dist|\.wrangler|\.next)(?:/|$)|(?:\.md|\.tsbuildinfo)$')
    files = sorted({p for p in names if p and not excluded.search(p)}, key=lambda p: p.encode('utf-16-be'))
    result = hashlib.sha256()
    for name in files:
        result.update(name.encode() + b'\0')
        result.update(Path(name).read_bytes())
    assert files, 'Missing frozen source'
    return dict(files=len(files), sha256=result.hexdigest())


def preparation():
    source, pipeline = frozen_source(), read('pipeline.json')
    assert source == read('source-frozen.json') == pipeline['source'], 'Frozen source changed'
    assert pipeline['passed'] is True and len(pipeline['results']) == 3, 'Missing preparation'
    for value, expected in zip(pipeline['results'], ['typecheck', 'test', 'build']):
        path = ROOT / 'verification' / (expected + '.log')
        assert value['id'] == expected and value['passed'] is True and value['exitCode'] == 0, 'Preparation failed'
        assert value['sourceBefore'] == value['sourceAfter'] == source['sha256'], 'Preparation source changed'
        assert value['log']['path'] == str(path) and value['log']['sha256'] == filehash(path), 'Preparation log changed'
        current = path.lstat()
        assert stat.S_ISREG(current.st_mode) and not current.st_mode & 0o077 and path.absolute() == path.resolve(), 'Unsafe preparation log'
    return source


def historical_boundary():
    assert filehash(HISTORY) == HISTORY_HASH and filehash(LOCK_HISTORY) == LOCK_HISTORY_HASH, 'Historical evidence changed'
    history = json.loads(HISTORY.read_text())
    assert len(history['processes']) == 27, 'Original population changed'
    expected = [p for p in history['processes'] if p['profile'] == PROFILE]
    assert sorted(p['pid'] for p in expected) == PIDS, 'Original member set changed'
    return history, expected


def binding(consumed=True, require_collected=True):
    report, plan = read('report.json'), read('targets-before.json')
    _, expected = historical_boundary()
    assert report['rootIdentity'] == owned_root(), 'Audit root identity changed'
    assert type(report['version']) is type(report['lifecycleEvidenceVersion']) is int and report['version'] == report['lifecycleEvidenceVersion'] == 2, 'Version-two report required'
    assert report['policy'] == POLICY and report['targets'] == plan['targets'] == TARGETS, 'Fixed policy/targets changed'
    assert all(report.get(key) == value for key, value in REFERENCES.items()), 'Historical binding changed'
    assert report['evidenceOrigin'] in ['collected', 'simulated'], 'Missing evidence origin'
    assert not require_collected or report['evidenceOrigin'] == 'collected', 'Simulated proof cannot validate maintenance'
    fields = lambda p: tuple(p[key] for key in ['pid', 'parent', 'group', 'identity', 'profile'])
    assert len(plan['captured']) == 9 and {fields(p) for p in plan['captured']} == {fields(p) for p in expected}, 'Captured boundary changed'
    assert plan['pid4303Absent'] is True and plan['untouched'] == dict(pid=4303, absent=True), 'Forbidden target binding changed'
    source = preparation()
    assert report['source'] == source, 'Report source changed'
    if consumed:
        invocation = read('task.json')
        assert invocation['version'] == 1 and invocation['policy'] == POLICY and invocation['source'] == source, 'Invocation binding changed'
    else:
        assert not os.path.lexists(ROOT / 'task.json'), 'Invocation consumed before admission'
    return dict(passed=True, source=source, collected=report['evidenceOrigin'] == 'collected', targets=9)


def process_rows(metadata=False):
    columns = 'pid=,lstart=,comm=' if metadata else 'pid=,ppid=,pgid=,stat=,lstart=,command='
    raw = subprocess.check_output(['ps', '-axo', columns]).decode()
    rows = {}
    for line in raw.splitlines():
        pattern = r'^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$' if metadata else r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$'
        match = re.match(pattern, line)
        assert match and int(match[1]) not in rows, 'Independent process collection unavailable'
        pid = int(match[1])
        start, text = (match[2], match[3]) if metadata else (match[5], match[6])
        started = datetime.datetime.strptime(start, '%a %b %d %H:%M:%S %Y').timestamp() * 1000
        value = dict(pid=pid, startHash=digest(start.encode()), startedMs=started)
        if metadata:
            value['executable'] = text
        else:
            value.update(parent=int(match[2]), group=int(match[3]), state=match[4], command=text,
                         identity=digest((start + '\0' + text).encode()), commandHash=digest(text.encode()))
        rows[pid] = value
    assert rows, 'Empty process collection'
    return rows


def independent_processes(before=False):
    history, _ = historical_boundary()
    plan = read('targets-before.json')
    captured = {p['pid']: p for p in plan['captured']}
    before_rows, metadata, after_rows = process_rows(), process_rows(True), process_rows()
    old_ids = {p['pid'] for p in history['processes']}
    for rows in [before_rows, metadata, after_rows]:
        assert 4303 not in rows, 'Forbidden PID reappeared'
        assert not (old_ids - set(PIDS)).intersection(rows), 'Excluded historical PID reappeared'
        if not before:
            assert not old_ids.intersection(rows), 'Historical PID remains/reused'
    for rows in [before_rows, after_rows]:
        descendants = set(old_ids)
        while True:
            expanded = descendants | {pid for pid, p in rows.items() if p['parent'] in descendants}
            if expanded == descendants:
                break
            descendants = expanded
        relevant = {pid for pid, p in rows.items() if pid in descendants or p['group'] in {30060, 30082, 30474}
                    or ('--user-data-dir' in p['command'] and str(PROFILES.resolve()) in p['command'])}
        assert relevant <= (set(PIDS) if before else set()), 'Unexpected historical population'
        if before:
            assert set(PIDS) <= set(rows) and set(PIDS) <= set(metadata), 'Incomplete current targets'
            for pid, old in captured.items():
                p, executable = rows[pid], metadata[pid]
                assert (p['identity'], p['parent'], p['group'], p['startedMs'], p['startHash']) == (
                    old['identity'], old['parent'], old['group'], old['startedMs'], old['startHash']), 'Current ownership changed'
                assert not p['state'].startswith('Z') and re.search(r'(?:^|\s)--user-data-dir(?:=|\s+)' + re.escape(str(PROFILES.resolve() / PROFILE)) + r'(?=\s|$)', p['command']), 'Current profile changed'
                assert executable['startedMs'] == p['startedMs'] and executable['startHash'] == p['startHash'], 'Current executable start changed'
                assert executable['executable'] == old['executable'] and Path(executable['executable']).resolve() == Path(executable['executable']), 'Current canonical executable changed'
                base = Path.home() / 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents'
                allowed = {str(base / 'MacOS/Google Chrome for Testing')} | {
                    str(base / ('Frameworks/Google Chrome for Testing Framework.framework/Versions/149.0.7827.55/Helpers/Google Chrome for Testing Helper' + suffix + '.app/Contents/MacOS/Google Chrome for Testing Helper' + suffix)) for suffix in ['', ' (Renderer)']}
                assert old['executable'] in allowed, 'Unpinned executable'
    return dict(passed=True, pid4303Absent=True, originalMembers=9, completeAbsence=not before)


def lock_fields(path):
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode), 'Unsafe worker lock'
    result = dict(ino=before.st_ino, dev=before.st_dev, mode=before.st_mode, mtimeNs=before.st_mtime_ns, sha256=filehash(path))
    after = path.lstat()
    assert (before.st_ino, before.st_dev, before.st_mode, before.st_size, before.st_mtime_ns) == (
        after.st_ino, after.st_dev, after.st_mode, after.st_size, after.st_mtime_ns), 'Lock changed during observation'
    return result


def worker_locks(before=False, guarded=False):
    historical_boundary()
    entries = read('worker-locks-before.json')
    assert len(entries) == 46 and len({p['path'] for p in entries}) == 46, 'Worker-lock baseline changed'
    old = next(p for p in json.loads(LOCK_HISTORY.read_text()) if Path(p['path']).name == STALE)
    baseline = next(p for p in entries if Path(p['path']).name == STALE)
    fields = lambda p: {key: p[key] for key in ['ino', 'dev', 'mode', 'mtimeNs', 'sha256']}
    assert fields(old) == fields(baseline), 'Historical stale lock changed'
    expected = {p['path'] for p in entries}
    guards = [str(PROFILES / (key + '.lock.reclaim')) for key in [PROFILE, STALE.removesuffix('.lock')]]
    if not before:
        expected.remove(str(PROFILES / STALE))
    if guarded:
        expected.update(guards)
    current = {str(p) for p in PROFILES.iterdir() if p.name.endswith(('.lock', '.lock.reclaim'))}
    assert current == expected, 'Worker locks/guards added or removed'
    for entry in entries:
        path = Path(entry['path']) if before or Path(entry['path']).name != STALE else ROOT / 'archived-worker.lock'
        assert lock_fields(path) == fields(entry), 'Worker-lock metadata changed'
    path = PROFILES / STALE if before else ROOT / 'archived-worker.lock'
    assert path.read_bytes() == b'4303', 'Stale-lock bytes changed'
    plan = read('targets-before.json')
    directories = plan['directories']
    assert len(directories) == 3 and {p['path'] for p in directories} == {
        str(PROFILES.resolve()), str((PROFILES / PROFILE).resolve()), str((PROFILES / STALE.removesuffix('.lock')).resolve())}, 'Profile-directory boundary changed'
    for record in directories:
        directory = Path(record['path'])
        current = directory.lstat()
        assert stat.S_ISDIR(current.st_mode) and directory == directory.resolve(), 'Noncanonical profile directory'
        assert (current.st_dev, current.st_ino, current.st_mode) == (record['dev'], record['ino'], record['mode']), 'Profile-directory identity changed'
    assert len(plan['ownership']) == 1, 'Profile ownership boundary changed'
    for kind, record in plan['ownership'][0].items():
        assert kind in ['worker', 'singleton'], 'Unexpected ownership evidence'
        path = PROFILES / (PROFILE + '.lock') if kind == 'worker' else PROFILES / PROFILE / 'SingletonLock'
        assert record['path'] == str(path.resolve() if kind == 'worker' else path.absolute()), 'Ownership path changed'
        if kind == 'singleton' and not before:
            # Forced exit may retain the original stale reference. Never remove
            # it here; independent complete PID absence is a separate gate.
            if not os.path.lexists(path):
                continue
        current = path.lstat()
        assert (current.st_dev, current.st_ino, current.st_mode, current.st_size) == (
            record['dev'], record['ino'], record['mode'], record['size']), 'Profile-lock identity changed'
        if kind == 'singleton':
            assert stat.S_ISLNK(current.st_mode), 'Unsafe singleton'
            link = os.readlink(path)
            assert re.search(r'-30474$', link) and digest(link.encode()) == record['sha256'], 'Singleton owner changed'
        else:
            assert stat.S_ISREG(current.st_mode) and filehash(path) == record['sha256'], 'Worker ownership changed'
    exact = plan['lockExact']
    assert fields(old) == {**fields(exact), 'mtimeNs': int(exact['mtimeNs'])}, 'Plan lock metadata changed'
    if guarded:
        recorded = read('guard-records.json')
        assert len(recorded) == 2 and {p['path'] for p in recorded} == {str(Path(p).resolve()) for p in guards}, 'Guard boundary changed'
        for record in recorded:
            assert lock_fields(Path(record['path'])) == {**fields(record), 'mtimeNs': int(record['mtimeNs'])}, 'Guard ownership changed'
    return dict(passed=True, workerLocks=46, preservedOtherWorkerLocks=45, archivedLocks=0 if before else 1, guards=2 if guarded else 0)


def preservation():
    legacy.ROOT, legacy.PROFILES = ROOT, PROFILES
    value = legacy.audit_preservation()
    assert value['ordinaryFictionalSmokeRows'] == value['bookkeepingRowsChanged'] == 0, 'Unexpected database writes'
    assert not any(db['tables'] for db in value['databaseDelta']), 'Database additions or changes'
    paths = {str(p) for base in [Path('.wrangler/state'), Path('.sites-runtime/po-cart-workers')] for p in base.rglob('*.sqlite')}
    assert paths == {p['path'] for p in read('database-before.json')}, 'Database files added/removed'
    return value


def fingerprint():
    return legacy.fingerprint(PROFILES)


def profile_changes(before, after, archived=False, guarded=False):
    changes = []
    for name in sorted(before.keys() | after.keys()):
        if before.get(name) == after.get(name):
            continue
        owned_guard = guarded and name in [PROFILE + '.lock.reclaim', STALE.removesuffix('.lock') + '.lock.reclaim'] and name not in before and name in after
        assert name.split('/')[0] == PROFILE or (archived and name == STALE and name in before and name not in after) or owned_guard, 'Inactive profile changed'
        changes.append(dict(path=name, before=before.get(name), after=after.get(name)))
    if archived:
        assert STALE in before and STALE not in after, 'Stale-lock removal unverified'
    return changes


def before(guarded=False):
    bound = binding(consumed=False)
    kept = preservation()
    locks = worker_locks(before=True, guarded=guarded)
    capture = fingerprint()
    changes = profile_changes(read('profiles-before-preparation.json')['entries'], capture['entries'], guarded=guarded)
    save('profiles-preconsumption.json' if guarded else 'profiles-before.json', capture)
    processes = independent_processes(before=True)
    worker_locks(before=True, guarded=guarded)
    preservation()
    assert preparation() == bound['source'], 'Source changed after fingerprint'
    result = dict(passed=True, source=bound['source'], processes=processes, workerLocks=locks,
                  concurrentActiveProfileChanges=changes, preservation=kept, strictHistoricalProfileStabilityClaimed=False)
    save('audit-guarded.json' if guarded else 'audit-before.json', result)
    return result


def lifecycle():
    result = maintenance.audit_maintenance(ROOT, require_collected=True)
    plan, report = read('targets-before.json'), read('report.json')
    expected = {p['pid']: p for p in plan['captured']}
    timeline = read('timeline.json')
    signal_boundary(timeline, plan)
    values = [read(p['reference']) for p in timeline if p['type'] == 'observation']
    for value in values:
        if value['event'] != 'sample':
            continue
        assert len(value['baseline']) == 9 and {p['pid'] for p in value['baseline']} == set(PIDS), 'Lifecycle boundary changed'
        assert value['forbiddenPids'] == [4303], 'Forbidden PID gate removed'
        for old in value['baseline']:
            captured = expected[old['pid']]
            assert all(old[key] == captured[key] for key in ['pid', 'parent', 'group', 'identity', 'profile']), 'Lifecycle admission changed'
            for key in ['startedMs', 'startHash']:
                assert key not in old or old[key] == captured[key], 'Lifecycle start changed'
            assert 'executableHash' not in old or old['executableHash'] == digest(captured['executable'].encode()), 'Lifecycle executable changed'
    if report.get('operationComplete'):
        assert values and values[-1]['event'] == 'decision' and values[-1]['phase'] == 'strict', 'Final strict absence missing'
        assert values[-1]['analysis']['passed'] and not values[-1]['analysis']['livePids'], 'Final absence incomplete'
        assert sorted(values[-1]['analysis']['absentPids']) == PIDS, 'Final absence boundary changed'
        closed = [p['event'] for p in timeline if p['type'] == 'event' and p['event']['kind'] == 'browser_closed']
        assert [(p['pid'], p['profile']) for p in closed] == [(30474, PROFILE)], 'Closure boundary changed'
    return result


def signal_boundary(timeline, plan):
    intents, closed, archived, last_strict_absent = set(), [], 0, set()
    kill_started = False
    for entry in timeline:
        if entry['type'] == 'observation':
            value = read(entry['reference'])
            if value['event'] == 'decision' and value['phase'] == 'strict' and value['analysis']['passed']:
                last_strict_absent = set(value['analysis']['absentPids'])
            continue
        event = entry['event']
        kind = event['kind']
        assert kind in ['signal_intent', 'signal_sent', 'signal_not_sent', 'browser_closed', 'worker_lock_archived'], 'Unknown maintenance action'
        if kind.startswith('signal_'):
            assert not closed and event['pid'] in PIDS and event['pid'] != 4303, 'Signal outside fixed lifecycle'
            assert event['signal'] in ['SIGTERM', 'SIGKILL'], 'Unexpected signal kind'
            if event['signal'] == 'SIGTERM':
                assert event['pid'] == 30474 and not kill_started, 'TERM outside leader phase'
            if kind == 'signal_intent':
                key = (event['pid'], event['signal'])
                assert key not in intents, 'Repeated signal attempt'
                if event['signal'] == 'SIGKILL':
                    assert (30474, 'SIGTERM') in intents or 30474 in last_strict_absent, 'KILL before leader disposition'
                    kill_started = True
                intents.add(key)
            if kind == 'signal_not_sent':
                assert event['reason'] == 'already_exited', 'Unproved omitted signal'
        elif kind == 'browser_closed':
            closed.append((event['pid'], event['profile']))
            assert closed == [(30474, PROFILE)], 'Closure boundary changed'
        else:
            archived += 1
            assert closed and archived == 1 and event['sha256'] == plan['lock']['sha256'], 'Archive action boundary changed'
    return dict(passed=True, signalIntents=len(intents), closureEvents=len(closed), archiveEvents=archived)


def failure_report():
    report = read('report.json')
    fallbacks = sorted(ROOT.glob('failure-report*.json'), key=lambda p: (p.name != 'failure-report.json', p.name))
    for path in fallbacks:
        value = read(path.name)
        assert value['attemptId'] == report['attemptId'] and value['policy'] == report['policy'], 'Foreign failure report'
        if value.get('failure'):
            if report.get('failure'):
                assert report['failure'] == value['failure'], 'Primary failure replaced'
            else:
                report = {**report, 'failure': value['failure'], 'failures': value['failures']}
    return report


def idle_check(name):
    code = "import {historicalProfilesPreflight} from './scripts/po-cart-worker/profile-preservation-preflight.mjs';console.log(JSON.stringify(historicalProfilesPreflight()));"
    result = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code]))
    save(name, result)
    assert result.get('passed') is True and result.get('status') == 'idle', 'Profiles are not idle'
    independent_processes()
    worker_locks()
    return result


def stability():
    idle_check('idle-before-stability.json')
    first = fingerprint()
    save('profiles-stability-first.json', first)
    idle_check('idle-between-stability.json')
    time.sleep(5)
    second = fingerprint()
    save('profiles-stability-second.json', second)
    assert second['startedAt'] - first['finishedAt'] >= 5, 'Fingerprint interval too short'
    assert first['entries'] == second['entries'] and first['sha256'] == second['sha256'], 'Profiles remain unstable'
    changes = profile_changes(read('profiles-before.json')['entries'], second['entries'], archived=True)
    total = profile_changes(read('profiles-before-preparation.json')['entries'], second['entries'], archived=True)
    save('shutdown-profile-changes.json', changes)
    save('task-profile-changes.json', total)
    idle_check('idle-after-stability.json')
    return dict(passed=True, profiles=second, separationSeconds=second['startedAt'] - first['finishedAt'], shutdownProfileChanges=len(changes))


def finish():
    failures, results = [], {}

    def check(name, operation):
        try:
            results[name] = operation()
        except Exception:
            failures.append(dict(category=name + '_failed'))

    # Every independent group is attempted, including after admission failure.
    check('binding', binding)
    check('lifecycle', lifecycle)
    check('processes', independent_processes)
    check('worker_locks', worker_locks)
    check('preservation', preservation)
    check('stability', stability)
    check('final_processes', independent_processes)
    check('final_worker_locks', worker_locks)
    check('final_preservation', preservation)
    check('final_source', preparation)
    report = None
    check('report', failure_report)
    report = results.get('report')
    complete = bool(report and report.get('operationComplete') is True and not report.get('failure') and not report.get('auditFailures'))
    if not complete:
        failures.append(dict(category='operation_incomplete'))
    result = dict(passed=not failures, policy=POLICY, auditFailures=failures,
                  primaryFailure=report.get('failure') if report else None,
                  operationComplete=complete, independent=results)
    if result['passed']:
        try:
            save('fresh-baseline.json', dict(version=1, policy=POLICY, source=results['binding']['source'],
                 profiles=results['stability']['profiles'], preservation=results['preservation'],
                 verifiedBy='verification-summary.json', historicalSeventeenFileFailureRetained=True))
        except Exception:
            failures.append(dict(category='baseline_publication_failed'))
            result['passed'] = False
    save('verification-summary.json', result)
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ['before', 'guarded', 'finish']:
        raise SystemExit('Only fixed before/guarded/finish audit operations are accepted.')
    if not __debug__:
        raise SystemExit('Optimized fixed audit execution is not accepted')
    try:
        value = finish() if sys.argv[1] == 'finish' else before(guarded=sys.argv[1] == 'guarded')
    except Exception:
        value = dict(passed=False, category='independent_single_instance_audit_failed')
    print(json.dumps(dict(passed=value['passed'], category=value.get('category'), auditFailures=value.get('auditFailures'))))
    raise SystemExit(0 if value['passed'] else 1)
