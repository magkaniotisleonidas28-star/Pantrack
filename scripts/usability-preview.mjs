import './sites-env.mjs';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';

// Dedicated practice DB and ordinary Supabase sign-in. No fixture users or
// integration credentials are copied. Existing local profiles are preserved.
const root='.sites-runtime/usability-preview';mkdirSync(root,{recursive:true,mode:0o700});
function values(path){
 if(!existsSync(path))return {};
 return Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).flatMap(line=>{const match=line.match(/^\s*(?:export\s+)?([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);if(!match)return [];let value=match[2];if(value.startsWith('"')&&value.endsWith('"')){try{value=JSON.parse(value);}catch{return [];}}else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);return [[match[1],value]];}));
}
const configured={...values('.env.local'),...Object.fromEntries(Object.entries(values('.dev.vars')).filter(([,value])=>value))};
const authNames=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'];
if(authNames.some(name=>!configured[name]))throw new Error('Normal sign-in needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in your ignored .dev.vars file. Do not send these values in chat.');
await new Promise((ok,fail)=>{const probe=createServer();probe.once('error',()=>fail(new Error('Port 5177 is in use. Keep the existing server open, or stop that server before restarting this preview.')));probe.listen(5177,'127.0.0.1',()=>probe.close(ok));});
const privatePath=root+'/.dev.vars',previous=values(privatePath);
const vars={APP_ORIGIN:'http://127.0.0.1:5177',PANTRACK_USABILITY_PREVIEW:'enabled',PANTRACK_EXACT_INVENTORY_PREVIEW:'enabled',CLOVER_ENVIRONMENT:'sandbox',AUTH_ENCRYPTION_KEY:previous.AUTH_ENCRYPTION_KEY||randomBytes(32).toString('hex'),...Object.fromEntries(authNames.map(name=>[name,configured[name]]))};
writeFileSync(privatePath,Object.entries(vars).map(([name,value])=>`${name}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
const configPath=root+'/wrangler.jsonc';
writeFileSync(configPath,JSON.stringify({name:'pantrack-usability-local',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],main:resolve('node_modules/vinext/dist/server/fetch-handler.js'),d1_databases:[{binding:'DB',database_name:'pantrack-usability-local',database_id:'00000000-0000-4000-8000-000000000000',migrations_dir:resolve('drizzle')}],vars:{PANTRACK_EXACT_INVENTORY_PREVIEW:'enabled'}},null,2)+'\n');
const migration=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config',configPath,'--persist-to','.sites-runtime/usability-state'],{stdio:'inherit'});
if(migration.error)throw migration.error;if(migration.status!==0)process.exit(migration.status??1);
console.log('Local practice site: http://127.0.0.1:5177 — sign in with your existing Pantrack account. Workspace data stays in this separate local database.');
process.env.PANTRACK_USABILITY_REVIEW='enabled';
process.argv=[process.execPath,resolve('node_modules/vite/bin/vite.js'),'--port','5177','--host','127.0.0.1','--strictPort'];
await import('../node_modules/vite/bin/vite.js');
