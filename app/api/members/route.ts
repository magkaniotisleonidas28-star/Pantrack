import {getChatGPTUser} from '@/app/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {csrf} from '@/lib/auth';
import {database} from '@/db/raw';
import {MembershipError,membershipInput,mutateMembership} from '@/lib/memberships';
export async function GET(req:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
  const companyId=new URL(req.url).searchParams.get('companyId'),member=await companyAccess(user.userId,companyId);
  if(!member)return Response.json({error:'Company access denied.'},{status:403});
  const db=database(),transfers=await db.prepare('SELECT id,from_user,to_user,expires FROM ownership_transfers WHERE company_id=? AND accepted_at IS NULL AND canceled_at IS NULL AND expires>? AND (to_user=? OR ?=\'owner\')').bind(companyId,Date.now(),user.userId,member.role).all();
  if(member.role!=='owner')return Response.json({members:[],invitations:[],audit:[],transfers:transfers.results},{headers:{'Cache-Control':'no-store'}});
  const [members,invitations,events]=await Promise.all([
    db.prepare('SELECT m.user_id,m.role,u.email FROM memberships m LEFT JOIN auth_users u ON u.id=m.user_id WHERE company_id=?').bind(companyId).all(),
    db.prepare('SELECT id,email,role,expires,consumed_at,revoked_at FROM company_invitations WHERE company_id=? ORDER BY expires DESC LIMIT 100').bind(companyId).all(),
    db.prepare('SELECT actor,action,target,created FROM security_audit WHERE company_id=? ORDER BY created DESC LIMIT 100').bind(companyId).all(),
  ]);
  return Response.json({members:members.results,invitations:invitations.results,transfers:transfers.results,audit:events.results},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
  if(!csrf(req))return Response.json({error:'Invalid request origin.'},{status:403});
  try{return Response.json(await mutateMembership(user,membershipInput.parse(await req.json())),{headers:{'Cache-Control':'no-store'}});}
  catch(e){return Response.json({error:e instanceof MembershipError?e.message:'Membership update failed. Reload and retry.'},{status:e instanceof MembershipError?e.status:400});}
}
