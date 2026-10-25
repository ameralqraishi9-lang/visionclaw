/**
 * Hey Claw server.
 *
 *   node src/server.js            # http://localhost:3000
 *   PORT=8080 npm start
 *
 * Serves the JSON API, the SSE event stream, and the static client from one
 * process. No build step, no bundle, no runtime dependencies.
 */
import { createServer } from "node:http";
import { join } from "node:path";
import { ROOT, get, run } from "./db.js";
import {
  createRouter,
  sendError,
  sendJson,
  serveStatic,
  readJson,
  HttpError,
} from "./http.js";
import { publicUser, requireUser, tokenFromRequest, userFromRequest, userFromToken } from "./auth.js";
import { createHub } from "./hub.js";
import { createLiveEngine } from "./live.js";
import { registerApi } from "./api.js";
import { ensureSeed } from "./seed.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = join(ROOT, "public");

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const seededId = ensureSeed();
run("DELETE FROM auth_tokens WHERE expires_at < ?", new Date().toISOString());

const hub = createHub();
const live = createLiveEngine(hub);
live.reapStale();

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const router = createRouter();

router.public.get("/api/healthz", () => ({
  ok: true,
  uptime: Math.round(process.uptime()),
  streams: hub.count(),
}));

registerApi(router, { hub, live });

// Server-sent events. EventSource cannot set headers, so a `?token=` query
// parameter is accepted in addition to the httpOnly cookie.
router.get("/api/events", ({ req, res, user }) => {
  hub.addClient(user.id, res);
  req.on("close", () => {});
  return undefined;
});

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy": [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; "),
};

const server = createServer(async (req, res) => {
  const started = Date.now();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const { pathname, searchParams } = url;

  // ---- API ----
  if (pathname.startsWith("/api/")) {
    const match = router.match(req.method, pathname);
    if (!match) {
      const known = router.hasPath(pathname);
      sendJson(res, known ? 405 : 404, {
        error: known ? "Method not allowed" : "No such endpoint",
      });
      return;
    }
    try {
      const { route, params } = match;
      let user = null;
      if (route.auth) {
        user = userFromRequest(req);
        if (!user && pathname === "/api/events") {
          user = userFromToken(searchParams.get("token"));
        } else if (!user && searchParams.get("token")) {
          // Handy for curl/CLI use; browsers use the header or cookie.
          user = userFromToken(searchParams.get("token"));
        }
        requireUser(user);
      }
      const body =
        req.method === "POST" || req.method === "PATCH" || req.method === "PUT"
          ? await readJson(req)
          : {};
      const query = Object.fromEntries(searchParams.entries());
      const out = await route.handler({
        req,
        res,
        user,
        params,
        body,
        query,
        token: tokenFromRequest(req) || searchParams.get("token"),
        hub,
        live,
        publicUser,
      });
      if (!res.writableEnded) {
        if (out && typeof out === "object" && Number.isInteger(out.status)) {
          // Handlers may return `{ status, ...payload }` to pick a status code.
          const { status, body, ...payload } = out;
          sendJson(res, status, "body" in out ? body : payload);
        } else if (out !== undefined) {
          sendJson(res, 200, out);
        }
      }
      if (process.env.HEYCLAW_LOG !== "0") {
        console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
      return;
    } catch (err) {
      if (!res.writableEnded) sendError(res, err);
      if (err instanceof HttpError && err.status < 500) return;
      return;
    }
  }

  // ---- static ----
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  if (serveStatic(PUBLIC_DIR, pathname, res, { spaFallback: join(PUBLIC_DIR, "index.html"), req })) return;
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
});

server.listen(PORT, HOST, () => {
  const line = `Hey Claw listening on http://${HOST}:${PORT}`;
  console.log(`\n  ${line}`);
  console.log(`  Demo: demo@heyclaw.app / glasses123${seededId ? "" : " (seeding disabled)"}`);
  console.log(`  DB:   ${process.env.HEYCLAW_DB || join(ROOT, "data", "heyclaw.db")}\n`);
});

function shutdown(signal) {
  console.log(`\n[heyclaw] ${signal} — closing`);
  live.reapStale();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  console.error("[heyclaw] unhandled rejection", err);
});
