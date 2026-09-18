import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export const ACCESS_COOKIE = "pantrack_access";
export const REFRESH_COOKIE = "pantrack_refresh";
const LOCAL_AUTH_ENABLED = "PANTRACK_LOCAL_AUTH";
const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

type Runtime = Record<string, string | undefined>;
type SupabaseUser = {
  id?: unknown;
  email?: unknown;
  user_metadata?: { full_name?: unknown; name?: unknown };
};

function runtime(): Runtime { return env as unknown as Runtime; }

export function supabaseConfiguration(): { url: string; key: string } | null {
  const configured = runtime();
  const url = configured.SUPABASE_URL?.trim();
  const key = configured.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || !parsed.hostname.endsWith(".supabase.co")) return null;
    return { url: parsed.origin, key };
  } catch { return null; }
}

export function configuredApplicationUrl(): string | null {
  const value = runtime().PANTRACK_APP_URL?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname) ? parsed.origin : null;
  } catch { return null; }
}

export async function verifiedSupabaseUser(accessToken: string): Promise<ChatGPTUser | null> {
  const config = supabaseConfiguration();
  if (!config || !accessToken || accessToken.length > 10_000) return null;
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.key, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const user = await response.json() as SupabaseUser;
    if (typeof user.id !== "string" || !user.id || typeof user.email !== "string" || !user.email) return null;
    const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
    const fullName = typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : null;
    return { userId: user.id, email: user.email, fullName, displayName: fullName ?? user.email };
  } catch { return null; }
}

function localFixtureUser(requestHeaders: Headers): ChatGPTUser | null {
  if (runtime()[LOCAL_AUTH_ENABLED] !== "1") return null;
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;
  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName = encodedFullName && requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
    ? safeDecodeURIComponent(encodedFullName) : null;
  return { userId, displayName: fullName ?? email, email, fullName };
}

// Kept for existing route imports and mocked test modules. In deployed Workers
// this verifies a Supabase token and never trusts request identity headers.
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const local = localFixtureUser(requestHeaders);
  if (local) return local;
  const access = (await cookies()).get(ACCESS_COOKIE)?.value;
  return access ? verifiedSupabaseUser(access) : null;
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(`/auth/sign-in?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`);
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}

function safeDecodeURIComponent(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}
