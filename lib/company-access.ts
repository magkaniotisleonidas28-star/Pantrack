import { database } from '@/db/raw';

export const companyRoles = ['owner', 'manager', 'employee'] as const;
export type CompanyRole = typeof companyRoles[number];
export type Membership = { role: CompanyRole };

export async function companyAccess(userId: string, companyId: unknown): Promise<Membership | null> {
  if (typeof companyId !== 'string' || !companyId || companyId.length > 200) return null;
  const row = await database().prepare('SELECT role FROM memberships WHERE user_id=? AND company_id=?').bind(userId, companyId).first<{ role: string }>();
  return row && companyRoles.includes(row.role as CompanyRole) ? { role: row.role as CompanyRole } : null;
}

export function hasCompanyRole(member: Membership | null, ...roles: CompanyRole[]): boolean { return !!member && roles.includes(member.role); }

export async function recordAudit(companyId: string, actorId: string, action: string, targetId: string | null, data: Record<string, unknown> = {}): Promise<void> {
  await database().prepare('INSERT INTO audit_log (company_id,id,actor_id,action,target_id,data,created) VALUES (?,?,?,?,?,?,?)').bind(companyId, crypto.randomUUID(), actorId, action, targetId, JSON.stringify(data), new Date().toISOString()).run();
}
