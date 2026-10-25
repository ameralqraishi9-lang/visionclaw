/** Memory — what Claw knows, where it learned it, and how to forget it. */
import { api } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

const CATEGORY_TINT = {
  person: "violet",
  place: "teal",
  preference: "accent",
  routine: "",
  work: "",
  home: "",
  other: "",
};

export async function mountMemory(ctx) {
  const { root, on, isCurrent, query } = ctx;
  const state = {
    items: [],
    categories: ["person", "place", "preference", "routine", "work", "home", "other"],
    q: query.get("q") || "",
    category: query.get("category") || "",
    pinnedOnly: false,
    loading: true,
    error: null,
  };

  root.innerHTML = `
    <div class="section-head">
      <p class="grow" id="mem-sub">Loading…</p>
      <div class="actions">
        <div class="search">
          ${icon("search", 15)}
          <input class="input" id="mq" placeholder="Search memory" value="${esc(state.q)}"
            aria-label="Search memory" style="width:230px">
        </div>
        <button class="btn ghost" id="pin-filter" aria-pressed="false">${icon("star", 14)}Pinned</button>
        <button class="btn primary" id="new-memory">${icon("plus", 15)}Add memory</button>
      </div>
    </div>
    <div class="chip-row" id="cats" style="margin-bottom:14px"></div>
    <div id="memory-list"></div>`;

  const listEl = ui.qs("#memory-list");
  listEl.innerHTML = `<div class="card card-body">${ui.skeletonList(6)}</div>`;

  async function load() {
    try {
      const data = await api("/api/memories");
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

  function paintCats() {
    const counts = {};
    for (const item of state.items) counts[item.category] = (counts[item.category] || 0) + 1;
    ui.qs("#cats").innerHTML = `
      <button class="chip" data-cat="" aria-pressed="${state.category === ""}">All <span class="count">${state.items.length}</span></button>
      ${state.categories
        .filter((c) => counts[c])
        .map(
          (c) => `<button class="chip" data-cat="${c}" aria-pressed="${state.category === c}">
            ${c} <span class="count">${counts[c]}</span>
          </button>`
        )
        .join("")}`;
    ui.qsa("[data-cat]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.category = btn.dataset.cat;
        paint();
      })
    );
  }

  function visible() {
    const q = state.q.toLowerCase();
    return state.items.filter((m) => {
      if (state.category && m.category !== state.category) return false;
      if (state.pinnedOnly && !m.pinned) return false;
      if (!q) return true;
      return [m.fact, m.detail, m.category].some((v) => v.toLowerCase().includes(q));
    });
  }

  function paint() {
    if (!isCurrent()) return;
    ui.qs("#pin-filter")?.setAttribute("aria-pressed", String(state.pinnedOnly));
    if (state.loading) return;
    paintCats();

    const learned = state.items.filter((m) => m.source === "learned").length;
    const pinned = state.items.filter((m) => m.pinned).length;
    ui.qs("#mem-sub").textContent = `${ui.plural(state.items.length, "fact")} · ${pinned} pinned · ${learned} learned by listening`;

    if (state.error) {
      listEl.innerHTML = ui.errorState(state.error);
      ui.qs("[data-retry]", listEl)?.addEventListener("click", load);
      return;
    }
    const items = visible();
    if (!items.length) {
      listEl.innerHTML = state.items.length
        ? ui.emptyState({
            iconName: "search",
            title: "Nothing in memory matches",
            body: "Try a broader search, or clear the filters.",
            actions: `<button class="btn sm" data-clear>Clear filters</button>`,
          })
        : ui.emptyState({
            iconName: "memory",
            title: "Claw doesn't know you yet",
            body: "Memory is what makes the answers feel personal: your kitchen, your people, the words you use for things. Mention something twice and it lands here.",
            actions: `<button class="btn primary sm" data-first>${icon("plus", 14)}Add something</button>`,
          });

      ui.qs("[data-clear]", listEl)?.addEventListener("click", () => {
        state.q = "";
        state.category = "";
        state.pinnedOnly = false;
        ui.qs("#mq").value = "";
        paint();
      });
      ui.qs("[data-first]", listEl)?.addEventListener("click", () => openForm());
      return;
    }

    listEl.innerHTML = `<div class="card">${items
      .map(
        (m) => `<div class="memory-row" data-row="${m.id}">
          <span class="thumb ${CATEGORY_TINT[m.category] || ""}" style="margin-top:1px">${icon(categoryIcon(m.category), 15)}</span>
          <div class="memory-main">
            <div class="memory-fact">
              ${m.pinned ? `<span style="color:var(--accent)">${icon("star", 13)}</span>` : ""}
              <span>${esc(m.fact)}</span>
              <span class="badge ${CATEGORY_TINT[m.category] || "plain"}">${esc(m.category)}</span>
              ${m.source === "told" ? `<span class="badge plain">told</span>` : ""}
            </div>
            ${m.detail ? `<div class="memory-detail">${esc(m.detail)}</div>` : ""}
            <div class="memory-meta">
              <span class="confidence">confidence
                <span class="confidence-bar"><i style="width:${m.confidence}%"></i></span>
                <span class="mono">${m.confidence}%</span>
              </span>
              <span>·</span>
              <span>${m.lastUsedAt ? `used ${ui.relTime(m.lastUsedAt)}` : "not used yet"}</span>
              <span>·</span>
              <span>added ${ui.relTime(m.createdAt)}</span>
            </div>
          </div>
          <div class="memory-actions">
            <button class="icon-btn sm" data-pin="${m.id}" title="${m.pinned ? "Unpin" : "Pin"}"
              aria-label="${m.pinned ? "Unpin" : "Pin"} memory" style="${m.pinned ? "color:var(--accent)" : ""}">
              ${icon("star", 14)}
            </button>
            <button class="icon-btn sm" data-edit="${m.id}" title="Edit" aria-label="Edit memory">${icon("pencil", 14)}</button>
            <button class="icon-btn sm danger" data-forget="${m.id}" title="Forget" aria-label="Forget memory">${icon("trash", 14)}</button>
          </div>
        </div>`
      )
      .join("")}</div>`;

    ui.qsa("[data-pin]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => togglePin(btn.dataset.pin))
    );
    ui.qsa("[data-edit]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => openForm(state.items.find((m) => m.id === btn.dataset.edit)))
    );
    ui.qsa("[data-forget]", listEl).forEach((btn) =>
      btn.addEventListener("click", () => forget(btn.dataset.forget))
    );
  }

  async function togglePin(id) {
    const memory = state.items.find((m) => m.id === id);
    if (!memory) return;
    const next = !memory.pinned;
    memory.pinned = next;
    paint();
    try {
      await api(`/api/memories/${id}`, { method: "PATCH", body: { pinned: next } });
      ui.toast(next ? "Pinned — Claw will prefer this fact" : "Unpinned", { kind: "info" });
    } catch (err) {
      memory.pinned = !next;
      ui.toast(err.message, { kind: "error" });
      paint();
    }
  }

  async function forget(id) {
    const memory = state.items.find((m) => m.id === id);
    if (!memory) return;
    await ui.confirmDialog({
      title: "Forget this?",
      message: `Claw will stop using “${memory.fact}”. This removes it from memory immediately.`,
      confirmLabel: "Forget it",
      danger: true,
      onConfirm: async () => {
        const before = state.items;
        state.items = state.items.filter((m) => m.id !== id);
        paint();
        try {
          await api(`/api/memories/${id}`, { method: "DELETE" });
          ui.toast("Forgotten");
        } catch (err) {
          state.items = before;
          paint();
          ui.toast(err.message, { kind: "error" });
        }
      },
    });
  }

  function openForm(existing = null) {
    const editing = Boolean(existing);
    const m = existing || {
      fact: "",
      detail: "",
      category: "preference",
      confidence: 85,
      pinned: false,
    };
    const { overlay, close } = ui.modal({
      title: editing ? "Edit memory" : "Add a memory",
      subtitle: editing
        ? "Corrections are how this stays accurate."
        : "Something Claw should always know without being told again.",
      body: `
        <form id="memory-form" class="stack" style="gap:14px" novalidate>
          <div class="field" data-field="fact">
            <label for="m-fact">What Claw should know</label>
            <input class="input" id="m-fact" name="fact" maxlength="160"
              placeholder="Priya is my partner" value="${esc(m.fact)}" required>
          </div>
          <div class="field" data-field="detail">
            <label for="m-detail">Detail <span class="faint">(optional)</span></label>
            <textarea class="textarea" id="m-detail" name="detail" maxlength="400"
              placeholder="Vegetarian. Oat milk in coffee, never dairy.">${esc(m.detail)}</textarea>
          </div>
          <div class="form-grid">
            <div class="field" data-field="category">
              <label for="m-category">Category</label>
              <select class="select" id="m-category" name="category">
                ${state.categories
                  .map(
                    (c) =>
                      `<option value="${c}" ${m.category === c ? "selected" : ""}>${c[0].toUpperCase() + c.slice(1)}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div class="field" data-field="confidence">
              <label for="m-confidence">Confidence · <span class="mono" id="conf-val">${m.confidence}%</span></label>
              <input type="range" id="m-confidence" name="confidence" min="10" max="100" step="5"
                value="${m.confidence}" style="width:100%;accent-color:var(--accent);margin-top:9px">
            </div>
          </div>
          <label class="check">
            <input type="checkbox" name="pinned" ${m.pinned ? "checked" : ""}>
            <span><strong style="font-weight:550">Pin this fact</strong><br>
            <span class="help">Pinned facts are preferred when they conflict with something older.</span></span>
          </label>
        </form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="save-memory">${editing ? "Save changes" : "Save memory"}</button>`,
    });

    overlay.querySelector("#m-confidence").addEventListener("input", (event) => {
      overlay.querySelector("#conf-val").textContent = `${event.target.value}%`;
    });

    overlay.querySelector("#save-memory").addEventListener("click", async (event) => {
      const form = overlay.querySelector("#memory-form");
      ui.clearFieldErrors(form);
      const values = ui.formValues(form);
      values.confidence = Number(values.confidence);
      if (!values.fact) return ui.showFieldError(form, "fact", "Write what Claw should know");
      ui.setBusy(event.currentTarget, true, "Saving");
      try {
        const payload = editing
          ? await api(`/api/memories/${existing.id}`, { method: "PATCH", body: values })
          : await api("/api/memories", { method: "POST", body: values });
        if (editing) {
          const idx = state.items.findIndex((item) => item.id === existing.id);
          if (idx >= 0) state.items[idx] = payload.memory;
        } else {
          state.items.unshift(payload.memory);
        }
        close();
        paint();
        ui.toast(editing ? "Memory updated" : "Saved to memory");
      } catch (err) {
        ui.setBusy(event.currentTarget, false);
        if (err.details) {
          for (const [field, message] of Object.entries(err.details)) ui.showFieldError(form, field, message);
        }
        ui.toast(err.message, { kind: "error" });
      }
    });
  }

  function categoryIcon(category) {
    return (
      {
        person: "user",
        place: "dot",
        preference: "star",
        routine: "refresh",
        work: "sessions",
        home: "sun",
        other: "sparkle",
      }[category] || "memory"
    );
  }

  /* ---------- wiring ---------- */

  ui.qs("#mq").addEventListener(
    "input",
    ui.debounce((event) => {
      state.q = event.target.value.trim();
      paint();
    }, 180)
  );
  ui.qs("#pin-filter").addEventListener("click", () => {
    state.pinnedOnly = !state.pinnedOnly;
    paint();
  });
  ui.qs("#new-memory").addEventListener("click", () => openForm());

  const offCreated = on("memory.created", (data) => {
    if (state.items.some((m) => m.id === data.memory.id)) return;
    state.items.unshift(data.memory);
    paint();
    ui.toast(`Learned: ${data.memory.fact}`, { kind: "info" });
  });
  const offDeleted = on("memory.deleted", (data) => {
    state.items = state.items.filter((m) => m.id !== data.id);
    paint();
  });

  await load();
  if (state.q) ui.qs("#mq").value = state.q;

  return () => {
    offCreated();
    offDeleted();
  };
}
