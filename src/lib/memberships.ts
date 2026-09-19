import {database} from '@/db/raw';
import {audit,hash,randomToken,recentlyVerified,type AuthUser} from '@/lib/auth';
import {companyAccess} from '@/lib/company-access';
import {z} from 'zod';
export const membershipInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('invite'),companyId:z.string().min(1).max(200),email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()),role:z.enum(['manager','employee'])}),
  z.object({action:z.literal('accept'),token:z.string().regex(/^[a-f0-9]{64}$/)}),
  z.object({action:z.literal('revoke'),companyId:z.string().min(1).max(200),id:z.string().uuid()}),
  z.object({action:z.literal('role'),companyId:z.string().min(1).max(200),userId:z.string().min(1).max(200),role:z.enum(['manager','employee'])}),
  z.object({action:z.literal('remove'),companyId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}),
  z.object({action:z.literal('transfer'),companyId:z.string().min(1).max(200),userId:z.string().uuid()}),
  z.object({action:z.literal('acceptTransfer'),companyId:z.string().min(1).max(200),id:z.string().uuid()}),
  z.object({action:z.literal('cancelTransfer'),companyId:z.string().min(1).max(200),id:z.string().uuid()}),
]);
export class MembershipError extends Error{constructor(message:string,public status=409){super(message);}}
export async function mutateMembership(user:AuthUser,b:z.infer<typeof membershipInput>){
  const db=database(),now=Date.now();
  if(b.action==='accept'){
    const tokenHash=await hash(b.token);
    // Consuming the token fires an atomic database trigger which creates membership
    // and audit records. A duplicate, revoked, wrong-email or stale request cannot win.
    const row=await db.prepare(`UPDATE company_invitations SET consumed_by=?,consumed_at=? WHERE token_hash=? AND email=? AND expires>? AND consumed_at IS NULL AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM memberships m WHERE m.company_id=company_invitations.company_id AND m.user_id=company_invitations.invited_by AND m.role='owner') AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.company_id=company_invitations.company_id AND m.user_id=?) RETURNING company_id`).bind(user.userId,now,tokenHash,user.email.toLowerCase(),now,user.userId).first<{company_id:string}>();
    if(!row)throw new MembershipError('Invitation is expired, already used, revoked, or not for your verified email.');
    return {companyId:row.company_id};
  }
  const member=await companyAccess(user.userId,b.companyId);
  if(b.action==='acceptTransfer'){
    if(!member||!recentlyVerified(user))throw new MembershipError('Sign in again to confirm this ownership transfer.',403);
    const row=await db.prepare('UPDATE ownership_transfers SET accepted_at=? WHERE id=? AND company_id=? AND to_user=? AND expires>? AND accepted_at IS NULL AND canceled_at IS NULL RETURNING id').bind(now,b.id,b.companyId,user.userId,now).first();
    if(!row)throw new MembershipError('Ownership transfer is no longer available.');
    return {ok:true};
  }
  if(member?.role!=='owner')throw new MembershipError('Company owner access required.',403);
  if(b.action==='invite'){
    const token=randomToken(),id=crypto.randomUUID(),expires=now+7*24*60*60*1000;
    await db.batch([
      db.prepare('UPDATE company_invitations SET revoked_at=? WHERE company_id=? AND email=? AND consumed_at IS NULL AND revoked_at IS NULL').bind(now,b.companyId,b.email),
      db.prepare('INSERT INTO company_invitations(id,company_id,email,role,token_hash,invited_by,expires) VALUES (?,?,?,?,?,?,?)').bind(id,b.companyId,b.email,b.role,await hash(token),user.userId,expires),
      audit(b.companyId,user.userId,'invitation.created',id),
    ]);
    return {id,token,expires};
  }
  if(b.action==='revoke'){
    await db.batch([db.prepare("UPDATE company_invitations SET revoked_at=? WHERE id=? AND company_id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner')").bind(now,b.id,b.companyId,b.companyId,user.userId),audit(b.companyId,user.userId,'invitation.revoked',b.id)]);
    return {ok:true};
  }
  if(b.action==='role'||b.action==='remove'){
    // Ownership changes use the recipient-confirmed transfer flow only.
    if(b.userId===user.userId)throw new MembershipError('Use ownership transfer before changing your own membership.');
    const target=await companyAccess(b.userId,b.companyId);
    if(!target||target.role==='owner')throw new MembershipError('Owner membership can only change through ownership transfer.');
    await db.batch([
      b.action==='remove'?db.prepare("DELETE FROM memberships WHERE company_id=? AND user_id=? AND role!='owner' AND EXISTS(SELECT 1 FROM memberships actor WHERE actor.company_id=? AND actor.user_id=? AND actor.role='owner')").bind(b.companyId,b.userId,b.companyId,user.userId):db.prepare("UPDATE memberships SET role=? WHERE company_id=? AND user_id=? AND role!='owner' AND EXISTS(SELECT 1 FROM memberships actor WHERE actor.company_id=? AND actor.user_id=? AND actor.role='owner')").bind(b.role,b.companyId,b.userId,b.companyId,user.userId),
      db.prepare("UPDATE ownership_transfers SET canceled_at=? WHERE company_id=? AND (from_user=? OR to_user=?) AND accepted_at IS NULL AND EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner')").bind(now,b.companyId,b.userId,b.userId,b.companyId,user.userId),
      audit(b.companyId,user.userId,'membership.'+b.action,b.userId),
    ]);
    return {ok:true};
  }
  if(b.action==='cancelTransfer'){
    await db.batch([db.prepare("UPDATE ownership_transfers SET canceled_at=? WHERE id=? AND company_id=? AND accepted_at IS NULL AND EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner')").bind(now,b.id,b.companyId,b.companyId,user.userId),audit(b.companyId,user.userId,'ownership.canceled',b.id)]);
    return {ok:true};
  }
  if(!recentlyVerified(user))throw new MembershipError('Sign in again before transferring ownership.',403);
  const target=await db.prepare('SELECT m.role FROM memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.company_id=? AND m.user_id=?').bind(b.companyId,b.userId).first<{role:string}>();
  if(!target||target.role==='owner'||b.userId===user.userId)throw new MembershipError('Choose another verified member of this company.');
  const id=crypto.randomUUID();
  await db.batch([
    db.prepare('UPDATE ownership_transfers SET canceled_at=? WHERE company_id=? AND accepted_at IS NULL AND canceled_at IS NULL').bind(now,b.companyId),
    db.prepare('INSERT INTO ownership_transfers(id,company_id,from_user,to_user,expires) VALUES (?,?,?,?,?)').bind(id,b.companyId,user.userId,b.userId,now+24*60*60*1000),
    audit(b.companyId,user.userId,'ownership.proposed',id),
  ]);
  return {id};
}
