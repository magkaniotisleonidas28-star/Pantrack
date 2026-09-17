declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    STRIPE_SECRET_KEY?: string;
    VENDOR_ENCRYPTION_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
