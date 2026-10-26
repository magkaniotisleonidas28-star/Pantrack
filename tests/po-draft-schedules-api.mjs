import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {fixture} from './helpers/supplier-simulation.mjs';

const f=await fixture();
globalThis.__tickApi={db:f.db,env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({stdin:{contents:"export * from './src/app/api/po-draft-schedules/tick/route.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-draft-schedules-api.mjs',plugins:[{name:'tick-http-dependencies',setup(b){
    // Keep the actual token digest and scheduler. Only the database and environment are fixtures.
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw)$/},args=>({path:args.path,namespace:'tick-http'}));
    b.onLoad({filter:/.*/,namespace:'tick-http'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__tickApi.env;':
      'export const database=()=>globalThis.__tickApi.db;',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-draft-schedules-api.mjs');
const token='fictional-scheduler-token',hash=v=>createHash('sha256').update(v).digest('hex');
f.sql.prepare("INSERT INTO automation_settings(company_id,data,scheduler_hash) VALUES('a','{}',?),('b','{}',?)").run(hash(token),hash('other-company-token'));
f.sql.prepare('INSERT INTO company_time_zones(company_id,version,time_zone,actor,created_at,operation_id,fingerprint) VALUES(?,?,?,?,?,?,?)')
  .run('a',1,'America/New_York','owner','2026-10-01T12:00:00.000Z',randomUUID(),'fp');
const tick=(companyId='a',auth=`Bearer ${token}`,host='http://127.0.0.1:5181')=>api.POST(new Request(`${host}/api/po-draft-schedules/tick?companyId=${companyId}`,
  {method:'POST',headers:auth?{authorization:auth}:{}}));
const leases=()=>JSON.stringify(f.sql.prepare('SELECT * FROM po_draft_tick_leases').all());
async function refused(status,run){const before=leases(),res=await run();assert.equal(res.status,status,await res.text());assert.equal(leases(),before,'A refused check runs nothing');}

globalThis.__tickApi.env.PANTRACK_CART_PREVIEW='disabled';await refused(404,()=>tick());globalThis.__tickApi.env.PANTRACK_CART_PREVIEW='enabled';
for(const host of ['http://localhost:5181','https://pantrack.example.invalid'])await refused(404,()=>tick('a',`Bearer ${token}`,host));
for(const [companyId,auth] of [['a',null],['a','Bearer wrong'],['a',token],['b',`Bearer ${token}`],['c',`Bearer ${token}`],['',`Bearer ${token}`],['a','Bearer '+'x'.repeat(200)]])
  await refused(401,()=>tick(companyId,auth));
const ok=await tick();assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/no-store/);
assert.deepEqual(await ok.json(),{companyId:'a',ran:true,reason:null,weeks:[]});
const other=await tick('b','Bearer other-company-token');assert.equal(other.status,200);assert.equal((await other.json()).reason,'time_zone_missing','Each company runs only its own check');
console.log('PASS: weekly draft tick route: preview flag and loopback only, the company\'s own scheduler token (hash compared, other companies\' tokens refused), private responses, and refusals run nothing.');
