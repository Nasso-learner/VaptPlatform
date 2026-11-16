import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, clearSessionCookies } from "@/server/session";

export async function POST() {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  const refresh = jar.get(REFRESH_COOKIE)?.value;

  // Best effort: blacklist the refresh token so a stolen copy is useless. Local sign-out succeeds regardless.
  if (refresh) {
    await fetch(`${API_URL}/auth/logout/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
    }).catch(() => undefined);
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
}
