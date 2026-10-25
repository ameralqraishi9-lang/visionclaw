/** Sessions — the archive of every conversation the glasses kept. */
import { api } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

export async function mountSessions(ctx) {
  const { root, navigate, on, isCurrent } = ctx;
  const state = {
    q: ctx.query.get("q") || "",
    mode: ctx.query.get("mode") || "",
    range: ctx.query.get("range") || "",
    items: [],
    total: 0,
    loading: true,
    error: null,
  };

  root.innerHTML = `
    <div class="section-head">
      <p class="grow" id="session-count">Loading…</p>
      <div class="actions">
        <div class="search">
          ${icon("search", 15)}
          <input class="input" id="q" placeholder="Search titles and summaries" value="${esc(state.q)}"
            aria-label="Search sessions" style="width:240px">
        </div>
        <div class="segmented" id="mode-filter">
          ${[
            ["", "All"],
            ["glasses", "Glasses"],
            ["phone", "Phone"],
          ]
            .map(
              ([value, label]) =>
                `<button data-mode="${value}" aria-pressed="${state.mode === value}">${label}</button>`
            )
            .join("")}
        </div>
        <div class="segmented" id="range-filter">
          ${[
            ["", "All time"],
            ["week", "7 days"],
            ["today", "Today"],
          ]
            .map(
              ([value, label]) =>
                `<button data-range="${value}" aria-pressed="${state.range === value}">${label}</button>`
            )
            .join("")}
        </div>
        <button class="btn primary" id="new-session">${icon("live", 15)}Go live</button>
      </div>
    </div>
    <div id="list"></div>`;

  const listEl = ui.qs("#list");
  listEl.innerHTML = `<div class="card card-body">${ui.skeletonList(6)}</div>`;

  const params = () => {
    const search = new URLSearchParams();
    if (state.q) search.set("q", state.q);
    if (state.mode) search.set("mode", state.mode);
    if (state.range) search.set("range", state.range);
    search.set("limit", "60");
    return search.toString();
  };

  async function load() {
    state.loading = true;
    try {
      const data = await api(`/api/sessions?${params()}`);
      if (!isCurrent()) return;
      state.items = data.items;
      state.total = data.total;
      state.error = null;
    } catch (err) {
      if (!isCurrent()) return;
      state.error = err.message;
    }
    state.loading = false;
    paint();
  }

  function paint() {
    if (!isCurrent()) return;
    const count = ui.qs("#session-count");
    if (count) {
      count.textContent = state.loading
        ? "Loading…"
        : `${ui.plural(state.total, "session")}${state.q ? ` matching “${state.q}”` : ""} · ${ui.plural(
            state.items.reduce((sum, s) => sum + Math.round(s.durationSeconds / 60), 0),
            "minute"
          )} of conversation`;
    }

    if (state.loading) {
      listEl.innerHTML = `<div class="card card-body">${ui.skeletonList(5)}</div>`;
      return;
    }
    if (state.error) {
      listEl.innerHTML = ui.errorState(state.error);
      ui.qs("[data-retry]", listEl)?.addEventListener("click", load);
      return;
    }
    if (!state.items.length) {
      listEl.innerHTML = state.q || state.mode || state.range
        ? ui.emptyState({
            iconName: "search",
            title: "No sessions match that",
            body: "Try a different word, or clear the filters to see everything.",
            actions: `<button class="btn sm" data-clear>Clear filters</button>`,
          })
        : ui.emptyState({
            iconName: "sessions",
            title: "Your history starts with a sentence",
            body: "Start a live session and Claw records the transcript, the frames it saw, and every action it took. It lands here before you put your phone down.",
            actions: `<button class="btn primary sm" data-new>${icon("live", 14)}Start a session</button>`,
          });
      ui.qs("[data-clear]", listEl)?.addEventListener("click", () => {
        state.q = "";
        state.mode = "";
        state.range = "";
        ui.qs("#q").value = "";
        ui.qsa("#mode-filter button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === "")));
        ui.qsa("#range-filter button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === "")));
        load();
      });
      ui.qs("[data-new]", listEl)?.addEventListener("click", () => navigate("/live"));
      return;
    }

    listEl.innerHTML = `<div class="card"><div class="list">${state.items
      .map(
        (s) => `<div class="list-row" data-id="${s.id}" role="button" tabindex="0" style="padding:13px 16px">
          <span class="thumb ${s.mode === "glasses" ? "accent" : ""}">${ui.deviceIcon(s.mode === "phone" ? "phone" : "glasses")}</span>
          <span class="grow">
            <span class="title">${esc(s.title)}
              ${s.actionsCount ? `<span class="badge teal" style="height:17px;font-size:9.5px">${s.actionsCount} actions</span>` : ""}
            </span>
            <span class="sub">
              <span>${ui.dateLine(s.startedAt)} · ${ui.timeOfDay(s.startedAt)}</span>
              <span>·</span>
              <span>${ui.humanDuration(s.durationSeconds)}</span>
              <span>·</span>
              <span>${s.eventCount} events</span>
              ${s.deviceName ? `<span class="faint">· ${esc(s.deviceName)}</span>` : ""}
            </span>
            ${s.summary ? `<div class="muted truncate" style="font-size:12px;margin-top:4px">${esc(s.summary)}</div>` : ""}
          </span>
          <span class="right">
            <button class="icon-btn sm" data-delete="${s.id}" title="Delete session" aria-label="Delete session">${icon("trash", 14)}</button>
            <span class="faint">${icon("chevronRight", 15)}</span>
          </span>
        </div>`
      )
      .join("")}</div></div>`;

    ui.qsa("[data-id]", listEl).forEach((row) => {
      const open = () => openDetail(row.dataset.id);
      row.addEventListener("click", (event) => {
        if (event.target.closest("[data-delete]")) return;
        open();
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
    ui.qsa("[data-delete]", listEl).forEach((btn) =>
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeSession(btn.dataset.delete);
      })
    );
  }

  async function removeSession(id) {
    const row = state.items.find((s) => s.id === id);
    if (!row) return;
    await ui.confirmDialog({
      title: "Delete this session?",
      message: `“${row.title}” and its ${row.eventCount} timeline events will be removed. This can't be undone.`,
      confirmLabel: "Delete session",
      danger: true,
      onConfirm: async () => {
        // Optimistic: the row disappears immediately.
        state.items = state.items.filter((s) => s.id !== id);
        state.total = Math.max(0, state.total - 1);
        paint();
        try {
          await api(`/api/sessions/${id}`, { method: "DELETE" });
          ui.toast("Session deleted");
        } catch (err) {
          ui.toast(err.message, { kind: "error" });
          load();
        }
      },
    });
  }

  async function openDetail(id) {
    history.replaceState({}, "", `/sessions/${id}`);
    const overlay = document.createElement("div");
    overlay.className = "overlay right";
    overlay.innerHTML = `<div class="drawer" role="dialog" aria-modal="true" aria-label="Session detail">
      <div class="drawer-head">
        <div class="grow">${ui.skeletonList(2)}</div>
        <button class="icon-btn" data-close aria-label="Close">${icon("x", 16)}</button>
      </div>
      <div class="drawer-body">${ui.skeletonList(6)}</div>
    </div>`;
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      history.replaceState({}, "", "/sessions");
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector("[data-close]").addEventListener("click", close);

    let data;
    try {
      data = await api(`/api/sessions/${id}`);
    } catch (err) {
      overlay.querySelector(".drawer-body").innerHTML = ui.errorState(err.message);
      return;
    }
    const s = data.session;
    overlay.innerHTML = `<div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(s.title)}">
      <div class="drawer-head">
        <span class="thumb ${s.mode === "glasses" ? "accent" : ""}">${ui.deviceIcon(s.mode === "phone" ? "phone" : "glasses")}</span>
        <div class="grow" style="min-width:0">
          <div class="eyebrow">${ui.dateLine(s.startedAt)} · ${ui.timeOfDay(s.startedAt)}</div>
          <h2 id="drawer-title" style="font-size:16px;font-weight:620;margin-top:2px">${esc(s.title)}</h2>
          <div class="faint" style="font-size:11.5px;margin-top:3px">
            ${ui.humanDuration(s.durationSeconds)} · ${s.mode === "phone" ? "phone camera" : "glasses"}${s.deviceName ? ` · ${esc(s.deviceName)}` : ""}
          </div>
        </div>
        <button class="icon-btn" data-close aria-label="Close">${icon("x", 16)}</button>
      </div>
      <div class="drawer-body">
        <div class="card" style="background:var(--surface-2)">
          <div class="card-body" style="padding:13px 14px">
            <div class="eyebrow">Summary</div>
            <p style="font-size:13px;line-height:1.6;margin-top:6px">${esc(s.summary || "No summary was written for this session.")}</p>
          </div>
        </div>

        <div class="grid cols-2" style="margin-top:12px;gap:10px">
          <div class="card card-body" style="padding:12px">
            <div class="eyebrow">Actions</div>
            <div class="stat-value" style="font-size:20px;margin-top:6px">${s.actionsCount}</div>
          </div>
          <div class="card card-body" style="padding:12px">
            <div class="eyebrow">Events</div>
            <div class="stat-value" style="font-size:20px;margin-top:6px">${s.eventCount}</div>
          </div>
        </div>

        <div class="row" style="margin:18px 0 8px">
          <h3 style="font-size:13px;font-weight:600">Transcript</h3>
          <span class="badge plain" style="margin-left:auto">${s.events.length} entries</span>
        </div>
        <div class="stack" style="gap:12px">
          ${
            s.events.length
              ? s.events
                  .map((event) => {
                    if (event.role === "scene") {
                      return `<div class="turn turn-scene"><div class="body">
                        <div class="who">${icon("glasses", 12)}frame<span class="when">${ui.timeOfDay(event.ts)}</span></div>
                        <div class="text">${esc(event.text)}</div></div></div>`;
                    }
                    if (event.role === "action") {
                      return `<div class="turn turn-action"><div class="body">
                        <div class="who">${esc(event.meta?.tool || "action")}<span class="when">${ui.timeOfDay(event.ts)}</span></div>
                        <div class="text">${esc(event.text)}</div></div></div>`;
                    }
                    if (event.role === "claw") {
                      return `<div class="turn turn-claw">
                        <span class="thumb accent" style="width:26px;height:26px;border-radius:8px">${icon("live", 13)}</span>
                        <div class="body"><div class="who">claw<span class="when" style="margin-left:auto">${ui.timeOfDay(event.ts)}</span></div>
                        <div class="text">${esc(event.text)}</div></div></div>`;
                    }
                    return `<div class="turn turn-user"><div class="body">
                      <div class="who" style="justify-content:flex-end"><span>you</span><span class="when">${ui.timeOfDay(event.ts)}</span></div>
                      <div class="text">${esc(event.text)}</div></div></div>`;
                  })
                  .join("")
              : `<p class="faint" style="font-size:12.5px">No events were recorded.</p>`
          }
        </div>

        <div class="divider"></div>
        <div class="field">
          <label for="rename">Rename session</label>
          <div class="row">
            <input class="input" id="rename" value="${esc(s.title)}" maxlength="120">
            <button class="btn" id="rename-btn">Save</button>
          </div>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn danger" id="delete-session">${icon("trash", 14)}Delete</button>
        <span class="grow"></span>
        <button class="btn ghost" data-close>Close</button>
      </div>
    </div>`;

    overlay.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", close));

    overlay.querySelector("#rename-btn").addEventListener("click", async (event) => {
      const input = overlay.querySelector("#rename");
      const title = input.value.trim();
      if (!title) return ui.toast("A session needs a name", { kind: "error" });
      ui.setBusy(event.currentTarget, true, "Saving");
      try {
        const res = await api(`/api/sessions/${s.id}`, { method: "PATCH", body: { title } });
        s.title = res.session.title;
        overlay.querySelector("#drawer-title").textContent = title;
        const row = state.items.find((item) => item.id === s.id);
        if (row) row.title = title;
        paint();
        ui.toast("Session renamed");
      } catch (err) {
        ui.toast(err.message, { kind: "error" });
      } finally {
        ui.setBusy(event.currentTarget, false);
      }
    });

    overlay.querySelector("#delete-session").addEventListener("click", async () => {
      await ui.confirmDialog({
        title: "Delete this session?",
        message: "The transcript and every action in it will be removed. This can't be undone.",
        confirmLabel: "Delete session",
        danger: true,
        onConfirm: async () => {
          try {
            await api(`/api/sessions/${s.id}`, { method: "DELETE" });
            state.items = state.items.filter((item) => item.id !== s.id);
            state.total = Math.max(0, state.total - 1);
            paint();
            close();
            ui.toast("Session deleted");
          } catch (err) {
            ui.toast(err.message, { kind: "error" });
            throw err;
          }
        },
      });
    });
  }

  /* ---------- wiring ---------- */

  ui.qs("#new-session").addEventListener("click", () => navigate("/live"));
  ui.qs("#q").addEventListener(
    "input",
    ui.debounce((event) => {
      state.q = event.target.value.trim();
      load();
    }, 260)
  );
  ui.qsa("#mode-filter button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      ui.qsa("#mode-filter button").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode))
      );
      load();
    })
  );
  ui.qsa("#range-filter button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.range = btn.dataset.range;
      ui.qsa("#range-filter button").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.range === state.range))
      );
      load();
    })
  );

  const off = on("any", ({ name }) => {
    if (["session.ended", "session.deleted"].includes(name)) load();
  });

  await load();
  if (ctx.params.id) openDetail(ctx.params.id);

  return () => off();
}
