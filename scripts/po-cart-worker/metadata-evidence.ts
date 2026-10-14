import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync,lstatSync} from 'node:fs';
import {providerPhases} from '../cart-preview/ai-provider';

const phaseIds=providerPhases.flatMap((phase,id)=>phase.endsWith(':Metadata')?[id]:[]);
export const metadataEvidenceLimit=16384;
export interface MetadataEvidenceSink {
  capture(value:unknown,phase:string):void;
  healthy():boolean;
  files():string[];
  close():void;
}
type EvidenceIo={write:typeof writeFileSync;sync:typeof fsyncSync;close:typeof closeSync};
const field=(value:unknown,key:string)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key)
  ?{present:true,value:(value as Record<string,unknown>)[key]}:{present:false};

// Evaluation-only retention of untrusted parsed fields, never a provider body,
// prompt, DOM or Extraction result. Exclusive files also fence duplicate capture.
export function metadataEvidence(root:string,io:EvidenceIo={write:writeFileSync,sync:fsyncSync,close:closeSync}):MetadataEvidenceSink {
  const descriptors=new Map<number,number>(),attempted=new Set<number>();let healthy=true,closed=false;
  const paths=phaseIds.map(id=>root+'/'+id+'.json');
  const close=()=>{closed=true;for(const [id,fd] of descriptors){descriptors.delete(id);try{io.close(fd);}catch{healthy=false;}}};
  try{
    mkdirSync(root,{recursive:true,mode:0o700});
    for(const [index,id] of phaseIds.entries())descriptors.set(id,openSync(paths[index],'wx',0o600));
    if(process.platform!=='win32'){const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
  }catch{healthy=false;close();throw Error('AI_METADATA_EVIDENCE_SETUP_FAILED');}
  return {healthy:()=>healthy,files:()=>[...paths],close,capture(value,phase){
    const id=providerPhases.indexOf(phase),fd=descriptors.get(id);
    try{
      if(!healthy||closed||fd===undefined||attempted.has(id))throw Error();
      attempted.add(id);
      const raw=JSON.stringify({version:1,untrusted:true,phaseId:id,fields:{completed:field(value,'completed'),progress:field(value,'progress')}})+'\n';
      if(Buffer.byteLength(raw)>metadataEvidenceLimit)throw Error();
      io.write(fd,raw);io.sync(fd);
      descriptors.delete(id);io.close(fd);
    }catch{healthy=false;throw Error('AI_METADATA_EVIDENCE_FAILED');}
  }};
}

// Read files independently for acceptance. Empty slots represent unrequested
// phases in held cases; retained values must never be used as instructions.
export function verifyMetadataEvidence(files:string[],phases:string[]){
  try{
    const expected=phases.filter(p=>p.endsWith(':Metadata')).map(p=>providerPhases.indexOf(p));
    if(files.length!==phaseIds.length||new Set(files).size!==files.length||expected.some(id=>!phaseIds.includes(id)))return false;
    const found:number[]=[];
    for(const [index,path] of files.entries()){
      const stat=lstatSync(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>metadataEvidenceLimit||(process.platform!=='win32'&&(stat.mode&0o777)!==0o600))return false;
      if(stat.size===0)continue;
      const e=JSON.parse(readFileSync(path,'utf8'));
      if(e.version!==1||e.untrusted!==true||e.phaseId!==phaseIds[index]||Object.keys(e).sort().join(',')!=='fields,phaseId,untrusted,version'
        ||Object.keys(e.fields).sort().join(',')!=='completed,progress')return false;
      for(const f of Object.values(e.fields) as {present:boolean;value?:unknown}[]){
        if(typeof f.present!=='boolean'||Object.keys(f).sort().join(',')!==(f.present?'present,value':'present'))return false;
      }
      if(e.fields.completed.present!==true||e.fields.completed.value!==true)return false;
      found.push(e.phaseId);
    }
    return JSON.stringify(found)===JSON.stringify(expected);
  }catch{return false;}
}
