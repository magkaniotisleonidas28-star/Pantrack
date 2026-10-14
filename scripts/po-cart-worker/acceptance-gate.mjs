import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readPrivate} from './private-files.mjs';

export const gatePolicy='metadata-repair-real-matrix-v1';
export const gateSteps=[
 ['metadata',['cart:browser-worker:check:ai:metadata']],
 ['reliability',['cart:browser-worker:check:reliability','--acceptance']],
 ['served-off',['cart:browser-worker:check:ai:http','--diagnostic-mode','off']],
 ['served-passive',['cart:browser-worker:check:ai:http','--diagnostic-mode','passive']],
 ['ai-safety',['cart:browser-worker:check:ai']],
 ...['off','passive','form'].map(mode=>['faults-'+mode,['cart:browser-worker:check:failures','--diagnostic-mode',mode]]),
 ...['typecheck','test','db:check','build','db:migrate:local','test:local'].map(name=>[name,[name]]),
 ...['cart:browser-worker:check','cart:browser-worker:check:http','cart:check','cart:manager:check','cart:browser-session:check','cart:reconciliation:check','cart:manager:check:launcher'].map(name=>[name,[name]])
];
export function sourceSnapshot(root=process.cwd()){
 // Git is already required by the frozen-source gate and CI. NUL delimiters
 // preserve spaces/unicode without requiring a separately installed rg binary.
 const listed=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
 const files=[...new Set(listed.split('\0').filter(file=>file&&!/^(?:\.sites-runtime|node_modules|docs|dist|\.wrangler|\.next)(?:\/|$)|(?:\.md|\.tsbuildinfo)$/.test(file)))].sort();
 if(!files.length)throw Error('No source files found for frozen-source gate.');
 const hash=createHash('sha256');for(const file of files)hash.update(file).update('\0').update(readFileSync(resolve(root,file)));
 return {files:files.length,sha256:hash.digest('hex')};
}
export const fileHash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export function validateGate(path){
 const report=readPrivate(path),source=sourceSnapshot();
 if(report.policy!==gatePolicy||report.passed!==true||report.source.sha256!==source.sha256||report.results.length!==gateSteps.length)throw Error('Fresh complete frozen-source gate required.');
 for(const [index,[id,args]] of gateSteps.entries()){
  const r=report.results[index];
  if(r.id!==id||JSON.stringify(r.args)!==JSON.stringify(args)||r.exitCode!==0||!r.passed||r.sourceBefore!==source.sha256||r.sourceAfter!==source.sha256||!r.references.length)throw Error('Gate result invalid.');
  for(const ref of r.references)if(fileHash(ref.path)!==ref.sha256)throw Error('Gate evidence changed.');
 }
 return {report,source,sha256:fileHash(path)};
}
