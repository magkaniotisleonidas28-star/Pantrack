import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const processes=()=>execFileSync('ps',['-Ao','pid,ppid,command'],{encoding:'utf8'}).split('\n').flatMap(line=>{
 const m=line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);return m?[{pid:Number(m[1]),parent:Number(m[2]),command:m[3]}]:[];
});
const hash=s=>createHash('sha256').update(s).digest('hex');
// Test-only Unix process ownership. Capture while the worker is alive; never
// discover/adopt a browser merely because it has an old cart profile.
export function captureOwnedBrowser(workerPid,profilePath){
 const marker='--user-data-dir='+resolve(profilePath);
 const matches=processes().filter(p=>p.parent===workerPid&&p.command.includes(marker)&&!p.command.includes('--type='));
 if(matches.length!==1)throw Error('Cannot prove crash-test browser ownership.');
 return {pid:matches[0].pid,commandHash:hash(matches[0].command)};
}
export async function stopOwnedBrowser(owned){
 const current=processes().find(p=>p.pid===owned.pid);if(!current)return;
 if(hash(current.command)!==owned.commandHash)throw Error('Browser process identity changed; cleanup requires review.');
 process.kill(owned.pid,'SIGTERM');
 const end=Date.now()+10000;
 while(processes().some(p=>p.pid===owned.pid)){if(Date.now()>=end)throw Error('Owned browser did not stop.');await new Promise(ok=>setTimeout(ok,50));}
}
