import type {SalesEventDraftV1, SalesIngestionService, SalesSourceBinding} from './sales-ingestion';

/** Implemented capabilities, not a provider's advertised or planned features. */
export type PosCapabilities = {
  authorization: 'oauth2' | 'client_credentials' | 'unsupported';
  locations: 'bound_location' | 'discovery' | 'unsupported';
  catalog: boolean;
  incrementalSales: boolean;
  webhooks: boolean;
};
export type PosResult<T> = {kind: 'supported'; value: T} | {kind: 'unsupported'; reason: 'adapter_not_implemented' | 'operation_not_supported'};
export const supported = <T>(value: T): PosResult<T> => ({kind: 'supported', value});
export function requireSupported<T>(result: PosResult<T>): T {
  if (result.kind === 'unsupported') throw new Error('This POS operation is not implemented.');
  return result.value;
}
export type PosAuthorization = {
  configured: boolean;
  connected: boolean;
  environment: string;
  locationId: string | null;
  lastChecked: string | null;
  environmentMatches: boolean;
};
export type PosLocation = {id: string; environment: string};
export type PosCatalogPage = {locationId: string; items: {id: string; name: string}[]; nextOffset: number | null};
export type PosSyncResult = {scanned: number; created: number; held: number; duplicates: number; checkpoint: string};
export type PosHealth = {
  startedAt: string; checkpoint: string; lastAttempt: string | null; lastSuccess: string | null;
  lastError: string | null; heldCount: number; lagMs: number; enabled: boolean;
};

/** Server-only operations: call through an authorized company route or authenticated webhook. */
export interface PosAdapter {
  readonly providerId: string;
  readonly capabilities: PosCapabilities;
  authorizationStatus(companyId: string): Promise<PosResult<PosAuthorization>>;
  locations(companyId: string): Promise<PosResult<PosLocation[]>>;
  catalog(companyId: string, kind: 'items' | 'modifiers', offset: number): Promise<PosResult<PosCatalogPage>>;
  sync(companyId: string): Promise<PosResult<PosSyncResult>>;
  webhook(request: Request): Promise<PosResult<Response>>;
  health(companyId: string): Promise<PosResult<PosHealth | null>>;
  source(companyId: string, environment: string, locationId: string): PosResult<SalesSourceBinding>;
  normalizeOrder(payload: unknown, startedAt: number, deleted?: boolean): PosResult<SalesEventDraftV1 | null>;
}

export const unavailableCapabilities: PosCapabilities = {
  authorization: 'unsupported', locations: 'unsupported', catalog: false, incrementalSales: false, webhooks: false,
};

/** No transport, credentials, or synthetic connection for an unimplemented provider. */
export function unavailablePosAdapter(providerId: string): PosAdapter {
  const unavailable = () => ({kind: 'unsupported', reason: 'adapter_not_implemented'} as const);
  return {
    providerId, capabilities: {...unavailableCapabilities},
    authorizationStatus: async () => unavailable(), locations: async () => unavailable(),
    catalog: async () => unavailable(), sync: async () => unavailable(), webhook: async () => unavailable(),
    health: async () => unavailable(), source: unavailable, normalizeOrder: unavailable,
  };
}

/** The provider-neutral receipt boundary. Inventory receives only the existing M4 contract. */
export function receivePosEvent(service: SalesIngestionService, companyId: string, source: SalesSourceBinding, draft: SalesEventDraftV1) {
  if (source.kind !== 'native') throw new Error('A native POS source is required.');
  return service.receive({companyId, source, actor: {kind: 'machine', machineId: `${source.provider}:${companyId}`, companyId, source}}, draft);
}
