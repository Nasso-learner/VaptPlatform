import "server-only";

import type { NextResponse } from "next/server";

/** Backend base URL, server-side only (the browser never talks to Django directly). */
export const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");

export const ACCESS_COOKIE = "vapt_access";
export const REFRESH_COOKIE = "vapt_refresh";

const ACCESS_MAX_AGE = 30 * 60; // matches SIMPLE_JWT ACCESS_TOKEN_LIFETIME
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // matches REFRESH_TOKEN_LIFETIME

export type Tokens = { access: string; refresh: string };

const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

function options(maxAge: number) {
  // httpOnly: page JavaScript (and therefore any XSS) can never read the tokens.
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}

export function setSessionCookies(response: NextResponse, tokens: Tokens) {
  response.cookies.set(ACCESS_COOKIE, tokens.access, options(ACCESS_MAX_AGE));
  response.cookies.set(REFRESH_COOKIE, tokens.refresh, options(REFRESH_MAX_AGE));
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", { ...options(0), maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...options(0), maxAge: 0 });
}

// Refresh tokens rotate and are single-use. When a page fires several requests at once after the access token
// expired, they all carry the same old refresh token: share one refresh call so only the first doesn't lock the rest out.
const inflight = new Map<string, { result: Promise<Tokens | null>; expires: number }>();

export function refreshTokens(refresh: string): Promise<Tokens | null> {
  const now = Date.now();
  for (const [key, entry] of inflight) if (entry.expires < now) inflight.delete(key);
  const existing = inflight.get(refresh);
  if (existing) return existing.result;

  const result = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access: string; refresh?: string };
      return { access: data.access, refresh: data.refresh ?? refresh };
    } catch {
      return null;
    }
  })();
  inflight.set(refresh, { result, expires: now + 30_000 });
  return result;
}
