"""Fixed-root adapter; the consumed original diagnosis keeps its own binding."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('diagnosis_audit', Path(__file__).with_name('shutdown-observation-audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
ROOT = Path('.sites-runtime/po-cart-workers/shutdown-observation-matrix-task-20261015')
POLICY = 'isolated-shutdown-observation-matrix-20261015'
CASES = [dict(id=f'{method}-{delay}-{repeat}', method=method, delay=delay, repetition=repeat)
         for method in ['SIGTERM', 'protocol'] for delay in [0, 10, 50] for repeat in [1, 2]]
audit.ROOT = ROOT
original_preservation = audit.preservation


def preservation():
    value = original_preservation()
    assert not any(db['tables'] for db in value['databaseDelta']), 'Unexpected database additions or changes'
    return value


audit.preservation = preservation


def before():
    audit.fixture_processes_gone([])  # Includes independent PID-4303 absence.
    audit.before()


def binding():
    report, invocation = audit.read('report.json'), audit.read('diagnosis.json')
    assert report['policy'] == invocation['policy'] == POLICY, 'Matrix policy changed'
    assert report['matrix'] == invocation['cases'] == CASES, 'Matrix cases changed'
    assert report['source'] == invocation['source'], 'Matrix source binding changed'
    assert report['historicalReference'] == dict(path=str(audit.HISTORY), sha256=audit.HISTORY_HASH), 'Historical reference changed'
    return dict(passed=True, policy=POLICY, source=invocation['source'], cases=len(CASES))


def finish():
    try:
        bound = binding()
    except Exception:
        bound = dict(passed=False, category='matrix_binding_audit_failed')
    audit.save('matrix-binding-audit.json', bound)
    original = audit.require_classification

    def classification(observed, expected):
        assert bound['passed'], 'See matrix-binding-audit.json'
        original(observed, expected)

    audit.require_classification = classification
    return audit.finish()  # Always attempts the remaining independent checks.


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ['before', 'finish']:
        raise SystemExit('Only the fixed before/finish audit operations are accepted.')
    globals()[sys.argv[1]]()
