"""Read-only audit of the isolated Chrome shutdown experiment."""
import importlib.util
import json
import math
import os
import re
import stat
import subprocess
from pathlib import Path

spec = importlib.util.spec_from_file_location('legacy', Path(__file__).with_name('legacy-profile-audit.py'))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('shutdown-lifecycle-audit.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)
ROOT = Path('.sites-runtime/po-cart-workers/shutdown-observation-diagnosis-task-20261015')
PROFILES = legacy.PROFILES
HISTORY = Path('.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015/observations/000006.json')
HISTORY_HASH = '5d0f4586905663ec15f5437a8c8c286212fc6fd555ba53888382141797fe8f9e'
filehash = legacy.filehash


def configure():
    legacy.ROOT = ROOT


def read(name):
    configure()
    return legacy.read(name)


def save(name, value):
    configure()
    legacy.save(name, value)


def historical_check():
    assert filehash(HISTORY) == HISTORY_HASH, 'Historical failure changed'
    code = "import {historicalProfilesPreflight} from './scripts/po-cart-worker/profile-preservation-preflight.mjs';console.log(JSON.stringify(historicalProfilesPreflight()));"
    now = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code]))
    old = read('historical-processes-before.json')
    fields = lambda p: tuple(p[k] for k in ['pid', 'parent', 'group', 'identity', 'profile', 'kind'])
    assert {fields(p) for p in now['processes']} == {fields(p) for p in old['processes']}, 'Historical process identities changed'
    assert now['liveLocks'] == old['liveLocks'] and now['status'] == old['status'], 'Historical lock references changed'
    entries = read('worker-locks-before.json')
    paths = {str(p) for p in PROFILES.iterdir() if p.name.endswith(('.lock', '.lock.reclaim'))}
    assert paths == {p['path'] for p in entries}, 'Historical locks or guards added/removed'
    for entry in entries:
        path = Path(entry['path'])
        s = path.lstat()
        assert stat.S_ISREG(s.st_mode) and (s.st_ino, s.st_dev, s.st_mtime_ns, s.st_mode, filehash(path)) == (
            entry['ino'], entry['dev'], entry['mtimeNs'], entry['mode'], entry['sha256']), 'Historical worker lock changed'
    return dict(passed=True, processes=len(now['processes']), workerLocks=len(entries), preflightStatus=now['status'])


def preservation():
    configure()
    value = legacy.audit_preservation()
    assert value['ordinaryFictionalSmokeRows'] == 0, 'Unexpected business additions'
    assert not any(t for db in value['databaseDelta'] for t in db['tables'] if not t['bookkeeping']), 'Business rows changed'
    return value


def before():
    value = preservation()
    historical = historical_check()
    save('preservation-before-diagnosis.json', value)
    save('historical-before-diagnosis.json', historical)


def analyze_observation(obs, baseline, phase='baseline'):
    """Independent analysis of sanitized evidence; never authorizes signals."""
    assert phase in ['baseline', 'shutdown'], 'Invalid observation phase'
    findings = []

    def blocked(category, pid=None):
        return dict(phase=phase, findings=findings, signaturePids=[], allAbsentAfter=False,
                    blockingFailure=dict(category=category, **({'pid': pid} if pid else {})))

    def digest(value):
        return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None

    def rows(value, metadata=False):
        if not isinstance(value, list) or any(not isinstance(p, dict) for p in value):
            return False
        if any(type(p.get('pid')) is not int for p in value) or len({p['pid'] for p in value}) != len(value):
            return False
        for p in value:
            if type(p.get('pid')) is not int or p['pid'] < 1 or not digest(p.get('startHash')) or (
                    type(p.get('startedMs')) not in [int, float] or not math.isfinite(p['startedMs'])):
                return False
            if metadata:
                if not digest(p.get('executableHash')):
                    return False
            elif not (type(p.get('parent')) is int and p['parent'] >= 0 and type(p.get('group')) is int and p['group'] > 0
                      and digest(p.get('identity')) and digest(p.get('commandHash')) and type(p.get('exactProfile')) is bool
                      and type(p.get('zombie')) is bool and isinstance(p.get('state'), str)):
                return False
        return True

    if not isinstance(obs, dict) or obs.get('complete') is not True or not rows(obs.get('before')) or not rows(obs.get('after')) or (
            not rows(obs.get('details'), True) or not rows(baseline) or not baseline or any(not digest(p.get('executableHash')) for p in baseline)):
        return blocked('incomplete_collection')
    known = {p['pid']: p for p in baseline}
    unexpected = next((p for p in obs['before'] + obs['after'] + obs['details'] if p['pid'] not in known), None)
    if unexpected:
        return blocked('unexpected_fixture_membership', unexpected['pid'])
    for old in baseline:
        pid = old['pid']
        a = next((p for p in obs['before'] if p['pid'] == pid), None)
        b = next((p for p in obs['after'] if p['pid'] == pid), None)
        d = next((p for p in obs['details'] if p['pid'] == pid), None)
        if any(p and (p['startHash'] != old['startHash'] or p['startedMs'] != old['startedMs']) for p in [a, b, d]):
            return blocked('observed_start_time_mismatch', pid)
        if any(p and (p['group'] != old['group'] or (p['parent'] != old['parent'] and (phase != 'shutdown' or p['parent'] != 1))) for p in [a, b]):
            return blocked('observed_topology_changed', pid)
        def note(kind):
            findings.append(dict(pid=pid, kind=kind))
        if any(p and p['commandHash'] != old['commandHash'] for p in [a, b]):
            note('command_changed')
        if any(p and not p['exactProfile'] for p in [a, b]):
            note('profile_reference_missing')
        if d and d['executableHash'] != old['executableHash']:
            note('executable_text_changed')
        if (a or b) and not d:
            note('metadata_missing')
        if any(p and (p['zombie'] or p['state'].startswith('Z')) for p in [a, b]):
            note('zombie')
        if not b:
            note('absent_after')
        if phase == 'baseline' and (not a or not b or not d or any(p and (p['identity'] != old['identity'] or not p['exactProfile']
                                      or p['zombie'] or p['state'].startswith('Z')) for p in [a, b]) or d['executableHash'] != old['executableHash']):
            return blocked('fixture_baseline_unverified', pid)
    signatures = []
    if phase == 'shutdown':
        for old in baseline:
            a = next((p for p in obs['before'] if p['pid'] == old['pid']), None)
            if a and a['startHash'] == old['startHash'] and a['identity'] != old['identity'] and a['commandHash'] != old['commandHash'] and (
                    not a['exactProfile'] and not any(p['pid'] == old['pid'] for p in obs['after'] + obs['details'])):
                signatures.append(old['pid'])
    return dict(phase=phase, findings=sorted(findings, key=lambda p: (p['pid'], p['kind'])), blockingFailure=None,
                signaturePids=sorted(signatures), allAbsentAfter=phase == 'shutdown' and not obs['after'])


def audit_case(result, expected):
    assert all(result.get(k) == v for k, v in expected.items()), 'Case order or policy changed'
    version = result.get('lifecycleEvidenceVersion', 1)
    assert type(version) is int and version in [1, 2], 'Unknown lifecycle version'
    if version == 2:
        lifecycle.audit_lifecycle(result, read)
    complete = result.get('completed') is True
    if complete:
        assert result.get('childExitObserved') is True, 'Fixture child exit unverified'
        assert result.get('cleanup', {}).get('verified') is True and result.get('network', {}).get('proxyClosed') is True, 'Fixture cleanup unverified'
        assert result['network'].get('proxyArgumentsVerified') is True, 'Proxy launch boundary unverified'
    if not result.get('baseline'):
        assert not complete and not result.get('observations') and not result.get('signatureObserved'), 'Missing fixture baseline'
        return False
    if version == 2 and not result.get('baselineReference'):
        assert not complete and not result.get('observations') and not result.get('signatureObserved'), 'Unpersisted baseline claimed verified'
        return False
    if version == 2:
        assert result['baselineReference'] == 'cases/' + expected['id'] + '/baseline.json', 'Unexpected baseline reference'
    assert result['baselineStabilityMs'] >= 250 and len(result['baseline']) >= 3, 'Unstable fixture baseline'
    old = {p['pid']: p for p in result['baseline']}
    assert len(old) == len(result['baseline']) and result['leader'] in old, 'Ambiguous fixture membership'
    assert not complete or len(result['observations']) >= 2, 'Incomplete observation series'
    assert read('cases/' + expected['id'] + '/baseline.json') == result['baseline'], 'Baseline reference changed'
    assert old[result['leader']]['parent'] == result['runnerPid'], 'Fixture child ownership changed'
    assert all(p['exactProfile'] and p['group'] == result['leader'] for p in old.values()), 'Fixture profile ownership changed'
    signatures = []
    analyses = []
    for index, ref in enumerate(result['observations']):
        assert re.fullmatch(r'cases/' + re.escape(expected['id']) + r'/observation-\d{4}\.json', ref), 'Unexpected observation reference'
        assert ref.endswith(f'observation-{index+1:04}.json'), 'Observation order changed'
        obs = read(ref)
        phase = 'baseline' if index == 0 else 'shutdown'
        analysis = analyze_observation(obs, result['baseline'], phase)
        if obs.get('complete'):
            assert analysis == obs.get('analysis'), 'False diagnostic findings'
            assert analysis['signaturePids'] == obs.get('signaturePids'), 'False signature evidence'
        if complete:
            assert not analysis['blockingFailure'], 'Blocked observation in complete case'
            if index == 0:
                assert obs.get('verdict', {}).get('passed') is True, 'Strict baseline verification missing'
            else:
                assert result['shutdownStartedMono'] <= obs['startedMono'] <= obs['finishedMono'] <= result['shutdownFinishedMono'], 'Observation timing changed'
        analyses.append(analysis)
        signatures.extend(analysis['signaturePids'])
    if complete:
        assert analyses[-1]['allAbsentAfter'], 'Fixture exit observation missing'
        assert 0 <= result['shutdownFinishedMono'] - result['shutdownStartedMono'] <= 5000, 'Shutdown observation deadline exceeded'
    assert bool(signatures) == result['signatureObserved'], 'False case classification'
    return bool(signatures)


def fixture_processes_gone(results):
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command=']).decode()
    rows = {}
    for line in raw.splitlines():
        m = re.match(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$', line)
        assert m and int(m[1]) not in rows, 'Independent process collection unavailable'
        rows[int(m[1])] = dict(parent=int(m[2]), group=int(m[3]), command=m[6])
    assert rows and 4303 not in rows, 'Forbidden PID reappeared'
    ids = {p['pid'] for r in results for p in r.get('baseline', [])} | {r['leader'] for r in results if r.get('leader')}
    assert not ids.intersection(rows), 'Fixture PID remains or was reused'
    assert not any(str(ROOT.resolve() / 'profiles') in p['command'] or p['parent'] in ids or p['group'] in ids for p in rows.values()), 'Fixture process remains'


def audit_signals(report):
    results = report['results']
    forbidden = {4303} | {p['pid'] for p in read('historical-processes-before.json')['processes']}
    cases = {r['id']: r for r in results}
    for event in report['events']:
        if event['kind'] == 'fixture_spawned':
            assert event.get('caseId') in cases and event['pid'] == cases[event['caseId']].get('leader'), 'Unexpected fixture spawn'
            assert event['pid'] > 0 and event['pid'] not in forbidden, 'Forbidden fixture PID'
        if event['kind'] in ['fixture_shutdown_signal', 'fixture_cleanup_signal']:
            case = cases.get(event.get('caseId'), {})
            captured = case.get('baseline', [])
            if case.get('lifecycleEvidenceVersion') == 2 and event['kind'] == 'fixture_cleanup_signal':
                captured = case.get('cleanupCaptured', [])
            fixture_ids = {p['pid'] for p in captured}
            assert event['pid'] > 0 and event['pid'] in fixture_ids and event['pid'] not in forbidden, 'Signal boundary violated'
            assert event.get('signal') in ['SIGTERM', 'SIGKILL'], 'Unexpected signal kind'
    for case in results:
        events = [e for e in report['events'] if e.get('caseId') == case['id']]
        spawned = [e for e in events if e['kind'] == 'fixture_spawned' and e['pid'] == case.get('leader')]
        assert len(spawned) == (1 if case.get('leader') else 0), 'Fixture spawn evidence missing'
        kind = 'fixture_shutdown_signal' if case['method'] == 'SIGTERM' else 'fixture_protocol_close'
        actions = [e for e in events if e['kind'] in ['fixture_shutdown_signal', 'fixture_protocol_close']]
        assert len(actions) <= 1 and all(e['kind'] == kind and e['pid'] == case['leader'] for e in actions), 'Shutdown action evidence changed'
        assert not case.get('completed') or len(actions) == 1, 'Shutdown action evidence missing'


def audit_profile_drift():
    before_entries = read('historical-profiles-before.json')['entries']
    after = legacy.fingerprint()
    save('historical-profiles-after.json', after)
    active = {p['profile'] for p in read('historical-processes-before.json')['processes']}
    changes = []
    for path in sorted(before_entries.keys() | after['entries'].keys()):
        if before_entries.get(path) != after['entries'].get(path):
            assert path.split('/')[0] in active, 'Inactive historical profile changed'
            changes.append(dict(path=path, before=before_entries.get(path), after=after['entries'].get(path)))
    save('concurrent-active-profile-drift.json', changes)
    return len(changes)


def finish():
    report = read('report.json')
    expected = [dict(id=f'{method}-{delay}-{repeat}', method=method, delay=delay, repetition=repeat)
                for method in ['SIGTERM', 'protocol'] for delay in [0, 10, 50] for repeat in [1, 2]]
    results, failures = report['results'], []
    def check(category, operation):
        try:
            return operation()
        except Exception:
            failures.append(dict(category=category))
            return None
    # Always attempt independent preservation, even after an incomplete matrix.
    gone = check('fixture_process_audit_failed', lambda: (fixture_processes_gone(results), True)[1])
    historical = check('historical_resource_audit_failed', historical_check)
    kept = check('business_preservation_audit_failed', preservation)
    if kept is not None:
        check('preservation_evidence_write_failed', lambda: save('preservation.json', kept))
    def cases():
        assert len(results) <= 12, 'Extra diagnostic cases'
        version = report.get('lifecycleEvidenceVersion', 1)
        assert type(version) is int and version in [1, 2], 'Unknown report lifecycle version'
        if version == 2:
            assert all(r.get('lifecycleEvidenceVersion') == 2 for r in results), 'Lifecycle evidence downgraded'
        return [audit_case(r, e) for r, e in zip(results, expected)]
    signatures = check('case_evidence_audit_failed', cases)
    check('signal_boundary_audit_failed', lambda: audit_signals(report))
    changes = check('historical_profile_audit_failed', audit_profile_drift)
    check('fixture_process_audit_failed', lambda: fixture_processes_gone(results))
    check('historical_resource_audit_failed', historical_check)
    check('business_preservation_audit_failed', preservation)
    complete = len(results) == 12 and all(r.get('completed') is True for r in results)
    count = sum(bool(s) and results[i].get('completed') is True for i, s in enumerate(signatures or []))
    status = ('reproduced' if count >= 2 else 'observed once' if count else 'not reproduced within this matrix') if complete else 'blocked'
    check('classification_audit_failed', lambda: require_classification(report['status'], status))
    primary = report.get('diagnosisFailure') or next((r['failure'] for r in results if r.get('failure')), None)
    if not complete:
        primary = primary or dict(category='incomplete_diagnostic_matrix')
    elif failures:
        primary = primary or failures[0]
    result = dict(passed=complete and not failures, status=status if complete and not failures else 'blocked', matrixComplete=complete,
                  lifecycleEvidenceVersion=report.get('lifecycleEvidenceVersion', 1),
                  completeCases=sum(r.get('completed') is True for r in results), attemptedCases=len(results), signatureCases=count,
                  independentChecksPassed=not failures, auditFailures=failures, diagnosisFailure=primary,
                  fixtureProcessesGone=gone is True, historical=historical, concurrentActiveProfileChanges=changes,
                  strictHistoricalProfileStabilityClaimed=False, historicalCauseEstablished=False,
                  **{k: v for k, v in (kept or {}).items() if k not in ['passed', 'databaseDelta']})
    save('verification-summary.json', result)
    print(json.dumps(result))
    return result


def require_classification(observed, expected):
    assert observed == expected, 'False matrix classification'
