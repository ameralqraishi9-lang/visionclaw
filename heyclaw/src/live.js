/**
 * The live session engine.
 *
 * Real VisionClaw streams ~1fps of camera frames to Gemini Live and takes tool
 * calls back. This console simulates that loop locally: it writes the same
 * event shapes the gateway records (scene / claw / user / action) into SQLite
 * and pushes them over SSE, so the UI, the stored transcript, and the live
 * feed all come from one source of truth.
 *
 * Swap `replyFor` for the gateway's turn endpoint to make it real.
 */
import { all, get, logActivity, nowIso, run, uid } from "./db.js";
import { badRequest, notFound } from "./http.js";
import { creationFacts } from "./content.js";

const SCENES = [
  { text: "Kitchen counter · morning light · kettle steaming", tags: ["kitchen", "morning"] },
  { text: "Living room · arc lamp on · sofa, two mugs", tags: ["living room", "evening"] },
  { text: "Front porch · overcast · package on the step", tags: ["porch", "package"] },
  { text: "Desk · laptop open · notebook with three lines", tags: ["desk", "work"] },
  { text: "Sidewalk · Woodward Ave · light traffic", tags: ["outdoors", "street"] },
  { text: "Garage · bike against the wall · door open", tags: ["garage", "bike"] },
  { text: "Kitchen · two pans on the stove · warm light", tags: ["kitchen", "cooking"] },
  { text: "Bookshelf · the arc lamp is at 40%", tags: ["living room", "lamps"] },
];

const PROACTIVE = [
  "You've been standing here a second — want the list for this week?",
  "I can hear the kettle. I'll wait until it's off before anything else.",
  "Two things on your calendar today. Nothing urgent before 10.",
  "The counter is out of reach of the lamp — no need to move anything.",
  "I'm watching, not talking. Say the word if you want something.",
];

const pick = (list, seed = Math.random()) => list[Math.floor(seed * list.length) % list.length];

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function createLiveEngine(hub) {
  /** userId -> interval handle for ambient scene events */
  const ambient = new Map();

  function addEvent(session, role, text, meta = {}) {
    const event = {
      id: uid("evt"),
      sessionId: session.id,
      role,
      text,
      meta,
      ts: nowIso(),
    };
    run(
      `INSERT INTO events (id, session_id, user_id, role, text, meta, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      session.id,
      session.user_id,
      role,
      text,
      JSON.stringify(meta),
      event.ts
    );
    hub.broadcast(session.user_id, "event", event);
    return event;
  }

  function activeSession(userId) {
    return get(
      `SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      userId
    );
  }

  function sessionPayload(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      mode: row.mode,
      deviceId: row.device_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      summary: row.summary,
      actionsCount: row.actions_count,
      events: all(
        "SELECT id, session_id, role, text, meta, ts FROM events WHERE session_id = ? ORDER BY ts, rowid",
        row.id
      ).map(shapeEvent),
    };
  }

  function shapeEvent(row) {
    let meta = {};
    try {
      meta = row.meta ? JSON.parse(row.meta) : {};
    } catch {
      meta = {};
    }
    return { id: row.id, sessionId: row.session_id, role: row.role, text: row.text, meta, ts: row.ts };
  }

  function start(userId, { mode = "glasses", title, deviceId = null } = {}) {
    const existing = activeSession(userId);
    if (existing) return sessionPayload(existing);

    const device = deviceId
      ? get("SELECT * FROM devices WHERE id = ? AND user_id = ?", deviceId, userId)
      : get(
          "SELECT * FROM devices WHERE user_id = ? AND status = 'connected' ORDER BY last_seen DESC LIMIT 1",
          userId
        );

    const id = uid("ses");
    const startedAt = nowIso();
    const label = title?.trim()
      ? title.trim()
      : `${mode === "phone" ? "Phone camera" : "Glasses"} session · ${timeLabel(startedAt)}`;

    run(
      `INSERT INTO sessions (id, user_id, title, mode, device_id, started_at, ended_at, duration_seconds, summary, actions_count)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, '', 0)`,
      id,
      userId,
      label,
      mode,
      device?.id || null,
      startedAt
    );

    const session = get("SELECT * FROM sessions WHERE id = ?", id);
    hub.broadcast(userId, "session.started", { session: sessionPayload(session) });
    logActivity(userId, "session", `Session started · ${mode === "phone" ? "phone camera" : "glasses"}`);

    if (device) {
      run("UPDATE devices SET status = 'connected', last_seen = ? WHERE id = ?", nowIso(), device.id);
    }

    // The scene arrives a beat after the feed opens, like a real first frame.
    setTimeout(() => {
      const live = get("SELECT * FROM sessions WHERE id = ?", id);
      if (!live || live.ended_at) return;
      const scene = pick(SCENES);
      addEvent(session, "scene", scene.text, { tags: scene.tags, frame: 1 });
    }, 900);

    // Ambient frames keep the viewfinder alive while the session runs.
    const timer = setInterval(() => {
      const live = get("SELECT * FROM sessions WHERE id = ?", id);
      if (!live || live.ended_at) {
        clearInterval(timer);
        ambient.delete(userId);
        return;
      }
      const scene = pick(SCENES);
      addEvent(live, "scene", scene.text, { tags: scene.tags });
    }, 45_000);
    ambient.set(userId, timer);

    return sessionPayload(session);
  }

  function say(userId, text) {
    const session = activeSession(userId);
    if (!session) throw badRequest("No live session — start the glasses first");
    const clean = String(text || "").trim();
    if (!clean) throw badRequest("Say something first");
    if (clean.length > 800) throw badRequest("That's longer than a voice turn (800 characters)");

    const userEvent = addEvent(session, "user", clean);
    const result = replyFor(userId, session, clean);

    setTimeout(() => {
      const live = get("SELECT * FROM sessions WHERE id = ?", session.id);
      if (!live || live.ended_at) return;
      addEvent(live, "claw", result.reply, {});
      for (const action of result.actions) {
        addEvent(live, "action", action.text, { tool: action.tool, tone: "success" });
      }
      if (result.actions.length) {
        run(
          "UPDATE sessions SET actions_count = actions_count + ? WHERE id = ?",
          result.actions.length,
          session.id
        );
      }
    }, 900 + Math.random() * 700);

    return { event: userEvent, pending: true };
  }

  function stop(userId) {
    const session = activeSession(userId);
    if (!session) throw notFound("No live session to stop");

    const endedAt = nowIso();
    const seconds = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(session.started_at).getTime()) / 1000)
    );
    const events = all("SELECT role, text FROM events WHERE session_id = ? ORDER BY ts", session.id);
    const spoken = events.filter((e) => e.role === "user").length;
    const actions = events.filter((e) => e.role === "action");
    const summary =
      actions.length || spoken
        ? `${spoken ? `${spoken} voice turn${spoken === 1 ? "" : "s"}` : "Hands-free"} · ${actions.length} action${actions.length === 1 ? "" : "s"} · ${events.length} frames`
        : "Short session — the glasses opened and closed without a turn.";

    run(
      "UPDATE sessions SET ended_at = ?, duration_seconds = ?, summary = ? WHERE id = ?",
      endedAt,
      seconds,
      summary,
      session.id
    );
    const devices = all("SELECT id FROM devices WHERE user_id = ? AND status = 'connected'", userId);
    for (const d of devices) {
      run("UPDATE devices SET status = 'paired', last_seen = ? WHERE id = ?", endedAt, d.id);
    }
    const timer = ambient.get(userId);
    if (timer) clearInterval(timer);
    ambient.delete(userId);

    const fresh = get("SELECT * FROM sessions WHERE id = ?", session.id);
    hub.broadcast(userId, "session.ended", { session: sessionPayload(fresh) });
    logActivity(
      userId,
      "session",
      `Session ended · ${fresh.title} · ${Math.max(1, Math.round(seconds / 60))} min`
    );
    return sessionPayload(fresh);
  }

  /** Close sessions left open (server restart, closed laptop). */
  function reapStale() {
    const stale = all("SELECT * FROM sessions WHERE ended_at IS NULL");
    for (const session of stale) {
      const seconds = Math.max(
        1,
        Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000)
      );
      run(
        `UPDATE sessions SET ended_at = ?, duration_seconds = ?,
           summary = CASE WHEN summary = '' THEN 'Session recovered after the app closed.' ELSE summary END
         WHERE id = ?`,
        nowIso(),
        seconds,
        session.id
      );
    }
    if (stale.length) console.log(`[heyclaw] closed ${stale.length} stale session(s)`);
  }

  return { start, say, stop, activeSession, sessionPayload, reshape: shapeEvent, reapStale };
}

/* ------------------------------------------------------------------ */
/* Intent-ish replies                                                  */
/* ------------------------------------------------------------------ */

function replyFor(userId, session, text) {
  const t = text.toLowerCase();
  const actions = [];

  const rememberMatch = t.match(/^remember (?:that )?(.+)$/);
  if (rememberMatch) {
    const fact = rememberMatch[1].replace(/[.?!]+$/, "").trim();
    const lower = fact.charAt(0).toUpperCase() + fact.slice(1);
    run(
      `INSERT INTO memories (id, user_id, fact, detail, category, source, confidence, pinned, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'preference', 'told', 100, 0, ?, ?, ?)`,
      uid("mem"),
      userId,
      lower.length > 90 ? `${lower.slice(0, 87)}…` : lower,
      "Said out loud during a live session.",
      nowIso(),
      nowIso(),
      nowIso()
    );
    logActivity(userId, "memory", `Learned: ${lower}`);
    return {
      reply: `Saved. "${lower}" is in memory now — I'll use it without being asked.`,
      actions: [{ tool: "Memory", text: "New memory · told during a session" }],
    };
  }

  if (/(light|lamp|dim|bright)/.test(t)) {
    actions.push({ tool: "HomeKit", text: "Lights → Living room 30% · warm" });
    return {
      reply: "Dropped the arc lamp to 30% and warmed it. Say when you want it back.",
      actions,
    };
  }
  if (/(order|coffee|latte|cortado|tea)/.test(t)) {
    actions.push({ tool: "Square", text: "Order placed · Blue Bottle Woodward · cortado" });
    return {
      reply: "Ordered the cortado. Pickup in about six minutes, under Avery.",
      actions,
    };
  }
  if (/(add|list|grocer|milk|buy|shop)/.test(t)) {
    actions.push({ tool: "Todoist", text: "Added to Groceries · oat milk, lemons, tortillas" });
    return {
      reply: "Added oat milk, lemons, and tortillas to Groceries. Nothing else looked low.",
      actions,
    };
  }
  if (/(remind|reminder|remember to)/.test(t)) {
    actions.push({ tool: "Reminders", text: "Reminder created · tomorrow 9:00am" });
    return {
      reply: "Set for tomorrow morning. I'll bring it up when you're in the kitchen.",
      actions,
    };
  }
  if (/(timer|minutes|alarm)/.test(t)) {
    const minutes = Number(t.match(/(\d+)\s*(minute|min)/)?.[1] || 8);
    actions.push({ tool: "Timers", text: `Timer running · ${minutes}:00` });
    return { reply: `${minutes} minutes on the clock. I'll say it once when it's done.`, actions };
  }
  if (/(play|music|song|spotify)/.test(t)) {
    actions.push({ tool: "Spotify", text: "Playing · Khruangbin radio" });
    return { reply: "Khruangbin radio, low. Tell me if the room wants something else.", actions };
  }
  if (/(calendar|meeting|schedule|today|tomorrow)/.test(t)) {
    return {
      reply:
        "Next up is design review at 2. The agenda is empty states, then the nav cut — and your parked icon set is still parked.",
      actions,
    };
  }
  if (/(who|what am i looking at|what is this|describe|see)/.test(t)) {
    const scene = get(
      "SELECT text FROM events WHERE session_id = ? AND role = 'scene' ORDER BY ts DESC LIMIT 1",
      session.id
    );
    return {
      reply: scene
        ? `${scene.text}. That's the frame I'm holding — say the word and I'll look closer at any part of it.`
        : "I'm still focusing the camera. Give me a second and ask again.",
      actions,
    };
  }
  if (/(thanks|thank you|good job|nice)/.test(t)) {
    return { reply: "Anytime. I'll stay quiet unless something's worth saying.", actions };
  }
  if (/\?$/.test(t)) {
    return {
      reply:
        "Not certain about that one. Two sources disagree and neither is fresh — I'd rather say nothing than guess.",
      actions,
    };
  }

  const seeded = creationFacts(userId);
  const memory = seeded.length ? seeded[Math.floor(Math.random() * seeded.length)] : null;
  const ambient = pick(PROACTIVE);
  return {
    reply: memory
      ? `${ambient} Also — I remembered: ${memory.fact.toLowerCase()}.`
      : ambient,
    actions,
  };
}
