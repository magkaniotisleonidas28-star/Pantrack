"""Independent read-only audit for the sole remaining-profile maintenance attempt."""
import importlib.util
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('legacy_audit', Path(__file__).with_name('legacy-profile-audit.py'))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
ROOT = Path('.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015')
PROFILES = legacy.PROFILES
TARGETS = legacy.TARGETS - {'0cb6c7898d4728682938e074a2c701500df57841d4620b99c5d740057f28d754'}
STALE = legacy.STALE
HISTORY = Path('.sites-runtime/po-cart-workers/profile-preflight-source-task-20261015/observed-preflight.json')
HISTORY_HASH = '196d88a3cfc163b6742d9a20e2a414deafcf5d7330d30b6ec9f732cbf775571e'
LOCK_HISTORY = Path('.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/worker-locks-before.json')
LOCK_HISTORY_HASH = '84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701'
digest, filehash = legacy.digest, legacy.filehash


def configure():
    legacy.ROOT = ROOT
    legacy.PROFILES = PROFILES


def read(name):
    configure()
    return legacy.read(name)


def save(name, value):
    configure()
    legacy.save(name, value)


def fingerprint():
    configure()
    return legacy.fingerprint()


def audit_preservation():
    configure()
    return legacy.audit_preservation()


def audit_worker_locks(before=False):
    entries = read('worker-locks-before.json')
    expected = {p['path'] for p in entries}
    if not before:
        expected.remove(str(PROFILES / STALE))
    current = {str(p) for p in PROFILES.iterdir() if p.name.endswith(('.lock', '.lock.reclaim'))}
    assert current == expected, 'Worker locks or guards added/removed'
    for entry in entries:
        path = Path(entry['path'])
        if not before and path.name == STALE:
            path = ROOT / 'archived-worker.lock'
        s = path.lstat()
        assert stat.S_ISREG(s.st_mode) and (s.st_ino, s.st_dev, s.st_mtime_ns, s.st_mode, filehash(path)) == (
            entry['ino'], entry['dev'], entry['mtimeNs'], entry['mode'], entry['sha256']), 'Worker lock changed'
    return dict(passed=True, preservedOtherWorkerLocks=len(entries)-1, archivedLocks=0 if before else 1)


def process_rows():
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command=']).decode()
    rows = {}
    for line in raw.splitlines():
        m = re.match(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$', line)
        assert m and int(m[1]) not in rows, 'Independent process observation unavailable'
        rows[int(m[1])] = dict(parent=int(m[2]), group=int(m[3]), command=m[6])
    assert rows, 'Independent process observation unavailable'
    return rows


def independent_process_audit():
    assert filehash(HISTORY) == HISTORY_HASH and filehash(LOCK_HISTORY) == LOCK_HISTORY_HASH, 'Historical target evidence changed'
    expected = [p for p in json.loads(HISTORY.read_text())['processes'] if p['profile'] in TARGETS]
    plan = read('targets-before.json')
    fields = lambda p: (p['pid'], p['identity'], p['profile'], p['parent'], p['group'])
    assert len(expected) == 18 and {fields(p) for p in plan['captured']} == {fields(p) for p in expected}, 'Audit target boundary changed'
    assert len(plan['captured']) == 18 and plan['pid4303Absent'] is True, 'Audit target boundary changed'
    old = next(p for p in json.loads(LOCK_HISTORY.read_text()) if Path(p['path']).name == STALE)
    archive = ROOT / 'archived-worker.lock'
    s = archive.lstat()
    assert stat.S_ISREG(s.st_mode) and archive.read_bytes() == b'4303', 'Archive bytes changed'
    assert (s.st_ino, s.st_dev, s.st_mtime_ns, s.st_mode, filehash(archive)) == (
        old['ino'], old['dev'], old['mtimeNs'], old['mode'], old['sha256']), 'Archive metadata changed'
    assert not os.path.lexists(PROFILES / STALE), 'Stale lock remains'
    for key in TARGETS | {STALE.removesuffix('.lock')}:
        assert not os.path.lexists(PROFILES / (key + '.lock.reclaim')), 'Guard remains'
        assert (PROFILES / key).is_dir() and not (PROFILES / key).is_symlink(), 'Target profile missing'
    # Two complete reads; disappearance cannot erase a PID reappearance.
    for rows in [process_rows(), process_rows()]:
        assert 4303 not in rows, 'PID 4303 reappeared'
        ids = {p['pid'] for p in expected}
        assert not ids.intersection(rows), 'Target PID remains/reused'
        assert not any(p['parent'] in ids or p['group'] in {30082, 30474} or (
            '--user-data-dir' in p['command'] and str(PROFILES.resolve()) in p['command']) for p in rows.values()), 'Profile process remains'
    return dict(passed=True, targetProcessesGone=True, pid4303Absent=True, archiveVerified=True, guardsCleared=True)


def idle_check(name):
    code = "import {historicalProfilesPreflight} from './scripts/po-cart-worker/profile-preservation-preflight.mjs';console.log(JSON.stringify(historicalProfilesPreflight()));"
    idle = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code]))
    save(name, idle)
    assert idle.get('passed') is True and idle.get('status') == 'idle', 'Preservation preflight is not idle'
    independent_process_audit()
    return idle


def audit_profile_changes(before, after):
    changes = []
    for path in sorted(before.keys() | after.keys()):
        if before.get(path) == after.get(path):
            continue
        assert path.split('/')[0] in TARGETS or (path == STALE and before.get(path) and path not in after), 'Unrelated profile changed'
        changes.append(dict(path=path, before=before.get(path), after=after.get(path)))
    assert STALE in before and STALE not in after, 'Archived lock disposition unverified'
    return changes


def finish():
    processes = independent_process_audit()
    locks = audit_worker_locks()
    preservation = audit_preservation()
    save('preservation.json', preservation)
    idle_check('idle-before-stability.json')
    first = fingerprint()
    save('profiles-stability-first.json', first)
    idle_check('idle-between-stability.json')
    # The second capture starts five seconds after the first FINISHES.
    time.sleep(5)
    second = fingerprint()
    save('profiles-stability-second.json', second)
    assert second['startedAt'] - first['finishedAt'] >= 5, 'Fingerprint interval too short'
    assert first['entries'] == second['entries'], 'Idle profiles remain unstable'
    changes = audit_profile_changes(read('profiles-before.json')['entries'], second['entries'])
    save('shutdown-profile-changes.json', changes)
    preparation_changes = audit_profile_changes(read('profiles-before-preparation.json')['entries'], second['entries'])
    save('task-profile-changes.json', preparation_changes)
    idle_check('idle-after-stability.json')
    audit_worker_locks()
    audit_preservation()
    source_code = "import {sourceSnapshot} from './scripts/po-cart-worker/acceptance-gate.mjs';console.log(JSON.stringify(sourceSnapshot()));"
    assert json.loads(subprocess.check_output(['node', '--input-type=module', '-e', source_code])) == read('task.json')['source'], 'Frozen source changed'
    result = dict(passed=True, independentProcesses=processes, workerLocks=locks, stableFingerprint=second['sha256'],
                  fingerprintSeparationSeconds=second['startedAt']-first['finishedAt'], shutdownProfileChanges=len(changes),
                  **{k: v for k, v in preservation.items() if k not in ['passed', 'databaseDelta']})
    # Baseline publication follows every independent audit, never a report claim.
    save('fresh-baseline.json', dict(version=1, profiles=second, historicalEvidence=read('baseline.json'),
                                   source=read('task.json')['source'], preservation=preservation,
                                   historicalSeventeenFileFailureRetained=True))
    save('verification-summary.json', result)
    return result


if __name__ == '__main__':
    try:
        result = finish()
    except Exception as error:
        result = dict(passed=False, category='independent_remaining_maintenance_audit_failed', reason=str(error))
        if not (ROOT / 'verification-summary.json').exists():
            save('verification-summary.json', result)
    print(json.dumps(result))
    raise SystemExit(0 if result['passed'] else 1)
