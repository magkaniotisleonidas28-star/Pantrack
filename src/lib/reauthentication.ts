// Dependency-free so services and their offline tests share the same rule.
export const REAUTHENTICATION_WINDOW_MS=5*60*1000;
export type ReauthenticationState={reauthenticatedAt?:number;recovery?:boolean};
export function recentlyVerified(user:ReauthenticationState,now=Date.now()){
  return !user.recovery && !!user.reauthenticatedAt && user.reauthenticatedAt>now-REAUTHENTICATION_WINDOW_MS;
}
