/** Boot, auth, shell, routing, and the live SSE connection. */
import { api, auth, connectEvents } from "./api.js";
import { icon } from "./icons.js";
import * as ui from "./ui.js";

import { mountOverview } from "./views/overview.js";
import { mountLive } from "./views/live.js";
import { mountSessions } from "./views/sessions.js";
import { mountNudges } from "./views/nudges.js";
import { mountMemory } from "./views/memory.js";
import { mountApps } from "./views/apps.js";
import { mountSettings } from "./views/settings.js";

/* ------------------------------------------------------------------ */
/* Event bus                                                           */
/* ------------------------------------------------------------------ */

class Bus {
  constructor() {
    this.handlers = new Map();
  }
  on(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    return () => this.off(name, handler);
  }
  off(name, handler) {
    this.handlers.get(name)?.delete(handler);
  }
  emit(name, payload) {
    for (const handler of [...(this.handlers.get(name) || [])]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[bus:${name}]`, err);
      }
    }
  }
}

export const app = {
  user: null,
  live: null,
  devices: [],
  route: "/overview",
  bus: new Bus(),
  connection: "connecting",
};

const ROUTES = {
  "/overview": { title: "Overview", sub: "What Claw did while your phone stayed in your pocket", mount: mountOverview },
  "/live": { title: "Live", sub: "Camera, voice, and memory — no prompts required", mount: mountLive },
  "/sessions": { title: "Sessions", sub: "Every conversation your glasses kept", mount: mountSessions },
  "/nudges": { title: "Nudges", sub: "The moments Claw chooses to speak up", mount: mountNudges },
  "/memory": { title: "Memory", sub: "What Claw knows, and where it learned it", mount: mountMemory },
  "/apps": { title: "Apps", sub: "The accounts Claw can act through", mount: mountApps },
  "/settings": { title: "Settings", sub: "Voice, devices, privacy, and your account", mount: mountSettings },
};

const NAV = [
  { section: "Console", items: [
    { path: "/overview", label: "Overview", icon: "overview" },
    { path: "/live", label: "Live session", icon: "live" },
    { path: "/sessions", label: "Sessions", icon: "sessions" },
  ]},
  { section: "Claw", items: [
    { path: "/nudges", label: "Nudges", icon: "nudges" },
    { path: "/memory", label: "Memory", icon: "memory" },
    { path: "/apps", label: "Apps", icon: "apps" },
  ]},
];

let shellMounted = false;
let currentCleanup = null;
let viewToken = 0;
let routeTitle = "";
let clockTimer = null;

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

const appRoot = () => document.getElementById("app");

function parseLocation() {
  const url = new URL(location.href);
  const parts = url.pathname.split("/").filter(Boolean);
  const base = parts.length ? `/${parts[0]}` : "/overview";
  const params = { id: parts[1] || null, rest: parts.slice(2) };
  return { path: ROUTES[base] ? base : "/overview", params, query: url.searchParams };
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  renderRoute();
}

function greeting() {
  return `${ui.dayPart()}, ${app.user?.name?.split(" ")[0] || "there"}`;
}

/** The live session, if this account has one running. */
export function liveSession() {
  return app.live?.session || null;
}

/* ------------------------------------------------------------------ */
/* Auth screen                                                         */
/* ------------------------------------------------------------------ */

function renderAuth(mode = "login") {
  if (clockTimer) clearInterval(clockTimer);
  shellMounted = false;
  appRoot().innerHTML = `
    <div class="auth">
      <aside class="auth-art">
        <img src="/img/cover.jpg" alt="" aria-hidden="true">
        <div class="wordmark">
          <span class="brand-mark">${icon("glasses", 19)}</span>
          <span>Hey Claw <span class="faint" style="font-weight:500">· VisionClaw console</span></span>
        </div>
        <div class="quote">
          <p>“Hey Claw, can you help me make that light a bit softer?”</p>
          <div class="who">No wake-word gymnastics. No app to open. Just the room, the glasses, and a reply.</div>
        </div>
      </aside>
      <main class="auth-panel">
        <div class="auth-form">
          <div class="row" style="margin-bottom:22px">
            <span class="brand-mark">${icon("glasses", 18)}</span>
            <span class="brand-name"><strong>Hey Claw</strong><span>VisionClaw console</span></span>
          </div>
          <h1>${mode === "signup" ? "Make your glasses useful" : "Welcome back"}</h1>
          <p class="lede">${
            mode === "signup"
              ? "One account for your devices, your memory, and every moment Claw decides to speak up."
              : "Sign in to see what your glasses have been up to — and to start a live session."
          }</p>

          <div id="auth-error" class="auth-error hidden" role="alert"></div>

          <form id="auth-form" novalidate autocomplete="on">
            ${
              mode === "signup"
                ? `<div class="field" data-field="name">
                    <label for="name">Full name</label>
                    <input class="input" id="name" name="name" autocomplete="name" placeholder="Avery Chen" required>
                  </div>`
                : ""
            }
            <div class="field" data-field="email">
              <label for="email">Email</label>
              <input class="input" id="email" name="email" type="email" autocomplete="email"
                placeholder="you@example.com" required>
            </div>
            <div class="field" data-field="password">
              <label for="password">Password</label>
              <input class="input" id="password" name="password" type="password"
                autocomplete="${mode === "signup" ? "new-password" : "current-password"}"
                placeholder="${mode === "signup" ? "At least 8 characters" : "••••••••"}" required>
            </div>
            <button class="btn primary block lg" type="submit" id="auth-submit">
              ${mode === "signup" ? "Create account" : "Sign in"}
              ${icon("arrowRight", 16)}
            </button>
          </form>

          <div class="auth-switch">
            ${
              mode === "signup"
                ? `Already have an account? <button class="linkish" data-mode="login">Sign in</button>`
                : `New here? <button class="linkish" data-mode="signup">Create an account</button>`
            }
          </div>

          <div class="auth-demo">
            <div class="row">
              <span>demo@heyclaw.app</span>
              <span>glasses123</span>
            </div>
            <button class="btn block" id="demo-btn">${icon("sparkle", 15)} Enter the demo account</button>
            <span class="help">Seeded with 6 sessions, 12 memories, and 5 live nudges.</span>
          </div>

          <p class="auth-foot">
            Hey Claw is the web console for VisionClaw wearers.<br>
            Camera frames stay on device; transcripts live in your account.
          </p>
        </div>
      </main>
    </div>`;

  const form = ui.qs("#auth-form");
  const errorBox = ui.qs("#auth-error");
  const submit = ui.qs("#auth-submit");
  if (window.innerWidth > 860) ui.qs("#email").focus({ preventScroll: true });

  ui.qsa("[data-mode]").forEach((btn) =>
    btn.addEventListener("click", () => renderAuth(btn.dataset.mode))
  );

  const fail = (message, details) => {
    errorBox.classList.remove("hidden");
    errorBox.textContent = message;
    if (details) {
      for (const [field, text] of Object.entries(details)) ui.showFieldError(form, field, text);
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    ui.clearFieldErrors(form);
    errorBox.classList.add("hidden");
    const values = ui.formValues(form);
    if (mode === "signup" && !values.name) {
      ui.showFieldError(form, "name", "Tell us your name");
      return;
    }
    if (!values.email) {
      ui.showFieldError(form, "email", "Enter your email");
      return;
    }
    if (!values.password) {
      ui.showFieldError(form, "password", "Enter your password");
      return;
    }
    ui.setBusy(submit, true, mode === "signup" ? "Creating…" : "Signing in…");
    try {
      const payload = await api(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        body: values,
      });
      auth.set(payload.token);
      await enterApp(payload.user);
    } catch (err) {
      ui.setBusy(submit, false);
      fail(err.message, err.details);
    }
  });

  ui.qs("#demo-btn").addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    ui.setBusy(btn, true, "Opening the demo…");
    try {
      const payload = await api("/api/auth/demo", { method: "POST" });
      auth.set(payload.token);
      await enterApp(payload.user);
      ui.toast("Welcome to Avery's console", { kind: "info" });
    } catch (err) {
      ui.setBusy(btn, false);
      fail(err.message);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function sidebarHtml() {
  const device = app.devices.find((d) => d.status === "connected") || app.devices[0];
  return `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-mark">${icon("glasses", 19)}</span>
        <span class="brand-name"><strong>Hey Claw</strong><span>VisionClaw console</span></span>
      </div>

      <nav class="nav" aria-label="Primary">
        ${NAV.map(
          (group) => `
          <div class="nav-label eyebrow">${group.section}</div>
          ${group.items
            .map(
              (item) => `
            <button class="nav-item" data-path="${item.path}">
              ${icon(item.icon, 17)}
              <span>${item.label}</span>
              ${item.path === "/live" ? `<span class="nav-live-dot hidden" data-live-dot></span>` : ""}
            </button>`
            )
            .join("")}`
        ).join("")}
        <div class="nav-label eyebrow">Account</div>
        <button class="nav-item" data-path="/settings">${icon("settings", 17)}<span>Settings</span></button>
      </nav>

      <div class="sidebar-foot">
        ${
          device
            ? `<button class="device-pill" data-path="/settings">
                <span class="thumb accent">${ui.deviceIcon(device.kind)}</span>
                <span class="meta">
                  <strong>${ui.escapeHtml(device.name)}</strong>
                  <span>${ui.statusLabel(device.status)} · ${ui.relTime(device.lastSeen)}</span>
                </span>
                ${ui.batteryBar(device.battery)}
              </button>`
            : ""
        }
        <div class="user-chip" data-user-chip>
          ${ui.avatar(app.user?.name || "")}
          <span class="meta">
            <strong>${ui.escapeHtml(app.user?.name || "")}</strong>
            <span>${ui.escapeHtml(app.user?.email || "")}</span>
          </span>
          <button class="icon-btn sm" id="signout" title="Sign out" aria-label="Sign out">${icon("logout", 15)}</button>
        </div>
        <div class="row faint" style="font-size:10.5px;padding:0 6px;gap:6px">
          <span class="status-dot" data-conn-dot></span>
          <span data-conn-label>Connecting…</span>
        </div>
      </div>
    </aside>`;
}

function renderShell() {
  appRoot().innerHTML = `
    <div class="shell">
      ${sidebarHtml()}
      <div class="main">
        <header class="topbar">
          <button class="icon-btn hamburger" id="menu-btn" aria-label="Open navigation">${icon("overview", 18)}</button>
          <div class="grow" style="min-width:0">
            <h1 id="page-title">Overview</h1>
            <div class="sub" id="page-sub"></div>
          </div>
          <div class="topbar-actions">
            <button class="btn ghost sm" id="search-btn" title="Search everything (⌘K)">
              ${icon("search", 15)}<span class="label">Search</span><kbd>⌘K</kbd>
            </button>
            <button class="btn primary sm" id="go-live">${icon("live", 15)}<span class="label">Go live</span></button>
          </div>
        </header>
        <div class="content" id="view"></div>
      </div>
    </div>`;

  shellMounted = true;

  ui.qsa(".nav-item").forEach((btn) =>
    btn.addEventListener("click", () => {
      navigate(btn.dataset.path);
      closeSidebar();
    })
  );
  ui.qsa(".device-pill").forEach((btn) =>
    btn.addEventListener("click", () => navigate(btn.dataset.path))
  );
  ui.qs("#signout").addEventListener("click", async () => {
    await ui.confirmDialog({
      title: "Sign out?",
      message: "This tab will forget your session. Your data stays in your account.",
      confirmLabel: "Sign out",
      onConfirm: async () => {
        try {
          await api("/api/auth/logout", { method: "POST" });
        } catch {
          /* token may already be gone */
        }
        auth.clear();
        app.user = null;
        app.live = null;
        stopStream();
        renderAuth("login");
        ui.toast("Signed out", { kind: "info" });
      },
    });
  });

  ui.qs("#go-live").addEventListener("click", () => navigate("/live"));
  ui.qs("#search-btn").addEventListener("click", openPalette);
  ui.qs("#menu-btn").addEventListener("click", openSidebar);
  refreshChrome();
}

function refreshChrome() {
  if (!shellMounted) return;
  refreshDevicePill();
  const { path } = parseLocation();
  ui.qsa(".nav-item").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.path === path)
  );
  const dot = ui.qs("[data-live-dot]");
  if (dot) dot.classList.toggle("hidden", !liveSession());

  const liveBtn = ui.qs("#go-live");
  if (liveBtn) {
    if (liveSession()) {
      liveBtn.className = "btn live sm";
      liveBtn.innerHTML = `${icon("live", 15)}<span class="label">On air</span>`;
      liveBtn.title = "You have a live session running";
    } else {
      liveBtn.className = "btn primary sm";
      liveBtn.innerHTML = `${icon("live", 15)}<span class="label">Go live</span>`;
      liveBtn.title = "Start a live session";
    }
  }

  const connDot = ui.qs("[data-conn-dot]");
  const connLabel = ui.qs("[data-conn-label]");
  if (connDot) {
    connDot.className = `status-dot ${app.connection === "online" ? "connected" : app.connection === "offline" ? "offline" : "pairing"}`;
  }
  if (connLabel) {
    connLabel.textContent =
      app.connection === "online"
        ? "Live updates on"
        : app.connection === "offline"
          ? "Reconnecting…"
          : "Connecting…";
  }
}

function refreshDevicePill() {
  const device = app.devices.find((d) => d.status === "connected") || app.devices[0];
  const foot = ui.qs(".sidebar-foot");
  if (!device || !foot) return;
  const mark = `<span class="thumb accent">${ui.deviceIcon(device.kind)}</span>
    <span class="meta">
      <strong>${ui.escapeHtml(device.name)}</strong>
      <span>${ui.statusLabel(device.status)} · ${ui.relTime(device.lastSeen)}</span>
    </span>
    ${ui.batteryBar(device.battery)}`;
  let existing = ui.qs(".device-pill", foot);
  if (!existing) {
    existing = document.createElement("button");
    existing.className = "device-pill";
    existing.dataset.path = "/settings";
    existing.addEventListener("click", () => navigate("/settings"));
    foot.prepend(existing);
  }
  if (existing.dataset.mark === mark) return;
  existing.dataset.mark = mark;
  existing.innerHTML = mark;
}

function openSidebar() {
  if (ui.qs("#sidebar")?.classList.contains("open")) return closeSidebar();
  ui.qs("#sidebar")?.classList.add("open");
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.id = "scrim";
  scrim.addEventListener("click", closeSidebar);
  // Inside #app: the shell owns a stacking context (z-index 1), so a scrim on
  // <body> would paint over the sidebar instead of behind it.
  (ui.qs(".shell") || document.body).appendChild(scrim);
}

function closeSidebar() {
  ui.qs("#sidebar")?.classList.remove("open");
  ui.qs("#scrim")?.remove();
}

function setTopbar() {
  const { path } = parseLocation();
  const route = ROUTES[path];
  const title = ui.qs("#page-title");
  const sub = ui.qs("#page-sub");
  if (title) title.textContent = route.title;
  if (sub) sub.textContent = route.title === "Overview" ? greeting() : route.sub;
  routeTitle = route.title;
  document.title = `${route.title} · Hey Claw`;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

async function renderRoute() {
  const { path, params, query } = parseLocation();
  app.route = path;
  if (!shellMounted) return;
  closeSidebar();
  setTopbar();
  refreshChrome();

  currentCleanup?.();
  currentCleanup = null;
  app.bus.handlers.forEach((set) => set.clear());

  const view = ui.qs("#view");
  if (!view) return;
  view.innerHTML = "";
  view.scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0, behavior: "instant" });

  const token = ++viewToken;
  const ctx = {
    root: view,
    app,
    user: app.user,
    params,
    query,
    navigate,
    refreshChrome,
    live: liveSession(),
    on: (name, handler) => app.bus.on(name, handler),
    /** Ignore async work that resolves after the view changed. */
    isCurrent: () => token === viewToken,
  };
  try {
    const cleanup = await ROUTES[path].mount(ctx);
    if (typeof cleanup === "function") currentCleanup = cleanup;
  } catch (err) {
    console.error(err);
    view.innerHTML = ui.errorState(err.message || "Could not render this view");
    ui.qs("[data-retry]", view)?.addEventListener("click", renderRoute);
  }
}

window.addEventListener("popstate", renderRoute);

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

let paletteOpen = false;
let paletteCloser = null;

function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const overlay = document.createElement("div");
  overlay.className = "palette";
  overlay.innerHTML = `
    <div class="palette-box" role="dialog" aria-modal="true" aria-label="Search">
      <div class="palette-input">
        ${icon("search", 17, "")}
        <input id="palette-q" placeholder="Search memory, nudges, sessions…" autocomplete="off"
          aria-label="Search" data-autofocus>
        <kbd>esc</kbd>
      </div>
      <div class="palette-results" id="palette-results"></div>
      <div class="palette-foot"><span>↑↓ to move</span><span>↵ to open</span><span>⌘K to toggle</span></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = ui.qs("#palette-q", overlay);
  const results = ui.qs("#palette-results", overlay);
  let items = [];
  let active = 0;

  const commands = () => [
    { label: "Overview", hint: "Go", icon: "overview", run: () => navigate("/overview") },
    { label: "Start a live session", hint: "Action", icon: "live", run: () => navigate("/live") },
    { label: "Sessions", hint: "Go", icon: "sessions", run: () => navigate("/sessions") },
    { label: "Nudges", hint: "Go", icon: "nudges", run: () => navigate("/nudges") },
    { label: "Memory", hint: "Go", icon: "memory", run: () => navigate("/memory") },
    { label: "Apps", hint: "Go", icon: "apps", run: () => navigate("/apps") },
    { label: "Settings & devices", hint: "Go", icon: "settings", run: () => navigate("/settings") },
  ];

  const paint = () => {
    if (!items.length) {
      results.innerHTML = `<div class="empty" style="padding:26px 16px;border:0;background:none">
        <p>No matches. Try a person, a place, or a word from a session.</p></div>`;
      return;
    }
    let html = "";
    let group = "";
    items.forEach((item, index) => {
      if (item.group !== group) {
        group = item.group;
        html += `<div class="palette-group eyebrow">${ui.escapeHtml(group)}</div>`;
      }
      html += `<button class="palette-item${index === active ? " active" : ""}" data-index="${index}">
        ${icon(item.icon || "dot", 15)}
        <span class="truncate">${ui.escapeHtml(item.label)}</span>
        <span class="right mono">${ui.escapeHtml(item.hint || "")}</span>
      </button>`;
    });
    results.innerHTML = html;
    ui.qsa(".palette-item", results).forEach((btn) =>
      btn.addEventListener("click", () => choose(Number(btn.dataset.index)))
    );
  };

  const choose = (index) => {
    const item = items[index];
    if (!item) return;
    close();
    item.run();
  };

  const load = async (q) => {
    if (!q) {
      items = commands().map((c) => ({ ...c, group: "Jump to" }));
      active = 0;
      paint();
      return;
    }
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      const next = [];
      data.memories.forEach((m) =>
        next.push({
          group: "Memory",
          icon: "memory",
          label: m.fact,
          hint: m.category,
          run: () => navigate(`/memory?q=${encodeURIComponent(q)}`),
        })
      );
      data.nudges.forEach((n) =>
        next.push({
          group: "Nudges",
          icon: "nudges",
          label: n.title,
          hint: n.triggerKind,
          run: () => navigate(`/nudges?q=${encodeURIComponent(q)}`),
        })
      );
      data.sessions.forEach((s) =>
        next.push({
          group: "Sessions",
          icon: "sessions",
          label: s.title,
          hint: s.startedAt ? ui.dateLine(s.startedAt) : "",
          run: () => navigate(`/sessions/${s.id}`),
        })
      );
      items = next;
      active = 0;
      paint();
    } catch {
      results.innerHTML = `<div class="palette-group faint">Search is unavailable right now.</div>`;
    }
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      paint();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(0, active - 1);
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  };

  const close = () => {
    paletteOpen = false;
    paletteCloser = null;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  paletteCloser = close;

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  input.addEventListener(
    "input",
    ui.debounce(() => load(input.value.trim()), 180)
  );
  load("");
  input.focus();
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && app.user) {
    event.preventDefault();
    if (paletteOpen) paletteCloser?.();
    else openPalette();
  }
  if (event.key === "/" && app.user && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
    event.preventDefault();
    openPalette();
  }
});

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

let stopStream = () => {};

function startStream() {
  stopStream();
  stopStream = connectEvents({
    onStatus: (status) => {
      app.connection = status;
      refreshChrome();
    },
    onEvent: (name, data) => {
      if (name === "session.started") {
        app.live = { session: data.session, events: data.session.events || [] };
        refreshChrome();
      } else if (name === "session.ended") {
        const wasWatching = parseLocation().path === "/live";
        app.live = null;
        refreshChrome();
        if (!wasWatching) {
          const secs = data.session?.durationSeconds || 0;
          ui.toast(`Session saved · ${ui.humanDuration(secs)}`, { kind: "info" });
        }
      } else if (name === "event") {
        if (app.live?.session.id === data.sessionId) app.live.events.push(data);
      } else if (name === "device.updated" || name === "device.created") {
        const idx = app.devices.findIndex((d) => d.id === data.device.id);
        if (idx >= 0) app.devices[idx] = data.device;
        else app.devices.push(data.device);
      } else if (name === "device.deleted") {
        app.devices = app.devices.filter((d) => d.id !== data.id);
        refreshChrome();
      }
      if (name === "device.updated" || name === "device.created") refreshChrome();
      app.bus.emit(name, data);
      app.bus.emit("any", { name, data });
    },
  });
}

async function loadDevices() {
  try {
    const data = await api("/api/devices");
    app.devices = data.items;
    refreshChrome();
  } catch {
    /* non-critical chrome */
  }
}

/* ------------------------------------------------------------------ */
/* Enter / boot                                                        */
/* ------------------------------------------------------------------ */

async function enterApp(user) {
  app.user = user;
  renderShell();
  await loadDevices();
  try {
    const state = await api("/api/live/state");
    app.live = state.session ? { session: state.session, events: state.session.events } : null;
  } catch {
    app.live = null;
  }
  startStream();
  refreshChrome();
  const { path } = parseLocation();
  if (path === "/overview") history.replaceState({}, "", "/overview");
  renderRoute();
  clockTimer = setInterval(() => {
    if (app.live) refreshChrome();
  }, 30_000);
}

async function boot() {
  const { path, query } = parseLocation();
  if (query.get("auth") === "signup") return renderAuth("signup");
  try {
    const data = await api("/api/auth/me");
    await enterApp(data.user);
  } catch {
    renderAuth("login");
    if (path !== "/") history.replaceState({}, "", "/");
  }
}

document.addEventListener("hc:unauthorized", () => {
  stopStream();
  app.user = null;
  app.live = null;
  renderAuth("login");
});

boot();
