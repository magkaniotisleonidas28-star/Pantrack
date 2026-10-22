import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// POSIX-only: exercises the python3 preservation auditor with SQLite fixtures.
if(process.platform==='win32'){console.log('SKIP po-cart-full-gate-audit on Windows: requires python3 SQLite fixtures and POSIX modes.');process.exit(0);}
const auditPath=resolve('scripts/po-cart-worker/full-gate-audit.py');
const consumed='.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014';
const consumedTask=existsSync(consumed+'/task.json')?statSync(consumed+'/task.json').mtimeMs:null;
const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-full-gate-audit-')));
let count=0;

// Every case runs the real auditor functions against temporary bases; only the
// fixed paths and the observation-baseline module are redirected.
const harness=`
import importlib.util,json,pathlib,sqlite3,shutil,sys,types
s=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
base=pathlib.Path(sys.argv[2]);mode=sys.argv[3];step=sys.argv[4]
a.root=base/'root';a.DATABASE_BASES=[base/'state'];a.PROTECTED_BASES=[base/'workers',base/'budget',base/'evaluation']
a.PROTECTED_EXTRA=[base/'cart-browser-results.json',base/'evaluation'/'state.json'];a.BASELINE=base/'baseline'
def db(path,rows,wal=False):
    path.parent.mkdir(parents=True,exist_ok=True);c=sqlite3.connect(path)
    if wal:c.execute('PRAGMA journal_mode=WAL')
    c.execute('CREATE TABLE items(name)');c.executemany('INSERT INTO items VALUES (?)',[(r,) for r in rows]);c.commit()
    if wal:c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    c.close()
def setup():
    for d in ['root','workers/evidence','workers/modules','workers/browser-profiles/p','budget','evaluation']:(base/d).mkdir(parents=True,exist_ok=True)
    (base/'workers/evidence/report.json').write_text('{"passed":false}');(base/'workers/modules/generated.mjs').write_text('x')
    (base/'workers/browser-profiles/p/Preferences').write_text('{}');(base/'budget/ledger.json').write_text('{"reserved":921518}')
    (base/'workers/local-storefront.json').write_text(json.dumps(dict(fixtures=dict(cart1=dict(lines=[1])))))
    db(base/'state/wrangler/main.sqlite',['a','b']);db(base/'state/cart-review-state/v3/review.sqlite',['h1','h2','h3'])
    db(base/'state/live.sqlite',['w'],wal=True);(base/'state/backups').mkdir(parents=True,exist_ok=True)
    shutil.copyfile(base/'state/live.sqlite',base/'state/backups/copy.sqlite')
def run(fn):
    try:return fn()
    except Exception as error:return dict(passed=False,error=str(error))
if step=='capture':
    setup()
    if mode=='invoked':(a.root/'task.json').write_text('{}')
    if mode=='consumed':a.root=a.CONSUMED
    result=run(a.capture)
    if mode=='twice':result=run(a.capture)
    if result.get('passed'):
        inventory=json.loads((a.root/'database-inventory.json').read_text());protected=json.loads((a.root/'baseline.json').read_text())['protectedFiles']
        result.update(paths=[pathlib.Path(p).relative_to(base/'state').as_posix() for p in inventory['paths']],
                      protected=sorted(pathlib.Path(f['path']).relative_to(base).as_posix()+('' if f['sha256'] else ':absent') for f in protected))
else:
    def change(path,sql):
        c=sqlite3.connect(base/'state'/path);c.execute(sql);c.commit();c.close()
    if mode=='added_rows':change('cart-review-state/v3/review.sqlite',"INSERT INTO items VALUES ('new')");db(base/'state/new-fixture.sqlite',['n'])
    if mode=='changed_row':change('cart-review-state/v3/review.sqlite',"UPDATE items SET name='x' WHERE name='h2'")
    if mode=='removed_row':change('wrangler/main.sqlite',"DELETE FROM items WHERE name='a'")
    if mode=='removed_db':(base/'state/cart-review-state/v3/review.sqlite').unlink()
    if mode=='protected_changed':(base/'workers/evidence/report.json').write_text('{"passed":true}')
    if mode=='absent_created':(base/'cart-browser-results.json').write_text('{}')
    if mode=='cart_changed':(base/'workers/local-storefront.json').write_text(json.dumps(dict(fixtures=dict(cart1=dict(lines=[2])))))
    if mode=='inventory':
        value=json.loads((a.root/'database-inventory.json').read_text());value['paths']=value['paths'][1:];(a.root/'database-inventory.json').write_text(json.dumps(value))
    if mode=='modules_changed':(base/'workers/modules/generated.mjs').write_text('regenerated')
    result=run(a.audit)
    if result.get('passed'):
        delta=json.loads((a.root/'database-delta.json').read_text());result['added']=sum(t['added'] for d in delta for t in d['tables'])
print(json.dumps(result))
`;
function audit(mode,step){
 const base=join(sandbox,String(++count));mkdirSync(base);
 const run=(m,s)=>{const r=spawnSync('python3',['-c',harness,auditPath,base,m,s],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').pop());};
 if(step==='capture')return run(mode,'capture');
 assert.equal(run('pass','capture').passed,true);return run(mode,'finish');
}
const before=`
import importlib.util,json,pathlib,sys,types
s=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
base=pathlib.Path(sys.argv[2]);mode=sys.argv[3];a.BASELINE=base;a.root=base/'root';a.root.mkdir()
entries={'p/Preferences':dict(sha256='kept'),'p':dict(mode=16832)}
fingerprint=lambda e:dict(entries=e,sha256=a.digest(json.dumps(e,sort_keys=True,separators=(',',':')).encode()))
second=fingerprint(entries)
if mode=='tampered':second['entries']={**entries,'p/Extra':{}}
(base/'profiles-stability-second.json').write_text(json.dumps(second))
(base/'fresh-baseline.json').write_text(json.dumps(dict(profiles=dict(sha256=fingerprint(entries)['sha256']))))
(base/'report.json').write_text(json.dumps(dict(status='complete' if mode!='unpublished' else 'blocked',passed=mode!='unpublished')))
(base/'verification-summary.json').write_text(json.dumps(dict(passed=True,baselinePublished=True)))
calls=[]
obs=types.SimpleNamespace(preflight=lambda:dict(passed=mode!='not_idle',status='idle' if mode!='not_idle' else 'historical_profiles_active'),
    processes=lambda:calls.append('processes') if mode!='reappeared' else (_ for _ in ()).throw(AssertionError('Historical PID present')),
    worker_locks=lambda:calls.append('locks'),singleton=lambda:calls.append('singleton'),
    fingerprint=lambda:fingerprint({**entries,'p/Preferences':dict(sha256='drifted')} if mode=='drift' else entries))
a.module=lambda name,filename:obs
try:result=a.baseline_holds();result['checks']=calls
except Exception as error:result=dict(passed=False,error=str(error))
print(json.dumps(result))
`;
function baselineCheck(mode){
 const base=join(sandbox,String(++count));mkdirSync(base);
 const r=spawnSync('python3',['-c',before,auditPath,base,mode],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').pop());
}

try{
 // Capture covers every database, including review states and sidecar-less WAL copies.
 const captured=audit('pass','capture');
 assert.equal(captured.passed,true);assert.equal(captured.databases,4);assert.equal(captured.historicalDatabaseRows,7);
 assert.deepEqual(captured.paths,['backups/copy.sqlite','cart-review-state/v3/review.sqlite','live.sqlite','wrangler/main.sqlite']);
 assert.deepEqual(captured.protected,['budget/ledger.json','cart-browser-results.json:absent','evaluation/state.json:absent','workers/evidence/report.json']);
 for(const mode of ['twice','invoked','consumed']){const r=audit(mode,'capture');assert.equal(r.passed,false,mode);}

 // The finish audit allows classified additions and refuses any historical loss.
 const clean=audit('pass','finish');assert.equal(clean.passed,true);assert.equal(clean.historicalDatabaseRows,7);assert.equal(clean.added,0);
 const added=audit('added_rows','finish');assert.equal(added.passed,true);assert.equal(added.added,1);
 assert.equal(audit('modules_changed','finish').passed,true);
 for(const mode of ['changed_row','removed_row','removed_db','protected_changed','absent_created','cart_changed','inventory']){
  const r=audit(mode,'finish');assert.equal(r.passed,false,mode);
 }

 // The pre-invocation check requires the published baseline to hold exactly.
 const holds=baselineCheck('pass');
 assert.equal(holds.passed,true);assert.deepEqual(holds.checks,['processes','locks','singleton','processes','locks','singleton']);
 for(const [mode,error] of [['drift','Profiles changed since the baseline'],['not_idle','Profiles are not idle'],['unpublished','Baseline not published'],
  ['tampered','Baseline fingerprint changed'],['reappeared','Historical PID present']]){
  assert.deepEqual(baselineCheck(mode),{passed:false,error},mode);
 }

 // The fixed scope covers every local database and the October 14 protected bases.
 const source=readFileSync(auditPath,'utf8');
 assert.match(source,/DATABASE_BASES=\[Path\('\.wrangler\/state'\),Path\('\.sites-runtime'\)\]/);
 assert.match(source,/root=Path\('\.sites-runtime\/po-cart-workers\/full-offline-acceptance-task-20261021'\)/);
 assert.doesNotMatch(source,/sqlite3\.connect\(/);
 // Only fixed operations run, never optimized.
 const invalid=spawnSync('python3',[auditPath,'--root','x'],{encoding:'utf8',cwd:sandbox});
 assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Only fixed capture\/before\/finish/);
 const optimized=spawnSync('python3',['-O',auditPath,'capture'],{encoding:'utf8',cwd:sandbox});
 assert.notEqual(optimized.status,0);assert.match(optimized.stderr,/Optimized gate audit execution is not accepted/);
 assert.equal(existsSync('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021'),false);
 if(consumedTask!==null)assert.equal(statSync(consumed+'/task.json').mtimeMs,consumedTask);
 console.log('PASS full gate audit: complete database capture, WAL copies, classified additions, historical-loss refusal and baseline pre-check; no real root written.');
}finally{
 rmSync(sandbox,{recursive:true,force:true});
}
