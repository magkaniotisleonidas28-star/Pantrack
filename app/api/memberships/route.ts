import { getChatGPTUser, safeRelativeReturnPath } from '@/app/chatgpt-auth';
import { companyAccess, hasCompanyRole, recordAudit, type CompanyRole } from '@/lib/company-access';
import { isSameOriginMutation } from '@/lib/request-security';
import { database } from '@/db/raw';
import { z } from 'zod';

const email = z.string().trim().email().max(320).transform(value => value.toLowerCase());
const companyId = z.string().min(1).max(200);
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), companyId, email, role: z.enum(['manager', 'employee']) }),
  z.object({ action: z.literal('accept'), token: z.string().min(32).max(400), returnTo: z.string().default('/') }),
  z.object({ action: z.literal('remove'), companyId, userId: z.string().min(1).max(200) }),
  z.object({ action: z.literal('changeRole'), companyId, userId: z.string().min(1).max(200), role: z.enum(['manager', 'employee']) }),
  z.object({ action: z.literal('transferOwnership'), companyId, userId: z.string().min(1).max(200) }),
]);
async function tokenHash(value: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, '0')).join(''); }
function failure(message: string, status = 400): Response { return Response.json({ error: message }, { status }); }

export async function GET(request: Request): Promise<Response> {
  const user = await getChatGPTUser(); const requested = new URL(request.url).searchParams.get('companyId'); const member = await companyAccess(user?.userId ?? '', requested);
  if (!user) return failure('Please sign in.', 401); if (!hasCompanyRole(member, 'owner')) return failure('Company owner access required.', 403);
  const db = database(); const [members, invitations] = await Promise.all([
    db.prepare('SELECT user_id as userId,role FROM memberships WHERE company_id=? ORDER BY role,user_id').bind(requested).all<{ userId: string; role: CompanyRole }>(),
    db.prepare('SELECT id,email,role,expires FROM company_invitations WHERE company_id=? AND accepted_at IS NULL AND expires>? ORDER BY created DESC').bind(requested, new Date().toISOString()).all<{ id: string; email: string; role: CompanyRole; expires: string }>(),
  ]);
  return Response.json({ members: members.results, invitations: invitations.results }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request) || !request.headers.get('content-type')?.startsWith('application/json')) return failure('Invalid request origin.', 403);
  const user = await getChatGPTUser(); if (!user) return failure('Please sign in.', 401); let input: z.infer<typeof body>;
  try { input = body.parse(await request.json()); } catch { return failure('Invalid membership request.'); }
  const db = database();
  try {
    if (input.action === 'accept') {
      const hash = await tokenHash(input.token); const invitation = await db.prepare('SELECT id,company_id,email,role,expires FROM company_invitations WHERE token_hash=? AND accepted_at IS NULL').bind(hash).first<{ id: string; company_id: string; email: string; role: CompanyRole; expires: string }>();
      if (!invitation || invitation.expires <= new Date().toISOString()) return failure('This invitation has expired or was already used.', 410);
      if (invitation.email !== user.email.trim().toLowerCase()) return failure('Sign in with the email address that received this invitation.', 403);
      const used = await db.prepare('UPDATE company_invitations SET accepted_at=?,accepted_by=? WHERE id=? AND accepted_at IS NULL').bind(new Date().toISOString(), user.userId, invitation.id).run();
      if (!used.meta.changes) return failure('This invitation has already been used.', 410);
      await db.prepare('INSERT OR IGNORE INTO memberships (user_id,company_id,role) VALUES (?,?,?)').bind(user.userId, invitation.company_id, invitation.role).run();
      await recordAudit(invitation.company_id, user.userId, 'membership.accepted', user.userId, { invitationId: invitation.id, role: invitation.role });
      return Response.json({ ok: true, companyId: invitation.company_id, returnTo: safeRelativeReturnPath(input.returnTo) });
    }
    const member = await companyAccess(user.userId, input.companyId); if (!hasCompanyRole(member, 'owner')) return failure('Company owner access required.', 403);
    if (input.action === 'invite') {
      const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`; const id = crypto.randomUUID(); const expires = new Date(Date.now() + 604800000).toISOString();
      await db.prepare('INSERT INTO company_invitations (id,company_id,email,role,token_hash,invited_by,created,expires) VALUES (?,?,?,?,?,?,?,?)').bind(id, input.companyId, input.email, input.role, await tokenHash(token), user.userId, new Date().toISOString(), expires).run();
      await recordAudit(input.companyId, user.userId, 'membership.invited', id, { email: input.email, role: input.role });
      return Response.json({ ok: true, invitation: { id, email: input.email, role: input.role, expires }, invitePath: `/auth/invite?token=${encodeURIComponent(token)}` });
    }
    if (input.action === 'remove') {
      if (input.userId === user.userId) return failure('Transfer ownership before removing yourself.', 409); const target = await companyAccess(input.userId, input.companyId);
      if (!target) return failure('Member not found.', 404); if (target.role === 'owner') return failure('Transfer ownership before removing an owner.', 409);
      await db.prepare('DELETE FROM memberships WHERE user_id=? AND company_id=?').bind(input.userId, input.companyId).run(); await recordAudit(input.companyId, user.userId, 'membership.removed', input.userId, { previousRole: target.role }); return Response.json({ ok: true });
    }
    if (input.action === 'changeRole') {
      const target = await companyAccess(input.userId, input.companyId); if (!target) return failure('Member not found.', 404); if (target.role === 'owner') return failure('Transfer ownership to change an owner role.', 409);
      await db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND company_id=?').bind(input.role, input.userId, input.companyId).run(); await recordAudit(input.companyId, user.userId, 'membership.role_changed', input.userId, { role: input.role }); return Response.json({ ok: true });
    }
    const target = await companyAccess(input.userId, input.companyId); if (!target) return failure('Member not found.', 404); if (input.userId === user.userId) return failure('Choose another company member.', 400);
    await db.batch([db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND company_id=?').bind('owner', input.userId, input.companyId), db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND company_id=?').bind('manager', user.userId, input.companyId)]);
    await recordAudit(input.companyId, user.userId, 'membership.ownership_transferred', input.userId, { previousRole: target.role }); return Response.json({ ok: true });
  } catch { return failure('Unable to update company memberships.', 503); }
}
