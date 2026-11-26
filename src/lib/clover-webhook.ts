import { env } from 'cloudflare:workers';
import { database } from '@/db/raw';
import { readBoundedUtf8, BodyTooLargeError } from '@/lib/bounded-body';
import { cloverConfig } from '@/lib/clover';
import { cloverSyncBudget, cloverSyncEnabled, syncClover } from '@/lib/clover-sync';
import { captureChallenge } from '@/lib/clover-webhook-challenge';
import { cloverAccessRemoval, recordCloverAccessRemoved } from '@/lib/clover-access';
import { z } from 'zod';

const notification = z.object({
  appId: z.string(),
  merchants: z.record(
    z.array(
      z.object({
        objectId: z.string(),
        type: z.enum(['CREATE', 'UPDATE', 'DELETE']),
        ts: z.number().int(),
      }),
    ),
  ),
});

/**
 * Clover's Apps notices are "A:" events for installs, removals and
 * subscription changes. Its documentation doesn't say which type a removal
 * uses; Pantrack treats DELETE as removal. Step P5 records what the sandbox
 * actually sends, and a refused token is caught separately either way.
 */
function appRemoved(update: { objectId: string; type: string }) {
  return update.objectId.startsWith('A:') && update.type === 'DELETE';
}

function equal(left: string, right: string) {
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function handleCloverWebhook(req: Request) {
  try {
    const body = JSON.parse(await readBoundedUtf8(req, 50_000)) as unknown;
    // Clover's dashboard sends this unauthenticated challenge before it can send
    // authenticated order notifications. It cannot trigger a sales read and must
    // work while the separate sales-sync gate is still off during setup.
    const challenge = z
      .object({ verificationCode: z.string().min(1).max(200) })
      .strict()
      .safeParse(body);
    if (challenge.success) {
      await captureChallenge(challenge.data.verificationCode);
      return Response.json({ ok: true });
    }
    const code = (env as unknown as { CLOVER_WEBHOOK_AUTH_CODE?: string }).CLOVER_WEBHOOK_AUTH_CODE;
    const authenticated = !!code && equal(req.headers.get('X-Clover-Auth') ?? '', code);
    const syncEnabled = cloverSyncEnabled();
    // While sales sync is off, only an authenticated app notice is handled, so
    // removing the app in Clover is noticed even before sync is turned on.
    if (!syncEnabled) {
      const parsed = notification.safeParse(body);
      if (
        !authenticated ||
        !parsed.success ||
        !Object.values(parsed.data.merchants).some((updates) => updates.some(appRemoved))
      )
        return new Response(null, { status: 404 });
    }
    if (!authenticated) return new Response(null, { status: 401 });
    const data = notification.parse(body),
      config = cloverConfig();
    if (data.appId !== config.clientId) return new Response(null, { status: 403 });
    const db = database(),
      // One budget for this notice: Cloudflare limits requests per run.
      budget = cloverSyncBudget();
    for (const [merchantId, updates] of Object.entries(data.merchants)) {
      const connection = await db
        .prepare('SELECT company_id FROM clover_connections WHERE environment=? AND merchant_id=?')
        .bind(config.environment, merchantId)
        .first<{ company_id: string }>();
      // The café removed the app in Clover (decision 0012, step P4). A notice
      // for a merchant with no connection here changes nothing.
      if (updates.some(appRemoved)) {
        if (connection)
          await recordCloverAccessRemoved(db, {
            companyId: connection.company_id,
            environment: config.environment,
            merchantId,
            reason: 'app_removed',
          });
        continue;
      }
      if (!syncEnabled || !updates.some((update) => update.objectId.startsWith('O:'))) continue;
      if (!connection) return new Response(null, { status: 403 });
      // Clover refused access earlier: automatic reads wait until the owner reconnects.
      if (await cloverAccessRemoval(db, connection.company_id)) continue;
      await syncClover(connection.company_id, budget);
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return new Response(null, { status: 413 });
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      return new Response(null, { status: 400 });
    return new Response(null, { status: 503 });
  }
}
