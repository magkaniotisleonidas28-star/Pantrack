"""Independent offline maintenance-evidence audit. No process control or CLI."""
import json
import math
import os
import re
import stat
from pathlib import Path


def digest(value):
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None


def decision(sample):
    findings = []

    def fail(category, p=None, old=None):
        value = dict(category=category, phase='reconciliation')
        if p:
            value['pid'] = p['pid']
            if digest(p.get('identity')):
                value['observedIdentity'] = p['identity']
        if old:
            value['expectedIdentity'] = old['identity']
        return dict(passed=False, findings=list(findings), livePids=[], absentPids=[], failure=value)

    def unique(rows):
        return isinstance(rows, list) and all(isinstance(p, dict) and type(p.get('pid')) is int and p['pid'] > 0 for p in rows) and len({p['pid'] for p in rows}) == len(rows)

    if (not isinstance(sample, dict) or type(sample.get('version')) is not int or sample['version'] != 2 or sample.get('complete') is not True
            or sample.get('phase') not in ['strict', 'shutdown'] or sample.get('evidenceOrigin') not in ['simulated', 'collected']
            or not all(unique(sample.get(k)) for k in ['before', 'after', 'executables', 'baseline'])
            or not all(isinstance(sample.get(k), list) for k in ['forbiddenPids', 'absentPids'])
            or (sample['phase'] == 'shutdown' and not sample['baseline'])):
        return fail('process_observation_unavailable')
    for p in sample['baseline']:
        if not all(digest(p.get(k)) for k in ['identity', 'profile']) or type(p.get('parent')) is not int or p['parent'] < 0 or type(p.get('group')) is not int or p['group'] < 1:
            return fail('process_observation_unavailable', p)
    for p in sample['before'] + sample['after']:
        if (not all(digest(p.get(k)) for k in ['identity', 'startHash', 'commandHash']) or type(p.get('startedMs')) not in [int, float]
                or not math.isfinite(p['startedMs']) or type(p.get('parent')) is not int or p['parent'] < 0
                or type(p.get('group')) is not int or p['group'] < 1 or type(p.get('zombie')) is not bool
                or not isinstance(p.get('state'), str) or p['zombie'] != p['state'].startswith('Z')):
            return fail('process_observation_unavailable', p)
    for p in sample['executables']:
        if not all(digest(p.get(k)) for k in ['startHash', 'executableHash']) or type(p.get('startedMs')) not in [int, float] or not math.isfinite(p['startedMs']):
            return fail('executable_collection_failed', p)
    seen = sample['before'] + sample['after'] + sample['executables']
    forbidden = next((p for p in seen if p['pid'] in sample['forbiddenPids'] + sample['absentPids']), None)
    if forbidden:
        return fail('process_appeared', forbidden)
    known = {p['pid']: p for p in sample['baseline']}
    unknown = next((p for p in seen if p['pid'] not in known), None)
    if unknown:
        return fail('unexpected_membership', unknown)
    live, absent = [], []
    for old in sample['baseline']:
        a, b, d = [next((p for p in sample[k] if p['pid'] == old['pid']), None) for k in ['before', 'after', 'executables']]

        def denied(category, p=None):
            return fail(category, p or dict(pid=old['pid']), old)

        if not a and (b or d):
            return denied('process_appeared', b or d)
        if sample['phase'] == 'shutdown' and (type(old.get('startedMs')) not in [int, float] or not math.isfinite(old['startedMs'])
                                             or not digest(old.get('startHash')) or not digest(old.get('executableHash'))):
            return denied('process_observation_unavailable')
        for p in [a, b, d]:
            if p and ((type(old.get('startedMs')) in [int, float] and p['startedMs'] != old['startedMs'])
                      or (digest(old.get('startHash')) and p['startHash'] != old['startHash'])):
                return denied('executable_identity_changed', p)
        if any(p and (p['group'] != old['group'] or p['parent'] not in [old['parent'], 1]) for p in [a, b]):
            return denied('identity_changed', b or a)
        if sample['phase'] == 'strict':
            if any(p and (p['identity'] != old['identity'] or p['zombie'] or p.get('profile') != old['profile']) for p in [a, b]):
                return denied('identity_changed', b or a)
            if b and not d:
                return denied('executable_evidence_incomplete', b)
            if d and ((digest(old.get('executableHash')) and d['executableHash'] != old['executableHash'])
                      or d.get('canonicalHash') != d['executableHash'] or ((b or a) and d.get('identity') != (b or a)['identity'])):
                return denied('executable_identity_changed', b or a or d)
        else:
            def note(kind):
                findings.append(dict(pid=old['pid'], kind=kind))
            if any(p and p['identity'] != old['identity'] for p in [a, b]):
                note('command_identity_changed')
            if any(p and p.get('profile') != old['profile'] for p in [a, b]):
                note('profile_reference_missing')
            if any(p and (p['zombie'] or p['state'].startswith('Z')) for p in [a, b]):
                note('zombie')
            if d and d['executableHash'] != old['executableHash']:
                note('executable_text_changed')
            if d and not digest(d.get('canonicalHash')):
                note('canonical_evidence_unavailable')
            elif d and d['canonicalHash'] != d['executableHash']:
                note('executable_noncanonical')
            if (a or b) and not d:
                note('metadata_missing')
                if b and all(p['identity'] == old['identity'] and not p['zombie'] and p.get('profile') == old['profile'] for p in [a, b] if p):
                    return denied('executable_evidence_incomplete', b)
        (live if b else absent).append(old['pid'])
    return dict(passed=True, findings=findings, livePids=live, absentPids=absent, failure=None)


SIGNAL_EVENTS = ['signal_intent', 'signal_sent', 'signal_not_sent']
REFERENCE = r'observations/\d{6}\.json'


def require(condition, message):
    # Explicit checks still refuse proof under python -O; assert statements do not.
    if not condition:
        raise AssertionError(message)


def regular_json(path):
    require(stat.S_ISREG(path.lstat().st_mode), 'Unsafe evidence file')
    return json.loads(path.read_text())


def bind_targets(baseline, targets):
    # Admission captures exactly the report's target browsers: each leader is
    # parented by launchd and leads its group; helpers belong to that leader.
    leaders = {t['profile']: t['pid'] for t in targets}
    require(isinstance(baseline, list) and all(isinstance(p, dict) for p in baseline)
            and len({p.get('pid') for p in baseline}) == len(baseline)
            and all(any(p.get('pid') == t['pid'] for p in baseline) for t in targets)
            and all(p.get('profile') in leaders and p.get('group') == leaders[p['profile']]
                    and p.get('parent') == (1 if p['pid'] == leaders[p['profile']] else leaders[p['profile']]) for p in baseline),
            'Captured targets do not match report targets')


def audit_maintenance(root, require_collected=False):
    try:
        return _audit(Path(root), require_collected)
    except AssertionError:
        raise
    except Exception:
        # Refuse malformed proof without echoing any of its content.
        raise AssertionError('Malformed maintenance evidence') from None


def _audit(root, require_collected):
    report = regular_json(root / 'report.json')
    require(isinstance(report, dict) and report.get('evidenceOrigin') in ['simulated', 'collected'], 'Missing report evidence origin')
    require(not require_collected or report['evidenceOrigin'] == 'collected', 'Simulated proof cannot validate real maintenance')
    require(type(report.get('version')) is int and report['version'] == 2, 'Report downgraded')
    passed, status, failures, failure = report.get('passed'), report.get('status'), report.get('failures'), report.get('failure')
    require(type(passed) is bool and isinstance(failures, list)
            and all(isinstance(f, dict) and isinstance(f.get('category'), str) for f in failures), 'Invalid report completion state')
    require((failure is None) == (not failures), 'Primary failure missing or invented')
    require(failure is None or failure == failures[0], 'Primary failure replaced')
    if passed:
        require(status == 'complete' and isinstance(report.get('finishedAt'), str), 'False completion')
    else:
        require(status != 'complete' and (not failures or status in ['blocked', 'interrupted']), 'Inconsistent report status')
    targets = report.get('targets')
    require(isinstance(targets, list) and targets and all(
        isinstance(t, dict) and type(t.get('pid')) is int and t['pid'] > 0 and t['pid'] != 4303 and digest(t.get('profile')) for t in targets)
        and len({t['pid'] for t in targets}) == len(targets) and len({t['profile'] for t in targets}) == len(targets), 'Invalid maintenance targets')
    leaders = {t['profile']: t['pid'] for t in targets}
    write_failed = any(f['category'] == 'evidence_write_failed' for f in failures)

    # Every committed observation is listed, in order, and nothing was cut off.
    timeline = regular_json(root / 'timeline.json')
    require(isinstance(timeline, list) and all(isinstance(e, dict) for e in timeline), 'Malformed maintenance evidence')
    listed = [e.get('reference') for e in timeline if e.get('type') == 'observation']
    require(all(isinstance(r, str) and re.fullmatch(REFERENCE, r) for r in listed), 'Invalid or repeated evidence reference')
    require(report.get('lastObservation') == (listed[-1] if listed else None), 'Observation evidence truncated')
    directory, names = root / 'observations', []
    if listed or os.path.lexists(directory):
        require(stat.S_ISDIR(directory.lstat().st_mode), 'Unsafe evidence file')
        names = os.listdir(directory)
    committed = sorted(n for n in names if re.fullmatch(r'\d{6}\.json', n))
    require(committed == sorted(r.split('/')[1] for r in listed), 'Unreferenced observation evidence')
    require(all(re.fullmatch(r'\d{6}\.json\.[0-9a-f-]{36}\.tmp', n) and write_failed for n in names if n not in committed), 'Unexpected observation file')

    # The durable report event log and the timeline describe the same events. Only
    # a final event whose report write failed can be missing; audit it in place.
    logged = report.get('events')
    require(isinstance(logged, list) and all(isinstance(e, dict) for e in logged), 'Report events differ from timeline')
    logged = [{k: v for k, v in e.items() if k != 'at'} for e in logged]
    recorded = [e.get('event') for e in timeline if e.get('type') == 'event']
    unrecorded = logged[len(recorded):]
    require(logged[:len(recorded)] == recorded and (not unrecorded or (len(unrecorded) == 1 and write_failed)), 'Report events differ from timeline')
    entries = timeline + [dict(type='event', event=e) for e in unrecorded]

    previous_sample, last_decision, last_strict, intent = None, None, None, None
    samples, strict_checks, closed = 0, 0, []
    observed_absent, ever_absent, baseline, refs, prior_verified = set(), set(), None, [], None
    forbidden, intents, last_signal, blocked = None, set(), -1, []
    for index, entry in enumerate(entries):
        if entry.get('type') == 'observation':
            ref = entry['reference']
            require(ref not in refs, 'Invalid or repeated evidence reference')
            refs.append(ref)
            require(ref == f'observations/{len(refs):06}.json', 'Evidence order changed')
            value = regular_json(root / ref)
            require(isinstance(value, dict) and type(value.get('version')) is int and value['version'] == 2, 'Evidence downgraded')
            if value.get('event') == 'sample':
                samples += 1
                require(value.get('evidenceOrigin') == report['evidenceOrigin'], 'Evidence origin changed')
                require(previous_sample is None, 'Sample without decision')
                if forbidden is None:
                    forbidden = value.get('forbiddenPids')
                require(isinstance(forbidden, list) and 4303 in forbidden and value.get('forbiddenPids') == forbidden, 'Forbidden PID list changed')
                if baseline is None:
                    baseline = value.get('baseline')
                    bind_targets(baseline, targets)
                if value.get('baseline') != baseline:
                    # Initial historical records lack executable/start fields.
                    # Admission may add only fields proved by its preceding
                    # verified strict sample, before any signal event.
                    require(prior_verified and prior_verified['phase'] == 'strict' and last_signal < 0, 'Captured targets changed')
                    require(isinstance(value['baseline'], list) and len(value['baseline']) == len(baseline), 'Captured targets changed')
                    for old, new in zip(baseline, value['baseline']):
                        require(isinstance(new, dict) and all(new.get(k) == v for k, v in old.items()), 'Captured identity changed')
                        metadata = next((p for p in prior_verified['executables'] if p['pid'] == old['pid']), None)
                        require(set(new) - set(old) <= {'startedMs', 'startHash', 'executableHash'}, 'Unexpected admission field')
                        require(metadata and all(new[k] == metadata[k] for k in set(new) - set(old)), 'Unproved admission field')
                    baseline = value['baseline']
                require(set(value['absentPids']) == observed_absent, 'Observed absence discarded')
                # A process absent from any verified complete read cannot return.
                seen = {p.get('pid') for k in ['before', 'after', 'executables'] for p in value.get(k) or [] if isinstance(p, dict)}
                previous_sample = (ref, value, decision(value), bool(seen & ever_absent))
            else:
                require(value.get('event') == 'decision' and previous_sample and value.get('sampleReference') == previous_sample[0], 'Decision without preceding persisted input')
                sample_ref, sample, expected, reappeared = previous_sample
                analysis = value.get('analysis')
                require(value.get('phase') == sample['phase'], 'Decision phase changed')
                require(isinstance(analysis, dict) and analysis.get('passed') is expected['passed'], 'False maintenance decision')
                require(value.get('outcome') == ('verified' if expected['passed'] else 'blocked'), 'False maintenance outcome')
                require(not (expected['passed'] and reappeared), 'Process reappeared')
                if not sample['complete']:
                    require(sample.get('collectionStage') in ['before_snapshot', 'executable_snapshot', 'after_snapshot'], 'Missing collection stage')
                    require(analysis['failure']['category'] == sample['collectionFailure']['category'], 'Collection failure replaced')
                    require(analysis['failure']['phase'] == sample['collectionStage'], 'Collection failure phase changed')
                if expected['passed'] or (sample['phase'] == 'shutdown' and sample['complete']):
                    require(analysis == expected, 'False maintenance analysis')
                if expected['passed']:
                    require(value.get('failure') is None, 'Verified decision carries a failure')
                else:
                    recorded_failure = value.get('failure')
                    require(isinstance(recorded_failure, dict) and isinstance(analysis.get('failure'), dict)
                            and recorded_failure.get('category') == analysis['failure'].get('category')
                            and recorded_failure.get('reference') == sample_ref, 'Decision failure contradicts analysis')
                    blocked.append((ref, recorded_failure['category']))
                last_decision = (sample, expected, index)
                if expected['passed']:
                    prior_verified = sample
                    ever_absent.update(expected['absentPids'])
                if expected['passed'] and sample['phase'] == 'shutdown':
                    observed_absent.update(expected['absentPids'])
                if sample['phase'] == 'strict' and expected['passed']:
                    strict_checks += 1
                    last_strict = (sample, expected, index)
                previous_sample = None
        else:
            require(entry.get('type') == 'event' and isinstance(entry.get('event'), dict) and isinstance(entry['event'].get('kind'), str), 'Unknown timeline item')
            event = entry['event']
            require('signal' not in event['kind'] or event['kind'] in SIGNAL_EVENTS, 'Unknown signal event')
            if event['kind'] in SIGNAL_EVENTS:
                require(previous_sample is None, 'Signal with unverified pending evidence')
                require(last_strict and last_decision == last_strict, 'Signal without a fresh strict decision')
                sample, verdict, checked_at = last_strict
                pid = event.get('pid')
                require(type(pid) is int and pid > 0 and pid != 4303 and pid in verdict['livePids'], 'Forbidden or absent signal target')
                old = next(p for p in sample['baseline'] if p['pid'] == pid)
                require(digest(old.get('startHash')) and digest(old.get('executableHash')) and type(old.get('startedMs')) in [int, float], 'Signal before complete admission')
                require(event.get('identity') == old['identity'] and event.get('signal') in ['SIGTERM', 'SIGKILL'], 'Signal identity/kind changed')
                require(event['signal'] != 'SIGTERM' or any(t['pid'] == pid for t in targets), 'TERM to a helper')
                if event['kind'] == 'signal_intent':
                    # Each intent follows its own strict check, made after any
                    # earlier signal event. An abandoned intent needs proof of exit.
                    require(checked_at > last_signal, 'Signal without a fresh strict decision')
                    require((pid, event['signal']) not in intents, 'Duplicate signal intent')
                    require(intent is None or intent[0] not in verdict['livePids'], 'Dangling signal intent')
                    intents.add((pid, event['signal']))
                    intent = (pid, event['signal'], index)
                else:
                    require(intent and intent[:2] == (pid, event['signal']) and checked_at > intent[2], 'Missing post-intent ownership recheck')
                    require(event['kind'] == 'signal_sent' or event.get('reason') == 'already_exited', 'Invalid signal result')
                    intent = None
                last_signal = index
            if event['kind'] == 'browser_closed':
                require(event.get('pid') not in closed and leaders.get(event.get('profile')) == event.get('pid'), 'False closure event')
                members = {p['pid'] for p in baseline or [] if p.get('profile') == event['profile']}
                require(previous_sample is None and last_decision and last_decision[1]['passed']
                        and not members & set(last_decision[1]['livePids']), 'Closure without proved absence')
                closed.append(event['pid'])
    if passed:
        require(previous_sample is None and last_decision and last_decision[0]['phase'] == 'strict', 'Missing final strict evidence')
        require(last_decision[1]['passed'] and not last_decision[1]['livePids'], 'Incomplete final absence')
        require(closed == [t['pid'] for t in targets], 'Incomplete target lifecycle')
        require(not failures, 'Failure in successful report')

    # Failures keep their evidence, in recorded order. The primary failure cannot
    # be replaced by a later write/audit failure or detached from its refusal.
    positions = []
    for f in failures:
        if 'reference' in f:
            require(f['reference'] in refs, 'Missing failure evidence')
            positions.append(refs.index(f['reference']))
    require(positions == sorted(positions), 'Failure evidence out of order')
    refusals = dict(blocked)
    if failure is not None and failure.get('reference') in refusals:
        require(failure.get('category') == refusals[failure['reference']], 'Primary failure contradicts its evidence')
    if blocked:
        first, category = blocked[0]
        require(any(f.get('reference') == first and f['category'] == category for f in failures), 'Blocked decision missing from failures')
        require(failure.get('reference') is None or refs.index(failure['reference']) <= refs.index(first), 'Primary failure contradicts its evidence')
    if previous_sample is not None and not previous_sample[2]['passed']:
        # The refusing sample's decision write failed: its own refusal precedes
        # the write failure and, where recomputable, keeps the same category.
        sample_ref, sample, expected, _ = previous_sample
        category = (sample['collectionFailure']['category'] if not sample['complete']
                    else expected['failure']['category'] if sample['phase'] == 'shutdown' else None)
        linked = [f for f in failures if f.get('reference') == sample_ref]
        require(linked and linked[0]['category'] != 'evidence_write_failed' and category in [None, linked[0]['category']],
                'Primary failure contradicts its evidence')
    return dict(passed=True, samples=samples, strictChecks=strict_checks, completed=passed, primaryFailure=failure)
