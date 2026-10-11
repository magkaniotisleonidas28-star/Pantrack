import './sites-env.mjs';
import {spawnSync} from 'node:child_process';
import {writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
const [action,file,companyId]=process.argv.slice(2);
try{
  mkdirSync('.sites-runtime/po-cart-workers',{recursive:true,mode:0o700});
  await fixtureCredential({action,file,companyId,execute:async sql=>{
    const path=`.sites-runtime/po-cart-workers/${randomUUID()}.sql`;writeFileSync(path,sql,{mode:0o600});
    try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',
      '.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',path],{encoding:'utf8'});
      if(r.error||r.status!==0)throw Error('Local credential fixture failed.');}finally{unlinkSync(path);}
  }});
  console.log('Local worker credential fixture completed; private file retained.');
}catch{console.error('Credential fixture failed. Usage: issue|rotate|revoke .sites-runtime/po-cart-workers/name.json [fictional-company-id]');process.exitCode=1;}
