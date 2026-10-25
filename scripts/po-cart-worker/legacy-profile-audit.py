"""Independent, read-only C4 maintenance audit. No browser/provider execution."""
import collections
import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import time
from pathlib import Path

ROOT = Path('.sites-runtime/po-cart-workers/legacy-profile-cleanup-task-20261015')
PROFILES = Path('.sites-runtime/po-cart-workers/browser-profiles')
TARGETS = {
    '0cb6c7898d4728682938e074a2c701500df57841d4620b99c5d740057f28d754',
    '22776886a411811a4c53a017119217ada012618186faf680812903ed38e254f0',
    '803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571',
}
STALE = 'e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf.lock'


def digest(b):
    return hashlib.sha256(b).hexdigest()


def filehash(p):
    result = hashlib.sha256()
    with Path(p).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def read(name):
    return json.loads((ROOT / name).read_text())


def save(name, value):
    path = ROOT / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def fingerprint(root=None):
    """Hash regular files in chunks; record links without following them."""
    root = PROFILES if root is None else root
    started = time.time()
    entries = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            before = path.lstat()
            value = dict(mode=before.st_mode, size=before.st_size,
                         mtimeNs=before.st_mtime_ns, ino=before.st_ino, dev=before.st_dev)
            if stat.S_ISREG(before.st_mode):
                value['sha256'] = filehash(path)
            elif stat.S_ISLNK(before.st_mode):
                value['linkHash'] = digest(os.readlink(path).encode())
            elif not stat.S_ISDIR(before.st_mode) and not stat.S_ISSOCK(before.st_mode):
                raise AssertionError('Unknown profile entry')
            after = path.lstat()
            assert (before.st_ino, before.st_size, before.st_mtime_ns, before.st_mode) == (
                after.st_ino, after.st_size, after.st_mtime_ns, after.st_mode), 'Profile changed during fingerprint'
            entries[str(path.relative_to(root))] = value
    return dict(startedAt=started, finishedAt=time.time(), entries=entries,
                sha256=digest(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()))


def open_readonly(path):
    """Open SQLite read-only. A WAL-format copy without -wal/-shm sidecars has no
    uncommitted frames, so it opens immutable instead of failing to open."""
    uri = 'file:' + str(path) + '?mode=ro'
    with Path(path).open('rb') as stream:
        header = stream.read(20)
    if len(header) == 20 and header[18] == 2 and not any(os.path.lexists(str(path) + suffix) for suffix in ['-wal', '-shm']):
        uri += '&immutable=1'
    return sqlite3.connect(uri, uri=True)


def audit_preservation():
    baseline = read('baseline.json')
    for f in baseline['protectedFiles']:
        assert Path(f['path']).is_file() and filehash(f['path']) == f['sha256'], 'Historical evidence changed'
    old = read('storefront-before.json')
    store = json.loads(Path('.sites-runtime/po-cart-workers/local-storefront.json').read_text())['fixtures']
    assert set(store) == set(old), 'Cart fixtures added or removed'
    for key, value in old.items():
        assert digest(json.dumps(store[key], sort_keys=True, separators=(',', ':')).encode()) == value, 'Historical cart changed'
    rows = ordinary = bookkeeping = 0
    deltas = []
    for entry in read('database-before.json'):
        connection = open_readonly(entry['path'])
        names = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert names == {t['name'] for t in entry['tables']}, 'Database tables changed'
        tables = []
        for table in entry['tables']:
            name = table['name']
            now = collections.Counter(digest(json.dumps(r, separators=(',', ':'), default=str).encode())
                                      for r in connection.execute('SELECT * FROM "' + name.replace('"', '""') + '"'))
            before = collections.Counter(table['rows'])
            removed, added = sum((before - now).values()), sum((now - before).values())
            if name in ['_cf_METADATA', 'sqlite_sequence']:
                bookkeeping += removed
            else:
                assert removed == 0, 'Historical business row changed'
                rows += len(table['rows'])
                if added:
                    assert entry['path'].startswith('.wrangler/state/') and name in {
                        'companies', 'memberships', 'products', 'security_audit'}, 'Unexpected business rows added'
                    ordinary += added
            if added or removed:
                tables.append(dict(name=name, added=added, removed=removed,
                                   bookkeeping=name in ['_cf_METADATA', 'sqlite_sequence']))
        connection.close()
        deltas.append(dict(path=entry['path'], tables=tables))
    manifest = read('rollback-manifest.json')
    original = read('source-before.json')
    for f in original:
        if f['path'] not in manifest['restore']:
            assert filehash(f['path']) == f['sha256'], 'Inherited source changed'
    listed = set(filter(None, subprocess.check_output([
        'git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')))
    assert listed == {f['path'] for f in original} | set(manifest['remove']), 'Unexpected source files'
    expected = {f['path'] for f in baseline['protectedFiles'] if Path(f['path']).name in {'task.json', 'allowance.json'}}
    current = set()
    base = Path('.sites-runtime/po-cart-workers')
    for directory, dirs, files in os.walk(base):
        if Path(directory) == base:
            dirs[:] = [d for d in dirs if d not in ['browser-profiles', ROOT.name]]
        for name in files:
            if name in {'task.json', 'allowance.json'}:
                current.add(str(Path(directory) / name))
    assert current == expected, 'Gate consumption records changed'
    retained = json.loads(Path('.sites-runtime/po-cart-workers/second-addition-display-on-task-20261015/verification-summary.json').read_text())
    assert retained['passed'] is False and retained['strictArtifactExceptions'] == 17, 'Historical failure changed'
    for ref in retained['references']:
        assert filehash(ref['path']) == ref['sha256'], 'Historical failure reference changed'
    ledger = json.loads(Path('.sites-runtime/cart-ai-budget/ledger.json').read_text())
    reserved = ledger['legacyReservedMicros'] + sum(r['micros'] for r in ledger['reservations'])
    assert reserved == 921518, 'Reserved exposure changed'
    return dict(passed=True, protectedEvidenceFiles=len(baseline['protectedFiles']), historicalCarts=len(old),
                historicalBusinessRows=rows, ordinaryFictionalSmokeRows=ordinary, bookkeepingRowsChanged=bookkeeping,
                realReservedMicros=reserved, retainedDisplayAuditPassed=False, retainedDisplayArtifactExceptions=17,
                browserJobsAdded=0, gateInvocationsAdded=0, databaseDelta=deltas)


def independent_process_audit():
    plan = read('targets-before.json')
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command=']).decode()
    import re
    rows = {}
    for line in raw.splitlines():
        m = re.match(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$', line)
        assert m, 'Independent process observation unavailable'
        rows[int(m[1])] = dict(identity=digest((m[5] + '\0' + m[6]).encode()), command=m[6])
    assert all(p['pid'] not in rows for p in plan['captured']), 'Target PID remains/reused'
    assert not any('--user-data-dir' in p['command'] and str(PROFILES.resolve()) in p['command'] for p in rows.values()), 'Profile process remains'
    assert rows[4303]['identity'] == plan['untouched']['identity'], 'Untouched PID changed'
    executable = subprocess.check_output(['ps', '-p', '4303', '-o', 'comm=']).decode().strip()
    assert executable == '/usr/libexec/applekeystored', 'Untouched executable changed'
    archive = ROOT / 'archived-worker.lock'
    s = archive.lstat()
    assert not archive.is_symlink() and archive.read_bytes() == b'4303', 'Archive bytes changed'
    assert (s.st_ino, s.st_dev, s.st_mtime_ns / 1000000, s.st_mode, s.st_size, filehash(archive)) == (
        plan['lock']['ino'], plan['lock']['dev'], plan['lock']['mtimeMs'], plan['lock']['mode'], plan['lock']['size'], plan['lock']['sha256']), 'Archive metadata changed'
    assert not (PROFILES / STALE).exists(), 'Stale lock remains'
    for key in TARGETS | {STALE.removesuffix('.lock')}:
        assert not os.path.lexists(PROFILES / (key + '.lock.reclaim')), 'Guard remains'
        assert (PROFILES / key).is_dir(), 'Target profile missing'
    return dict(passed=True, targetProcessesGone=True, applekeystoredUntouched=True, archiveVerified=True, guardsCleared=True)


def finish():
    # Separate process/lock evidence is required even if the maintenance report
    # claims success. No report boolean can authorize the fresh baseline.
    processes = independent_process_audit()
    preservation = audit_preservation()
    save('preservation.json', preservation)
    first = fingerprint()
    save('profiles-stability-first.json', first)
    time.sleep(5)
    second = fingerprint()
    save('profiles-stability-second.json', second)
    assert second['startedAt'] - first['finishedAt'] >= 5, 'Fingerprint interval too short'
    assert first['entries'] == second['entries'], 'Idle profiles remain unstable'
    before = read('profiles-before.json')['entries']
    changes = []
    for path in sorted(before.keys() | second['entries'].keys()):
        if before.get(path) != second['entries'].get(path):
            assert path.split('/')[0] in TARGETS or path == STALE, 'Unrelated profile changed'
            changes.append(dict(path=path, before=before.get(path), after=second['entries'].get(path)))
    assert STALE not in second['entries'], 'Archived lock still in profiles'
    save('shutdown-profile-changes.json', changes)
    # Recheck after hashing; a passing first observation cannot hide later drift.
    independent_process_audit()
    audit_preservation()
    save('fresh-baseline.json', dict(version=1, profiles=second, historicalEvidence=read('baseline.json'),
                                   source=read('task.json')['source'], preservation=preservation,
                                   historicalSeventeenFileFailureRetained=True))
    result = dict(passed=True, independentProcesses=processes, stableFingerprint=second['sha256'],
                  fingerprintSeparationSeconds=second['startedAt'] - first['finishedAt'],
                  shutdownProfileChanges=len(changes), **{k: v for k, v in preservation.items() if k not in ['passed', 'databaseDelta']})
    save('verification-summary.json', result)
    return result


if __name__ == '__main__':
    try:
        result = finish()
    except Exception as error:
        result = dict(passed=False, category='independent_maintenance_audit_failed', reason=str(error))
        save('verification-summary.json', result)
    print(json.dumps(result))
    raise SystemExit(0 if result['passed'] else 1)
