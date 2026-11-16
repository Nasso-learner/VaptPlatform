import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, clearSessionCookies, refreshTokens, setSessionCookies, type Tokens } from "@/server/session";

/**
 * Authenticated pass-through to the Django API.
 * The browser only ever sends its httpOnly cookies here; this handler turns them into a Bearer token,
 * transparently refreshes an expired access token, and forwards the response (including report downloads).
 */
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "x-content-type-options", "content-security-policy"];

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.some((segment) => segment === ".." || segment === "." || segment.includes("/") || segment.includes("\\"))) {
    return NextResponse.json({ detail: "Bad path." }, { status: 400 });
  }
  const joined = path.join("/");
  // Sign-in goes through /api/auth/login so tokens land in cookies instead of the response body.
  if (joined.startsWith("auth/token")) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const target = `${API_URL}/${joined}/${request.nextUrl.search}`; // Django routes end with a slash
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const contentType = request.headers.get("content-type");

  const call = (token?: string) =>
    fetch(target, {
      method: request.method,
      headers: {
        Accept: request.headers.get("accept") ?? "application/json",
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      redirect: "manual",
      cache: "no-store",
    });

  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let rotated: Tokens | null = null;

  try {
    let upstream = access ? await call(access) : null;
    if ((!upstream || upstream.status === 401) && refresh) {
      rotated = await refreshTokens(refresh);
      if (!rotated) {
        const expired = NextResponse.json({ detail: "Session expired. Please sign in again." }, { status: 401 });
        clearSessionCookies(expired);
        return expired;
      }
      upstream = await call(rotated.access);
    }
    upstream ??= await call(undefined); // public endpoints (auth config, registration)

    const headers = new Headers();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers });
    if (rotated) setSessionCookies(response, rotated);
    return response;
  } catch {
    return NextResponse.json({ detail: "The API is unreachable. Is the backend running?" }, { status: 502 });
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
