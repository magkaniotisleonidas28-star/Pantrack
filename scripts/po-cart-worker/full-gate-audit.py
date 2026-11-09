"""Independent read-only preservation audit; never emits business rows or secrets."""
import json,hashlib,sqlite3,collections,os,re,sys,subprocess,importlib.util
from pathlib import Path
root=Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261109')
# Consumed gate roots stay retained; one whose final audits all passed accounts for the profiles it recorded.
CONSUMED=[Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261022'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261024'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261025'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261027'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261031'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261101'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261104'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261105'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261108')]
GATE_AUDITS=['credentialsRevoked','cleanupVerified','preservationVerified','evidenceVerified','consumptionVerified','passed']
# Owner-reviewed gates whose only failed audit was database preservation, for a cause unrelated to
# browser profiles: their exact final-audit.json and preservation.json hashes.
PRESERVATION_REVIEWED={'.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261027':
                       ('0de11404a0118a9ac446aee4540dfc22f35468450b2ae0a00ec9623658492c37','1887d51e17ec5e3b5443e609679f3feb57e5586e73055ace6d799d6aa472d0b2')}
# Owner-reviewed profiles changed outside any gate on 2026-11-04 (the paid matrix and offline checks of its
# follow-up, one reusing a historical name) and the one 2026-11-09 paid-matrix profile: the exact fingerprint
# of every entry under each.
PROFILES_REVIEWED={
                   '0aa12d101f3f64d251934fc0f0b422651822551b34cf9586761d50ee2bdadaad':'0b9151af046811c808bc3cf1568fb7c134cabb7f2ac4d95a9fff8cb5a52beb55',
                   '1720e08ab735e9292230068d5685cce1dea9cba3dc4c725875d8595975d0a544':'b577a238e5875cd243af1f8c1814d5ee4c510b1734d181308563752c2e447bef',
                   '177f2428ecb5cecd61acd35e12fcd3e3d53cc91a0130f2f06ece51bccc789d75':'68a23884b340e6b05bb4ec3e03a051f25298dd9e037586f9ff8c65736a8c618e',
                   '17d046dd06c2dccc59f8b71c87a612c249b24349df43ad460538ed751ebc086c':'26bb27f2ab602c67a58158ca548f7224ba67d3c48df533e712821dfa549412d6',
                   '196416d26183b913bb58b3223491fdd96f8e1db37c0a0fd489a4686bb258eed7':'9b8665b89c6c1fc2c8d188c891a05099b4dc9757c0236db12e10b313aab39ed3',
                   '2d2ce509e74ff4653195f6c3ba1974551860dd55cc3078e00c8b766f02612bca':'9cbe82e1c36950d257c586a523d60c0c8ddafdb51c328f7fe608333a74829e73',
                   '3043a51412e47d90740e45496dbb1544e56d4e29a539f9ae20c2c27be5005a04':'e05068fb7f0ae1f7b9a8b3ee9ef85c78f055fc7c56e2cfd54970937f54bfbb99',
                   '31fe1771aff9f6f7f2cd0947b7fc5a9d869e2c00f882021befddf1d172af5e91':'78581ccde3a10989a8266b213b5191f6e311371d1883b15ee6c6f729359ed08d',
                   '3c71043b35d7263eda16d1fadf46b5e8a884deed77348c285ae35a1a42b1dd8c':'8996867ba51135a75bfc963bec15412503a45f45740a2860d7a8c04d6b7d666d',
                   '47e700bc70ac9e4b138b5514da954e157d977a66caaaf885130b25e3fc546d12':'944cdd06b10bbdb961bb1a71e1c40ddb8fe1879df2f0617c664ff4cb2ce39f2a',
                   '52e99e1938cf92f6aec083f183925be7debc486e8d3dfcc5f1ff769d825aeb28':'b473d033b7c4722bdf1eb5b576da2507ef47e2da56047ad4cce7cdc3c93b25e7',
                   '54ac7496e0282ceee47e7d2d9d18391d4d29d6fe06dbc1530e3796662934f8ae':'99119b57ca4e69676b031338f5fcc596c443c20e05bcb4c19ebdd23d064d9699',
                   '61dae016bfee50fc2a7d269311ae9bfe523fcd9db42a6064470c87eb7f4c9711':'163df684e74a5a52244dc356bfda63f822e27523132ed5a2e3d461b9e9b1fdfc',
                   '6e49c9b00b1c059fc7865b4302caff05385da4166c54b9f90395d9e76b56f7c0':'a34584e54d1d81d0b97f2ecf34e54a47d9c9289722486f5faafe9e30a36ad24a',
                   '76e48fa3b7fbdbccc67c6b8c6d7864f2b7bbeae566e12fac9fbe3bcb93478c21':'e85528e46edd15a32d977075aaa2820fa6d44d3522198ef3f4e76b97a7d5276d',
                   '8511524c20c01acf02f8fee29aa72c25dcea5bd1af15586a7b1d6d1e7aae349d':'82a8ab0397dae43c794e24cef4851318dbd7a828db0a5b1eaa10a84e595dca9a',
                   '861c3bbd96d520b8c92765b481434467280a909cf42dd5bf2dde88a2425d0556':'304e00d63c98b6b2118ec23756912264e1406b55942b323f41930f2b1d9cbeb9',
                   '9c2d1d55139564c573d1b19573db2b85f87debb5fb92d4504f82329b46636aea':'fc77f1e9f09558f07455d477fc28c2f7620a3157d016c84289677703bb785421',
                   '9f985ac28ac948eab1a47e2a8515b80136ae4d651715e200b9e6b53e46433996':'f4497cc4f04f529c7251b60c5d70c6b5e9cdbfabe97726379da83108ee61a84d',
                   'a5c664e64e672b3d6e3e5af2e4edb13d233baeef347887ebda3d8d9b1166bef7':'497f46c9132ebefd5da5259e62c0deb3d749e4d07443e572bf970f88cbde9773',
                   'a7328e86fe57c6e58ff2074beeb05cacb19682e5b480192e948956939874748f':'3e7c875ec3af4016d2bb7b16b4b587d0ae3061906ab5c10f079a63f1a2f0cf18',
                   'ab8c355cdfb3e67c15fb92726d66bdafb7452fa558f4b5dd65c97fb5b69d2e54':'36081aeafd8732b394cca5fe6fa497e1554cb5c7532ca90c4b3e11dfe78401af',
                   'b1bffe93adf9b7a4e8ce775d94bd2f8efba985873eacb65b4bb0273b428cc257':'395198203c894fe9068afb7ac9f15fd27bd4bf3f9dee7923525fc515b1ea80b4',
                   'ca73a2093e11c46b9c1e38e2c1c6d777b8f7d62976efb42f8b5bae73bcca0478':'81612d4e4fc4c6f9ea14ecf369698d0da36dc99011c6a3fc979527e2ab4c2805',
                   'cbddc56228a8baed55bd71242ba201f408a10ade5c512ba3bd036dd9a259dca2':'26755f852ab5ab8ff09bdc6ee89c10fc904757bc540c2ea8bdd93cdbe3e435c2',
                   'da24fc3cbb045889135477f7103c6080a19d9fbaac7149a3ab367384d401a75e':'814d63e001606f50059973e46fe5923caf3420a654b800bdb2f9649f79c2af6d',
                   'dbcd9c5546335ddc8075142075888cca751976c332aa7b28db594ee51416c281':'cef8d11d86a8bd1f9d1db2bc852fa251f7c25f6809d41df2190cb1d50b41b50d',
                   'e19708d53a770e7f8705add119aad1b845545979d27d6f16b6e0992f12eff8be':'7819655d7623e8c81a1c396c57e6cc17dcc6223633d5c8ef9c6ed64016790661',
                   'ea5675a34231122696f2cd705276a0d0fac37d9ee6e0977cad69d35fc51ebaef':'11d5b93a4de99df670a47b299a1598df6fc86d190cd51369b7c65858392cea6b',
                   'ed8ce108d8e98478a0381ee05dec5e2845e17cfc9a6bfadf6ea03e989c945ab0':'5092a377eb999a048e1910ece8bb56bd9208c794e81573f6ef52da8306bab699',
                   'fa5a2cdeb71a47fe76ef415e6415874d17e4b82467a948808372b718b29cc047':'c1ca9732be9aab235a7663dd9f473bdeada99b05f605a6b57f340c0a5eb7fcfd'}
# Owner-reviewed historical locks removed during G11 on 2026-11-09, when its checks' profile names matched
# October profiles (a recycled random port) and reclaimed their stale locks: accepted only while absent.
REMOVED_HISTORICAL_LOCKS=frozenset(['5caa81aa652a6f95175164c4fcf9fcb7c233822adb8b3ef19b7409783c38766c.lock',
                                    '9d2a3df075ad7c3e6b231b97532c8a8f324105bafefd9e82a24c219fa43c9c6f.lock',
                                    'ceb5e52a45c32cf937a818f56ac093af26263f8bc0868c27862c54f7487db32b.lock'])
# Every local database is captured, including cart-review and other review states.
DATABASE_BASES=[Path('.wrangler/state'),Path('.sites-runtime')]
PROTECTED_BASES=[Path('.sites-runtime/po-cart-workers'),Path('.sites-runtime/cart-ai-budget'),Path('.sites-runtime/cart-ai-evaluation')]
PROTECTED_EXTRA=[Path('.sites-runtime/cart-browser-results.json'),Path('.sites-runtime/cart-ai-evaluation/state.json')]
BASELINE=Path('.sites-runtime/po-cart-workers/observation-baseline-task-20261021')
# The gate migrates these local states (db:migrate:local and the cart preview). Capture and the
# pre-check refuse one missing a migration, so no upgrade rewrites captured rows inside the run.
MIGRATED_STATES=[Path('.wrangler/state'),Path('.sites-runtime/cart-review-state')]
MIGRATIONS=Path('drizzle')
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
def schema_current():
 expected=sorted(p.name for p in MIGRATIONS.glob('*.sql'))
 for base in MIGRATED_STATES:
  found=0
  for p in sorted(base.rglob('*.sqlite')):
   c=legacy.open_readonly(p)
   try:
    if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations'").fetchone():
     found+=1;assert sorted(r[0] for r in c.execute('SELECT name FROM d1_migrations'))==expected,'Gate database missing migrations'
   finally:c.close()
  assert expected and found,'Gate database missing migrations'
def capture():
 assert all(root.resolve()!=c.resolve() for c in CONSUMED) and root.is_dir() and not os.path.lexists(root/'task.json'),'Gate root not prepared or already invoked'
 schema_current()
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
def reviewed(gate,audits):
 """The gate's only failed audit is preservation, and both audit files are exactly the owner-reviewed ones."""
 pinned=PRESERVATION_REVIEWED.get(str(gate))
 return pinned is not None and audits.get('preservationVerified') is False and audits.get('passed') is False and \
  all(audits.get(k) is True for k in GATE_AUDITS if k not in ['preservationVerified','passed']) and \
  (filehash(gate/'final-audit.json'),filehash(gate/'preservation.json'))==pinned
def profile_digest(entries,name):
 return digest(json.dumps({k:v for k,v in entries.items() if k==name or k.startswith(name+'/')},sort_keys=True,separators=(',',':')).encode())
def gate_profiles(obs):
 """Profile directories, with their recorded worker PIDs, from consumed gates whose retained final audits all passed,
 or whose only failed audit is an owner-reviewed preservation failure."""
 names={}
 for gate in CONSUMED:
  audits=json.loads((gate/'final-audit.json').read_text()) if (gate/'task.json').is_file() and (gate/'final-audit.json').is_file() else {}
  # A gate without complete passing audits accounts for nothing unless reviewed; its profiles must stay exact.
  accepted=reviewed(gate,audits)
  if not (all(audits.get(k) is True for k in GATE_AUDITS) or accepted):continue
  for ref in audits['references']:
   assert Path(ref['path']).parent.resolve()==gate.resolve() and filehash(ref['path'])==ref['sha256'],'Gate audit evidence changed'
  process=json.loads((gate/'process-audit.json').read_text());preservation=json.loads((gate/'preservation.json').read_text())
  records=sorted((gate/'profiles').glob('*.json')) if (gate/'profiles').is_dir() else []
  assert process['passed'] is True and process['profilesClear'] is True and (preservation['passed'] is True or accepted) and process['profiles']==len(records),'Gate audit evidence changed'
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
 schema_current()
 obs=module('gate_observation_audit','observation-baseline-audit.py')
 report=json.loads((BASELINE/'report.json').read_text());summary=json.loads((BASELINE/'verification-summary.json').read_text())
 fresh=json.loads((BASELINE/'fresh-baseline.json').read_text());second=json.loads((BASELINE/'profiles-stability-second.json').read_text())
 assert report['status']=='complete' and report['passed'] is True and summary['passed'] is True and summary['baselinePublished'] is True,'Baseline not published'
 expected=digest(json.dumps(second['entries'],sort_keys=True,separators=(',',':')).encode())
 assert second['sha256']==expected==fresh['profiles']['sha256'],'Baseline fingerprint changed'
 preflight=obs.preflight();assert preflight['passed'] is True and preflight['status']=='idle','Profiles are not idle'
 gates=gate_profiles(obs);locks=gate_locks(obs,gates);removed=REMOVED_HISTORICAL_LOCKS
 obs.processes();obs.worker_locks(locks,removed);obs.singleton()
 current=obs.fingerprint()
 changed=sorted(k for k in current['entries'].keys()|second['entries'].keys() if current['entries'].get(k)!=second['entries'].get(k))
 # An owner-reviewed profile is accounted only while every entry under it is exactly as pinned.
 reviewed_profiles={n for n,pin in PROFILES_REVIEWED.items() if n!=obs.PROFILE and profile_digest(current['entries'],n)==pin}
 # Only entries inside a passing gate's recorded profile directories or a reviewed profile, and
 # that gate's accounted new lock files, may differ, and a reviewed removed lock may be absent;
 # other historical locks, the active profile and every other profile stay exact.
 assert all(k.split('/')[0] in gates or k.split('/')[0] in reviewed_profiles or (k in locks and k not in second['entries']) or
            (k in removed and k not in current['entries']) for k in changed),'Profiles changed since the baseline'
 assert gate_locks(obs,gates)==locks,'Worker locks changed during the check'
 obs.processes();obs.worker_locks(locks,removed);obs.singleton()
 return dict(passed=True,baseline=fresh['profiles']['sha256'],profileEntries=len(current['entries']),gateProfiles=len(gates),gateChangedEntries=len(changed),gateLocks=len(locks),
             gateChangedProfiles=len({k.split('/')[0] for k in changed if k not in locks}),reviewedProfiles=len(reviewed_profiles),removedLocks=len(removed),preflight='idle',workerLocks=46-len(removed))
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
