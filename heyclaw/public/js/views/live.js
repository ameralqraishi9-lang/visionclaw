/** Live — the viewfinder, the transcript, and the "no prompt" promise. */
import { api } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

const VOICE_SAMPLES = [
  "What am I looking at?",
  "Dim the lights a little",
  "Add oat milk to my list",
  "Remember that I take my coffee black",
];

let optimisticCount = 0;

export async function mountLive(ctx) {
  const { root, on, navigate, isCurrent } = ctx;

  root.innerHTML = `
    <div class="live-grid">
      <div class="skeleton" style="aspect-ratio:16/10;border-radius:22px"></div>
      <div class="skeleton" style="height:340px;border-radius:16px"></div>
    </div>`;

  try {
    const state = await api("/api/live/state");
    ctx.app.live = state.session
      ? { session: state.session, events: state.session.events || [] }
      : null;
  } catch {
    /* fall back to whatever the shell already knows */
  }
  if (!isCurrent()) return;

  let busy = false;
  let listening = false;
  let lastEnded = null;
  let voiceTimer = null;
  let tick = null;
  const typingNodes = new Set();

  /* ---------- render ---------- */

  function session() {
    return ctx.app.live?.session || null;
  }

  function events() {
    return ctx.app.live?.events || [];
  }

  function paint() {
    typingNodes.clear();
    const live = session();
    const evts = events();
    const lastScene = [...evts].reverse().find((e) => e.role === "scene");
    const device = ctx.app.devices.find((d) => d.id === live?.deviceId) ||
      ctx.app.devices.find((d) => d.status === "connected") ||
      ctx.app.devices[0];

    root.innerHTML = `
      <div class="live-grid">
        <div class="stack" style="gap:14px">
          <div class="viewfinder ${live ? "on" : "off"}" id="viewfinder">
            <div class="vf-top">
              ${
                live
                  ? `<span class="rec"><span class="dot"></span>rec</span>
                     <span class="vf-chip">${icon(live.mode === "phone" ? "phone" : "glasses", 12)} ${live.mode === "phone" ? "phone camera" : "ray-ban meta"}</span>
                     <span class="vf-chip" data-frame-count>${countFrames(evts)} frames</span>
                     <span class="vf-chip" data-vf-clock style="margin-left:auto">${elapsed(live)}</span>`
                  : `<span class="vf-chip">${icon("glasses", 12)} feed closed</span>
                     <span class="vf-chip" style="margin-left:auto">1 fps · 16 kHz audio</span>`
              }
            </div>
            ${
              live
                ? `<div class="vf-center">
                    <div class="vf-scene" id="vf-scene">${esc(lastScene?.text || "Opening the camera…")}</div>
                    <div class="vf-tags" id="vf-tags">${(lastScene?.meta?.tags || [])
                      .map((t) => `<span>${esc(t)}</span>`)
                      .join("")}</div>
                  </div>
                  <div class="vf-bottom">
                    <span class="vf-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
                    <span class="vf-chip">listening</span>
                    <span class="faint vf-hint" style="font-size:11px">Say anything — no wake word needed</span>
                    <button class="btn danger sm" id="stop-btn" style="margin-left:auto">${icon("stop", 13)}End session</button>
                  </div>`
                : `<div class="pulse-ring"></div>
                   <div class="vf-empty">
                    <span class="glasses">${icon("glasses", 40)}</span>
                    <h3>The glasses are off</h3>
                    <p>Start a session and Claw opens its eyes. It sees the room, hears you, and decides
                       when something is worth saying — without a prompt.</p>
                    <div class="row wrap" style="justify-content:center;gap:8px">
                      <button class="btn primary" data-start="glasses">${icon("glasses", 15)}Start on glasses</button>
                      <button class="btn ghost" data-start="phone">${icon("phone", 15)}Use phone camera</button>
                    </div>
                  </div>`
            }
          </div>

          ${live ? transcriptCard(evts) : lastEnded ? recapCard(lastEnded) : aftercareCard(ctx)}
        </div>

        <div class="live-side">
          ${live ? liveInfoCard(live, device, evts) : setupCard(ctx, device)}
        </div>
      </div>`;

    const sub = document.getElementById("page-sub");
    if (sub) {
      sub.textContent = live
        ? "On air · the glasses are watching the room"
        : "Camera, voice, and memory — no prompts required";
    }
    wire();
  }

  function transcriptCard(evts) {
    return `<section class="card transcript">
      <div class="card-head">
        <h2>Transcript</h2>
        <span class="badge danger" style="height:18px"><span class="dot"></span>live</span>
        <div class="actions">
          <span class="faint mono" style="font-size:10.5px">${evts.length} events</span>
        </div>
      </div>
      <div class="transcript-scroll" id="transcript">
        ${
          evts.length
            ? evts.map(turnHtml).join("")
            : `<div class="empty" style="border:0;background:none;padding:26px">
                <div class="empty-icon">${icon("mic", 20)}</div>
                <h3>Listening</h3>
                <p>Say “what am I looking at?” or just talk. Claw answers out loud and logs it here.</p>
              </div>`
        }
        ${typingNodes.size ? typingHtml() : ""}
      </div>
      <div class="suggestions" id="suggestions">
        ${["What am I looking at?", "Dim the lights", "Add oat milk to my list", "Remember that I hate cilantro"]
          .map((s) => `<button class="suggestion" data-say="${esc(s)}">${esc(s)}</button>`)
          .join("")}
      </div>
      <div class="composer">
        <textarea class="input" id="say-input" rows="1" placeholder="Speak as if you were in the room…"
          aria-label="Say something to Claw" maxlength="800"></textarea>
        <button class="icon-btn" id="mic-btn" title="Simulate voice input" aria-label="Simulate voice input">${icon("mic", 17)}</button>
        <button class="btn primary" id="send-btn">Send${icon("arrowRight", 14)}</button>
      </div>
    </section>`;
  }

  function aftercareCard(ctx) {
    return `<section class="card card-body" style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <span class="thumb accent">${icon("sparkle", 16)}</span>
      <div style="flex:1;min-width:240px">
        <div style="font-size:13.5px;font-weight:600">What happens when you press start</div>
        <ol class="muted" style="font-size:12.5px;line-height:1.7;margin:8px 0 0;padding-left:18px">
          <li>Camera frames stream at ~1 fps — no upload until a turn needs them.</li>
          <li>Audio flows both ways. Claw answers out loud in your chosen voice.</li>
          <li>Anything worth keeping lands in Memory; every session is saved here.</li>
        </ol>
      </div>
    </section>`;
  }

  function recapCard(session) {
    const events = session.events || [];
    const turns = events.filter((e) => e.role === "user").length;
    return `<section class="card" style="overflow:hidden;border-color:var(--line-strong)">
      <div class="card-head">
        <h2>Session saved</h2>
        <div class="actions"><span class="badge teal"><span class="dot"></span>archived</span></div>
      </div>
      <div class="card-body" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
        <span class="thumb accent">${icon("sessions", 16)}</span>
        <div class="grow" style="min-width:200px">
          <div style="font-size:13.5px;font-weight:600">${esc(session.title)}</div>
          <div class="faint" style="font-size:12px;margin-top:2px">${esc(session.summary || "Transcript written to your account.")}</div>
        </div>
        <div class="row" style="gap:18px">
          <div><div class="eyebrow">Length</div><div class="mono" style="font-size:14px">${ui.humanDuration(session.durationSeconds)}</div></div>
          <div><div class="eyebrow">Turns</div><div class="mono" style="font-size:14px">${turns}</div></div>
          <div><div class="eyebrow">Actions</div><div class="mono" style="font-size:14px">${session.actionsCount}</div></div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn ghost sm" data-open-session="${session.id}">Transcript</button>
          <button class="btn primary sm" data-start="glasses">Again</button>
        </div>
      </div>
    </section>`;
  }

  function liveInfoCard(live, device, evts) {
    const actions = evts.filter((e) => e.role === "action");
    return `
      <section class="card">
        <div class="card-head"><h2>Session</h2>
          <div class="actions"><span class="badge accent">${live.mode === "phone" ? "phone" : "glasses"}</span></div>
        </div>
        <div class="card-body" style="padding-top:12px">
          <div class="big-timer" data-session-clock>${elapsed(live)}</div>
          <div class="faint" style="font-size:11.5px;margin-top:2px">started ${ui.timeOfDay(live.startedAt)}</div>
          <div class="divider"></div>
          <div class="kv"><span class="k">Device</span><span class="v">${esc(device?.name || "Phone camera")}</span></div>
          <div class="kv"><span class="k">Frames</span><span class="v mono" data-frame-kv>${countFrames(evts)}</span></div>
          <div class="kv"><span class="k">Voice turns</span><span class="v mono">${evts.filter((e) => e.role === "user").length}</span></div>
          <div class="kv"><span class="k">Actions taken</span><span class="v mono">${actions.length}</span></div>
        </div>
      </section>
      ${
        actions.length
          ? `<section class="card">
              <div class="card-head"><h2>Actions this session</h2></div>
              <div class="list">${actions
                .slice(-5)
                .map(
                  (a) => `<div class="list-row" style="cursor:default">
                    <span class="thumb teal">${icon("zap", 14)}</span>
                    <span class="grow">
                      <span class="title" style="font-weight:500;font-size:12.5px">${esc(a.text)}</span>
                      <span class="sub">${esc(a.meta?.tool || "Claw")} · ${ui.timeOfDay(a.ts)}</span>
                    </span>
                  </div>`
                )
                .join("")}</div>
            </section>`
          : ""
      }
      <section class="card card-body">
        <div class="eyebrow">Memory used</div>
        <p class="muted" style="font-size:12.5px;line-height:1.65;margin-top:8px">
          Claw is answering with what it already knows about you — your kitchen, your people, your quiet hours.
          <button class="linkish" data-goto="/memory">Review memory</button>
        </p>
      </section>`;
  }

  function setupCard(ctx, device) {
    return `
      <section class="card">
        <div class="card-head"><h2>Ready when you are</h2></div>
        <div class="card-body" style="padding-top:12px">
          <div class="kv"><span class="k">Paired device</span><span class="v">${esc(device?.name || "None yet")}</span></div>
          <div class="kv"><span class="k">Status</span><span class="v">${device ? ui.statusLabel(device.status) : "Not paired"}</span></div>
          <div class="kv"><span class="k">Battery</span><span class="v">${device ? `${device.battery}%` : "—"}</span></div>
          <div class="kv"><span class="k">Wake word</span><span class="v">${esc(ctx.app.user?.wakeWord || "Hey Claw")}</span></div>
          <div class="kv"><span class="k">Voice</span><span class="v">${esc(ctx.app.user?.voice || "Sol · warm")}</span></div>
          <div class="kv"><span class="k">Autonomy</span><span class="v" style="text-transform:capitalize">${esc(ctx.app.user?.autonomy || "balanced")}</span></div>
        </div>
        <div class="card-body" style="padding-top:0">
          <button class="btn ghost block" data-goto="/settings">${icon("settings", 15)}Tune voice & devices</button>
        </div>
      </section>
      <section class="card card-body">
        <div class="eyebrow">No prompt required</div>
        <p class="muted" style="font-size:12.5px;line-height:1.7;margin-top:8px">
          Claw doesn't wait to be asked. If the porch is raining on a package, or a meeting is about to
          start with a parked decision, it speaks first — then goes quiet again.
        </p>
        <div class="row wrap" style="margin-top:12px;gap:6px">
          <span class="badge violet">proactive</span>
          <span class="badge">on-device frames</span>
          <span class="badge">quiet hours</span>
        </div>
      </section>`;
  }

  /* ---------- wiring ---------- */

  function wire() {
    ui.qsa("[data-start]", root).forEach((btn) =>
      btn.addEventListener("click", () => start(btn.dataset.start, btn))
    );
    ui.qsa("[data-goto]", root).forEach((btn) =>
      btn.addEventListener("click", () => navigate(btn.dataset.goto))
    );
    ui.qs("[data-open-session]")?.addEventListener("click", (event) =>
      navigate(`/sessions/${event.currentTarget.dataset.openSession}`)
    );
    ui.qs("#stop-btn")?.addEventListener("click", (event) => stop(event.currentTarget));
    ui.qs("#send-btn")?.addEventListener("click", send);
    ui.qsa("[data-say]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const input = ui.qs("#say-input");
        input.value = btn.dataset.say;
        input.focus();
        send();
      })
    );
    const input = ui.qs("#say-input");
    if (input) {
      input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = `${Math.min(120, input.scrollHeight)}px`;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          send();
        }
      });
      input.focus({ preventScroll: true });
    }
    ui.qs("#mic-btn")?.addEventListener("click", simulateVoice);
    scrollTranscript();
  }

  async function start(mode, button) {
    if (busy) return;
    busy = true;
    ui.setBusy(button, true, "Opening camera…");
    try {
      const data = await api("/api/live/start", { method: "POST", body: { mode } });
      ctx.app.live = { session: data.session, events: data.session.events || [] };
      ctx.refreshChrome();
      paint();
      ui.toast(`Camera live · ${mode === "phone" ? "phone" : "glasses"}`, { kind: "info" });
    } catch (err) {
      ui.toast(err.message, { kind: "error" });
      ui.setBusy(button, false);
    } finally {
      busy = false;
    }
  }

  async function stop(button) {
    if (busy) return;
    busy = true;
    ui.setBusy(button, true, "Saving…");
    try {
      const data = await api("/api/live/stop", { method: "POST" });
      lastEnded = data.session;
      ctx.app.live = null;
      ctx.refreshChrome();
      paint();
      ui.toast(`Session saved · ${ui.humanDuration(data.session.durationSeconds)}`);
    } catch (err) {
      ui.toast(err.message, { kind: "error" });
      ui.setBusy(button, false);
    } finally {
      busy = false;
    }
  }

  function send() {
    const input = ui.qs("#say-input");
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    input.style.height = "auto";
    addOptimistic(value);
    showTyping();
    api("/api/live/say", { method: "POST", body: { text: value } }).catch((err) => {
      hideTyping();
      ui.toast(err.message, { kind: "error" });
    });
  }

  function simulateVoice() {
    if (listening) return;
    listening = true;
    const btn = ui.qs("#mic-btn");
    const previous = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span>`;
    btn.style.background = "var(--danger-dim)";
    btn.style.color = "#ffb1b1";
    voiceTimer = setTimeout(() => {
      const input = ui.qs("#say-input");
      listening = false;
      if (btn.isConnected) {
        btn.innerHTML = previous;
        btn.style.background = "";
        btn.style.color = "";
      }
      if (!input || !session()) return;
      input.value = VOICE_SAMPLES[Math.floor(Math.random() * VOICE_SAMPLES.length)];
      input.focus();
      ui.toast("Heard through the glasses mic", { kind: "info", timeout: 2200 });
    }, 1400);
  }

  function addOptimistic(text) {
    const list = ui.qs("#transcript");
    if (!list) return;
    list.querySelector(".empty")?.remove();
    const node = document.createElement("div");
    const id = `local_${++optimisticCount}`;
    node.innerHTML = turnHtml({ id, role: "user", text, meta: {}, ts: new Date().toISOString() }, true);
    const turn = node.firstElementChild;
    list.appendChild(turn);
    scrollTranscript();
    // Remember the row so the server echo can claim it instead of duplicating.
    pending.push({ id, text, node: turn });
  }

  const pending = [];

  function showTyping() {
    const list = ui.qs("#transcript");
    if (!list || list.querySelector("#typing")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = typingHtml();
    const node = wrap.firstElementChild;
    node.id = "typing";
    list.appendChild(node);
    typingNodes.add(node);
    scrollTranscript();
  }

  function hideTyping() {
    ui.qs("#typing")?.remove();
    typingNodes.clear();
  }

  function appendEvent(event) {
    const list = ui.qs("#transcript");
    if (!list) return;
    // Reconcile the optimistic row.
    if (event.role === "user") {
      const idx = pending.findIndex((p) => p.text === event.text);
      if (idx >= 0) {
        const [entry] = pending.splice(idx, 1);
        if (entry.node.isConnected) {
          entry.node.dataset.id = event.id;
          const when = entry.node.querySelector(".when");
          if (when) when.textContent = ui.timeOfDay(event.ts);
          return;
        }
      }
    }
    if (event.role === "claw") hideTyping();
    list.querySelector(".empty")?.remove();
    if (event.role === "scene") {
      const scene = ui.qs("#vf-scene");
      const tags = ui.qs("#vf-tags");
      if (scene) scene.textContent = event.text;
      if (tags) {
        tags.innerHTML = (event.meta?.tags || []).map((t) => `<span>${esc(t)}</span>`).join("");
      }
      const count = ui.qs("[data-frame-count]");
      if (count) count.textContent = `${countFrames(events())} frames`;
      const kv = ui.qs("[data-frame-kv]");
      if (kv) kv.textContent = countFrames(events());
      return;
    }
    list.insertAdjacentHTML("beforeend", turnHtml(event));
    scrollTranscript();
  }

  function scrollTranscript() {
    const list = ui.qs("#transcript");
    if (list) list.scrollTop = list.scrollHeight;
  }

  /* ---------- live timers ---------- */

  tick = setInterval(() => {
    const live = session();
    if (!live) return;
    const value = elapsed(live);
    const vf = ui.qs("[data-vf-clock]", root);
    if (vf) vf.textContent = value;
    const clock = ui.qs("[data-session-clock]", root);
    if (clock) clock.textContent = value;
    const frames = ui.qs("[data-frame-count]", root);
    if (frames) frames.textContent = `${countFrames(events())} frames`;
  }, 1000);

  paint();

  /* ---------- stream subscriptions ---------- */

  const offEvent = on("event", (event) => {
    if (!session()) return;
    if (event.sessionId !== session().id) return;
    appendEvent(event);
  });

  const offStarted = on("session.started", (data) => {
    ctx.app.live = { session: data.session, events: data.session.events || [] };
    ctx.refreshChrome();
    paint();
  });

  const offEnded = on("session.ended", (data) => {
    lastEnded = data.session;
    ctx.app.live = null;
    ctx.refreshChrome();
    paint();
    ui.toast(`Session saved · ${ui.humanDuration(data.session?.durationSeconds || 0)}`);
  });

  return () => {
    clearInterval(tick);
    clearTimeout(voiceTimer);
    offEvent();
    offStarted();
    offEnded();
  };
}

/* ------------------------------------------------------------------ */
/* Fragments                                                           */
/* ------------------------------------------------------------------ */

function countFrames(events) {
  return events.filter((e) => e.role === "scene").length;
}

function elapsed(session) {
  if (!session) return "00:00";
  const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  return ui.clockDuration((end - new Date(session.startedAt).getTime()) / 1000);
}

function turnHtml(event, optimistic = false) {
  const meta = event.meta || {};
  if (event.role === "scene") {
    return `<div class="turn turn-scene" data-id="${event.id}">
      <div class="body">
        <div class="who">${icon("glasses", 12)}frame <span class="when">${ui.timeOfDay(event.ts)}</span></div>
        <div class="text">${esc(event.text)}</div>
      </div>
    </div>`;
  }
  if (event.role === "action") {
    return `<div class="turn turn-action" data-id="${event.id}">
      <div class="body">
        <div class="who">${esc(meta.tool || "action")} <span class="when">${ui.timeOfDay(event.ts)}</span></div>
        <div class="text">${esc(event.text)}</div>
      </div>
    </div>`;
  }
  if (event.role === "claw") {
    return `<div class="turn turn-claw" data-id="${event.id}">
      <span class="thumb accent" style="width:26px;height:26px;border-radius:8px">${icon("live", 13)}</span>
      <div class="body">
        <div class="who">claw <span class="when" style="margin-left:auto">${ui.timeOfDay(event.ts)}</span></div>
        <div class="text">${esc(event.text)}</div>
      </div>
    </div>`;
  }
  if (event.role === "user") {
    return `<div class="turn turn-user" data-id="${event.id}">
      <div class="body">
        <div class="who" style="justify-content:flex-end">
          <span>you</span><span class="when">${optimistic ? "sending…" : ui.timeOfDay(event.ts)}</span>
        </div>
        <div class="text">${esc(event.text)}</div>
      </div>
    </div>`;
  }
  return "";
}

function typingHtml() {
  return `<div class="turn turn-claw" aria-live="polite">
    <span class="thumb accent" style="width:26px;height:26px;border-radius:8px">${icon("live", 13)}</span>
    <div class="body">
      <div class="who">claw</div>
      <div class="typing"><i></i><i></i><i></i></div>
    </div>
  </div>`;
}
