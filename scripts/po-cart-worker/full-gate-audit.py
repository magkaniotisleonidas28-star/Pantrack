"""Independent read-only preservation audit; never emits business rows or secrets."""
import json,hashlib,sqlite3,collections,os,re,sys,subprocess,importlib.util
from pathlib import Path
root=Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261114')
# Consumed gate roots stay retained; one whose final audits all passed accounts for the profiles it recorded.
CONSUMED=[Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261022'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261024'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261025'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261027'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261031'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261101'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261104'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261105'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261108'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261109'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261110'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261111'),Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261112'),
          Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261113')]
GATE_AUDITS=['credentialsRevoked','cleanupVerified','preservationVerified','evidenceVerified','consumptionVerified','passed']
# Owner-reviewed gates whose only failed audit was database preservation, for a cause unrelated to
# browser profiles: their exact final-audit.json and preservation.json hashes.
PRESERVATION_REVIEWED={'.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261027':
                       ('0de11404a0118a9ac446aee4540dfc22f35468450b2ae0a00ec9623658492c37','1887d51e17ec5e3b5443e609679f3feb57e5586e73055ace6d799d6aa472d0b2')}
# Owner-reviewed profiles changed outside any gate on 2026-11-04 (the paid matrix and offline checks of its
# follow-up, one reusing a historical name), the one profile of each 2026-11-09 paid matrix, the six of the
# first 2026-11-10 paid matrix, the twelve of the second, the one of the first 2026-11-12 matrix and the two
# of the second: the exact fingerprint of every entry under each.
PROFILES_REVIEWED={
                   '0aa12d101f3f64d251934fc0f0b422651822551b34cf9586761d50ee2bdadaad':'0b9151af046811c808bc3cf1568fb7c134cabb7f2ac4d95a9fff8cb5a52beb55',
                   '0eb0f1b6f6338bc2019cdfcc4ffabe61bd33caf1922bb2220a5d1c59fad2782f':'c82aa612da7177db398124b130abf8691576b73fe5f41f81f2f61ddf3d55b4c0',
                   '0f7ee92fd12861d826a02827e13f28b2b44d402e583b304edc82068da72c0dcf':'a79a1594ffd5a85a5581bb0d109879c79a32f040877fe6e8e4107c18a721a955',
                   '1720e08ab735e9292230068d5685cce1dea9cba3dc4c725875d8595975d0a544':'b577a238e5875cd243af1f8c1814d5ee4c510b1734d181308563752c2e447bef',
                   '177f2428ecb5cecd61acd35e12fcd3e3d53cc91a0130f2f06ece51bccc789d75':'68a23884b340e6b05bb4ec3e03a051f25298dd9e037586f9ff8c65736a8c618e',
                   '17d046dd06c2dccc59f8b71c87a612c249b24349df43ad460538ed751ebc086c':'26bb27f2ab602c67a58158ca548f7224ba67d3c48df533e712821dfa549412d6',
                   '196416d26183b913bb58b3223491fdd96f8e1db37c0a0fd489a4686bb258eed7':'9b8665b89c6c1fc2c8d188c891a05099b4dc9757c0236db12e10b313aab39ed3',
                   '2d2ce509e74ff4653195f6c3ba1974551860dd55cc3078e00c8b766f02612bca':'9cbe82e1c36950d257c586a523d60c0c8ddafdb51c328f7fe608333a74829e73',
                   '2e8c27ee227e99c5287e33d779a2d0df5de1d3b62f6420c0090ef85646c61679':'7772ce6e51dc5c0baa203af6d3a74f7e0ce2237bd02fb76b99b235b8e5e1900f',
                   '3043a51412e47d90740e45496dbb1544e56d4e29a539f9ae20c2c27be5005a04':'e05068fb7f0ae1f7b9a8b3ee9ef85c78f055fc7c56e2cfd54970937f54bfbb99',
                   '31fe1771aff9f6f7f2cd0947b7fc5a9d869e2c00f882021befddf1d172af5e91':'78581ccde3a10989a8266b213b5191f6e311371d1883b15ee6c6f729359ed08d',
                   '3c71043b35d7263eda16d1fadf46b5e8a884deed77348c285ae35a1a42b1dd8c':'8996867ba51135a75bfc963bec15412503a45f45740a2860d7a8c04d6b7d666d',
                   '3dd8eff74cdbff8030bff831f4cdaa2f75488633f15ba346697c02ed1f3ab161':'f7b0cccca5365753750a6494b07127c4c6e2bdcdadc6c3144ce950d4d8ca4bfa',
                   '3f8c2017821b28fdb81c0d813b41466ec5bac846c3c14f10b374bc210b13ed24':'caf6776a4d1dfbfdffaa4da71019fe6d668998da4f4dfd8b45dd210da1cccff7',
                   '47e700bc70ac9e4b138b5514da954e157d977a66caaaf885130b25e3fc546d12':'944cdd06b10bbdb961bb1a71e1c40ddb8fe1879df2f0617c664ff4cb2ce39f2a',
                   '4b41e19802bedefdc6b2fc430aec236c45527a3c76343376508176e3950fb40d':'33633f42bef0bb41aa243982e44b7721d03cb40c6d48fc83b5ca062376cdbd70',
                   '52aa164fade77cf17fdb2cdfd655dd083e3370ec99997586320224b75343d2c1':'69cbbed638c7db189a6deae97e459c900a827488642a0f06f3c6b6717ba9f84c',
                   '52e99e1938cf92f6aec083f183925be7debc486e8d3dfcc5f1ff769d825aeb28':'b473d033b7c4722bdf1eb5b576da2507ef47e2da56047ad4cce7cdc3c93b25e7',
                   '549bbadfa622e6d10a68f067beb26c8fd67001092af48013f6462f90a3cd6d7e':'9869a3dcae2aceb03266fa8625ce777051f3c0f156f459ef8a2c7994788731ac',
                   '54ac7496e0282ceee47e7d2d9d18391d4d29d6fe06dbc1530e3796662934f8ae':'99119b57ca4e69676b031338f5fcc596c443c20e05bcb4c19ebdd23d064d9699',
                   '59e2f9c2e9877c95b8df54f9201ae1294b234234a4ab4fb9a5f973fbeea335fb':'e667cf8ca75f4bf74b334562e71c2d49a971e7af99e49e180a5e691368e64682',
                   '5d40ea666c9921a0716e67438ecfc51c3b35f0778a0f7a284ff219052bf5b867':'120840e7c92063a6b4fc23740e2b44ed82a9d7019eb927c6d3787e61333fa2e4',
                   '6025658c5456c74065db987856640d69ac8b2cd03484303b89b7d7b7f9e46674':'8c0a5413b13a07d61f99fb0321258f27980f0744f7d2ea55c33e5480315550a3',
                   '61dae016bfee50fc2a7d269311ae9bfe523fcd9db42a6064470c87eb7f4c9711':'163df684e74a5a52244dc356bfda63f822e27523132ed5a2e3d461b9e9b1fdfc',
                   '6e49c9b00b1c059fc7865b4302caff05385da4166c54b9f90395d9e76b56f7c0':'a34584e54d1d81d0b97f2ecf34e54a47d9c9289722486f5faafe9e30a36ad24a',
                   '76e48fa3b7fbdbccc67c6b8c6d7864f2b7bbeae566e12fac9fbe3bcb93478c21':'e85528e46edd15a32d977075aaa2820fa6d44d3522198ef3f4e76b97a7d5276d',
                   '7e722e20834e1b30a58c4bb717dd3f5d6dcbb45aaa904f1404f0db72f691f2d8':'b57872242507109c1e2fab93342ddedbfe391e4fdb12c548928628e381f6c765',
                   '82e4923137984e13d9921616cbae4dec5282bd0fd24d6b649ccba62925d7ff88':'d0c714f5c08fa9964072374fcaef90e1f53d98672dcc92e82f9170c943f87388',
                   '848b0c450cce24180941b75e29d5ee6f8aadbaae6ba688ffd28c0aade3384841':'4f6e2d575b86c831bf456fac7a711c5911a17ae76a6da72c83b09c54de4a4d17',
                   '8511524c20c01acf02f8fee29aa72c25dcea5bd1af15586a7b1d6d1e7aae349d':'82a8ab0397dae43c794e24cef4851318dbd7a828db0a5b1eaa10a84e595dca9a',
                   '861c3bbd96d520b8c92765b481434467280a909cf42dd5bf2dde88a2425d0556':'304e00d63c98b6b2118ec23756912264e1406b55942b323f41930f2b1d9cbeb9',
                   '8a1b4c471a76953cac109bee59f5d7ce78dcd8184339bb28acaba3f33ca71bb4':'b4426c0c8143c36f5b0f89e7daf7763daee980a0740efb7ceb906e5dc257b203',
                   '8e155d671d4e248e346669f31f3329b59759c00f19306ed13e4fb2d9333ed0f5':'bae0eb13a66160050d35b0491d0309cce0f4e1f5b42b40cda912b8503d451042',
                   '997b8a2e9ec3fe7be14c395ab5f94ec19ffc276dc2dcf8034f5a92bfd0f7f495':'e75e1833fb1b51352c7d8a2e3d1a9bbaa8f51d6f7cd533d15304a10d7cfc278e',
                   '9c2d1d55139564c573d1b19573db2b85f87debb5fb92d4504f82329b46636aea':'fc77f1e9f09558f07455d477fc28c2f7620a3157d016c84289677703bb785421',
                   '9f985ac28ac948eab1a47e2a8515b80136ae4d651715e200b9e6b53e46433996':'f4497cc4f04f529c7251b60c5d70c6b5e9cdbfabe97726379da83108ee61a84d',
                   'a5c664e64e672b3d6e3e5af2e4edb13d233baeef347887ebda3d8d9b1166bef7':'497f46c9132ebefd5da5259e62c0deb3d749e4d07443e572bf970f88cbde9773',
                   'a7328e86fe57c6e58ff2074beeb05cacb19682e5b480192e948956939874748f':'3e7c875ec3af4016d2bb7b16b4b587d0ae3061906ab5c10f079a63f1a2f0cf18',
                   'ab8c355cdfb3e67c15fb92726d66bdafb7452fa558f4b5dd65c97fb5b69d2e54':'36081aeafd8732b394cca5fe6fa497e1554cb5c7532ca90c4b3e11dfe78401af',
                   'af0c6745e4b3545093080a87fa10092d3b70c3d3b73a07c5a5782b37a43b1e0e':'631cb340fbb7edf1ecd05f6c2d7cfefb12735ba972db691155409ce30d3bbae7',
                   'b1bffe93adf9b7a4e8ce775d94bd2f8efba985873eacb65b4bb0273b428cc257':'395198203c894fe9068afb7ac9f15fd27bd4bf3f9dee7923525fc515b1ea80b4',
                   'b75115baa6ec90f53dc2805b218e27e4f4e4d0af43e5f280b83604520ce665b1':'54642cd6c6e6c50132e3db90593d6b9c043a541e276bd2a3cc285a71c1516ba8',
                   'ca73a2093e11c46b9c1e38e2c1c6d777b8f7d62976efb42f8b5bae73bcca0478':'81612d4e4fc4c6f9ea14ecf369698d0da36dc99011c6a3fc979527e2ab4c2805',
                   'cbddc56228a8baed55bd71242ba201f408a10ade5c512ba3bd036dd9a259dca2':'26755f852ab5ab8ff09bdc6ee89c10fc904757bc540c2ea8bdd93cdbe3e435c2',
                   'da24fc3cbb045889135477f7103c6080a19d9fbaac7149a3ab367384d401a75e':'814d63e001606f50059973e46fe5923caf3420a654b800bdb2f9649f79c2af6d',
                   'dbcd9c5546335ddc8075142075888cca751976c332aa7b28db594ee51416c281':'cef8d11d86a8bd1f9d1db2bc852fa251f7c25f6809d41df2190cb1d50b41b50d',
                   'e19708d53a770e7f8705add119aad1b845545979d27d6f16b6e0992f12eff8be':'7819655d7623e8c81a1c396c57e6cc17dcc6223633d5c8ef9c6ed64016790661',
                   'e4ca0840a2f0b4f566cb76c168e2f0058d5edd555c94063bc2a5146cd71bf558':'4fa3e407d0e951e8799fc82043082429273f12d3b26d9eb457ae9b1b9210df7a',
                   'ea5675a34231122696f2cd705276a0d0fac37d9ee6e0977cad69d35fc51ebaef':'11d5b93a4de99df670a47b299a1598df6fc86d190cd51369b7c65858392cea6b',
                   'eac316e64fc01ac338b0772cdb33e691a933735f3d99b537ded4d13a174a930e':'5d4b5eb32341fd6cdaabb7f2a8c71dde22af5e5b39a5164f9cf4edcc3a216d5a',
                   'ed8ce108d8e98478a0381ee05dec5e2845e17cfc9a6bfadf6ea03e989c945ab0':'5092a377eb999a048e1910ece8bb56bd9208c794e81573f6ef52da8306bab699',
                   'fa5a2cdeb71a47fe76ef415e6415874d17e4b82467a948808372b718b29cc047':'c1ca9732be9aab235a7663dd9f473bdeada99b05f605a6b57f340c0a5eb7fcfd',
                   'fed92a3b334d415882d7924f64eb4f9e1b0f47f54334009fa8ae538ef0843d03':'1b6e14b57b4af5801796048805c7fc8c8aaa97fea52a3d125d21160d78c9d1bc'}
# Owner-reviewed historical locks removed during G11 on 2026-11-09 and G13 and G14 on 2026-11-10, when their checks'
# profile names matched October profiles (a recycled random port) and reclaimed their stale locks: accepted
# only while absent.
REMOVED_HISTORICAL_LOCKS=frozenset(['5caa81aa652a6f95175164c4fcf9fcb7c233822adb8b3ef19b7409783c38766c.lock',
                                    '6df48a4bd9c4e1cf03b8caab8534b527875b9e7fd144662ac7ff518bb06f2fe7.lock',
                                    '9d2a3df075ad7c3e6b231b97532c8a8f324105bafefd9e82a24c219fa43c9c6f.lock',
                                    'b2f67b0c7da678430aeb811a6cc1c2b8e451d8edd827a63c691c30cafd501e9d.lock',
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
# Cloudflare-reserved tables are never queried: capture records only their names, from
# sqlite_master. Every other table keeps exact row preservation.
CAPTURE_VERSION=2
def reserved(name):return name.startswith('_cf_')
def table_names(c):return [n for (n,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
def snapshot_tables():
 """The application's table inventory: the latest migration snapshot."""
 latest=max(MIGRATIONS.glob('meta/*_snapshot.json'),default=None);assert latest,'Application snapshot missing'
 s=json.loads(latest.read_text());return {t['name'] for t in s['tables'].values()}
def table_rows(c,name):
 assert not reserved(name),'Reserved table read refused'
 return [digest(json.dumps(r,separators=(',',':'),default=str).encode()) for r in c.execute('SELECT * FROM "'+name.replace('"','""')+'"')]
def schema_current():
 expected=sorted(p.name for p in MIGRATIONS.glob('*.sql'))
 for base in MIGRATED_STATES:
  found=0
  for p in sorted(base.rglob('*.sqlite')):
   c=legacy.open_readonly(p)
   try:
    names=set(table_names(c))
    if 'd1_migrations' in names:
     found+=1;assert sorted(r[0] for r in c.execute('SELECT name FROM d1_migrations'))==expected,'Gate database missing migrations'
     # A migrated state holds exactly the application's tables, plus bookkeeping and reserved names.
     app=snapshot_tables();other={n for n in names-app if not reserved(n)}-{'d1_migrations','sqlite_sequence'}
     assert app<=names and not other,'Gate database tables differ from the application snapshot'
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
  for name in table_names(c):
   if reserved(name):tables.append(dict(name=name,reserved=True));continue
   values=table_rows(c,name);tables.append(dict(name=name,rows=values));rows+=0 if name=='sqlite_sequence' else len(values)
  c.close();entries.append(dict(path=p,tables=tables))
 save('database-before.json',dict(version=CAPTURE_VERSION,entries=entries))
 save('database-inventory.json',dict(version=CAPTURE_VERSION,bases=[str(b) for b in DATABASE_BASES],paths=paths))
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
 captured=read('database-before.json');inventory=read('database-inventory.json')
 # An older capture recorded reserved rows; it is never reinterpreted.
 assert isinstance(captured,dict) and captured.get('version')==CAPTURE_VERSION and inventory.get('version')==CAPTURE_VERSION,'Incompatible database capture'
 entries=captured['entries']
 assert inventory['bases']==[str(b) for b in DATABASE_BASES] and inventory['paths']==[e['path'] for e in entries],'Database inventory incomplete'
 assert set(inventory['paths'])<=set(database_paths()),'Captured database removed'
 rows=0;delta=[];reserved_tables=0;sequences=0
 for entry in entries:
  c=legacy.open_readonly(entry['path']);tables=[];names=set(table_names(c))
  for t in entry['tables']:
   if t.get('reserved'):
    assert reserved(t['name']) and t['name'] in names,'Captured database table removed';reserved_tables+=1;continue
   now=collections.Counter(table_rows(c,t['name']))
   before=collections.Counter(t['rows']);removed=sum((before-now).values());added=sum((now-before).values())
   if t['name']=='sqlite_sequence' and removed:
    seq=dict(c.execute('SELECT * FROM sqlite_sequence'))
    stable=digest(json.dumps(('d1_migrations',seq['d1_migrations']),separators=(',',':')).encode());assert stable in before
    assert seq['po_cart_worker_credential_events']==c.execute('SELECT max(id) FROM po_cart_worker_credential_events').fetchone()[0];sequences+=removed
   else:assert removed==0;rows+=len(t['rows'])
   if added or removed:tables.append(dict(name=t['name'],added=added,removed=removed,bookkeeping=t['name']=='sqlite_sequence'))
  delta.append(dict(path=entry['path'],tables=tables));c.close()
 allowed=set(read('rollback-manifest.json')['restore'])
 for f in read('source-before.json'):
  if f['path'] not in allowed:assert filehash(f['path'])==f['sha256']
 save('database-delta.json',delta)
 return dict(passed=True,protectedArtifacts=len(baseline['protectedFiles']),historicalCarts=len(old),historicalDatabaseRows=rows,reservedTablesUninspected=reserved_tables,sequenceRowsChanged=sequences)
if __name__=='__main__':
 mode=sys.argv[1] if len(sys.argv)==2 else 'finish' if len(sys.argv)==1 else None
 if mode not in ['capture','before','finish']:raise SystemExit('Only fixed capture/before/finish gate audit operations are accepted.')
 if not __debug__:raise SystemExit('Optimized gate audit execution is not accepted')
 name={'capture':'capture.json','before':'baseline-check.json','finish':'preservation.json'}[mode]
 try:result={'capture':capture,'before':baseline_holds,'finish':audit}[mode]()
 except Exception:result=dict(passed=False,category=mode+'_failed')
 save(name,result);print(json.dumps(result));sys.exit(0 if result['passed'] else 1)
