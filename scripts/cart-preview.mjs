import './sites-env.mjs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {mkdirSync,writeFileSync} from 'node:fs';

for(const port of [5181,5182])await new Promise((ok,fail)=>{const probe=createServer();probe.once('error',()=>fail(Error(`Port ${port} is in use. Existing previews were left running.`)));probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
const root='.sites-runtime/cart-review-config';mkdirSync(root,{recursive:true,mode:0o700});
const vars={...(process.env.PANTRACK_CART_BROWSER_LOCAL==='enabled'?{PANTRACK_CART_BROWSER_LOCAL:'enabled'}:{}),...(process.env.PANTRACK_CART_WORKER_LOCAL==='enabled'?{PANTRACK_CART_WORKER_TRANSPORT:'enabled'}:{}),APP_ORIGIN:'http://127.0.0.1:5181',PANTRACK_CART_PREVIEW:'enabled',PANTRACK_PO_DRAFT_PREVIEW:'enabled',PANTRACK_EXACT_INVENTORY_PREVIEW:'enabled',PANTRACK_CLOVER_SYNC_ENABLED:'disabled'};
writeFileSync(root+'/.dev.vars',Object.entries(vars).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});
const configPath=root+'/wrangler.jsonc';
writeFileSync(configPath,JSON.stringify({name:'pantrack-cart-local',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],main:resolve('node_modules/vinext/dist/server/fetch-handler.js'),
  d1_databases:[{binding:'DB',database_name:'pantrack-local',database_id:'00000000-0000-4000-8000-000000000000',migrations_dir:resolve('drizzle')}],vars},null,2)+'\n');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config',configPath,'--persist-to','.sites-runtime/cart-review-state'],{stdio:'inherit'});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
process.env.PANTRACK_PO_REVIEW='enabled';process.env.PANTRACK_CART_REVIEW='enabled';
console.log('Cart preview: http://127.0.0.1:5181 — fictional local sign-in; offline runner; isolated database. Run pnpm cart:seed once after startup.');
process.argv=[process.execPath,resolve('node_modules/vite/bin/vite.js'),'--port','5181','--host','127.0.0.1','--strictPort'];
await import('../node_modules/vite/bin/vite.js');
