// Separate explicit local profile; ordinary cart preview keeps transport off.
process.env.PANTRACK_CART_WORKER_LOCAL='enabled';
await import('./cart-preview.mjs');
