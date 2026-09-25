import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {csrf} from '@/lib/auth';
import {clearChallenge,readChallenge} from '@/lib/clover-webhook-challenge';

const headers={'Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer'};
async function authorized(companyId:string|null){
 const user=await getChatGPTUser();
 if(!user)return {status:401,userId:null};
 return {status:companyId&&(await companyAccess(user.userId,companyId))?.role==='owner'?200:403,userId:user.userId};
}

export async function GET(req:Request){
 const companyId=new URL(req.url).searchParams.get('companyId'),{status}=await authorized(companyId);
 if(status!==200)return Response.json({error:'Access denied.'},{status,headers});
 try{const value=await readChallenge(companyId!);return value?Response.json(value,{headers}):new Response(null,{status:404,headers});}
 catch{return new Response(null,{status:503,headers});}
}

export async function DELETE(req:Request){
 const companyId=new URL(req.url).searchParams.get('companyId'),{status,userId}=await authorized(companyId);
 if(status!==200)return Response.json({error:'Access denied.'},{status,headers});
 if(!csrf(req))return Response.json({error:'Invalid request origin.'},{status:403,headers});
 try{await clearChallenge(companyId!,userId!);return Response.json({ok:true},{headers});}
 catch{return new Response(null,{status:503,headers});}
}
