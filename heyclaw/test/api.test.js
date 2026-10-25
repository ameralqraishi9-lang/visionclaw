/**
 * API tests: auth, isolation between accounts, validation, and CRUD.
 *
 *   npm test
 *
 * Boots a real server against a throwaway SQLite file, so what is tested is
 * exactly what ships (routing, cookies, validation, persistence).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_PORT || 3319);
const base = `http://127.0.0.1:${PORT}`;

let server;
/** token per account, so tests can act as different users */
const sessions = {};

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/api/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error("server did not start");
}

async function call(path, { method = "GET", body, token, raw = false } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: raw ? text : text ? JSON.parse(text) : null,
  };
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "heyclaw-test-"));
  server = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "src/server.js"],
    {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), HEYCLAW_DB: join(dir, "test.db"), HEYCLAW_LOG: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  await waitForServer();
});

after(() => {
  server?.kill("SIGKILL");
});

describe("auth", () => {
  test("signup creates an account and returns a token", async () => {
    const res = await call("/api/auth/signup", {
      method: "POST",
      body: { name: "Test Runner", email: `runner${Date.now()}@heyclaw.app`, password: "testpass123" },
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.name, "Test Runner");
    assert.equal(res.body.user.password_hash, undefined);
    sessions.runner = res.body.token;
  });

  test("signup validates input field by field", async () => {
    const res = await call("/api/auth/signup", {
      method: "POST",
      body: { name: "x", email: "not-an-email", password: "short" },
    });
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.details).sort(), ["email", "name", "password"]);
  });

  test("duplicate email is refused", async () => {
    const email = `dupe${Date.now()}@heyclaw.app`;
    const first = await call("/api/auth/signup", {
      method: "POST",
      body: { name: "Dupe One", email, password: "testpass123" },
    });
    assert.equal(first.status, 201);
    const second = await call("/api/auth/signup", {
      method: "POST",
      body: { name: "Dupe Two", email, password: "testpass123" },
    });
    assert.equal(second.status, 409);
  });

  test("bad password is rejected", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      body: { email: "demo@heyclaw.app", password: "wrong-password" },
    });
    assert.equal(res.status, 401);
  });

  test("demo login works and sets an httpOnly cookie", async () => {
    const res = await call("/api/auth/demo", { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    const cookie = res.headers.get("set-cookie") || "";
    assert.match(cookie, /hc_token=/);
    assert.match(cookie, /HttpOnly/);
    sessions.demo = res.body.token;
  });

  test("protected routes need a token", async () => {
    const res = await call("/api/memories");
    assert.equal(res.status, 401);
  });

  test("a bogus token is not accepted", async () => {
    const res = await call("/api/overview", { token: "not-a-real-token" });
    assert.equal(res.status, 401);
  });

  test("me returns the signed-in user", async () => {
    const res = await call("/api/auth/me", { token: sessions.runner });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, "Test Runner");
  });
});

describe("seed data", () => {
  test("demo account is alive on first load", async () => {
    const res = await call("/api/overview", { token: sessions.demo });
    assert.equal(res.status, 200);
    assert.ok(res.body.totals.memories >= 10, "memories seeded");
    assert.ok(res.body.totals.sessions >= 5, "sessions seeded");
    assert.ok(res.body.totals.connectedApps >= 4, "apps connected");
    assert.equal(res.body.chart.length, 14);
    assert.ok(res.body.devices.length >= 2);
    assert.ok(res.body.activity.length > 0);
  });

  test("a new account starts empty but usable", async () => {
    const res = await call("/api/overview", { token: sessions.runner });
    assert.equal(res.body.totals.sessions, 0);
    assert.equal(res.body.totals.memories, 1, "only the welcome memory");
    assert.equal(res.body.devices.length, 0, "no invented devices");
  });
});

describe("memories", () => {
  let id;

  test("create", async () => {
    const res = await call("/api/memories", {
      method: "POST",
      token: sessions.runner,
      body: { fact: "Prefers window seats", detail: "Always asks at check-in.", category: "preference", confidence: 90 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.memory.fact, "Prefers window seats");
    id = res.body.memory.id;
  });

  test("validation rejects an empty fact", async () => {
    const res = await call("/api/memories", {
      method: "POST",
      token: sessions.runner,
      body: { fact: "   " },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.details.fact);
  });

  test("invalid category is refused", async () => {
    const res = await call("/api/memories", {
      method: "POST",
      token: sessions.runner,
      body: { fact: "Something", category: "nonsense" },
    });
    assert.equal(res.status, 422);
  });

  test("update pins it", async () => {
    const res = await call(`/api/memories/${id}`, {
      method: "PATCH",
      token: sessions.runner,
      body: { pinned: true, confidence: 95 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.memory.pinned, true);
    assert.equal(res.body.memory.confidence, 95);
  });

  test("search finds it", async () => {
    const res = await call("/api/memories?q=window", { token: sessions.runner });
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].id, id);
  });

  test("another account cannot see or touch it", async () => {
    const list = await call("/api/memories", { token: sessions.demo });
    assert.ok(!list.body.items.some((m) => m.id === id), "memories are per-account");
    const patch = await call(`/api/memories/${id}`, {
      method: "PATCH",
      token: sessions.demo,
      body: { pinned: false },
    });
    assert.equal(patch.status, 404);
    const del = await call(`/api/memories/${id}`, { method: "DELETE", token: sessions.demo });
    assert.equal(del.status, 404);
  });

  test("delete", async () => {
    const res = await call(`/api/memories/${id}`, { method: "DELETE", token: sessions.runner });
    assert.equal(res.status, 200);
    const list = await call("/api/memories", { token: sessions.runner });
    assert.ok(!list.body.items.some((m) => m.id === id));
  });
});

describe("nudges", () => {
  let id;

  test("create", async () => {
    const res = await call("/api/nudges", {
      method: "POST",
      token: sessions.demo,
      body: {
        title: "Test nudge",
        triggerKind: "place",
        condition: "When the tests run",
        action: "Say it worked",
        priority: "high",
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.nudge.active, true);
    assert.equal(res.body.nudge.fireCount, 0);
    id = res.body.nudge.id;
  });

  test("pause and resume", async () => {
    const paused = await call(`/api/nudges/${id}`, {
      method: "PATCH",
      token: sessions.demo,
      body: { active: false },
    });
    assert.equal(paused.body.nudge.active, false);
    const firing = await call(`/api/nudges/${id}/fire`, { method: "POST", token: sessions.demo });
    assert.equal(firing.status, 400, "paused nudges do not fire");
    const resumed = await call(`/api/nudges/${id}`, {
      method: "PATCH",
      token: sessions.demo,
      body: { active: true },
    });
    assert.equal(resumed.body.nudge.active, true);
  });

  test("firing records an event and bumps the counter", async () => {
    const res = await call(`/api/nudges/${id}/fire`, { method: "POST", token: sessions.demo });
    assert.equal(res.status, 201);
    assert.ok(res.body.event.message.includes("Test nudge"));
    assert.equal(res.body.nudge.fireCount, 1);
    const list = await call("/api/nudges", { token: sessions.demo });
    assert.ok(list.body.recent.some((e) => e.nudgeId === id));
  });

  test("delete removes it", async () => {
    const res = await call(`/api/nudges/${id}`, { method: "DELETE", token: sessions.demo });
    assert.equal(res.status, 200);
    const list = await call("/api/nudges", { token: sessions.demo });
    assert.ok(!list.body.items.some((n) => n.id === id));
  });
});

describe("live sessions", () => {
  test("start, speak, and stop", async () => {
    const started = await call("/api/live/start", { method: "POST", token: sessions.runner, body: { mode: "glasses" } });
    assert.equal(started.status, 201);
    const id = started.body.session.id;
    assert.equal(started.body.session.endedAt, null);

    const say = await call("/api/live/say", {
      method: "POST",
      token: sessions.runner,
      body: { text: "remember that I take the aisle seat" },
    });
    assert.equal(say.status, 200);

    await sleep(1600);
    const state = await call("/api/live/state", { token: sessions.runner });
    assert.equal(state.body.session.id, id);
    assert.ok(state.body.session.events.some((e) => e.role === "user"));
    assert.ok(state.body.session.events.some((e) => e.role === "claw"));

    const memory = await call("/api/memories?q=aisle", { token: sessions.runner });
    assert.equal(memory.body.items.length, 1, "spoken memory is stored");

    const stopped = await call("/api/live/stop", { method: "POST", token: sessions.runner });
    assert.equal(stopped.status, 200);
    assert.ok(stopped.body.session.endedAt);
    assert.ok(stopped.body.session.durationSeconds >= 1);

    const sessionsList = await call("/api/sessions", { token: sessions.runner });
    assert.ok(sessionsList.body.items.some((s) => s.id === id));
  });

  test("speaking with no session is refused", async () => {
    const res = await call("/api/live/say", { method: "POST", token: sessions.runner, body: { text: "hello?" } });
    assert.equal(res.status, 400);
  });

  test("session detail carries the transcript", async () => {
    const list = await call("/api/sessions", { token: sessions.demo });
    const first = list.body.items[0];
    const detail = await call(`/api/sessions/${first.id}`, { token: sessions.demo });
    assert.ok(detail.body.session.events.length > 0);
    assert.ok(detail.body.session.events[0].ts);
  });
});

describe("devices, connections, settings", () => {
  test("pairing is asynchronous and lands as paired", async () => {
    const created = await call("/api/devices", {
      method: "POST",
      token: sessions.runner,
      body: { name: "Test glasses", kind: "glasses" },
    });
    assert.equal(created.status, 202);
    assert.equal(created.body.device.status, "pairing");
    await sleep(3200);
    const list = await call("/api/devices", { token: sessions.runner });
    const device = list.body.items.find((d) => d.id === created.body.device.id);
    assert.equal(device.status, "paired");
  });

  test("connect, pause, disconnect", async () => {
    const connect = await call("/api/connections/todoist/connect", { method: "POST", token: sessions.runner });
    assert.equal(connect.status, 201);
    assert.equal(connect.body.connection.status, "connected");
    const pause = await call("/api/connections/todoist", {
      method: "PATCH",
      token: sessions.runner,
      body: { status: "paused" },
    });
    assert.equal(pause.body.connection.status, "paused");
    const off = await call("/api/connections/todoist/disconnect", { method: "POST", token: sessions.runner });
    assert.equal(off.body.connection.status, "disconnected");
  });

  test("settings round-trip and validate", async () => {
    const ok = await call("/api/settings", {
      method: "PATCH",
      token: sessions.runner,
      body: { wakeWord: "Hey Vision", autonomy: "whisper", proactive: false },
    });
    assert.equal(ok.body.user.wakeWord, "Hey Vision");
    assert.equal(ok.body.user.autonomy, "whisper");
    assert.equal(ok.body.user.proactive, false);

    const bad = await call("/api/settings", { method: "PATCH", token: sessions.runner, body: { autonomy: "chaos" } });
    assert.equal(bad.status, 422);
  });

  test("password change requires the current password", async () => {
    const bad = await call("/api/settings/password", {
      method: "POST",
      token: sessions.runner,
      body: { current: "nope", next: "a-new-password" },
    });
    assert.equal(bad.status, 422);
  });

  test("export returns a complete JSON bundle", async () => {
    const res = await call("/api/export", { token: sessions.runner, raw: true });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    for (const key of ["devices", "sessions", "events", "memories", "nudges", "connections"]) {
      assert.ok(Array.isArray(data[key]), `${key} is exported`);
    }
  });
});

describe("routing", () => {
  test("unknown API path is a 404 with JSON", async () => {
    const res = await call("/api/nope", { token: sessions.demo });
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  test("wrong method is a 405", async () => {
    const res = await call("/api/overview", { method: "POST", token: sessions.demo, body: {} });
    assert.equal(res.status, 405);
  });

  test("static client is served", async () => {
    const res = await fetch(`${base}/styles.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/css/);
  });

  test("security headers are set", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  });
});
