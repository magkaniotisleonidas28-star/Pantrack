import './sites-env.mjs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {mkdirSync,writeFileSync} from 'node:fs';

// Fictional fixture sign-in, placeholder D1 binding, isolated local persistence.
// No supplier/mail credentials, external fetch, hosted account or live migration.
await new Promise((ok,fail)=>{
  const probe=createServer();probe.once('error',()=>fail(new Error('Port 5179 is already in use. Keep or stop its existing preview.')));
  probe.listen(5179,'127.0.0.1',()=>probe.close(ok));
});
const root='.sites-runtime/po-review-config';mkdirSync(root,{recursive:true,mode:0o700});
const vars={APP_ORIGIN:'http://127.0.0.1:5179',PANTRACK_PO_DRAFT_PREVIEW:'enabled',PANTRACK_EXACT_INVENTORY_PREVIEW:'enabled',PANTRACK_CLOVER_SYNC_ENABLED:'disabled'};
// No shared .dev.vars/auth/provider secrets are copied into the fictional preview.
writeFileSync(root+'/.dev.vars',Object.entries(vars).map(([name,value])=>`${name}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
const configPath=root+'/wrangler.jsonc';
writeFileSync(configPath,JSON.stringify({name:'pantrack-po-review-local',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],
  main:resolve('node_modules/vinext/dist/server/fetch-handler.js'),d1_databases:[{binding:'DB',database_name:'pantrack-local',database_id:'00000000-0000-4000-8000-000000000000',migrations_dir:resolve('drizzle')}],vars},null,2)+'\n');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local',
  '--config',configPath,'--persist-to','.sites-runtime/po-review-state'],{stdio:'inherit'});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
process.env.PANTRACK_PO_REVIEW='enabled';
console.log('PO draft preview: http://127.0.0.1:5179 — fictional local sign-in; isolated database; nothing is sent.');
process.argv=[process.execPath,resolve('node_modules/vite/bin/vite.js'),'--port','5179','--host','127.0.0.1','--strictPort'];
await import('../node_modules/vite/bin/vite.js');
