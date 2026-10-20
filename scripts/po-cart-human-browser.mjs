import {gateActive} from './po-cart-worker/full-gate-runtime.mjs';
if(gateActive())await import('./po-cart-worker/offline-boundary.mjs');
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];let worker;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>worker?.requestStop());
try{
 if(!['--credential','--journal','--fixture'].every(k=>args.includes(k)&&value(k)))throw Error('Private paths required.');
 const output=resolve('.sites-runtime/po-cart-workers/modules/human-'+randomUUID()+'.mjs');
 await build({entryPoints:['scripts/po-cart-worker/human-browser.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,logLevel:'silent'});
 const {HumanBrowserWorker}=await import(pathToFileURL(output).href);
 worker=new HumanBrowserWorker({credentialFile:value('--credential'),journalFile:value('--journal'),fixtureFile:value('--fixture'),origin:args.includes('--origin')?value('--origin'):undefined,headless:args.includes('--headless')});
 await worker.tick();
}catch{console.error('Practice browser access stopped; existing cart and private recovery evidence retained.');process.exitCode=1;}
finally{worker?.close();}
