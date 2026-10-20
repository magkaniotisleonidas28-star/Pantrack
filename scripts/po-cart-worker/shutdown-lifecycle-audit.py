"""Independent analysis of version-two lifecycle evidence; no process control."""
import hashlib
import json
import math
import re

STAGES = ['executable', 'proxy', 'port', 'spawn', 'startup', 'baseline', 'shutdown', 'observe',
          'dispose', 'child_exit', 'proxy_close', 'report']


def digest(value):
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None


def decision(sample):
    assert isinstance(sample, dict) and type(sample.get('complete')) is bool, 'Invalid startup collection'
    members, metadata = sample.get('members'), sample.get('metadata')
    assert isinstance(members, list) and isinstance(metadata, list), 'Missing startup collection'
    for rows in [members, metadata]:
        assert all(type(p.get('pid')) is int and p['pid'] > 0 for p in rows), 'Invalid startup PID'
        assert len({p['pid'] for p in rows}) == len(rows), 'Ambiguous startup collection'
    if not sample['complete']:
        return dict(kind='rejected', condition='incomplete_collection')
    for p in members:
        assert all(digest(p.get(k)) for k in ['identity', 'startHash', 'commandHash']), 'Invalid startup identity'
        assert type(p.get('zombie')) is bool and type(p.get('exactProfile')) is bool, 'Missing startup ownership evidence'
        assert type(p.get('parent')) is int and type(p.get('group')) is int, 'Invalid startup topology'
    for d in metadata:
        assert all(digest(d.get(k)) for k in ['startHash', 'metadataIdentity', 'executableHash']), 'Invalid executable evidence'
        assert type(d.get('executableAllowed')) is bool, 'Missing executable policy evidence'
    if len(members) < 3:
        return dict(kind='rejected', condition='insufficient_members')
    invalid = next((p for p in members if p['zombie'] or not p['exactProfile']), None)
    if invalid:
        return dict(kind='rejected', condition='zombie_member' if invalid['zombie'] else 'profile_argument_missing', pid=invalid['pid'])
    for p in members:
        d = next((d for d in metadata if d['pid'] == p['pid']), None)
        condition = ('metadata_missing' if d is None else 'identity_metadata_mismatch' if d['metadataIdentity'] != p['identity']
                     else 'executable_not_allowed' if not d['executableAllowed'] else 'executable_resolution_failed' if d.get('canonicalError')
                     else 'executable_not_canonical' if d.get('canonicalHash') != d['executableHash'] else None)
        if condition:
            return dict(kind='rejected', condition=condition, pid=p['pid'])
    return dict(kind='candidate')


def population_hash(sample):
    value = sorted([[p['pid'], p['parent'], p['group'], p['identity'],
                     next(d['executableHash'] for d in sample['metadata'] if d['pid'] == p['pid'])]
                    for p in sample['members']], key=lambda p: p[0])
    return hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()


def audit_lifecycle(result, read):
    assert result.get('lifecycleEvidenceVersion') == 2, 'Missing lifecycle version'
    assert result.get('evidenceOrigin') in ['simulated', 'collected'], 'Missing evidence origin'
    assert type(result.get('completed')) is bool, 'Missing completion state'
    refs = result.get('lifecycle')
    assert isinstance(refs, list) and refs and len(set(refs)) == len(refs), 'Missing lifecycle evidence'
    events, samples, decisions, previous_stage, previous_time = [], {}, {}, -1, -math.inf
    for index, ref in enumerate(refs):
        assert re.fullmatch(r'cases/' + re.escape(result['id']) + r'/lifecycle-\d{4}\.json', ref), 'Invalid lifecycle reference'
        event = read(ref)
        assert event.get('version') == 2 and event.get('sequence') == index + 1 and ref.endswith(f'{index+1:04}.json'), 'Missing or reordered lifecycle evidence'
        assert event.get('stage') in STAGES, 'Unknown lifecycle phase'
        stage, time = STAGES.index(event['stage']), event.get('atMono')
        assert type(time) in [int, float] and math.isfinite(time) and time >= previous_time, 'Invalid lifecycle timing'
        assert stage >= previous_stage, 'Reordered lifecycle phases'
        previous_stage, previous_time = stage, time
        events.append(event)
        if event['event'] == 'population_sample':
            assert event['stage'] == 'startup', 'Startup sample outside startup'
            samples[ref] = (event, decision(event['sample']))
        if event['event'] == 'population_decision':
            sample_ref = event.get('sampleReference')
            assert sample_ref in samples and sample_ref == refs[index-1], 'Decision without preceding persisted sample'
            sample, verdict = samples[sample_ref]
            assert event.get('decision') == verdict, 'False startup decision'
            if verdict['kind'] == 'candidate':
                assert event.get('populationHash') == population_hash(sample['sample']), 'False startup population hash'
            decisions[sample_ref] = verdict
    assert events[0]['stage'] == 'executable' and events[0]['event'] == 'enter', 'Missing executable phase'
    entered = [e['stage'] for e in events if e['event'] == 'enter']
    assert len(set(entered)) == len(entered), 'Repeated lifecycle phase'
    assert all(e['stage'] in entered for e in events), 'Evidence without phase entry'
    if result.get('leader'):
        targets = [e for e in events if e['stage'] == 'dispose' and e['event'] == 'targets']
        captured = result.get('cleanupCaptured')
        assert len(targets) == 1 and targets[0].get('captured') == captured, 'Missing disposal capture evidence'
        assert isinstance(captured, list) and len({p['pid'] for p in captured}) == len(captured), 'Ambiguous disposal captures'
        for p in captured:
            assert p['pid'] > 0 and p['exactProfile'] and p['group'] == result['leader'], 'Unowned disposal capture'
            if result.get('baseline'):
                assert p in result['baseline'], 'Disposal adopted an uncaptured member'
            else:
                assert p['pid'] == result['leader'] and p['parent'] == result['runnerPid'], 'Partial startup disposal adopted a member'
                assert any(e['event'] == 'leader_sample' and e.get('owned') and e.get('mainExecutable')
                           and e.get('member') == {k: v for k, v in p.items() if k != 'executableHash'}
                           and e.get('executableHash') == p['executableHash'] for e in events), 'Disposal leader ownership evidence missing'
    if result.get('baseline'):
        stable = result.get('startupStableReferences')
        assert isinstance(stable, list) and len(stable) == 2 and stable[0] != stable[1], 'Missing stable startup samples'
        first, last = [samples[r][0] for r in stable]
        assert list(samples)[-2:] == stable, 'Startup samples are not consecutive'
        assert all(decisions[r] == dict(kind='candidate') for r in stable), 'Rejected startup population admitted'
        assert population_hash(first['sample']) == population_hash(last['sample']), 'Unstable startup population admitted'
        assert last['atMono'] - first['atMono'] >= 250 and result['baselineStabilityMs'] >= 250, 'Startup stabilization too short'
        assert result['startupDeadlineMono'] - result['startupStartedMono'] == 20000, 'Startup deadline changed'
        assert result['startupStartedMono'] <= first['atMono'] <= last['atMono'] < result['startupDeadlineMono'], 'Startup deadline exceeded'
        baseline = result['baseline']
        assert last['sample']['members'] == [{k: v for k, v in p.items() if k != 'executableHash'} for p in baseline], 'Startup baseline differs'
        assert all(p['executableHash'] == next(d['executableHash'] for d in last['sample']['metadata'] if d['pid'] == p['pid']) for p in baseline), 'Startup executable baseline differs'
    failure = result.get('failure')
    assert result['completed'] or isinstance(failure, dict), 'Incomplete case has no named failure'
    if failure:
        assert not result.get('completed') and failure.get('stage') in STAGES and isinstance(failure.get('condition'), str), 'Unexplained failure'
        assert failure.get('reference') in refs + result.get('observations', []), 'Missing primary failure evidence'
        retained = read(failure['reference'])
        if failure['stage'] == 'startup' and failure['reference'] in samples and retained['sample']['complete']:
            expected = decision(retained['sample'])
            assert expected['kind'] == 'rejected' and failure['condition'] == expected['condition'], 'False startup refusal'
            assert failure.get('pid') == expected.get('pid'), 'False startup refusal PID'
        assert any(e.get('event') == 'failed' and e.get('failure') == failure for e in events), 'Primary failure omitted from lifecycle'
    for secondary in result.get('secondaryFailures', []):
        assert secondary.get('stage') in STAGES and isinstance(secondary.get('condition'), str), 'Unexplained secondary failure'
        assert secondary.get('reference') in refs + result.get('observations', []), 'Missing secondary failure evidence'
    terminal = [e for e in events if e['event'] == 'terminal']
    assert len(terminal) <= 1, 'Repeated terminal event'
    raw_ref = result.get('resultReference')
    assert raw_ref in [f"cases/{result['id']}/result.json", f"cases/{result['id']}/failure-result.json"], 'Missing durable case result'
    assert read(raw_ref) == result, 'Case result differs from report'
    if result.get('completed'):
        assert not failure and not result.get('secondaryFailures'), 'Failure hidden by completion'
        assert entered == STAGES and terminal and terminal[0].get('completed') is True, 'Incomplete lifecycle claimed complete'
        assert not any(e['event'] == 'failed' for e in events), 'Failed lifecycle claimed complete'
        for stage, event in [('executable', 'ready'), ('proxy', 'ready'), ('port', 'ready'), ('spawn', 'ready'),
                             ('startup', 'cdp_ready'), ('startup', 'pages_initialize'), ('startup', 'pages_ready'), ('startup', 'stable'),
                             ('shutdown', 'requested')]:
            assert len([e for e in events if e['stage'] == stage and e['event'] == event]) == 1, 'Missing lifecycle completion milestone'
        cdp = next(i for i, e in enumerate(events) if e['event'] == 'cdp_ready')
        pages = next(i for i, e in enumerate(events) if e['event'] == 'pages_ready')
        population = next(i for i, e in enumerate(events) if e['event'] == 'population_sample')
        assert cdp < pages < population and any(e['event'] == 'cdp_connect' for e in events[:cdp]), 'Initialization order changed'
        assert any(e['event'] == 'leader_sample' and e.get('owned') and e.get('mainExecutable') for e in events[:cdp]), 'Owned leader proof missing'
        assert next(e for e in events if e['event'] == 'stable')['references'] == result['startupStableReferences'], 'Stable milestone differs'
        assert next(e for e in events if e['event'] == 'requested')['method'] == result['method'], 'Shutdown method differs'
        for phase in ['dispose', 'child_exit', 'proxy_close']:
            assert any(e['stage'] == phase and e['event'] == 'verified' for e in events), 'Cleanup lifecycle proof missing'
        assert any(e['stage'] == 'baseline' and e['event'] == 'verified' for e in events), 'Strict baseline proof missing'
        assert any(e['stage'] == 'observe' and e['event'] == 'exit_observed' for e in events), 'Exit observation proof missing'
    return True
