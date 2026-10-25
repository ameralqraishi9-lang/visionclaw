/**
 * JSON API.
 *
 * Every handler receives a context object:
 *   { req, res, user, params, body, query, token, hub, live }
 * and returns `{ status?, body? }` (default 200 + the returned value). Throwing
 * an HttpError becomes a JSON error response.
 */
import {
  all,
  daysAgo,
  get,
  logActivity,
  nowIso,
  parseJson,
  run,
  uid,
} from "./db.js";
import { HttpError, badRequest, notFound } from "./http.js";
import {
  assertLoginAllowed,
  clearLoginFailures,
  createSession,
  createUser,
  destroyAllSessions,
  destroySession,
  noteLoginFailure,
  normalizeEmail,
  publicUser,
  updatePassword,
  validateSignup,
  verifyPassword,
} from "./auth.js";
import {
  AUTONOMY,
  LANGUAGES,
  MEMORY_CATEGORIES,
  TRIGGER_KINDS,
  VOICES,
} from "./content.js";
import { APP_CATALOG, catalogEntry } from "./catalog.js";
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoUser, seedNewUser } from "./seed.js";
import { choice, int, optionalText, text, truthy } from "./validate.js";

const COOKIE_DAYS = 30;

function setAuthCookie(res, token) {
  res.setHeader(
    "set-cookie",
    `hc_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}`
  );
}

function clearAuthCookie(res) {
  res.setHeader("set-cookie", "hc_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

/* ------------------------------------------------------------------ */
/* Serializers                                                         */
/* ------------------------------------------------------------------ */

const shapeDevice = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  model: r.model,
  firmware: r.firmware,
  battery: r.battery,
  status: r.status,
  lastSeen: r.last_seen,
  createdAt: r.created_at,
});

const shapeMemory = (r) => ({
  id: r.id,
  fact: r.fact,
  detail: r.detail,
  category: r.category,
  source: r.source,
  confidence: r.confidence,
  pinned: !!r.pinned,
  lastUsedAt: r.last_used_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const shapeNudge = (r) => ({
  id: r.id,
  title: r.title,
  triggerKind: r.trigger_kind,
  condition: r.condition,
  action: r.action,
  priority: r.priority,
  active: !!r.active,
  fireCount: r.fire_count,
  lastFiredAt: r.last_fired_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastMessage: r.last_message ?? null,
});

const shapeNudgeEvent = (r) => ({
  id: r.id,
  nudgeId: r.nudge_id,
  message: r.message,
  kind: r.kind,
  firedAt: r.fired_at,
});

const shapeSession = (r) => ({
  id: r.id,
  title: r.title,
  mode: r.mode,
  deviceId: r.device_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationSeconds: r.duration_seconds,
  summary: r.summary,
  actionsCount: r.actions_count,
  eventCount: r.event_count ?? 0,
  deviceName: r.device_name ?? null,
});

function shapeConnection(row) {
  const app = catalogEntry(row.slug);
  return {
    slug: row.slug,
    name: app?.name ?? row.slug,
    category: app?.category ?? "Other",
    blurb: app?.blurb ?? "",
    scopes: row.scopes ? row.scopes.split(",").map((s) => s.trim()).filter(Boolean) : [],
    tint: app?.tint ?? "#64748b",
    monogram: app?.monogram ?? row.slug.slice(0, 2).toUpperCase(),
    status: row.status,
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
  };
}

function shapeActivity(r) {
  return { id: r.id, kind: r.kind, message: r.message, createdAt: r.created_at };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function one(sql, ...params) {
  const row = get(sql, ...params);
  if (!row) throw notFound();
  return row;
}

function likeEscape(value) {
  return `%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function localDayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerApi(router, { hub, live }) {
  /* ---------------- auth ---------------- */

  router.public.post("/api/auth/signup", ({ res, body, req }) => {
    validateSignup(body);
    assertLoginAllowed(`signup:${req.socket.remoteAddress}`);
    const row = createUser(body);
    seedNewUser(row.id);
    const token = createSession(row.id);
    setAuthCookie(res, token);
    return { status: 201, body: { token, user: publicUser(row) } };
  });

  router.public.post("/api/auth/login", ({ req, res, body }) => {
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!email || !password) throw badRequest("Email and password are required");
    assertLoginAllowed(email);
    const row = get("SELECT * FROM users WHERE email = ?", email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      noteLoginFailure(email);
      throw new HttpError(401, "Email or password doesn't match");
    }
    clearLoginFailures(email);
    const token = createSession(row.id);
    setAuthCookie(res, token);
    return { token, user: publicUser(row) };
  });

  router.public.post("/api/auth/demo", ({ res }) => {
    let row = get("SELECT * FROM users WHERE email = ?", DEMO_EMAIL);
    if (!row) {
      seedDemoUser();
      row = get("SELECT * FROM users WHERE email = ?", DEMO_EMAIL);
    }
    const token = createSession(row.id);
    setAuthCookie(res, token);
    return { token, user: publicUser(row), demo: true };
  });

  router.get("/api/auth/me", ({ user }) => ({ user }));

  router.post("/api/auth/logout", ({ res, token, user }) => {
    destroySession(token);
    clearAuthCookie(res);
    logActivity(user.id, "account", "Signed out");
    return { ok: true };
  });

  /* ---------------- overview ---------------- */

  router.get("/api/overview", ({ user }) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const sessionTotals = get(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS seconds,
              COALESCE(SUM(actions_count), 0) AS actions
         FROM sessions WHERE user_id = ? AND started_at >= ?`,
      user.id,
      todayIso
    );
    const todayNudges =
      get("SELECT COUNT(*) AS n FROM nudge_events WHERE user_id = ? AND fired_at >= ?", user.id, todayIso)
        ?.n ?? 0;

    const totals = {
      sessions: get("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", user.id).n,
      minutes: Math.round(
        get("SELECT COALESCE(SUM(duration_seconds), 0) AS s FROM sessions WHERE user_id = ?", user.id).s / 60
      ),
      actions: get("SELECT COALESCE(SUM(actions_count), 0) AS n FROM sessions WHERE user_id = ?", user.id).n,
      memories: get("SELECT COUNT(*) AS n FROM memories WHERE user_id = ?", user.id).n,
      activeNudges: get("SELECT COUNT(*) AS n FROM nudges WHERE user_id = ? AND active = 1", user.id).n,
      connectedApps: get(
        "SELECT COUNT(*) AS n FROM connections WHERE user_id = ? AND status = 'connected'",
        user.id
      ).n,
    };

    // 14-day activity: sessions + minutes per day, nudges per day.
    const since = new Date(Date.now() - 13 * 86_400_000);
    since.setHours(0, 0, 0, 0);
    const sessionRows = all(
      `SELECT started_at, duration_seconds FROM sessions WHERE user_id = ? AND started_at >= ?`,
      user.id,
      since.toISOString()
    );
    const nudgeRows = all(
      `SELECT fired_at FROM nudge_events WHERE user_id = ? AND fired_at >= ?`,
      user.id,
      since.toISOString()
    );
    const days = [];
    for (let i = 0; i <= 13; i += 1) {
      const d = new Date(since.getTime() + i * 86_400_000);
      days.push({
        date: localDayKey(d),
        label: d.toLocaleDateString("en-US", { weekday: "short" }),
        day: d.getDate(),
        sessions: 0,
        minutes: 0,
        nudges: 0,
      });
    }
    const byKey = new Map(days.map((d) => [d.date, d]));
    for (const row of sessionRows) {
      const bucket = byKey.get(localDayKey(row.started_at));
      if (!bucket) continue;
      bucket.sessions += 1;
      bucket.minutes += row.duration_seconds / 60;
    }
    for (const row of nudgeRows) {
      const bucket = byKey.get(localDayKey(row.fired_at));
      if (bucket) bucket.nudges += 1;
    }
    for (const d of days) d.minutes = Math.round(d.minutes);

    const devices = all(
      "SELECT * FROM devices WHERE user_id = ? ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'pairing' THEN 1 ELSE 2 END, last_seen DESC",
      user.id
    ).map(shapeDevice);

    const recentSessions = all(
      `SELECT s.*, d.name AS device_name,
              (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count
         FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
        WHERE s.user_id = ? ORDER BY s.started_at DESC LIMIT 5`,
      user.id
    ).map(shapeSession);

    const topNudges = all(
      `SELECT n.*, (SELECT message FROM nudge_events e WHERE e.nudge_id = n.id ORDER BY fired_at DESC LIMIT 1) AS last_message
         FROM nudges n WHERE n.user_id = ? AND n.active = 1
        ORDER BY n.fire_count DESC LIMIT 4`,
      user.id
    ).map(shapeNudge);

    const activity = all(
      "SELECT * FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 8",
      user.id
    ).map(shapeActivity);

    const active = live.activeSession(user.id);

    return {
      today: {
        sessions: sessionTotals.sessions,
        minutes: Math.round(sessionTotals.seconds / 60),
        actions: sessionTotals.actions,
        nudges: todayNudges,
      },
      totals,
      chart: days,
      devices,
      recentSessions,
      topNudges,
      activity,
      liveSession: active
        ? { id: active.id, title: active.title, startedAt: active.started_at, mode: active.mode }
        : null,
    };
  });

  /* ---------------- live sessions ---------------- */

  router.get("/api/live/state", ({ user }) => {
    const session = live.activeSession(user.id);
    return { session: session ? live.sessionPayload(session) : null };
  });

  router.post("/api/live/start", ({ user, body }) => {
    const mode = choice(body.mode, ["glasses", "phone"], {
      label: "Mode",
      field: "mode",
      fallback: "glasses",
    });
    const session = live.start(user.id, { mode, title: body.title, deviceId: body.deviceId });
    return { status: 201, session };
  });

  router.post("/api/live/say", ({ user, body }) => {
    if (!text(body.text, { label: "Message", max: 800, field: "text" })) {
      throw badRequest("Say something first");
    }
    return live.say(user.id, body.text);
  });

  router.post("/api/live/stop", ({ user }) => ({ session: live.stop(user.id) }));

  /* ---------------- sessions ---------------- */

  router.get("/api/sessions", ({ user, query }) => {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const offset = Math.max(0, Number(query.offset) || 0);
    const where = ["s.user_id = ?"];
    const params = [user.id];
    if (query.q) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\')");
      params.push(likeEscape(query.q), likeEscape(query.q));
    }
    if (query.mode && ["glasses", "phone"].includes(query.mode)) {
      where.push("s.mode = ?");
      params.push(query.mode);
    }
    if (query.range === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      where.push("s.started_at >= ?");
      params.push(start.toISOString());
    } else if (query.range === "week") {
      where.push("s.started_at >= ?");
      params.push(new Date(Date.now() - 7 * 86_400_000).toISOString());
    }
    const clause = where.join(" AND ");
    const items = all(
      `SELECT s.*, d.name AS device_name,
              (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count
         FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
        WHERE ${clause} ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    ).map(shapeSession);
    const total = get(`SELECT COUNT(*) AS n FROM sessions s WHERE ${clause}`, ...params).n;
    return { items, total };
  });

  router.get("/api/sessions/:id", ({ user, params }) => {
    const row = get(
      `SELECT s.*, d.name AS device_name,
              (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count
         FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
        WHERE s.id = ? AND s.user_id = ?`,
      params.id,
      user.id
    );
    if (!row) throw notFound("Session not found");
    const events = all(
      "SELECT id, session_id, role, text, meta, ts FROM events WHERE session_id = ? ORDER BY ts, rowid",
      row.id
    ).map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      role: e.role,
      text: e.text,
      meta: parseJson(e.meta),
      ts: e.ts,
    }));
    return { session: { ...shapeSession(row), events } };
  });

  router.patch("/api/sessions/:id", ({ user, params, body }) => {
    const row = one("SELECT * FROM sessions WHERE id = ? AND user_id = ?", params.id, user.id);
    const title = text(body.title, { label: "Title", max: 120, field: "title" });
    run("UPDATE sessions SET title = ? WHERE id = ?", title, row.id);
    logActivity(user.id, "session", `Renamed session · ${title}`);
    return { session: shapeSession(get("SELECT * FROM sessions WHERE id = ?", row.id)) };
  });

  router.delete("/api/sessions/:id", ({ user, params }) => {
    const row = one("SELECT * FROM sessions WHERE id = ? AND user_id = ?", params.id, user.id);
    run("DELETE FROM sessions WHERE id = ?", row.id);
    logActivity(user.id, "session", `Deleted session · ${row.title}`);
    hub.broadcast(user.id, "session.deleted", { id: row.id });
    return { ok: true, id: row.id };
  });

  /* ---------------- devices ---------------- */

  router.get("/api/devices", ({ user }) => ({
    items: all(
      "SELECT * FROM devices WHERE user_id = ? ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'pairing' THEN 1 ELSE 2 END, last_seen DESC",
      user.id
    ).map(shapeDevice),
  }));

  router.post("/api/devices", ({ user, body }) => {
    const kind = choice(body.kind, ["glasses", "phone", "web"], {
      label: "Device type",
      field: "kind",
      fallback: "glasses",
    });
    const name = text(body.name, { label: "Device name", max: 60, field: "name" });
    const model = optionalText(body.model, { label: "Model", max: 80, field: "model" }) ||
      (kind === "glasses" ? "Ray-Ban Meta · Wayfarer (Gen 2)" : kind === "phone" ? "Phone camera" : "Web viewer");
    const id = uid("dev");
    const at = nowIso();
    run(
      `INSERT INTO devices (id, user_id, name, kind, model, firmware, battery, status, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pairing', ?, ?)`,
      id,
      user.id,
      name,
      kind,
      model,
      kind === "web" ? "browser" : "12.4.2",
      100,
      at,
      at
    );
    const device = shapeDevice(get("SELECT * FROM devices WHERE id = ?", id));
    hub.broadcast(user.id, "device.created", { device });
    logActivity(user.id, "device", `Pairing started · ${name}`);

    // Pairing completes a moment later, exactly like a real BLE handshake.
    setTimeout(() => {
      const row = get("SELECT * FROM devices WHERE id = ?", id);
      if (!row) return;
      run("UPDATE devices SET status = 'paired', battery = 96, last_seen = ? WHERE id = ?", nowIso(), id);
      hub.broadcast(user.id, "device.updated", {
        device: shapeDevice(get("SELECT * FROM devices WHERE id = ?", id)),
      });
      logActivity(user.id, "device", `Paired · ${name}`);
    }, 2600);

    return { status: 202, device };
  });

  router.patch("/api/devices/:id", ({ user, params, body }) => {
    const row = one("SELECT * FROM devices WHERE id = ? AND user_id = ?", params.id, user.id);
    if (body.name !== undefined) {
      const name = text(body.name, { label: "Device name", max: 60, field: "name" });
      run("UPDATE devices SET name = ? WHERE id = ?", name, row.id);
    }
    if (body.status !== undefined) {
      const status = choice(body.status, ["connected", "paired", "idle", "offline"], {
        label: "Status",
        field: "status",
      });
      run("UPDATE devices SET status = ?, last_seen = ? WHERE id = ?", status, nowIso(), row.id);
    }
    const device = shapeDevice(get("SELECT * FROM devices WHERE id = ?", row.id));
    hub.broadcast(user.id, "device.updated", { device });
    return { device };
  });

  router.post("/api/devices/:id/ping", ({ user, params }) => {
    const row = one("SELECT * FROM devices WHERE id = ? AND user_id = ?", params.id, user.id);
    run("UPDATE devices SET last_seen = ?, battery = ? WHERE id = ?", nowIso(), Math.max(8, row.battery - 1), row.id);
    const device = shapeDevice(get("SELECT * FROM devices WHERE id = ?", row.id));
    hub.broadcast(user.id, "device.updated", { device });
    logActivity(user.id, "device", `Connection test · ${row.name}`);
    return { device, ok: true };
  });

  router.delete("/api/devices/:id", ({ user, params }) => {
    const row = one("SELECT * FROM devices WHERE id = ? AND user_id = ?", params.id, user.id);
    run("DELETE FROM devices WHERE id = ?", row.id);
    hub.broadcast(user.id, "device.deleted", { id: row.id });
    logActivity(user.id, "device", `Unpaired · ${row.name}`);
    return { ok: true };
  });

  /* ---------------- memories ---------------- */

  router.get("/api/memories", ({ user, query }) => {
    const where = ["user_id = ?"];
    const params = [user.id];
    if (query.q) {
      where.push("(fact LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')");
      params.push(likeEscape(query.q), likeEscape(query.q));
    }
    if (query.category && MEMORY_CATEGORIES.includes(query.category)) {
      where.push("category = ?");
      params.push(query.category);
    }
    if (query.pinned === "1" || query.pinned === "true") where.push("pinned = 1");
    const items = all(
      `SELECT * FROM memories WHERE ${where.join(" AND ")}
        ORDER BY pinned DESC, updated_at DESC`,
      ...params
    ).map(shapeMemory);
    return {
      items,
      total: items.length,
      categories: MEMORY_CATEGORIES,
    };
  });

  router.post("/api/memories", ({ user, body }) => {
    const fact = text(body.fact, { label: "Memory", max: 160, field: "fact" });
    const detail = optionalText(body.detail, { label: "Detail", max: 400, field: "detail" });
    const category = choice(body.category, MEMORY_CATEGORIES, {
      label: "Category",
      field: "category",
      fallback: "preference",
    });
    const confidence = int(body.confidence, { label: "Confidence", min: 10, max: 100, fallback: 80 });
    const pinned = truthy(body.pinned) ? 1 : 0;
    const at = nowIso();
    const id = uid("mem");
    run(
      `INSERT INTO memories (id, user_id, fact, detail, category, source, confidence, pinned, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'told', ?, ?, ?, ?, ?)`,
      id,
      user.id,
      fact,
      detail,
      category,
      confidence,
      pinned,
      at,
      at,
      at
    );
    const memory = shapeMemory(get("SELECT * FROM memories WHERE id = ?", id));
    hub.broadcast(user.id, "memory.created", { memory });
    logActivity(user.id, "memory", `Added memory · ${fact}`);
    return { status: 201, memory };
  });

  router.patch("/api/memories/:id", ({ user, params, body }) => {
    const row = one("SELECT * FROM memories WHERE id = ? AND user_id = ?", params.id, user.id);
    const sets = [];
    const values = [];
    if (body.fact !== undefined) {
      sets.push("fact = ?");
      values.push(text(body.fact, { label: "Memory", max: 160, field: "fact" }));
    }
    if (body.detail !== undefined) {
      sets.push("detail = ?");
      values.push(optionalText(body.detail, { label: "Detail", max: 400, field: "detail" }));
    }
    if (body.category !== undefined) {
      sets.push("category = ?");
      values.push(choice(body.category, MEMORY_CATEGORIES, { label: "Category", field: "category" }));
    }
    if (body.confidence !== undefined) {
      sets.push("confidence = ?");
      values.push(int(body.confidence, { label: "Confidence", min: 10, max: 100 }));
    }
    if (body.pinned !== undefined) {
      sets.push("pinned = ?");
      values.push(truthy(body.pinned) ? 1 : 0);
    }
    if (!sets.length) throw badRequest("Nothing to update");
    sets.push("updated_at = ?");
    values.push(nowIso(), row.id);
    run(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`, ...values);
    const memory = shapeMemory(get("SELECT * FROM memories WHERE id = ?", row.id));
    hub.broadcast(user.id, "memory.updated", { memory });
    return { memory };
  });

  router.delete("/api/memories/:id", ({ user, params }) => {
    const row = one("SELECT * FROM memories WHERE id = ? AND user_id = ?", params.id, user.id);
    run("DELETE FROM memories WHERE id = ?", row.id);
    hub.broadcast(user.id, "memory.deleted", { id: row.id });
    logActivity(user.id, "memory", `Forgot · ${row.fact}`);
    return { ok: true, id: row.id };
  });

  /* ---------------- nudges ---------------- */

  const nudgeSelect = `SELECT n.*,
      (SELECT message FROM nudge_events e WHERE e.nudge_id = n.id ORDER BY fired_at DESC LIMIT 1) AS last_message
    FROM nudges n`;

  router.get("/api/nudges", ({ user }) => {
    const items = all(
      `${nudgeSelect} WHERE n.user_id = ? ORDER BY n.active DESC, n.fire_count DESC`,
      user.id
    ).map(shapeNudge);
    const recent = all(
      "SELECT * FROM nudge_events WHERE user_id = ? ORDER BY fired_at DESC LIMIT 12",
      user.id
    ).map(shapeNudgeEvent);
    const firedToday =
      get(
        "SELECT COUNT(*) AS n FROM nudge_events WHERE user_id = ? AND fired_at >= ?",
        user.id,
        new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      )?.n ?? 0;
    return {
      items,
      recent,
      triggers: TRIGGER_KINDS,
      stats: {
        active: items.filter((n) => n.active).length,
        paused: items.filter((n) => !n.active).length,
        fired30d: all(
          "SELECT id FROM nudge_events WHERE user_id = ? AND fired_at >= ?",
          user.id,
          daysAgo(30, 0)
        ).length,
        firedToday,
      },
    };
  });

  router.post("/api/nudges", ({ user, body }) => {
    const title = text(body.title, { label: "Title", max: 80, field: "title" });
    const triggerKind = choice(body.triggerKind, TRIGGER_KINDS, {
      label: "Trigger",
      field: "triggerKind",
      fallback: "place",
    });
    const condition = text(body.condition, { label: "When", max: 200, field: "condition" });
    const action = text(body.action, { label: "What to say", max: 200, field: "action" });
    const priority = choice(body.priority, ["low", "normal", "high"], {
      label: "Priority",
      field: "priority",
      fallback: "normal",
    });
    const active = truthy(body.active, true) ? 1 : 0;
    const at = nowIso();
    const id = uid("ndg");
    run(
      `INSERT INTO nudges (id, user_id, title, trigger_kind, condition, action, priority, active, fire_count, last_fired_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      id,
      user.id,
      title,
      triggerKind,
      condition,
      action,
      priority,
      active,
      at,
      at
    );
    const nudge = shapeNudge(get(`${nudgeSelect} WHERE n.id = ?`, id));
    hub.broadcast(user.id, "nudge.created", { nudge });
    logActivity(user.id, "nudge", `Nudge created · ${title}`);
    return { status: 201, nudge };
  });

  router.patch("/api/nudges/:id", ({ user, params, body }) => {
    const row = one("SELECT * FROM nudges WHERE id = ? AND user_id = ?", params.id, user.id);
    const sets = [];
    const values = [];
    if (body.title !== undefined) {
      sets.push("title = ?");
      values.push(text(body.title, { label: "Title", max: 80, field: "title" }));
    }
    if (body.triggerKind !== undefined) {
      sets.push("trigger_kind = ?");
      values.push(choice(body.triggerKind, TRIGGER_KINDS, { label: "Trigger", field: "triggerKind" }));
    }
    if (body.condition !== undefined) {
      sets.push("condition = ?");
      values.push(text(body.condition, { label: "When", max: 200, field: "condition" }));
    }
    if (body.action !== undefined) {
      sets.push("action = ?");
      values.push(text(body.action, { label: "What to say", max: 200, field: "action" }));
    }
    if (body.priority !== undefined) {
      sets.push("priority = ?");
      values.push(choice(body.priority, ["low", "normal", "high"], { label: "Priority", field: "priority" }));
    }
    if (body.active !== undefined) {
      sets.push("active = ?");
      values.push(truthy(body.active) ? 1 : 0);
    }
    if (!sets.length) throw badRequest("Nothing to update");
    sets.push("updated_at = ?");
    values.push(nowIso(), row.id);
    run(`UPDATE nudges SET ${sets.join(", ")} WHERE id = ?`, ...values);
    const nudge = shapeNudge(get(`${nudgeSelect} WHERE n.id = ?`, row.id));
    hub.broadcast(user.id, "nudge.updated", { nudge });
    if (body.active !== undefined) {
      logActivity(user.id, "nudge", `${nudge.active ? "Resumed" : "Paused"} nudge · ${nudge.title}`);
    }
    return { nudge };
  });

  router.delete("/api/nudges/:id", ({ user, params }) => {
    const row = one("SELECT * FROM nudges WHERE id = ? AND user_id = ?", params.id, user.id);
    run("DELETE FROM nudges WHERE id = ?", row.id);
    hub.broadcast(user.id, "nudge.deleted", { id: row.id });
    logActivity(user.id, "nudge", `Deleted nudge · ${row.title}`);
    return { ok: true, id: row.id };
  });

  router.post("/api/nudges/:id/fire", ({ user, params }) => {
    const row = one("SELECT * FROM nudges WHERE id = ? AND user_id = ?", params.id, user.id);
    if (!row.active) throw badRequest("Resume this nudge before testing it");
    const at = nowIso();
    const message = `${row.title} · ${row.action}`;
    const id = uid("nev");
    run(
      `INSERT INTO nudge_events (id, nudge_id, user_id, message, kind, fired_at)
       VALUES (?, ?, ?, ?, 'spoken', ?)`,
      id,
      row.id,
      user.id,
      message,
      at
    );
    run(
      "UPDATE nudges SET fire_count = fire_count + 1, last_fired_at = ? WHERE id = ?",
      at,
      row.id
    );
    const event = shapeNudgeEvent(get("SELECT * FROM nudge_events WHERE id = ?", id));
    const nudge = shapeNudge(get(`${nudgeSelect} WHERE n.id = ?`, row.id));
    hub.broadcast(user.id, "nudge.fired", { event, nudge });
    logActivity(user.id, "nudge", `Nudge fired · ${row.title}`, at);
    return { status: 201, event, nudge };
  });

  router.get("/api/nudges/:id", ({ user, params }) => {
    const row = one("SELECT * FROM nudges WHERE id = ? AND user_id = ?", params.id, user.id);
    const events = all(
      "SELECT * FROM nudge_events WHERE nudge_id = ? ORDER BY fired_at DESC LIMIT 30",
      row.id
    ).map(shapeNudgeEvent);
    return { nudge: shapeNudge(get(`${nudgeSelect} WHERE n.id = ?`, row.id)), events };
  });

  /* ---------------- connections ---------------- */

  router.get("/api/connections", ({ user }) => {
    const rows = all("SELECT * FROM connections WHERE user_id = ?", user.id);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const items = APP_CATALOG.map((app) => {
      const row = bySlug.get(app.slug);
      return row
        ? shapeConnection(row)
        : {
            slug: app.slug,
            name: app.name,
            category: app.category,
            blurb: app.blurb,
            scopes: app.scopes,
            tint: app.tint,
            monogram: app.monogram,
            status: "disconnected",
            accountLabel: "",
            connectedAt: null,
          };
    });
    const categories = [...new Set(APP_CATALOG.map((a) => a.category))];
    return { items, categories };
  });

  router.post("/api/connections/:slug/connect", ({ user, params, body }) => {
    const app = catalogEntry(params.slug);
    if (!app) throw notFound("Unknown app");
    const label =
      optionalText(body.accountLabel, { label: "Account", max: 80, field: "accountLabel" }) ||
      user.email;
    const existing = get("SELECT * FROM connections WHERE user_id = ? AND slug = ?", user.id, params.slug);
    const at = nowIso();
    if (existing) {
      run(
        "UPDATE connections SET status = 'connected', account_label = ?, scopes = ?, connected_at = ? WHERE id = ?",
        label,
        app.scopes.join(", "),
        at,
        existing.id
      );
    } else {
      run(
        `INSERT INTO connections (id, user_id, slug, status, account_label, scopes, connected_at)
         VALUES (?, ?, ?, 'connected', ?, ?, ?)`,
        uid("con"),
        user.id,
        app.slug,
        label,
        app.scopes.join(", "),
        at
      );
    }
    const connection = shapeConnection(
      get("SELECT * FROM connections WHERE user_id = ? AND slug = ?", user.id, app.slug)
    );
    hub.broadcast(user.id, "connection.updated", { connection });
    logActivity(user.id, "connection", `${app.name} connected`);
    return { status: 201, connection };
  });

  router.post("/api/connections/:slug/disconnect", ({ user, params }) => {
    const row = get("SELECT * FROM connections WHERE user_id = ? AND slug = ?", user.id, params.slug);
    if (!row) throw notFound("That app is not connected");
    run("UPDATE connections SET status = 'disconnected' WHERE id = ?", row.id);
    const connection = shapeConnection(get("SELECT * FROM connections WHERE id = ?", row.id));
    hub.broadcast(user.id, "connection.updated", { connection });
    logActivity(user.id, "connection", `${connection.name} disconnected`);
    return { connection };
  });

  router.patch("/api/connections/:slug", ({ user, params, body }) => {
    const row = one("SELECT * FROM connections WHERE user_id = ? AND slug = ?", user.id, params.slug);
    const status = choice(body.status, ["connected", "paused"], { label: "Status", field: "status" });
    run("UPDATE connections SET status = ? WHERE id = ?", status, row.id);
    const connection = shapeConnection(get("SELECT * FROM connections WHERE id = ?", row.id));
    hub.broadcast(user.id, "connection.updated", { connection });
    logActivity(
      user.id,
      "connection",
      `${connection.name} ${status === "paused" ? "paused" : "resumed"}`
    );
    return { connection };
  });

  /* ---------------- settings ---------------- */

  router.patch("/api/settings", ({ user, body }) => {
    const sets = [];
    const values = [];
    if (body.name !== undefined) {
      sets.push("name = ?");
      values.push(text(body.name, { label: "Name", min: 2, max: 60, field: "name" }));
    }
    if (body.wakeWord !== undefined) {
      sets.push("wake_word = ?");
      values.push(text(body.wakeWord, { label: "Wake word", min: 2, max: 40, field: "wakeWord" }));
    }
    if (body.voice !== undefined) {
      sets.push("voice = ?");
      values.push(choice(body.voice, VOICES, { label: "Voice", field: "voice" }));
    }
    if (body.language !== undefined) {
      sets.push("language = ?");
      values.push(choice(body.language, LANGUAGES, { label: "Language", field: "language" }));
    }
    if (body.autonomy !== undefined) {
      sets.push("autonomy = ?");
      values.push(choice(body.autonomy, AUTONOMY, { label: "Autonomy", field: "autonomy" }));
    }
    if (body.proactive !== undefined) {
      sets.push("proactive = ?");
      values.push(truthy(body.proactive) ? 1 : 0);
    }
    if (body.retentionDays !== undefined) {
      sets.push("retention_days = ?");
      values.push(int(body.retentionDays, { label: "Retention", min: 1, max: 365, field: "retentionDays" }));
    }
    if (!sets.length) throw badRequest("Nothing to update");
    values.push(user.id);
    run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...values);
    const row = get("SELECT * FROM users WHERE id = ?", user.id);
    logActivity(user.id, "account", "Settings updated");
    return { user: publicUser(row) };
  });

  router.post("/api/settings/password", ({ user, body, token }) => {
    const row = get("SELECT * FROM users WHERE id = ?", user.id);
    if (!verifyPassword(String(body.current ?? ""), row.password_hash)) {
      throw new HttpError(422, "Current password is incorrect", { current: "Current password is incorrect" });
    }
    updatePassword(user.id, body.next);
    if (token) {
      destroyAllSessions(user.id);
      createSession(user.id);
    }
    logActivity(user.id, "account", "Password changed");
    return { ok: true };
  });

  router.get("/api/export", ({ user, res }) => {
    const dump = {
      exportedAt: nowIso(),
      user,
      devices: all("SELECT * FROM devices WHERE user_id = ?", user.id),
      sessions: all("SELECT * FROM sessions WHERE user_id = ?", user.id),
      events: all("SELECT * FROM events WHERE user_id = ?", user.id),
      memories: all("SELECT * FROM memories WHERE user_id = ?", user.id).map(shapeMemory),
      nudges: all("SELECT * FROM nudges WHERE user_id = ?", user.id).map(shapeNudge),
      nudgeEvents: all("SELECT * FROM nudge_events WHERE user_id = ?", user.id).map(shapeNudgeEvent),
      connections: all("SELECT * FROM connections WHERE user_id = ?", user.id).map(shapeConnection),
    };
    const body = JSON.stringify(dump, null, 2);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="heyclaw-${user.id}.json"`,
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
    return undefined;
  });

  router.post("/api/settings/clear-sessions", ({ user }) => {
    const count = get("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", user.id).n;
    run("DELETE FROM sessions WHERE user_id = ?", user.id);
    hub.broadcast(user.id, "sessions.cleared", { count });
    logActivity(user.id, "account", `Deleted all session history (${count})`);
    return { ok: true, count };
  });

  /* ---------------- search ---------------- */

  router.get("/api/search", ({ user, query }) => {
    const q = String(query.q || "").trim();
    if (q.length < 1) return { q, memories: [], nudges: [], sessions: [] };
    const like = likeEscape(q);
    return {
      q,
      memories: all(
        `SELECT * FROM memories WHERE user_id = ? AND (fact LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\') LIMIT 5`,
        user.id,
        like,
        like
      ).map(shapeMemory),
      nudges: all(
        `SELECT * FROM nudges WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR condition LIKE ? ESCAPE '\\') LIMIT 5`,
        user.id,
        like,
        like
      ).map(shapeNudge),
      sessions: all(
        `SELECT * FROM sessions WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')
         ORDER BY started_at DESC LIMIT 5`,
        user.id,
        like,
        like
      ).map(shapeSession),
    };
  });
}

