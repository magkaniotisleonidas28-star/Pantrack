import {cloverPosAdapter} from './clover-pos-adapter';
import {unavailablePosAdapter, requireSupported, type PosAdapter, type PosCapabilities} from './pos-adapter';

export type PosAvailability = {
  provider: string;
  capabilities: PosCapabilities;
  native: {
    state: 'setup_required' | 'disconnected' | 'authorized' | 'degraded';
    sync: 'unavailable' | 'not_connected' | 'paused' | 'ready' | 'degraded';
    reason: 'adapter_not_implemented' | 'app_setup_required' | 'environment_mismatch' | 'status_unavailable' | null;
    sandboxAccepted: boolean;
  };
  fallbacks: {csv: true; bridge: 'disabled' | 'configured' | 'received'; lastReceived: string | null};
};

export function posAdapter(provider: string): PosAdapter {
  return provider === 'clover' ? cloverPosAdapter : unavailablePosAdapter(provider);
}

/** Read-only local evidence. No provider request, token decrypt, or inventory write. */
export async function posAvailability(companyId: string, provider: string, bridgeEnabled: boolean, lastReceived: string | null): Promise<PosAvailability> {
  const adapter = posAdapter(provider);
  const base = {provider, capabilities: {...adapter.capabilities}, fallbacks: {
    csv: true as const, bridge: bridgeEnabled ? lastReceived ? 'received' as const : 'configured' as const : 'disabled' as const, lastReceived,
  }};
  const authorization = await adapter.authorizationStatus(companyId).catch(() => null);
  if (!authorization) return {...base, native: {state: 'degraded', sync: 'unavailable', reason: 'status_unavailable', sandboxAccepted: false}};
  if (authorization.kind === 'unsupported') return {...base, native: {state: 'setup_required', sync: 'unavailable', reason: authorization.reason === 'adapter_not_implemented' ? 'adapter_not_implemented' : 'status_unavailable', sandboxAccepted: false}};
  const auth = authorization.value;
  const sandboxAccepted = provider === 'clover' && auth.environment === 'sandbox';
  if (!auth.configured || !auth.environmentMatches) return {...base, native: {state: 'setup_required', sync: 'not_connected', reason: auth.configured ? 'environment_mismatch' : 'app_setup_required', sandboxAccepted}};
  if (!auth.connected) return {...base, native: {state: 'disconnected', sync: 'not_connected', reason: null, sandboxAccepted}};
  try {
    const health = requireSupported(await adapter.health(companyId));
    if (!health) return {...base, native: {state: 'degraded', sync: 'unavailable', reason: 'status_unavailable', sandboxAccepted}};
    const degraded = !!health.lastError || health.heldCount > 0;
    return {...base, native: {state: degraded ? 'degraded' : 'authorized', sync: health.enabled ? degraded ? 'degraded' : 'ready' : 'paused', reason: null, sandboxAccepted}};
  } catch {
    return {...base, native: {state: 'degraded', sync: 'unavailable', reason: 'status_unavailable', sandboxAccepted}};
  }
}
