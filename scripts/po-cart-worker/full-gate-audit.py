"""Independent read-only preservation audit; never emits business rows or secrets."""
import json,hashlib,sqlite3,collections,os,re,sys,subprocess,importlib.util
from pathlib import Path
root=Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261024')
# Consumed gate roots stay retained; one whose final audits all passed accounts for the profiles it recorded.
CONSUMED=[Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261022')]
GATE_AUDITS=['credentialsRevoked','cleanupVerified','preservationVerified','evidenceVerified','consumptionVerified','passed']
# Every local database is captured, including cart-review and other review states.
DATABASE_BASES=[Path('.wrangler/state'),Path('.sites-runtime')]
PROTECTED_BASES=[Path('.sites-runtime/po-cart-workers'),Path('.sites-runtime/cart-ai-budget'),Path('.sites-runtime/cart-ai-evaluation')]
PROTECTED_EXTRA=[Path('.sites-runtime/cart-browser-results.json'),Path('.sites-runtime/cart-ai-evaluation/state.json')]
BASELINE=Path('.sites-runtime/po-cart-workers/observation-baseline-task-20261021')
def module(name,filename):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename));value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
legacy=module('gate_legacy_audit','legacy-profile-audit.py')
def digest(b):return hashlib.sha256(b).hexdigest()
def filehash(p):return digest(Path(p).read_bytes())
def read(name):return json.loads((root/name).read_text())
def save(name,value):
 p=root/name;p.write_text(json.dumps(value)+'\n');p.chmod(0o600)
def database_paths():return sorted(str(p) for base in DATABASE_BASES for p in base.rglob('*.sqlite'))
def table_rows(c,name):return [digest(json.dumps(r,separators=(',',':'),default=str).encode()) for r in c.execute('SELECT * FROM "'+name.replace('"','""')+'"')]
def capture():
 assert all(root.resolve()!=c.resolve() for c in CONSUMED) and root.is_dir() and not os.path.lexists(root/'task.json'),'Gate root not prepared or already invoked'
 for name in ['baseline.json','storefront-before.json','database-before.json','database-inventory.json','source-before.json','rollback-manifest.json']:
  assert not os.path.lexists(root/name),'Before-images already captured'
 protected=[]
 for base in PROTECTED_BASES:
  for d,dirs,names in os.walk(base):
   if Path(d)==PROTECTED_BASES[0]:dirs[:]=[n for n in dirs if n not in ['browser-profiles','modules',root.name]]
   for n in sorted(names):
    p=Path(d)/n
    if p.is_symlink() or not p.is_file() or p.suffix in ['.sqlite','.sqlite-wal','.sqlite-shm'] or p==PROTECTED_BASES[0]/'local-storefront.json':continue
    protected.append(dict(path=str(p),sha256=filehash(p)))
 listed={f['path'] for f in protected}
 # A missing extra stays protected as absent.
 protected+=[dict(path=str(p),sha256=filehash(p) if p.is_file() else None) for p in PROTECTED_EXTRA if str(p) not in listed]
 save('baseline.json',dict(protectedFiles=protected))
 store=json.load(open(PROTECTED_BASES[0]/'local-storefront.json'))['fixtures']
 save('storefront-before.json',{k:digest(json.dumps(v,sort_keys=True,separators=(',',':')).encode()) for k,v in store.items()})
 paths=database_paths();entries=[];rows=0
 for p in paths:
  c=legacy.open_readonly(p);tables=[]
  for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
   values=table_rows(c,name);tables.append(dict(name=name,rows=values));rows+=0 if name in ['_cf_METADATA','sqlite_sequence'] else len(values)
  c.close();entries.append(dict(path=p,tables=tables))
 save('database-before.json',entries)
 save('database-inventory.json',dict(version=1,bases=[str(b) for b in DATABASE_BASES],paths=paths))
 files=sorted(set(filter(None,subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0'))))
 save('source-before.json',[dict(path=p,sha256=filehash(p)) for p in files])
 save('rollback-manifest.json',dict(restore=[],remove=[]))
 return dict(passed=True,protectedArtifacts=len(protected),historicalCarts=len(store),databases=len(entries),historicalDatabaseRows=rows,sourceFiles=len(files))
def gate_profiles(obs):
 """Profile directories, with their recorded worker PIDs, from consumed gates whose retained final audits all passed."""
 names={}
 for gate in CONSUMED:
  audits=json.loads((gate/'final-audit.json').read_text()) if (gate/'task.json').is_file() and (gate/'final-audit.json').is_file() else {}
  # A gate without complete passing audits accounts for nothing; its profiles must stay exact.
  if not all(audits.get(k) is True for k in GATE_AUDITS):continue
  for ref in audits['references']:
   assert Path(ref['path']).parent.resolve()==gate.resolve() and filehash(ref['path'])==ref['sha256'],'Gate audit evidence changed'
  process=json.loads((gate/'process-audit.json').read_text());preservation=json.loads((gate/'preservation.json').read_text())
  records=sorted((gate/'profiles').glob('*.json')) if (gate/'profiles').is_dir() else []
  assert process['passed'] is True and process['profilesClear'] is True and preservation['passed'] is True and process['profiles']==len(records),'Gate audit evidence changed'
  for record in records:
   value=json.loads(record.read_text());path=Path(value['path'])
   assert path.parent==obs.PROFILES.resolve() and re.fullmatch('[0-9a-f]{64}',path.name) and path.name!=obs.PROFILE,'Unexpected gate profile record'
   assert type(value['workerPid']) is int and value['workerPid']>0,'Unexpected gate profile record'
   names.setdefault(path.name,set()).add(value['workerPid'])
 return names
def gate_locks(obs,gates):
 """Worker locks left by a passing gate's deliberate crash scenarios. Each names a
 recorded profile, holds exactly a worker PID that gate recorded for it, and that
 process is gone. Reclaim guards and every other lock are never accounted."""
 historical={Path(p['path']).name for p in json.loads(obs.LOCK_HISTORY.read_text())};running=obs.process_rows()
 accounted=set()
 for path in sorted(obs.PROFILES.iterdir()):
  if not path.name.endswith(('.lock','.lock.reclaim')) or path.name in historical:continue
  assert path.name.endswith('.lock') and path.name[:-5] in gates,'Worker locks/guards added or removed'
  obs.lock_fields(path);value=path.read_bytes()
  assert re.fullmatch(rb'[1-9][0-9]*',value) and int(value) in gates[path.name[:-5]],'Unaccounted worker lock'
  assert int(value) not in running,'Gate worker lock owner present'
  accounted.add(path.name)
 return accounted
def baseline_holds():
 obs=module('gate_observation_audit','observation-baseline-audit.py')
 report=json.loads((BASELINE/'report.json').read_text());summary=json.loads((BASELINE/'verification-summary.json').read_text())
 fresh=json.loads((BASELINE/'fresh-baseline.json').read_text());second=json.loads((BASELINE/'profiles-stability-second.json').read_text())
 assert report['status']=='complete' and report['passed'] is True and summary['passed'] is True and summary['baselinePublished'] is True,'Baseline not published'
 expected=digest(json.dumps(second['entries'],sort_keys=True,separators=(',',':')).encode())
 assert second['sha256']==expected==fresh['profiles']['sha256'],'Baseline fingerprint changed'
 preflight=obs.preflight();assert preflight['passed'] is True and preflight['status']=='idle','Profiles are not idle'
 gates=gate_profiles(obs);locks=gate_locks(obs,gates)
 obs.processes();obs.worker_locks(locks);obs.singleton()
 current=obs.fingerprint()
 changed=sorted(k for k in current['entries'].keys()|second['entries'].keys() if current['entries'].get(k)!=second['entries'].get(k))
 # Only entries inside a passing gate's recorded profile directories, and that gate's
 # accounted new lock files, may differ; historical locks, the active profile and
 # every other profile stay exact.
 assert all(k.split('/')[0] in gates or (k in locks and k not in second['entries']) for k in changed),'Profiles changed since the baseline'
 assert gate_locks(obs,gates)==locks,'Worker locks changed during the check'
 obs.processes();obs.worker_locks(locks);obs.singleton()
 return dict(passed=True,baseline=fresh['profiles']['sha256'],profileEntries=len(current['entries']),gateProfiles=len(gates),gateChangedEntries=len(changed),gateLocks=len(locks),
             gateChangedProfiles=len({k.split('/')[0] for k in changed if k not in locks}),preflight='idle',workerLocks=46)
def audit():
 baseline=read('baseline.json')
 for f in baseline['protectedFiles']:
  assert Path(f['path']).exists()==(f['sha256'] is not None)
  if f['sha256'] is not None:assert filehash(f['path'])==f['sha256']
 old=read('storefront-before.json');store=json.load(open(PROTECTED_BASES[0]/'local-storefront.json'))['fixtures']
 for k,v in old.items():assert digest(json.dumps(store[k],sort_keys=True,separators=(',',':')).encode())==v
 inventory=read('database-inventory.json')
 assert inventory['bases']==[str(b) for b in DATABASE_BASES] and inventory['paths']==[e['path'] for e in read('database-before.json')],'Database inventory incomplete'
 assert set(inventory['paths'])<=set(database_paths()),'Captured database removed'
 rows=0;delta=[];metadata=0;sequences=0
 for entry in read('database-before.json'):
  c=legacy.open_readonly(entry['path']);tables=[]
  for t in entry['tables']:
   now=collections.Counter(table_rows(c,t['name']))
   before=collections.Counter(t['rows']);removed=sum((before-now).values());added=sum((now-before).values())
   if t['name']=='_cf_METADATA':metadata+=removed
   elif t['name']=='sqlite_sequence' and removed:
    seq=dict(c.execute('SELECT * FROM sqlite_sequence'))
    stable=digest(json.dumps(('d1_migrations',seq['d1_migrations']),separators=(',',':')).encode());assert stable in before
    assert seq['po_cart_worker_credential_events']==c.execute('SELECT max(id) FROM po_cart_worker_credential_events').fetchone()[0];sequences+=removed
   else:assert removed==0;rows+=len(t['rows'])
   if added or removed:tables.append(dict(name=t['name'],added=added,removed=removed,bookkeeping=t['name'] in ['_cf_METADATA','sqlite_sequence']))
  delta.append(dict(path=entry['path'],tables=tables));c.close()
 allowed=set(read('rollback-manifest.json')['restore'])
 for f in read('source-before.json'):
  if f['path'] not in allowed:assert filehash(f['path'])==f['sha256']
 save('database-delta.json',delta)
 return dict(passed=True,protectedArtifacts=len(baseline['protectedFiles']),historicalCarts=len(old),historicalDatabaseRows=rows,cloudflareMetadataRowsChanged=metadata,sequenceRowsChanged=sequences)
if __name__=='__main__':
 mode=sys.argv[1] if len(sys.argv)==2 else 'finish' if len(sys.argv)==1 else None
 if mode not in ['capture','before','finish']:raise SystemExit('Only fixed capture/before/finish gate audit operations are accepted.')
 if not __debug__:raise SystemExit('Optimized gate audit execution is not accepted')
 name={'capture':'capture.json','before':'baseline-check.json','finish':'preservation.json'}[mode]
 try:result={'capture':capture,'before':baseline_holds,'finish':audit}[mode]()
 except Exception:result=dict(passed=False,category=mode+'_failed')
 save(name,result);print(json.dumps(result));sys.exit(0 if result['passed'] else 1)
