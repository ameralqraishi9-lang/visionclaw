/**
 * A very small HTTP layer: router, JSON helpers, static files.
 *
 * Deliberately dependency-free — the whole app is Node 22 + the standard
 * library, so `npm start` works on a clean checkout with no install step.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Sign in to continue") => new HttpError(401, msg);
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      keys.push(part.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { re: new RegExp(`^${source}/?$`), keys };
}

export function createRouter() {
  const routes = [];

  const add = (method, path, handler, opts = {}) => {
    routes.push({ method, path, handler, auth: opts.auth !== false, ...compile(path) });
  };

  const router = {
    get: (p, h, o) => add("GET", p, h, o),
    post: (p, h, o) => add("POST", p, h, o),
    patch: (p, h, o) => add("PATCH", p, h, o),
    put: (p, h, o) => add("PUT", p, h, o),
    delete: (p, h, o) => add("DELETE", p, h, o),
    /** Public route (no auth required). */
    public: {
      get: (p, h) => add("GET", p, h, { auth: false }),
      post: (p, h) => add("POST", p, h, { auth: false }),
    },
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.re.exec(pathname);
        if (!m) continue;
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        return { route, params };
      }
      return null;
    },
    /** 405 vs 404 for API paths. */
    hasPath(pathname) {
      return routes.some((r) => r.re.test(pathname));
    },
    routes,
  };

  return router;
}

export async function readJson(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw badRequest("Expected a JSON object body");
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error("[heyclaw]", err);
  sendJson(res, status, {
    error: status >= 500 ? "Something went wrong on our side" : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}

/** Serve a file from `root`; returns false when it is not a real file. */
export function serveStatic(root, pathname, res, { spaFallback = null, req } = {}) {
  const safeRoot = resolve(root);
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(safeRoot, rel);
  if (!file.startsWith(safeRoot + sep) && file !== safeRoot) return false;

  if (existsSync(file) && statSync(file).isFile()) {
    return streamFile(file, res, req);
  }
  // Pretty paths: /nudges -> /nudges.html when that page exists as a file.
  const html = `${file.replace(/\/$/, "")}.html`;
  if (existsSync(html) && statSync(html).isFile()) {
    return streamFile(html, res, req);
  }
  if (spaFallback && existsSync(spaFallback) && statSync(spaFallback).isFile()) {
    return streamFile(spaFallback, res, req);
  }
  return false;
}

function streamFile(file, res, req) {
  const stat = statSync(file);
  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cache = file.endsWith(".html")
    ? "no-cache"
    : "public, max-age=3600, must-revalidate";

  if (req?.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag, "cache-control": cache });
    res.end();
    return true;
  }
  res.writeHead(200, {
    "content-type": type,
    "content-length": stat.size,
    etag,
    "cache-control": cache,
  });
  createReadStream(file).pipe(res);
  return true;
}
