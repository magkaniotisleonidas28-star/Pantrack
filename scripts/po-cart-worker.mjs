import {FakeCartWorker} from './po-cart-worker/client.mjs';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
let worker;
try{
  if(!args.includes('--credential')||!args.includes('--journal'))throw Error('Private file paths required.');
  worker=new FakeCartWorker({credentialFile:value('--credential'),journalFile:value('--journal'),
    origin:args.includes('--origin')?value('--origin'):undefined,fakeDelayMs:args.includes('--fake-delay-ms')?Number(value('--fake-delay-ms')):0});
  do{await worker.tick();if(args.includes('--once'))break;await new Promise(ok=>setTimeout(ok,1000));}while(true);
}catch{console.error('Local fake worker stopped; private journal retained for recovery.');process.exitCode=1;}
finally{worker?.close();}
