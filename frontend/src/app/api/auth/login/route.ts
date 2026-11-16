import { NextResponse } from "next/server";

import { API_URL, setSessionCookies, type Tokens } from "@/server/session";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid request." }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json({ detail: "Email and password are required." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/auth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "The API is unreachable. Is the backend running?" }, { status: 502 });
  }

  if (upstream.status === 429) {
    return NextResponse.json({ detail: "Too many attempts. Please wait a minute and try again." }, { status: 429 });
  }
  if (!upstream.ok) {
    // One generic message for wrong email, wrong password and disabled accounts alike (no account enumeration).
    return NextResponse.json({ detail: "Invalid email or password." }, { status: 401 });
  }

  const tokens = (await upstream.json()) as Tokens;
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, tokens);
  return response;
}
