// Test-only preload for the real worker CLI. Observe completed journal saves
// inside its process so the parent never races Windows atomic file replacement
// by repeatedly opening the journal. Send only a count, never journal contents.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';

const index=process.argv.indexOf('--journal');
const journal=index>=0?resolve(process.argv[index+1]):null;
const rename=fs.renameSync;
fs.renameSync=function(source,target){
  const result=rename(source,target);
  if(journal&&resolve(String(target))===journal&&process.connected){
    const state=JSON.parse(fs.readFileSync(journal,'utf8'));
    process.send({type:'journal-saved',calls:state.calls.length},()=>{});
  }
  return result;
};
syncBuiltinESMExports();
