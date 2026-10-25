/** Tiny API client: bearer token, JSON, typed errors, one 401 event. */
const TOKEN_KEY = "heyclaw.token";

let token = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

export const auth = {
  get token() {
    return token;
  },
  set(next) {
    token = next;
    try {
      localStorage.setItem(TOKEN_KEY, next);
    } catch {
      /* private mode: the httpOnly cookie still carries the session */
    }
  },
  clear() {
    token = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details || null;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const message = payload?.error || `Request failed (${res.status})`;
    if (res.status === 401) {
      auth.clear();
      window.dispatchEvent(new CustomEvent("hc:unauthorized"));
    }
    throw new ApiError(message, res.status, payload?.details);
  }
  return payload;
}

export const sseUrl = () =>
  `/api/events${auth.token ? `?token=${encodeURIComponent(auth.token)}` : ""}`;

/** Subscribe to the server-sent event stream; returns a disposer. */
export function connectEvents(handlers = {}) {
  let source = null;
  let retry = 0;
  let closed = false;
  let timer = null;

  const open = () => {
    if (closed) return;
    source = new EventSource(sseUrl());
    source.addEventListener("ready", () => {
      retry = 0;
      handlers.onStatus?.("online");
    });
    const forward = (name) => {
      source.addEventListener(name, (event) => {
        let data = {};
        try {
          data = JSON.parse(event.data);
        } catch {
          data = {};
        }
        handlers.onEvent?.(name, data);
      });
    };
    [
      "event",
      "session.started",
      "session.ended",
      "session.deleted",
      "sessions.cleared",
      "memory.created",
      "memory.updated",
      "memory.deleted",
      "nudge.created",
      "nudge.updated",
      "nudge.deleted",
      "nudge.fired",
      "device.created",
      "device.updated",
      "device.deleted",
      "connection.updated",
    ].forEach(forward);

    source.onerror = () => {
      handlers.onStatus?.("offline");
      source?.close();
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      clearTimeout(timer);
      timer = setTimeout(open, 800 * retry);
    };
  };

  open();

  return () => {
    closed = true;
    clearTimeout(timer);
    source?.close();
  };
}
