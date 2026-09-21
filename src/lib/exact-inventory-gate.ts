import {env} from 'cloudflare:workers';

/**
 * A4 is deliberately dark until B4 switches sales ingestion and inventory
 * consumption together. Only the exact literal "enabled" opens the preview.
 */
export function exactInventoryPreviewEnabled() {
  return (env as unknown as {PANTRACK_EXACT_INVENTORY_PREVIEW?: string})
    .PANTRACK_EXACT_INVENTORY_PREVIEW === 'enabled';
}
