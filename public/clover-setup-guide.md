# Connect Clover to Pantrack

This release implements Clover North America OAuth v2 authorization, encrypted token storage, token refresh, disconnection, and paginated menu loading. It does not yet import Clover orders or run background sales synchronization. No live merchant has been tested.

## One-time developer setup

1. Create a Clover developer account and a sandbox web app for Pantrack. Use a server-side authorization-code integration (high-trust app). Configure read access to merchant information and inventory/menu items. Orders read access will also be needed for the upcoming sales integration; do not request payment creation or inventory write access for this flow.
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
5. Install/authorize the app for a sandbox merchant. Production installation and distribution depend on Clover's requirements for your app; complete Clover's required review and permissions process before using live customer accounts. Sandbox credentials cannot connect live accounts.

## In Pantrack

The company owner opens Setup & register, chooses Connect Clover, authorizes on Clover, and returns to Pantrack. Then choose Load Clover menu and Map to recipe for each item. Merchant ID fills the mapping location automatically; provider is Clover. Recipes must already exist. Menu loading never deducts inventory.

Use one company per pilot merchant. Keep recipe units and supplier pack conversions consistent. Authorizing the connection is not proof of live sales sync: that stage is still pending.

## Testing and operation

Verify sandbox authorization, callback validation, menu access, pagination, expiration/refresh and disconnection before switching to production. If token refresh fails, reconnect. Disconnecting removes Pantrack's stored tokens; remove the app in Clover as well to revoke provider-side authorization. Mappings and historical data remain.

Next engineering stage: read completed Clover orders, map line items and modifiers, block unmapped/custom items, establish an opening-count cutoff, deduplicate by merchant/order/line identity, handle revisions and refunds without restoring consumed ingredients, then add scheduled sync and failure alerts. Keep automated purchasing paused during this validation.

Official Clover references:
- https://docs.clover.com/dev/docs/generate-an-oauth-api-token-or-access_token
- https://docs.clover.com/dev/docs/refresh-access-tokens
- https://docs.clover.com/dev/reference/inventorygetitems
