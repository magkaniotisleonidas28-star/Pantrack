"""Independent read-only preservation audit; never emits business rows or secrets."""
import json,hashlib,sqlite3,collections,os,sys
from pathlib import Path
root=Path('.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014')
def digest(b):return hashlib.sha256(b).hexdigest()
def filehash(p):return digest(Path(p).read_bytes())
def read(name):return json.loads((root/name).read_text())
def save(name,value):
 p=root/name;p.write_text(json.dumps(value)+'\n');p.chmod(0o600)
def audit():
 baseline=read('baseline.json')
 for f in baseline['protectedFiles']:
  assert Path(f['path']).exists()==(f['sha256'] is not None)
  if f['sha256'] is not None:assert filehash(f['path'])==f['sha256']
 old=read('storefront-before.json');store=json.load(open('.sites-runtime/po-cart-workers/local-storefront.json'))['fixtures']
 for k,v in old.items():assert digest(json.dumps(store[k],sort_keys=True,separators=(',',':')).encode())==v
 rows=0;delta=[];metadata=0;sequences=0
 for entry in read('database-before.json'):
  c=sqlite3.connect('file:'+entry['path']+'?mode=ro',uri=True);tables=[]
  for t in entry['tables']:
   now=collections.Counter(digest(json.dumps(r,separators=(',',':'),default=str).encode()) for r in c.execute('SELECT * FROM "'+t['name']+'"'))
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
try:result=audit()
except Exception:result=dict(passed=False,category='preservation_failed')
save('preservation.json',result);print(json.dumps(result));sys.exit(0 if result['passed'] else 1)
