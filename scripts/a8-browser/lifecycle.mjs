// Close the exact server object acquired by this check. No PID discovery/signals.
export async function withA8Server({ createServer, run, record }) {
  let server, result, failure;
  try {
    server = await createServer((created) => {
      server = created;
    });
    result = await run(server);
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = [];
    // Persist the actual resource state before attempting cleanup.
    try {
      record('server-close-inputs', {
        acquired: Boolean(server),
        listening: server?.httpServer?.listening === true,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await server?.close();
      if (server?.httpServer?.listening) throw Error('A8 server is still listening.');
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      record('server-close-result', {
        passed: cleanupErrors.length === 0,
        listening: server?.httpServer?.listening === true,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        'A8 check or server cleanup failed.',
      );
  }
  if (failure) throw failure;
  return result;
}
