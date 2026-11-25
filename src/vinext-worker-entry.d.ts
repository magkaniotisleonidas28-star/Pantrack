// vinext resolves this module at build time to the App Router request handler.
declare module 'virtual:vinext-worker-entry' {
  const handler: {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Response | Promise<Response>;
  };
  export default handler;
}
