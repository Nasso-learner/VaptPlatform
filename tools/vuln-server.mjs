// Intentionally vulnerable test target for DAST. Binds to localhost only. Never deploy.
// Usage: node scripts/vuln-server.mjs   → http://localhost:4000
import http from "http";

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://x"); } catch { return res.writeHead(400).end(); }
  const origin = req.headers.origin;
  const headers = { "Content-Type": "text/html", "X-Powered-By": "Express 4.16.0", "Set-Cookie": "session=abc123; Path=/" };
  if (origin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" });

  if (url.pathname === "/.env") return res.writeHead(200, headers).end("DB_PASSWORD=hunter2\nAPI_KEY=xyz\n");
  if (url.pathname === "/.git/HEAD") return res.writeHead(200, headers).end("ref: refs/heads/main\n");
  if (url.pathname === "/search") return res.writeHead(200, headers).end(`<h1>Results for ${url.searchParams.get("q")}</h1>`); // reflected XSS
  if (url.pathname === "/") return res.writeHead(200, headers).end(`<form action="/search"><input name="q"><button>Go</button></form><a href="/search?q=test">search</a>`);
  res.writeHead(500, headers).end(`Traceback (most recent call last):\n  File "app.py", line 10\nKeyError: '${url.pathname}'`);
}).listen(4000, "127.0.0.1", () => console.log("vulnerable target on http://localhost:4000"));
