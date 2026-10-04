import {database} from '@/db/raw';

export type AuthenticationFence = {epoch:number};
type RecoveryAttempt = {id:string;userId:string};
export const RECOVERY_LEASE_MS = 30_000;
const changed = 'Authentication changed. Please sign in again or request a fresh recovery link.';

function epochFrom(result:D1Result):AuthenticationFence {
  const row=result.results?.[0] as {epoch:number}|undefined;
  if(!row || !Number.isSafeInteger(row.epoch) || row.epoch<0)throw new Error(changed);
  return {epoch:row.epoch};
}

// Capture before any external identity exchange, including when the user ID is
// not known yet. A shared sequence orders attempts against each user's cutoff.
export async function captureAuthenticationFence():Promise<AuthenticationFence> {
  const db=database(),now=Date.now();
  const results=await db.batch([
    db.prepare('UPDATE auth_fence SET epoch=epoch+1 WHERE id=1 AND EXISTS(SELECT 1 FROM auth_users WHERE recovery_id IS NOT NULL AND recovery_until<=?)').bind(now),
    db.prepare("INSERT INTO security_audit(id,company_id,actor,action,target,created) SELECT recovery_id||':expired',NULL,id,'password.recovery_unknown','lease_expired',? FROM auth_users WHERE recovery_id IS NOT NULL AND recovery_until<=?").bind(now,now),
    db.prepare('UPDATE auth_users SET session_epoch=(SELECT epoch FROM auth_fence WHERE id=1),recovery_id=NULL,recovery_until=0 WHERE recovery_id IS NOT NULL AND recovery_until<=?').bind(now),
    db.prepare('SELECT epoch FROM auth_fence WHERE id=1'),
  ]);
  // Expiration advances the cutoff before unlocking, so proofs captured during
  // an abandoned recovery cannot become valid when its lease expires.
  return epochFrom(results[3]);
}

export async function beginPasswordRecovery(session:{userId:string;sessionHash?:string}):Promise<RecoveryAttempt> {
  const db=database(),now=Date.now(),id=crypto.randomUUID();
  const results=await db.batch([
    db.prepare('UPDATE auth_fence SET epoch=epoch+1 WHERE id=1'),
    db.prepare(`UPDATE auth_users SET session_epoch=(SELECT epoch FROM auth_fence WHERE id=1),recovery_id=?,recovery_until=?
      WHERE id=? AND recovery_id IS NULL AND EXISTS(SELECT 1 FROM auth_sessions s
      WHERE s.hash=? AND s.user_id=auth_users.id AND s.epoch=auth_users.session_epoch AND s.recovery=1 AND s.expires>?)`)
      .bind(id,now+RECOVERY_LEASE_MS,session.userId,session.sessionHash||'',now),
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND recovery_id=?)').bind(session.userId,session.userId,id),
    db.prepare("INSERT INTO security_audit(id,company_id,actor,action,target,created) SELECT ?,NULL,id,'password.recovery_attempt','',? FROM auth_users WHERE id=? AND recovery_id=?").bind(id,now,session.userId,id),
    db.prepare('SELECT session_epoch AS epoch FROM auth_users WHERE id=? AND recovery_id=?').bind(session.userId,id),
  ]);
  // Use the committed claim, not D1 change-count acknowledgments. A revoked
  // recovery cookie or a simultaneous reset cannot authorize another PUT.
  epochFrom(results[4]);
  return {id,userId:session.userId};
}

export async function finishPasswordRecovery(attempt:RecoveryAttempt,outcome:'recovered'|'failed'|'unknown') {
  const db=database(),action=outcome==='recovered'?'password.recovered':'password.recovery_'+outcome;
  await db.batch([
    db.prepare('UPDATE auth_fence SET epoch=epoch+1 WHERE id=1'),
    db.prepare(`UPDATE auth_users SET session_epoch=(SELECT epoch FROM auth_fence WHERE id=1),
      recovery_until=CASE WHEN recovery_id=? THEN 0 ELSE recovery_until END,
      recovery_id=CASE WHEN recovery_id=? THEN NULL ELSE recovery_id END WHERE id=?`).bind(attempt.id,attempt.id,attempt.userId),
    db.prepare('INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES (?,NULL,?,?,?,?)').bind(attempt.id+':finished',attempt.userId,action,'',Date.now()),
  ]);
  // Even failure/timeout invalidates all proofs begun during recovery. A late
  // completion also advances the cutoff, without unlocking a newer recovery.
}
