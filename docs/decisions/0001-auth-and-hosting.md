# Authentication and hosting decision

Date: 2026-09-18

Pantrack uses Supabase Auth for email and password accounts. The Worker verifies each Supabase access token with Supabase before serving protected data. Browser session tokens are held in secure, HTTP-only cookies; hosted requests never accept identity headers.

The target Cloudflare Worker is named `pantrack`. Its default address is `https://pantrack.magkaniotisleonidas28.workers.dev` after deployment. Set this address as `PANTRACK_APP_URL` and in the Supabase Site URL and redirect URL allow list before testing email confirmation or password recovery.

Each company has scoped memberships. Owners manage members and ownership, managers can manage operational data, and employees have read access. Invitations bind to the invited email address, expire after seven days, and are single use. Pantrack returns a shareable invitation link to the owner; automatic invitation email delivery is not configured yet.
