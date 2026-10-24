import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,statSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// POSIX-only: exercises the python3 preservation auditor with SQLite fixtures.
if(process.platform==='win32'){console.log('SKIP po-cart-full-gate-audit on Windows: requires python3 SQLite fixtures and POSIX modes.');process.exit(0);}
const auditPath=resolve('scripts/po-cart-worker/full-gate-audit.py');
// The real gate root legitimately exists during gate preparation and its own
// test step; this suite must leave it and both consumed roots exactly as it found them.
const gateRoots=['20261014','20261021','20261022','20261024'].map(day=>'.sites-runtime/po-cart-workers/full-offline-acceptance-task-'+day);
const gateListing=()=>gateRoots.map(root=>existsSync(root)?readdirSync(root).sort().map(name=>[name,statSync(root+'/'+name).mtimeMs]):null);
const gateBefore=gateListing();
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
    if mode.startswith('consumed'):a.root=a.CONSUMED[int(mode[-1])]
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
import importlib.util,json,os,pathlib,sys,types
s=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
s=importlib.util.spec_from_file_location('observation',pathlib.Path(sys.argv[1]).with_name('observation-baseline-audit.py'));real=importlib.util.module_from_spec(s);s.loader.exec_module(real)
base=pathlib.Path(sys.argv[2]);mode=sys.argv[3];a.BASELINE=base;a.root=base/'root';a.root.mkdir()
profiles=base/'browser-profiles';profiles.mkdir()
REUSED,NEW,FAILED,OTHER,ACTIVE='a'*64,'d'*64,'b'*64,'e'*64,'c'*64
entries={'p/Preferences':dict(sha256='kept'),'p':dict(mode=16832),REUSED:dict(mode=16832),REUSED+'/Cookies':dict(sha256='old'),
 REUSED+'.lock':dict(sha256='lock'),FAILED:dict(mode=16832),ACTIVE+'/Preferences':dict(sha256='active')}
fingerprint=lambda e:dict(entries=e,sha256=a.digest(json.dumps(e,sort_keys=True,separators=(',',':')).encode()))
second=fingerprint(entries)
if mode=='tampered':second['entries']={**entries,'p/Extra':{}}
(base/'profiles-stability-second.json').write_text(json.dumps(second))
(base/'fresh-baseline.json').write_text(json.dumps(dict(profiles=dict(sha256=fingerprint(entries)['sha256']))))
(base/'report.json').write_text(json.dumps(dict(status='complete' if mode!='unpublished' else 'blocked',passed=mode!='unpublished')))
(base/'verification-summary.json').write_text(json.dumps(dict(passed=True,baselinePublished=True)))
def gate(name,records,passed=True,invoked=True,count=None,pid=1000):
    g=base/name;(g/'profiles').mkdir(parents=True)
    if invoked:(g/'task.json').write_text('{}')
    (g/'process-audit.json').write_text(json.dumps(dict(passed=True,profilesClear=True,profiles=len(records) if count is None else count)))
    (g/'preservation.json').write_text(json.dumps(dict(passed=True)))
    for i,r in enumerate(records):(g/'profiles'/(str(i)+'.json')).write_text(json.dumps(dict(path=r if r.startswith('/') else str(profiles.resolve()/r),workerPid=pid+i)))
    audits={k:True for k in a.GATE_AUDITS};audits['passed']=passed
    audits['references']=[dict(path=str(g/f),sha256=a.filehash(g/f)) for f in ['process-audit.json','preservation.json']]
    (g/'final-audit.json').write_text(json.dumps(audits));return g
records=[REUSED,NEW]+([ACTIVE] if mode=='active_record' else [])+(['/elsewhere/'+'f'*64] if mode=='outside_record' else [])+(['g'*64+'.lock'] if mode=='lock_record' else [])
latest=gate('latest',records,invoked=mode!='not_invoked',count=5 if mode=='count_mismatch' else None)
a.CONSUMED=[gate('failed',[FAILED],passed=False,pid=2000),latest]
if mode=='tampered_gate':(latest/'preservation.json').write_text(json.dumps(dict(passed=True,extra=1)))
current=dict(entries)
if mode in ['gate_drift','not_invoked']:
    del current[REUSED+'/Cookies'];current.update({REUSED:dict(mode=16832,mtimeNs=2),REUSED+'/Preferences':dict(sha256='new'),NEW:dict(mode=16832),NEW+'/Preferences':dict(sha256='new')})
drift=dict(drift=('p/Preferences',dict(sha256='drifted')),unrecorded=(OTHER+'/Preferences',dict(sha256='new')),failed_drift=(FAILED+'/Preferences',dict(sha256='new')),
           lock_drift=(REUSED+'.lock',dict(sha256='rewritten')),active_drift=(ACTIVE+'/Preferences',dict(sha256='drifted')))
if mode in drift:current[drift[mode][0]]=drift[mode][1]
# Real historical locks, including the retained stale lock, through the real lock checks.
HISTORICAL=['e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf.lock',REUSED+'.lock']
(profiles/HISTORICAL[0]).write_bytes(b'4303');(profiles/HISTORICAL[1]).write_bytes(b'7')
(base/'locks.json').write_text(json.dumps([dict(path='x/'+n,**real.lock_fields(profiles/n)) for n in HISTORICAL]))
real.PROFILES,real.LOCK_HISTORY,real.LOCK_COUNT=profiles,base/'locks.json',2;real.historical_pids=lambda:[]
# NEW was recorded by the passing gate with worker PID 1001; FAILED only by the failed gate (2000).
locks=dict(gate_lock=(NEW,b'1001'),lock_entry_only=None,lock_unrecorded=(OTHER,b'1001'),lock_failed_gate=(FAILED,b'2000'),lock_pid_mismatch=(NEW,b'4242'),
           lock_bytes=(NEW,b'1001\\n'),direct_unaccounted=(NEW,b'1001'),lock_owner_alive=(NEW,b'1001'),lock_owner_reappeared=(NEW,b'1001'))
if mode in locks and locks[mode]:(profiles/(locks[mode][0]+'.lock')).write_bytes(locks[mode][1])
if mode=='lock_guard':(profiles/(NEW+'.lock.reclaim')).write_bytes(b'')
if mode=='lock_symlink':os.symlink('elsewhere',profiles/(NEW+'.lock'))
if mode=='historical_lock_removed':(profiles/HISTORICAL[1]).unlink()
if mode in ['gate_lock','lock_entry_only']:current[NEW+'.lock']=dict(sha256='gate-lock')
running={1:dict(parent=0,group=1,command='/sbin/launchd')};rows=[]
def process_rows():
    rows.append(1);alive=mode=='lock_owner_alive' or (mode=='lock_owner_reappeared' and len(rows)>1)
    return {**running,**({1001:dict(parent=1,group=1001,command='unrelated')} if alive else {})}
calls=[]
obs=types.SimpleNamespace(PROFILES=profiles,PROFILE=ACTIVE,preflight=lambda:dict(passed=mode!='not_idle',status='idle' if mode!='not_idle' else 'historical_profiles_active'),
    processes=lambda:calls.append('processes') if mode!='reappeared' else (_ for _ in ()).throw(AssertionError('Historical PID present')),
    LOCK_HISTORY=real.LOCK_HISTORY,lock_fields=real.lock_fields,process_rows=process_rows,
    worker_locks=lambda accounted=frozenset():(calls.append('locks'),real.worker_locks(accounted)),singleton=lambda:calls.append('singleton'),
    fingerprint=lambda:fingerprint(current))
a.module=lambda name,filename:obs
# The observation auditor's own exact-set check backs up gate_locks.
if mode.startswith('direct_'):
    try:real.worker_locks(frozenset() if mode=='direct_unaccounted' else {HISTORICAL[1]});print(json.dumps(dict(passed=True)))
    except Exception as error:print(json.dumps(dict(passed=False,error=str(error))))
    sys.exit(0)
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
 for(const mode of ['twice','invoked','consumed0','consumed1']){const r=audit(mode,'capture');assert.equal(r.passed,false,mode);}

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
 assert.equal(holds.gateProfiles,2);assert.equal(holds.gateChangedEntries,0);assert.equal(holds.gateLocks,0);
 // A lock left by the passing gate's crash scenarios, holding that profile's recorded PID with its owner gone, is accounted.
 const gateLock=baselineCheck('gate_lock');
 assert.equal(gateLock.passed,true);assert.equal(gateLock.gateLocks,1);assert.equal(gateLock.gateChangedEntries,1);assert.equal(gateLock.gateChangedProfiles,0);
 // Drift confined to profiles recorded by a consumed gate whose audits passed is accounted for.
 const accounted=baselineCheck('gate_drift');
 assert.equal(accounted.passed,true);assert.equal(accounted.gateChangedProfiles,2);assert.equal(accounted.gateChangedEntries,5);
 for(const [mode,error] of [['drift','Profiles changed since the baseline'],['unrecorded','Profiles changed since the baseline'],
  ['failed_drift','Profiles changed since the baseline'],['not_invoked','Profiles changed since the baseline'],['lock_drift','Profiles changed since the baseline'],
  ['active_drift','Profiles changed since the baseline'],['active_record','Unexpected gate profile record'],['outside_record','Unexpected gate profile record'],
  ['lock_record','Unexpected gate profile record'],['tampered_gate','Gate audit evidence changed'],['count_mismatch','Gate audit evidence changed'],
  ['not_idle','Profiles are not idle'],['unpublished','Baseline not published'],
  ['tampered','Baseline fingerprint changed'],['reappeared','Historical PID present'],
  ['lock_entry_only','Profiles changed since the baseline'],['lock_unrecorded','Worker locks/guards added or removed'],
  ['lock_failed_gate','Worker locks/guards added or removed'],['lock_guard','Worker locks/guards added or removed'],
  ['lock_pid_mismatch','Unaccounted worker lock'],['lock_bytes','Unaccounted worker lock'],['lock_owner_alive','Gate worker lock owner present'],
  ['lock_owner_reappeared','Gate worker lock owner present'],['lock_symlink','Unsafe worker lock'],
  ['historical_lock_removed','Worker locks/guards added or removed'],['direct_unaccounted','Worker locks/guards added or removed'],
  ['direct_historical','Worker locks/guards added or removed']]){
  assert.deepEqual(baselineCheck(mode),{passed:false,error},mode);
 }

 // The fixed scope covers every local database and the October 14 protected bases.
 const source=readFileSync(auditPath,'utf8');
 assert.match(source,/DATABASE_BASES=\[Path\('\.wrangler\/state'\),Path\('\.sites-runtime'\)\]/);
 assert.match(source,/root=Path\('\.sites-runtime\/po-cart-workers\/full-offline-acceptance-task-20261024'\)/);
 assert.match(source,/CONSUMED=\[Path\('\.sites-runtime\/po-cart-workers\/full-offline-acceptance-task-20261014'\),Path\('\.sites-runtime\/po-cart-workers\/full-offline-acceptance-task-20261021'\),\n {10}Path\('\.sites-runtime\/po-cart-workers\/full-offline-acceptance-task-20261022'\)\]/);
 assert.doesNotMatch(source,/sqlite3\.connect\(/);
 // Only fixed operations run, never optimized.
 const invalid=spawnSync('python3',[auditPath,'--root','x'],{encoding:'utf8',cwd:sandbox});
 assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Only fixed capture\/before\/finish/);
 const optimized=spawnSync('python3',['-O',auditPath,'capture'],{encoding:'utf8',cwd:sandbox});
 assert.notEqual(optimized.status,0);assert.match(optimized.stderr,/Optimized gate audit execution is not accepted/);
 assert.deepEqual(gateListing(),gateBefore,'Real gate roots changed');
 console.log('PASS full gate audit: complete database capture, WAL copies, classified additions, historical-loss refusal and baseline pre-check with gate-recorded profiles and accounted gate worker locks; no real root written.');
}finally{
 rmSync(sandbox,{recursive:true,force:true});
}
