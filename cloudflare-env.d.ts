declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    APP_ORIGIN?: string;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    AUTH_ENCRYPTION_KEY?: string;
    STRIPE_SECRET_KEY?: string;
    VENDOR_ENCRYPTION_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
