import {gateActive} from './po-cart-worker/full-gate-runtime.mjs';
if(gateActive())await import('./po-cart-worker/offline-boundary.mjs');
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;worker?.requestStop();});
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
let worker;
try{
 if(!['--credential','--journal','--fixture'].every(k=>args.includes(k)&&value(k)))throw Error('Private file paths required.');
 if(args.includes('--ai'))throw Error('AI is available only through the dedicated evaluation command.');
 const output=resolve('.sites-runtime/po-cart-workers/modules/browser-'+randomUUID()+'.mjs');mkdirSync(resolve(output,'..'),{recursive:true,mode:0o700});
 await build({entryPoints:['scripts/po-cart-worker/browser-adapter.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,logLevel:'silent'});
 const {LocalBrowserCartWorker}=await import(pathToFileURL(output).href);
 worker=new LocalBrowserCartWorker({credentialFile:value('--credential'),journalFile:value('--journal'),fixtureFile:value('--fixture'),
  origin:args.includes('--origin')?value('--origin'):undefined,headless:!args.includes('--visible'),diagnosticFile:args.includes('--diagnostic')?value('--diagnostic'):undefined});
 do{await worker.tick();if(args.includes('--once'))break;await new Promise(ok=>setTimeout(ok,1000));}while(!stopping);
}catch{console.error('Local browser worker stopped; private evidence and profile retained for review.');process.exitCode=1;}
finally{worker?.close();}
