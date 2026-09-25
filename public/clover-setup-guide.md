# Connect Clover to Pantrack

This development build implements Clover North America OAuth v2 authorization,
encrypted token storage, token refresh/recovery, disconnection, menu loading,
and an owner-triggered sales sync against the M4 event service. Sales sync has a
separate server gate, off by default and limited to sandbox. No live merchant
or Clover sandbox sale has been tested yet. Scheduled polling is not provisioned.

## One-time developer setup

1. Create a Clover developer account and a sandbox web app for Pantrack. Use a server-side authorization-code integration (high-trust app). Configure read access to merchant information, inventory/menu items, orders, and payment timing. Do not request payment creation or inventory write access.
2. Set the Clover app Site URL to the exact HTTPS origin configured as Pantrack's
   `APP_ORIGIN`, with no trailing path. For local sandbox testing, use
   `http://127.0.0.1:5173` only if Clover accepts an HTTP loopback callback.
3. Register the exact callback shown in Pantrack's Clover setup panel. It is
   `${APP_ORIGIN}/api/clover/callback`; do not reuse an old ChatGPT Site URL or a
   preview URL that can change.
4. Configure these server runtime values, never browser code or source control:
   - CLOVER_ENVIRONMENT: sandbox initially; production for North America live accounts.
   - CLOVER_CLIENT_ID: the matching Clover app ID.
   - CLOVER_CLIENT_SECRET: the matching Clover app secret, stored as a secret.
   - VENDOR_ENCRYPTION_KEY: already used by Pantrack for encrypted credentials. Preserve its existing value.
5. For B7 only, install/authorize the app for a fictional sandbox merchant. Configure the HTTPS webhook URL `${APP_ORIGIN}/api/clover/webhook`, subscribe to order events, and store Clover's `X-Clover-Auth` code as the server secret `CLOVER_WEBHOOK_AUTH_CODE`. Enable `PANTRACK_CLOVER_SYNC_ENABLED=enabled` only after the sandbox setup and B7 test approval. Production installation and distribution need separate review; this sync gate does not enable production.

## In Pantrack

The company owner opens Setup & register, chooses Connect Clover, authorizes on Clover, and returns to Pantrack. Load Clover menu items and modifiers, then map each native item or variation to an active exact recipe and each modifier to an active recipe modifier. Existing CSV mappings are retained but are not trusted for native sales until reviewed and mapped here. The merchant ID is bound on the server. Menu loading and mapping never deduct inventory.

When the separate sandbox sync gate is enabled, Sync now scans orders created
from connection time onward. The owner chose to deduct for fully paid orders;
payment time determines the stock-count cutoff. An unmapped item or modifier
holds the whole sale. Refunds and cancellations do not restore stock automatically.
Connections made before the B6 migration need one owner reconnection to set a
new initial-sync starting point; the migration does not invent one.

Use one company per pilot merchant. Keep recipe units and supplier pack conversions consistent. Authorizing the connection is not proof of live sales sync: that stage is still pending.

## Testing and operation

Verify sandbox authorization, callback validation, menu access, pagination, expiration/refresh and disconnection before switching to production. If token refresh fails, reconnect. Disconnecting removes Pantrack's stored tokens; remove the app in Clover as well to revoke provider-side authorization. Mappings and historical data remain.

Next stage: B7 tests the adapter against a fictional Clover sandbox merchant,
including webhook retries and reconciliation. Later operations work provisions
the polling schedule and alerts. Keep automated purchasing paused.

Official Clover references:
- https://docs.clover.com/dev/docs/generate-an-oauth-api-token-or-access_token
- https://docs.clover.com/dev/docs/refresh-access-tokens
- https://docs.clover.com/dev/reference/inventorygetitems
