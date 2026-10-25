/** Nudges — the moments Claw speaks first. */
import { api } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

const TRIGGERS = [
  ["place", "Place", "Arriving somewhere, or leaving it", "arriving or leaving"],
  ["calendar", "Calendar", "Before or after an event", "calendar events"],
  ["routine", "Routine", "A time of day or a repeated habit", "a routine"],
  ["device", "Device", "Battery, pairing, connection", "device state"],
  ["time", "Time", "Quiet hours, mornings, wind-down", "time of day"],
  ["weather", "Weather", "Rain, heat, first snow", "the weather"],
  ["person", "Person", "When someone specific is around", "a person"],
];

export async function mountNudges(ctx) {
  const { root, on, isCurrent, query } = ctx;
  const state = {
    items: [],
    recent: [],
    stats: { active: 0, paused: 0, fired30d: 0, firedToday: 0 },
    filter: "all",
    q: query.get("q") || "",
    loading: true,
    error: null,
  };

  root.innerHTML = `
    <div class="section-head">
      <p class="grow" id="nudge-sub">Loading your rules…</p>
      <div class="actions">
        <div class="search">
          ${icon("search", 15)}
          <input class="input" id="nq" placeholder="Search nudges" value="${esc(state.q)}"
            aria-label="Search nudges" style="width:210px">
        </div>
        <div class="segmented" id="nudge-filter">
          ${[
            ["all", "All"],
            ["active", "Armed"],
            ["paused", "Paused"],
          ]
            .map(([value, label]) => `<button data-filter="${value}" aria-pressed="false">${label}</button>`)
            .join("")}
        </div>
        <button class="btn primary" id="new-nudge">${icon("plus", 15)}New nudge</button>
      </div>
    </div>
    <div id="nudge-stats"></div>
    <div id="nudge-list" style="margin-top:16px"></div>
    <div id="nudge-recent" style="margin-top:16px"></div>`;

  const listEl = ui.qs("#nudge-list");
  const statsEl = ui.qs("#nudge-stats");
  const recentEl = ui.qs("#nudge-recent");
  statsEl.innerHTML = ui.skeletonStats(4);
  listEl.innerHTML = `<div class="grid cols-3">${Array.from({ length: 3 })
    .map(() => `<div class="skeleton" style="height:186px;border-radius:16px"></div>`)
    .join("")}</div>`;

  async function load() {
    try {
      const data = await api("/api/nudges");
      if (!isCurrent()) return;
      state.items = data.items;
      state.recent = data.recent;
      state.stats = data.stats;
      state.error = null;
    } catch (err) {
      if (!isCurrent()) return;
      state.error = err.message;
    }
    state.loading = false;
    paint();
  }

  function visible() {
    const q = state.q.toLowerCase();
    return state.items.filter((n) => {
      if (state.filter === "active" && !n.active) return false;
      if (state.filter === "paused" && n.active) return false;
      if (!q) return true;
      return [n.title, n.condition, n.action].some((field) => field.toLowerCase().includes(q));
    });
  }

  function paint() {
    if (!isCurrent()) return;
    const sub = ui.qs("#nudge-sub");
    if (!sub) return;
    sub.textContent = state.loading
      ? "Loading your rules…"
      : `${state.stats.active} armed · ${state.stats.paused} paused · ${state.stats.fired30d} firings in 30 days`;

    statsEl.innerHTML = `<div class="grid cols-4">
      ${miniStat("shield", "Armed", state.stats.active, "speaks without being asked")}
      ${miniStat("pause", "Paused", state.stats.paused, "kept, but silent")}
      ${miniStat("zap", "Fired today", state.stats.firedToday, "one sentence each")}
      ${miniStat("wave", "Last 30 days", state.stats.fired30d, "moments it chose")}
    </div>`;

    if (state.loading) {
      listEl.innerHTML = `<div class="grid cols-3">${Array.from({ length: 3 })
        .map(() => `<div class="skeleton" style="height:186px;border-radius:16px"></div>`)
        .join("")}</div>`;
      recentEl.innerHTML = "";
      return;
    }
    if (state.error) {
      listEl.innerHTML = ui.errorState(state.error);
      ui.qs("[data-retry]", listEl)?.addEventListener("click", load);
      return;
    }

    const items = visible();
    listEl.innerHTML = items.length
      ? `<div class="nudge-grid">${items.map(nudgeCard).join("")}</div>`
      : state.items.length
        ? ui.emptyState({
            iconName: "search",
            title: "Nothing matches",
            body: "Try another word, or clear the filter.",
            actions: `<button class="btn sm" data-clear>Clear filters</button>`,
          })
        : ui.emptyState({
            iconName: "nudges",
            title: "Claw has nothing to say yet",
            body: "Nudges are the rules that let Claw speak first — at the door, before a meeting, after quiet hours. Arms itself in seconds.",
            actions: `<button class="btn primary sm" data-first>${icon("plus", 14)}Create your first nudge</button>`,
          });

    ui.qs("[data-clear]", listEl)?.addEventListener("click", () => {
      state.q = "";
      state.filter = "all";
      ui.qs("#nq").value = "";
      syncFilter();
      paint();
    });
    ui.qs("[data-first]", listEl)?.addEventListener("click", () => openForm());

    ui.qsa("[data-toggle]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => toggle(btn.dataset.toggle))
    );
    ui.qsa("[data-test]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => testFire(btn.dataset.test, btn))
    );
    ui.qsa("[data-edit]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => openForm(state.items.find((n) => n.id === btn.dataset.edit)))
    );
    ui.qsa("[data-remove]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => remove(btn.dataset.remove))
    );

    recentEl.innerHTML = state.recent.length
      ? `<section class="card">
          <div class="card-head"><h2>Recent firings</h2>
            <div class="actions"><span class="badge plain">${state.recent.length} shown</span></div>
          </div>
          <div class="list">${state.recent
            .map(
              (e) => `<div class="list-row" style="cursor:default">
                <span class="thumb accent">${icon("mic", 14)}</span>
                <span class="grow">
                  <span class="title" style="font-weight:500;font-size:12.5px">${esc(e.message)}</span>
                  <span class="sub">Spoken · ${ui.relTime(e.firedAt)} · ${ui.timeOfDay(e.firedAt)}</span>
                </span>
                <span class="right badge plain">${e.kind}</span>
              </div>`
            )
            .join("")}</div>
        </section>`
      : "";
  }

  function syncFilter() {
    ui.qsa("#nudge-filter button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter))
    );
  }

  /* ---------- mutations ---------- */

  async function toggle(id) {
    const nudge = state.items.find((n) => n.id === id);
    if (!nudge) return;
    const next = !nudge.active;
    // Optimistic flip — the switch answers instantly.
    nudge.active = next;
    paint();
    try {
      const res = await api(`/api/nudges/${id}`, { method: "PATCH", body: { active: next } });
      Object.assign(nudge, res.nudge);
      ui.toast(next ? `Armed · ${nudge.title}` : `Paused · ${nudge.title}`, { kind: "info" });
    } catch (err) {
      nudge.active = !next;
      ui.toast(err.message, { kind: "error" });
    }
    paint();
  }

  async function testFire(id, button) {
    const nudge = state.items.find((n) => n.id === id);
    if (!nudge) return;
    ui.setBusy(button, true, "Speaking");
    try {
      const res = await api(`/api/nudges/${id}/fire`, { method: "POST" });
      Object.assign(nudge, res.nudge);
      state.recent = [res.event, ...state.recent].slice(0, 12);
      state.stats.firedToday += 1;
      state.stats.fired30d += 1;
      paint();
      ui.toast(res.event.message, { kind: "info", timeout: 5200 });
    } catch (err) {
      ui.toast(err.message, { kind: "error" });
      ui.setBusy(button, false);
    }
  }

  async function remove(id) {
    const nudge = state.items.find((n) => n.id === id);
    if (!nudge) return;
    await ui.confirmDialog({
      title: "Delete this nudge?",
      message: `Claw will stop watching for “${nudge.condition}”. Its firing history is removed too.`,
      confirmLabel: "Delete nudge",
      danger: true,
      onConfirm: async () => {
        state.items = state.items.filter((n) => n.id !== id);
        paint();
        try {
          await api(`/api/nudges/${id}`, { method: "DELETE" });
          ui.toast("Nudge deleted");
        } catch (err) {
          ui.toast(err.message, { kind: "error" });
          load();
        }
      },
    });
  }

  function openForm(existing = null) {
    const editing = Boolean(existing);
    const n = existing || {
      title: "",
      triggerKind: "place",
      condition: "",
      action: "",
      priority: "normal",
      active: true,
    };
    const { overlay, close } = ui.modal({
      title: editing ? "Edit nudge" : "New nudge",
      subtitle: editing
        ? "Change when Claw speaks, or exactly what it says."
        : "A nudge is a rule, not a reminder: it fires when the moment arrives.",
      wide: true,
      body: `
        <div class="row" style="gap:8px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--accent-dim);border:1px solid var(--accent-line)">
          <span style="color:var(--accent);margin-top:1px">${icon("sparkle", 15)}</span>
          <p style="font-size:12px;line-height:1.6;color:#ffd9a8;margin:0">
            Claw keeps it to one sentence. It speaks, then goes back to being quiet.
          </p>
        </div>
        <form id="nudge-form" class="stack" style="gap:14px" novalidate>
          <div class="field" data-field="title">
            <label for="n-title">Name</label>
            <input class="input" id="n-title" name="title" maxlength="80" placeholder="Grab the package" value="${esc(n.title)}" required>
          </div>
          <div class="form-grid">
            <div class="field" data-field="triggerKind">
              <label for="n-trigger">Fires when</label>
              <select class="select" id="n-trigger" name="triggerKind">
                ${TRIGGERS.map(
                  ([value, label]) =>
                    `<option value="${value}" ${n.triggerKind === value ? "selected" : ""}>${label} — ${TRIGGERS.find(([v]) => v === value)?.[3] || label}</option>`
                ).join("")}
              </select>
            </div>
            <div class="field" data-field="priority">
              <label for="n-priority">Priority</label>
              <select class="select" id="n-priority" name="priority">
                ${[
                  ["low", "Low — whisper, may wait"],
                  ["normal", "Normal — speak once"],
                  ["high", "High — interrupt politely"],
                ]
                  .map(
                    ([value, label]) =>
                      `<option value="${value}" ${n.priority === value ? "selected" : ""}>${label}</option>`
                  )
                  .join("")}
              </select>
            </div>
          </div>
          <div class="field" data-field="condition">
            <label for="n-condition">The moment</label>
            <input class="input" id="n-condition" name="condition" maxlength="200"
              placeholder="Arriving home during a delivery window" value="${esc(n.condition)}" required>
            <span class="help">Describe the situation in your own words. Claw matches it against what the glasses see and hear.</span>
          </div>
          <div class="field" data-field="action">
            <label for="n-action">What gets said</label>
            <textarea class="textarea" id="n-action" name="action" maxlength="200"
              placeholder="One quiet sentence at the door — then stay silent">${esc(n.action)}</textarea>
          </div>
          <label class="check">
            <input type="checkbox" name="active" ${n.active ? "checked" : ""}>
            <span><strong style="font-weight:550">Arm immediately</strong><br>
            <span class="help">Paused nudges keep their history and can be resumed any time.</span></span>
          </label>
        </form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="save-nudge">${editing ? "Save changes" : "Create nudge"}</button>`,
    });

    overlay.querySelector("#save-nudge").addEventListener("click", async (event) => {
      const form = overlay.querySelector("#nudge-form");
      ui.clearFieldErrors(form);
      const values = ui.formValues(form);
      if (!values.title) return ui.showFieldError(form, "title", "Give it a name");
      if (!values.condition) return ui.showFieldError(form, "condition", "Describe the moment");
      if (!values.action) return ui.showFieldError(form, "action", "Say what Claw should say");
      ui.setBusy(event.currentTarget, true, editing ? "Saving" : "Creating");
      try {
        const payload = editing
          ? await api(`/api/nudges/${existing.id}`, { method: "PATCH", body: values })
          : await api("/api/nudges", { method: "POST", body: values });
        if (editing) {
          const idx = state.items.findIndex((item) => item.id === existing.id);
          if (idx >= 0) state.items[idx] = payload.nudge;
        } else {
          state.items.unshift(payload.nudge);
          state.stats.active += payload.nudge.active ? 1 : 0;
        }
        close();
        paint();
        ui.toast(editing ? "Nudge updated" : "Nudge created");
      } catch (err) {
        ui.setBusy(event.currentTarget, false);
        if (err.details) {
          for (const [field, message] of Object.entries(err.details)) ui.showFieldError(form, field, message);
        }
        ui.toast(err.message, { kind: "error" });
      }
    });
  }

  function nudgeCard(n) {
    const priorityTone = n.priority === "high" ? "accent" : n.priority === "low" ? "plain" : "teal";
    return `<article class="card nudge ${n.active ? "" : "paused"}" data-card="${n.id}">
      <div class="nudge-head">
        <span class="thumb violet">${icon(ui.triggerIcon(n.triggerKind), 15)}</span>
        <div class="grow" style="min-width:0">
          <h3>${esc(n.title)}</h3>
          <div class="sub">${ui.triggerLabel(n.triggerKind)} trigger</div>
        </div>
        <button class="switch" role="switch" aria-checked="${n.active}" aria-label="${n.active ? "Pause" : "Arm"} ${esc(n.title)}"
          data-toggle="${n.id}"></button>
      </div>
      <div class="nudge-quote">${esc(n.action)}</div>
      <div class="nudge-meta">
        <span class="badge ${priorityTone}">${n.priority}</span>
        <span>·</span>
        <span>fires on: ${esc(n.condition)}</span>
      </div>
      <div class="nudge-foot">
        <span class="mono faint" style="font-size:10.5px">${n.fireCount}× · ${n.lastFiredAt ? ui.relTime(n.lastFiredAt) : "never fired"}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-test="${n.id}" ${n.active ? "" : "disabled"}>${icon("play", 12)}Test</button>
        <button class="icon-btn sm" data-edit="${n.id}" title="Edit" aria-label="Edit nudge">${icon("pencil", 14)}</button>
        <button class="icon-btn sm danger" data-remove="${n.id}" title="Delete" aria-label="Delete nudge">${icon("trash", 14)}</button>
      </div>
    </article>`;
  }

  function miniStat(iconName, label, value, foot) {
    return `<div class="card stat" style="min-height:96px">
      <div class="stat-top">${icon(iconName, 15)}<span>${esc(label)}</span></div>
      <div class="stat-value" style="font-size:23px">${value}</div>
      <div class="stat-foot">${esc(foot)}</div>
    </div>`;
  }

  /* ---------- wiring ---------- */

  ui.qs("#nq").addEventListener(
    "input",
    ui.debounce((event) => {
      state.q = event.target.value.trim();
      paint();
    }, 180)
  );
  ui.qsa("#nudge-filter button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      syncFilter();
      paint();
    })
  );
  ui.qs("#new-nudge").addEventListener("click", () => openForm());
  syncFilter();

  const offNew = on("nudge.created", () => load());
  const offFired = on("nudge.fired", (data) => {
    if (!isCurrent()) return;
    const nudge = state.items.find((n) => n.id === data.nudge.id);
    if (nudge) Object.assign(nudge, data.nudge);
    state.recent = [data.event, ...state.recent.filter((e) => e.id !== data.event.id)].slice(0, 12);
    paint();
  });
  const offUpdated = on("nudge.updated", (data) => {
    const nudge = state.items.find((n) => n.id === data.nudge.id);
    if (nudge) Object.assign(nudge, data.nudge);
    paint();
  });

  await load();

  return () => {
    offNew();
    offFired();
    offUpdated();
  };
}
