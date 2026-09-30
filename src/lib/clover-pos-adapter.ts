import {z} from 'zod';
import {cloverConfig, cloverConnection, cloverJson, withClover} from './clover';
import {cloverSyncStatus, syncClover} from './clover-sync';
import {cloverSource, normalizeCloverOrder, normalizeCloverDeletedOrder, type CloverOrder} from './clover-orders';
import {handleCloverWebhook} from './clover-webhook';
import {supported, type PosAdapter} from './pos-adapter';

export const cloverPosAdapter: PosAdapter = {
  providerId: 'clover',
  capabilities: {authorization: 'oauth2', locations: 'bound_location', catalog: true, incrementalSales: true, webhooks: true},
  async authorizationStatus(companyId) {
    const config = cloverConfig(), connection = await cloverConnection(companyId);
    return supported({configured: config.ready, connected: !!connection, environment: config.environment,
      locationId: connection?.merchant_id ?? null, lastChecked: connection?.last_checked ?? null,
      environmentMatches: !connection || connection.environment === config.environment});
  },
  async locations(companyId) {
    const connection = await cloverConnection(companyId);
    return supported(connection ? [{id: connection.merchant_id, environment: connection.environment}] : []);
  },
  async catalog(companyId, kind, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('Invalid catalog offset.');
    const config = cloverConfig();
    return supported(await withClover(companyId, async (connection, token) => {
      const url = config.api + '/v3/merchants/' + encodeURIComponent(connection.merchant_id) + '/' + kind + '?limit=100&offset=' + offset;
      const data = z.object({elements: z.array(z.object({id: z.string().min(1), name: z.string().optional(), deleted: z.boolean().optional(), hidden: z.boolean().optional()})).max(100)})
        .parse(await cloverJson(url, {headers: {Authorization: 'Bearer ' + token}}));
      return {locationId: connection.merchant_id, items: data.elements.filter(item => !item.deleted && !item.hidden).map(item => ({id: item.id, name: item.name || item.id})),
        nextOffset: data.elements.length === 100 ? offset + 100 : null};
    }));
  },
  async sync(companyId) { return supported(await syncClover(companyId)); },
  async webhook(request) { return supported(await handleCloverWebhook(request)); },
  async health(companyId) { return supported(await cloverSyncStatus(companyId)); },
  source(companyId, environment, locationId) { return supported(cloverSource(companyId, environment, locationId)); },
  normalizeOrder(payload, startedAt, deleted = false) {
    return supported(deleted ? normalizeCloverDeletedOrder(payload as CloverOrder, startedAt) : normalizeCloverOrder(payload as CloverOrder, startedAt));
  },
};
