import { ACCESS_COOKIE, REFRESH_COOKIE, configuredApplicationUrl, safeRelativeReturnPath, supabaseConfiguration, verifiedSupabaseUser } from "@/app/chatgpt-auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { z } from "zod";

const credentials = z.object({ email: z.string().trim().email().max(320), password: z.string().min(12).max(200) });
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("signIn"), ...credentials.shape, returnTo: z.string().default("/") }),
  z.object({ action: z.literal("signUp"), ...credentials.shape }),
  z.object({ action: z.literal("requestRecovery"), email: z.string().trim().email().max(320) }),
  z.object({ action: z.literal("updatePassword"), password: z.string().min(12).max(200) }),
  z.object({ action: z.literal("establishSession"), accessToken: z.string().min(20).max(10_000), refreshToken: z.string().min(20).max(10_000), returnTo: z.string().default("/") }),
  z.object({ action: z.literal("signOut") }),
]);
type Session = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };

function appOrigin(request: Request): string | null {
  const candidate = configuredApplicationUrl() || new URL(request.url).origin;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname)) return parsed.origin;
  } catch { /* Invalid configuration. */ }
  return null;
}

function authHeaders(key: string, access?: string): HeadersInit {
  return { apikey: key, "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) };
}

async function authRequest(path: string, init: RequestInit): Promise<Response> {
  const config = supabaseConfiguration();
  if (!config) throw new Error("Supabase authentication is not configured.");
  return fetch(`${config.url}/auth/v1/${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
}

function addCookie(response: Response, name: string, value: string, maxAge: number, secure: boolean): void {
  response.headers.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
}

function clearSession(response: Response, secure: boolean): void {
  addCookie(response, ACCESS_COOKIE, "", 0, secure);
  addCookie(response, REFRESH_COOKIE, "", 0, secure);
}

function sessionResponse(session: Session, request: Request, returnTo: string): Response {
  if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") throw new Error("Supabase did not return a session.");
  const response = Response.json({ ok: true, returnTo: safeRelativeReturnPath(returnTo) });
  const secure = new URL(request.url).protocol === "https:";
  const expires = typeof session.expires_in === "number" && Number.isInteger(session.expires_in) ? Math.min(Math.max(session.expires_in, 60), 86_400) : 3_600;
  addCookie(response, ACCESS_COOKIE, session.access_token, expires, secure);
  addCookie(response, REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30, secure);
  return response;
}

function error(message: string, status = 400): Response { return Response.json({ error: message }, { status }); }

export async function GET(request: Request): Promise<Response> {
  const config = supabaseConfiguration();
  if (!config) return Response.json({ configured: false }, { headers: { "Cache-Control": "no-store" } });
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${REFRESH_COOKIE}=([^;]+)`));
  if (!match) return Response.json({ configured: true, user: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const refresh = decodeURIComponent(match[1]);
    const refreshed = await authRequest("token?grant_type=refresh_token", { method: "POST", headers: authHeaders(config.key), body: JSON.stringify({ refresh_token: refresh }) });
    if (!refreshed.ok) { const response = Response.json({ configured: true, user: null }); clearSession(response, new URL(request.url).protocol === "https:"); return response; }
    const session = await refreshed.json() as Session;
    const user = await verifiedSupabaseUser(String(session.access_token ?? ""));
    if (!user) return error("Your session could not be verified. Please sign in again.", 401);
    const response = sessionResponse(session, request, "/");
    response.headers.set("Content-Type", "application/json");
    return response;
  } catch { return error("Authentication is temporarily unavailable.", 503); }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request) || !request.headers.get("content-type")?.startsWith("application/json")) return error("Invalid request origin.", 403);
  let body: z.infer<typeof action>;
  try { body = action.parse(await request.json()); } catch { return error("Enter a valid email address and password."); }
  const config = supabaseConfiguration();
  if (!config) return error("Supabase authentication is not configured.", 503);
  const origin = appOrigin(request);
  if (!origin) return error("Pantrack authentication URL is not configured.", 503);
  try {
    if (body.action === "signOut") { const response = Response.json({ ok: true }); clearSession(response, new URL(request.url).protocol === "https:"); return response; }
    if (body.action === "establishSession") {
      if (!await verifiedSupabaseUser(body.accessToken)) return error("Your sign-in link could not be verified.", 401);
      return sessionResponse({ access_token: body.accessToken, refresh_token: body.refreshToken }, request, body.returnTo);
    }
    if (body.action === "signIn") {
      const response = await authRequest("token?grant_type=password", { method: "POST", headers: authHeaders(config.key), body: JSON.stringify({ email: body.email, password: body.password }) });
      if (!response.ok) return error("Email or password is incorrect.", 401);
      return sessionResponse(await response.json() as Session, request, body.returnTo);
    }
    if (body.action === "signUp") {
      const response = await authRequest("signup", { method: "POST", headers: authHeaders(config.key), body: JSON.stringify({ email: body.email, password: body.password, redirect_to: `${origin}/auth/confirm` }) });
      if (!response.ok) return error("Unable to create that account. Try a different email address.");
      const session = await response.json() as Session;
      if (session.access_token && session.refresh_token) return sessionResponse(session, request, "/");
      return Response.json({ ok: true, confirmationRequired: true });
    }
    if (body.action === "requestRecovery") {
      await authRequest("recover", { method: "POST", headers: authHeaders(config.key), body: JSON.stringify({ email: body.email, redirect_to: `${origin}/auth/reset` }) });
      return Response.json({ ok: true });
    }
    const access = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`))?.[1];
    if (!access || !await verifiedSupabaseUser(decodeURIComponent(access))) return error("Sign in through your recovery link before changing your password.", 401);
    const response = await authRequest("user", { method: "PUT", headers: authHeaders(config.key, decodeURIComponent(access)), body: JSON.stringify({ password: body.password }) });
    if (!response.ok) return error("Unable to change password. Request a new recovery link.");
    return Response.json({ ok: true });
  } catch { return error("Authentication is temporarily unavailable.", 503); }
}
