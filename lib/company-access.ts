import {database} from '@/db/raw';
export async function companyAccess(userId:string,companyId:unknown){
 if(typeof companyId!=='string'||!companyId||companyId.length>200)return null;
 const membership=await database().prepare('SELECT role FROM memberships WHERE user_id=? AND company_id=?').bind(userId,companyId).first<{role:string}>();
 return membership&&['owner','manager','employee'].includes(membership.role)?membership:null;
}
