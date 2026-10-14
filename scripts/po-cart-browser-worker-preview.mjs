// Default off; enables only the existing loopback fictional API/storefront profile.
process.env.PANTRACK_CART_BROWSER_LOCAL='enabled';
process.env.PANTRACK_CART_WORKER_LOCAL='enabled';
await import('./cart-preview.mjs');
