import handler from 'vinext/server/fetch-handler';
import { runScheduledCloverSync } from './lib/clover-scheduled';

/**
 * Pantrack's Worker: vinext serves every request, and the 10-minute trigger
 * in wrangler.jsonc checks Clover (decision 0012, step P3). The check does
 * nothing unless Clover sales sync is turned on for the site.
 */
const worker = {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return handler.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledCloverSync().then(
        (run) =>
          console.log(
            JSON.stringify({
              event: 'clover.scheduled_sync',
              skipped: run.skipped ?? null,
              cafes: run.cafes.map(({ outcome, passes, created, paused }) => ({
                outcome,
                passes,
                created,
                paused,
              })),
            }),
          ),
        () => console.error('Scheduled Clover check could not run.'),
      ),
    );
  },
};

export default worker;
