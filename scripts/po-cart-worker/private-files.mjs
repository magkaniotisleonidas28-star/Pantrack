import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,lstatSync,readFileSync,unlinkSync,readlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
export function readPrivate(path){
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)))throw Error('Private regular file with mode 0600 required.');
  return JSON.parse(readFileSync(path,'utf8'));
}
export function writePrivate(path,data){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.'+randomUUID()+'.tmp',fd=openSync(tmp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(data)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(tmp,path);
  if(process.platform!=='win32'){const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
}
export function journalLock(path){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const lock=path+'.lock';
  try{const pid=Number(readFileSync(lock,'utf8'));let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(!alive)unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
  return ()=>unlinkSync(lock);
}

// Serialize stale-lock reclamation too. An active PID always wins, regardless of application lease expiry.
// A crash inside reclamation conservatively leaves the guard for manual review.
export function profileLock(path){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const lock=path+'.lock',guard=lock+'.reclaim';
  const gate=openSync(guard,'wx',0o600);closeSync(gate);
  try{
    // Chromium can outlive a crashed worker. Its live singleton owner blocks profile reuse too.
    try{const singleton=join(path,'SingletonLock'),stat=lstatSync(singleton);
      if(!stat.isSymbolicLink())throw Error('Browser profile ownership requires review.');
      const match=readlinkSync(singleton).match(/-(\d+)$/);if(!match)throw Error('Browser profile ownership requires review.');
      let alive=true;try{process.kill(Number(match[1]),0);}catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive)throw Error('Browser profile is still open. Close its window before reuse.');
    }catch(e){if(e.code!=='ENOENT')throw e;}
    try{const pid=Number(readFileSync(lock,'utf8'));let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive)throw Error('Account profile is actively owned.');unlinkSync(lock);
    }catch(e){if(e.code!=='ENOENT')throw e;}
    const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,String(process.pid));fsyncSync(fd);}finally{closeSync(fd);}
  }finally{unlinkSync(guard);}
  return ()=>unlinkSync(lock);
}
