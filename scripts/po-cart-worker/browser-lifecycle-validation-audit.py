"""Fixed real-validation binding; historical matrix evidence stays untouched."""
import hashlib
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('matrix_adapter', Path(__file__).with_name('shutdown-observation-matrix-audit.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
audit = adapter.audit
ROOT = Path('.sites-runtime/po-cart-workers/browser-lifecycle-validation-task-20261015')
POLICY = 'isolated-browser-lifecycle-validation-20261015'
adapter.ROOT = audit.ROOT = ROOT
adapter.POLICY = POLICY
original_binding = adapter.binding
original_case = audit.audit_case


def frozen_source():
    listed = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
    excluded = re.compile(r'^(?:\.sites-runtime|node_modules|docs|dist|\.wrangler|\.next)(?:/|$)|(?:\.md|\.tsbuildinfo)$')
    files = sorted({p for p in listed if p and not excluded.search(p)}, key=lambda p: p.encode('utf-16-be'))
    digest = hashlib.sha256()
    for name in files:
        digest.update(name.encode() + b'\0')
        digest.update(Path(name).read_bytes())
    assert files, 'Missing frozen source'
    return dict(files=len(files), sha256=digest.hexdigest())


def preparation():
    source = frozen_source()
    pipeline = audit.read('pipeline.json')
    assert source == audit.read('source-frozen.json') == pipeline['source'], 'Frozen source changed'
    assert pipeline['passed'] is True and len(pipeline['results']) == 3, 'Missing successful preparation'
    for step, expected in zip(pipeline['results'], ['typecheck', 'test', 'build']):
        assert step['id'] == expected and step['passed'] is True and step['exitCode'] == 0, 'Preparation failed'
        assert step['sourceBefore'] == step['sourceAfter'] == source['sha256'], 'Preparation source changed'
        assert audit.filehash(step['log']['path']) == step['log']['sha256'], 'Preparation log changed'
    return source


def collected(result):
    assert type(result.get('lifecycleEvidenceVersion')) is int and result['lifecycleEvidenceVersion'] == 2, 'Version-two lifecycle evidence required'
    assert result.get('evidenceOrigin') == 'collected', 'Simulated evidence cannot validate real Chrome'


def audit_case(result, expected):
    collected(result)
    return original_case(result, expected)


def binding():
    value = original_binding()
    report = audit.read('report.json')
    assert value['source'] == preparation(), 'Invocation source changed'
    assert type(report.get('lifecycleEvidenceVersion')) is int and report['lifecycleEvidenceVersion'] == 2, 'Version-two report required'
    assert len(report['results']) <= len(adapter.CASES), 'Extra validation cases'
    for result, expected in zip(report['results'], adapter.CASES):
        collected(result)
        assert all(result.get(k) == v for k, v in expected.items()), 'Validation case order changed'
    return dict(**value, lifecycleEvidenceVersion=2, evidenceOrigin='collected')


def before():
    # Profile hashing precedes the final preservation/process checks. Active
    # history is permitted here only; this never creates an idle baseline.
    preparation()
    old = audit.read('historical-profiles-before.json')['entries']
    now = audit.legacy.fingerprint()
    active = {p['profile'] for p in audit.read('historical-processes-before.json')['processes']}
    changed = [p for p in sorted(old.keys() | now['entries'].keys()) if old.get(p) != now['entries'].get(p)]
    assert all(p.split('/')[0] in active for p in changed), 'Inactive historical profile changed'
    audit.save('preconsumption-profile-drift.json', dict(passed=True, activeChanges=changed, fingerprint=now['sha256']))
    audit.before()
    audit.fixture_processes_gone([])  # Final independent PID-4303 absence.


adapter.binding = binding
audit.audit_case = audit_case


def finish():
    # Binding failure is retained separately and cannot skip the remaining
    # independent process, lifecycle, signal and preservation audits.
    return adapter.finish()


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ['before', 'finish']:
        raise SystemExit('Only the fixed before/finish audit operations are accepted.')
    globals()[sys.argv[1]]()
