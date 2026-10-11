import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
try{const f=await seedLocalBrowserJob({layout:args.includes('--layout')?value('--layout'):undefined,scenario:args.includes('--scenario')?value('--scenario'):undefined});
 console.log('Fictional job: '+f.jobId+'\nPrivate manifest: '+f.root+'/manifest.json');
 console.log(`pnpm cart:browser-worker --credential ${f.credentialFiles[0]} --journal ${f.root}/journal-one.json --fixture ${f.fixtureFile} --once`);
}catch{console.error('Fictional browser fixture setup failed. Start the dedicated local profile and use valid layout/scenario enums.');process.exitCode=1;}
