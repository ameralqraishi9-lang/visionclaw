/** Apps — the accounts Claw is allowed to act through. */
import { api } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

export async function mountApps(ctx) {
  const { root, on, isCurrent, user } = ctx;
  const state = { items: [], categories: [], filter: "all", loading: true, error: null };

  root.innerHTML = `
    <div class="section-head">
      <p class="grow" id="apps-sub">Loading catalog…</p>
      <div class="actions">
        <div class="segmented" id="app-filter">
          ${[
            ["all", "All"],
            ["connected", "Connected"],
            ["available", "Available"],
          ]
            .map(
              ([value, label]) =>
                `<button data-filter="${value}" aria-pressed="${value === "all"}">${label}</button>`
            )
            .join("")}
        </div>
      </div>
    </div>
    <div id="app-grid"></div>
    <section class="card card-body" style="margin-top:18px;display:flex;gap:14px;align-items:flex-start">
      <span class="thumb teal">${icon("shield", 16)}</span>
      <div>
        <div style="font-size:13px;font-weight:600">Scoped, revocable, per-account</div>
        <p class="muted" style="font-size:12.5px;line-height:1.65;margin-top:5px;max-width:640px">
          Each connection carries only the scopes listed on its card. Pausing keeps the grant but stops
          Claw from calling it; disconnecting revokes it at the provider. The gateway performs the OAuth
          exchange and stores tokens in your per-user vault — never in this browser.
        </p>
      </div>
    </section>`;

  const gridEl = ui.qs("#app-grid");
  gridEl.innerHTML = `<div class="app-grid">${Array.from({ length: 6 })
    .map(() => `<div class="skeleton" style="height:184px;border-radius:16px"></div>`)
    .join("")}</div>`;

  async function load() {
    try {
      const data = await api("/api/connections");
      if (!isCurrent()) return;
      state.items = data.items;
      state.categories = data.categories;
      state.error = null;
    } catch (err) {
      if (!isCurrent()) return;
      state.error = err.message;
    }
    state.loading = false;
    paint();
  }

  function paint() {
    if (!isCurrent() || state.loading) return;
    const connected = state.items.filter((a) => a.status === "connected").length;
    ui.qs("#apps-sub").textContent = `${connected} of ${state.items.length} apps connected · ${
      state.items.reduce((n, a) => n + (a.status === "connected" ? a.scopes.length : 0), 0)
    } scopes granted`;

    if (state.error) {
      gridEl.innerHTML = ui.errorState(state.error);
      ui.qs("[data-retry]", gridEl)?.addEventListener("click", load);
      return;
    }

    const visible = state.items.filter((app) => {
      if (state.filter === "connected") return app.status !== "disconnected";
      if (state.filter === "available") return app.status === "disconnected";
      return true;
    });

    if (!visible.length) {
      gridEl.innerHTML = ui.emptyState({
        iconName: "apps",
        title: state.filter === "available" ? "Everything is already connected" : "Nothing connected yet",
        body:
          state.filter === "available"
            ? "Claw can already act through every app in the catalog. Pause one if you want a break."
            : "Connect an account and Claw can use it the moment you ask — or before you think to.",
        actions: `<button class="btn sm" data-show-all>Show all apps</button>`,
      });
      ui.qs("[data-show-all]", gridEl)?.addEventListener("click", () => {
        state.filter = "all";
        ui.qsa("#app-filter button").forEach((b) =>
          b.setAttribute("aria-pressed", String(b.dataset.filter === "all"))
        );
        paint();
      });
      return;
    }

    gridEl.innerHTML = `<div class="app-grid">${visible.map(card).join("")}</div>`;

    ui.qsa("[data-connect]", gridEl).forEach((btn) =>
      btn.addEventListener("click", () => connect(btn.dataset.connect, btn))
    );
    ui.qsa("[data-disconnect]", gridEl).forEach((btn) =>
      btn.addEventListener("click", () => disconnect(btn.dataset.disconnect))
    );
    ui.qsa("[data-pause]", gridEl).forEach((btn) => {
      const app = state.items.find((a) => a.slug === btn.dataset.pause);
      btn.addEventListener("click", () => setStatus(app, app.status === "paused" ? "connected" : "paused"));
    });
  }

  function card(app) {
    const isConnected = app.status === "connected";
    return `<article class="card app-card" data-app="${app.slug}">
      <div class="row" style="align-items:flex-start">
        <span class="app-logo" style="background:linear-gradient(150deg, ${app.tint}, ${shade(app.tint)})">${esc(app.monogram)}</span>
        <div class="grow" style="min-width:0">
          <div class="name">${esc(app.name)}</div>
          <div class="faint" style="font-size:11px">${esc(app.category)}</div>
        </div>
        ${
          isConnected
            ? `<span class="badge teal" style="height:18px"><span class="dot"></span>on</span>`
            : app.status === "paused"
              ? `<span class="badge plain" style="height:18px">paused</span>`
              : ""
        }
      </div>
      <p class="blurb">${esc(app.blurb)}</p>
      <div class="scopes">${app.scopes.map((s) => `<span class="scope">${esc(s)}</span>`).join("")}</div>
      <div class="foot">
        ${
          app.status === "disconnected"
            ? `<span class="account faint">Not connected</span>
               <span style="margin-left:auto">
                 <button class="btn sm" data-connect="${app.slug}">${icon("plus", 13)}Connect</button>
               </span>`
            : `<span class="account">
                 <span class="status-dot ${app.status === "paused" ? "offline" : "connected"}"></span>
                 ${esc(app.accountLabel)}${app.status === "paused" ? " · paused" : ""}
               </span>
               <span style="margin-left:auto;display:flex;gap:2px">
                 <button class="icon-btn sm" data-pause="${app.slug}" title="${app.status === "paused" ? "Resume" : "Pause"}"
                   aria-label="${app.status === "paused" ? "Resume" : "Pause"} ${esc(app.name)}">
                   ${icon(app.status === "paused" ? "play" : "pause", 13)}
                 </button>
                 <button class="icon-btn sm danger" data-disconnect="${app.slug}" title="Disconnect"
                   aria-label="Disconnect ${esc(app.name)}">${icon("unlink", 13)}</button>
               </span>`
        }
      </div>
    </article>`;
  }

  async function connect(slug, button) {
    const app = state.items.find((a) => a.slug === slug);
    if (!app) return;
    ui.setBusy(button, true, "Opening");
    // A brief, honest handshake beat: the real flow opens an in-app auth sheet.
    await new Promise((resolve) => setTimeout(resolve, 550));
    try {
      const res = await api(`/api/connections/${slug}/connect`, {
        method: "POST",
        body: { accountLabel: user.email },
      });
      Object.assign(app, res.connection);
      paint();
      ui.toast(`${app.name} connected`);
    } catch (err) {
      ui.toast(err.message, { kind: "error" });
      paint();
    }
  }

  async function disconnect(slug) {
    const app = state.items.find((a) => a.slug === slug);
    if (!app) return;
    await ui.confirmDialog({
      title: `Disconnect ${app.name}?`,
      message: `Claw will lose the ${app.scopes.join(", ")} grants and stop acting on your behalf in ${app.name}.`,
      confirmLabel: "Disconnect",
      danger: true,
      onConfirm: async () => {
        const previous = { ...app };
        app.status = "disconnected";
        paint();
        try {
          const res = await api(`/api/connections/${slug}/disconnect`, { method: "POST" });
          Object.assign(app, res.connection);
          paint();
          ui.toast(`${app.name} disconnected`, { kind: "info" });
        } catch (err) {
          Object.assign(app, previous);
          paint();
          ui.toast(err.message, { kind: "error" });
          throw err;
        }
      },
    });
  }

  async function setStatus(app, status) {
    if (!app) return;
    const previous = app.status;
    app.status = status;
    paint();
    try {
      const res = await api(`/api/connections/${app.slug}`, { method: "PATCH", body: { status } });
      Object.assign(app, res.connection);
      paint();
      ui.toast(status === "paused" ? `${app.name} paused` : `${app.name} resumed`, { kind: "info" });
    } catch (err) {
      app.status = previous;
      paint();
      ui.toast(err.message, { kind: "error" });
    }
  }

  ui.qsa("#app-filter button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      ui.qsa("#app-filter button").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter))
      );
      paint();
    })
  );

  const off = on("connection.updated", (data) => {
    const app = state.items.find((a) => a.slug === data.connection.slug);
    if (app) {
      Object.assign(app, data.connection);
      paint();
    }
  });

  await load();
  return () => off();
}

/** Darken a hex tint for the logo gradient. */
function shade(hex) {
  const clean = hex.replace("#", "");
  const num = parseInt(clean.length === 3 ? clean.repeat(2) : clean, 16);
  const r = Math.max(0, ((num >> 16) & 255) - 70);
  const g = Math.max(0, ((num >> 8) & 255) - 70);
  const b = Math.max(0, (num & 255) - 70);
  return `rgb(${r}, ${g}, ${b})`;
}
