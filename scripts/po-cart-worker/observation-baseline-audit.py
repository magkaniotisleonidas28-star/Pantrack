"""Fixed observation-baseline audit. Read-only resources; writes only owned evidence."""
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


legacy = module('baseline_legacy_audit', 'legacy-profile-audit.py')
ROOT = Path('.sites-runtime/po-cart-workers/observation-baseline-task-20261021')
POLICY = 'fixed-observation-baseline-20261021'
PROFILES = Path('.sites-runtime/po-cart-workers/browser-profiles')
PROFILE = '803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571'
FORBIDDEN = [4303]
LOCK_COUNT = 46
# Every local database, including cart-review and other review states outside po-cart-workers.
DATABASE_BASES = [Path('.wrangler/state'), Path('.sites-runtime')]
SINGLETON_HASH = '1ca5152cf75d66e36c07e75dc337956996e3ad0a4975d923f8f41043019c10f2'
HISTORY = Path('.sites-runtime/po-cart-workers/profile-preflight-source-task-20261015/observed-preflight.json')
HISTORY_HASH = '196d88a3cfc163b6742d9a20e2a414deafcf5d7330d30b6ec9f732cbf775571e'
LOCK_HISTORY = Path('.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/worker-locks-before.json')
LOCK_HISTORY_HASH = '84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701'
# Complete profile fingerprint retained by the 2026-10-16 combined integration.
PRIOR_PROFILES = Path('.sites-runtime/po-cart-workers/single-instance-maintenance-integration-task-20261016/historical-profiles-after.json')
PRIOR_PROFILES_HASH = '9c3593be648121627b1d93dffe2052bad85d7c6bb1b833bc9667d81d0d4c12ec'
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


def historical_pids():
    assert filehash(HISTORY) == HISTORY_HASH and filehash(LOCK_HISTORY) == LOCK_HISTORY_HASH, 'Historical evidence changed'
    pids = sorted(p['pid'] for p in json.loads(HISTORY.read_text())['processes'])
    assert len(pids) == len(set(pids)) == 27, 'Historical population changed'
    return pids


def binding():
    report = read('report.json')
    assert report['rootIdentity'] == owned_root(), 'Audit root identity changed'
    assert type(report['version']) is int and report['version'] == 1 and report['policy'] == POLICY, 'Fixed policy changed'
    assert all(report.get(key) == value for key, value in REFERENCES.items()), 'Historical binding changed'
    assert report['evidenceOrigin'] == 'collected', 'Simulated evidence cannot validate a baseline'
    assert report['stage'] == 'independent_audit' and report['status'] == 'running', 'Audit outside its fixed phase'
    assert report['failure'] is None and not report['failures'], 'Collection failed'
    collection = report['collection']
    assert collection and collection['passed'] is True and collection['signalsSent'] == 0, 'Collection incomplete'
    source = preparation()
    assert report['source'] == source, 'Report source changed'
    for name in ['processes-before.json', 'processes-after.json']:
        assert read(name)['scoped'] == [], 'Collected historical process evidence'
    collected = read('preflight.json')
    assert collected['passed'] is True and collected['status'] == 'idle', 'Collected preflight not idle'
    assert read('singleton.json')['linkHash'] == SINGLETON_HASH, 'Collected singleton changed'
    assert len(read('worker-locks.json')) == LOCK_COUNT, 'Collected worker locks changed'
    for name in ['task.json', 'allowance.json', 'fresh-baseline.json', 'verification-summary.json']:
        assert not os.path.lexists(ROOT / name), 'Unexpected invocation or prior publication'
    return dict(passed=True, source=source)


def process_rows():
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command=']).decode()
    rows = {}
    for line in raw.splitlines():
        match = re.match(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$', line)
        assert match and int(match[1]) not in rows, 'Independent process collection unavailable'
        datetime.datetime.strptime(match[5], '%a %b %d %H:%M:%S %Y')
        rows[int(match[1])] = dict(parent=int(match[2]), group=int(match[3]), command=match[6])
    assert rows, 'Empty process collection'
    return rows


def processes():
    old = set(historical_pids())
    root = str(PROFILES.resolve())
    for rows in [process_rows(), process_rows()]:
        assert not (old | set(FORBIDDEN)).intersection(rows), 'Historical or forbidden PID present'
        assert not {pid for pid, p in rows.items() if p['group'] in {30060, 30082, 30474} or p['parent'] in old}, 'Historical descendant present'
        assert not any(root in p['command'] for p in rows.values()), 'Historical profile referenced'
    return dict(passed=True, historicalPidsAbsent=len(old), forbiddenPidsAbsent=len(FORBIDDEN))


def lock_fields(path):
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode), 'Unsafe worker lock'
    result = dict(ino=before.st_ino, dev=before.st_dev, mode=before.st_mode, mtimeNs=before.st_mtime_ns, sha256=filehash(path))
    after = path.lstat()
    assert (before.st_ino, before.st_dev, before.st_mode, before.st_size, before.st_mtime_ns) == (
        after.st_ino, after.st_dev, after.st_mode, after.st_size, after.st_mtime_ns), 'Lock changed during observation'
    return result


def worker_locks(accounted=frozenset()):
    """`accounted` names extra locks a caller has already verified; historical locks stay exact."""
    historical_pids()
    entries = json.loads(LOCK_HISTORY.read_text())
    assert len(entries) == len({Path(p['path']).name for p in entries}) == LOCK_COUNT, 'Worker-lock evidence changed'
    current = {p.name for p in PROFILES.iterdir() if p.name.endswith(('.lock', '.lock.reclaim'))}
    historical = {Path(p['path']).name for p in entries}
    assert not historical & set(accounted) and current == historical | set(accounted), 'Worker locks/guards added or removed'
    for entry in entries:
        assert lock_fields(PROFILES / Path(entry['path']).name) == {key: entry[key] for key in ['ino', 'dev', 'mode', 'mtimeNs', 'sha256']}, 'Worker-lock metadata changed'
    assert (PROFILES / 'e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf.lock').read_bytes() == b'4303', 'Stale-lock bytes changed'
    return dict(passed=True, workerLocks=len(entries), archivedLocks=0, guards=0)


def singleton():
    path = PROFILES / PROFILE / 'SingletonLock'
    current = path.lstat()
    assert stat.S_ISLNK(current.st_mode), 'Singleton reference missing'
    link = os.readlink(path)
    assert re.search(r'-30474$', link) and digest(link.encode()) == SINGLETON_HASH, 'Singleton owner changed'
    return dict(passed=True, originalOwnerRetained=True, removed=False)


def preservation():
    legacy.ROOT, legacy.PROFILES = ROOT, PROFILES
    value = legacy.audit_preservation()
    assert value['ordinaryFictionalSmokeRows'] == value['bookkeepingRowsChanged'] == 0, 'Unexpected database writes'
    assert not any(db['tables'] for db in value['databaseDelta']), 'Database additions or changes'
    assert database_paths() == {p['path'] for p in read('database-before.json')}, 'Database files added/removed'
    return value


def database_paths():
    return {str(p) for base in DATABASE_BASES for p in base.rglob('*.sqlite')}


def fingerprint():
    return legacy.fingerprint(PROFILES)


def prior_profiles():
    assert filehash(PRIOR_PROFILES) == PRIOR_PROFILES_HASH, 'Prior profile fingerprint changed'
    return json.loads(PRIOR_PROFILES.read_text())['entries']


def profile_changes(before, after):
    changes = []
    for name in sorted(before.keys() | after.keys()):
        if before.get(name) == after.get(name):
            continue
        # Only the profile already active on 2026-10-16 may drift, and its
        # retained singleton reference and worker lock must stay exact.
        assert name.split('/')[0] == PROFILE and name != PROFILE + '/SingletonLock', 'Inactive profile changed'
        changes.append(dict(path=name, before=before.get(name), after=after.get(name)))
    return changes


def preflight():
    code = "import {historicalProfilesPreflight} from './scripts/po-cart-worker/profile-preservation-preflight.mjs';console.log(JSON.stringify(historicalProfilesPreflight()));"
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code]))


def idle_check(name):
    result = preflight()
    save(name, result)
    assert result.get('passed') is True and result.get('status') == 'idle', 'Profiles are not idle'
    processes()
    worker_locks()
    singleton()
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
    changes = profile_changes(prior_profiles(), second['entries'])
    save('profile-changes-since-20261016.json', changes)
    idle_check('idle-after-stability.json')
    return dict(passed=True, profiles=dict(sha256=second['sha256'], entries=len(second['entries'])),
                separationSeconds=second['startedAt'] - first['finishedAt'], activeProfileChangesSince20261016=len(changes))


def finish():
    failures, results = [], {}

    def check(name, operation):
        try:
            results[name] = operation()
        except Exception:
            failures.append(dict(category=name + '_failed'))

    # Every independent group is attempted, including after collection failure.
    check('binding', binding)
    check('processes', processes)
    check('worker_locks', worker_locks)
    check('singleton', singleton)
    check('preservation', preservation)
    check('stability', stability)
    check('final_processes', processes)
    check('final_worker_locks', worker_locks)
    check('final_singleton', singleton)
    check('final_preservation', preservation)
    check('final_source', preparation)
    result = dict(passed=not failures, policy=POLICY, auditFailures=failures, baselinePublished=False,
                  signalsSent=0, independent={k: v for k, v in results.items() if k not in ['preservation', 'final_preservation']},
                  preservation=results.get('final_preservation'))
    if result['passed']:
        try:
            save('fresh-baseline.json', dict(version=1, policy=POLICY, source=results['binding']['source'],
                 profiles=results['stability']['profiles'], preservation=results['final_preservation'],
                 validWhen='report.json status complete', verifiedBy='verification-summary.json',
                 historicalSeventeenFileFailureRetained=True))
            result['baselinePublished'] = True
        except Exception:
            failures.append(dict(category='baseline_publication_failed'))
            result['passed'] = False
    save('verification-summary.json', result)
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] != 'finish':
        raise SystemExit('Only the fixed finish audit operation is accepted.')
    if not __debug__:
        raise SystemExit('Optimized fixed audit execution is not accepted')
    try:
        value = finish()
    except Exception:
        value = dict(passed=False, category='independent_observation_baseline_audit_failed')
    print(json.dumps(dict(passed=value['passed'], category=value.get('category'), auditFailures=value.get('auditFailures'))))
    raise SystemExit(0 if value['passed'] else 1)
