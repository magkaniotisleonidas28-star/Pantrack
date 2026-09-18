export function isSameOriginMutation(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

export function requireJsonMutation(request: Request): string | null {
  if (!isSameOriginMutation(request)) return "Invalid request origin.";
  if (!request.headers.get("content-type")?.startsWith("application/json")) return "JSON required.";
  return null;
}
