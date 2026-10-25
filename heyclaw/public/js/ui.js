/** DOM helpers, formatters, and the shared overlays (toast / modal / confirm). */
import { icon } from "./icons.js";

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";

/* ---------------- time ---------------- */

export function relTime(iso) {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (abs < 45_000) return "just now";
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 7) return future ? `in ${days}d` : `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeOfDay(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function dateLine(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function clockDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function humanDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function dayPart() {
  const hour = new Date().getHours();
  if (hour < 5) return "Late evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export const plural = (n, word, suffix = "s") => `${n} ${word}${n === 1 ? "" : suffix}`;

export function debounce(fn, wait = 260) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/* ---------------- toasts ---------------- */

let toastStack = null;

export function toast(message, { kind = "success", timeout = 4200 } = {}) {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    toastStack.setAttribute("role", "status");
    toastStack.setAttribute("aria-live", "polite");
    document.body.appendChild(toastStack);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const glyph = kind === "error" ? "alert" : kind === "info" ? "info" : "check";
  el.innerHTML = `
    <span class="toast-icon">${icon(glyph, 16)}</span>
    <span class="grow">${escapeHtml(message)}</span>
    <button class="icon-btn sm close" aria-label="Dismiss">${icon("x", 13)}</button>`;
  toastStack.appendChild(el);

  const remove = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  const timer = setTimeout(remove, timeout);
  el.querySelector(".close").addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

/* ---------------- modals ---------------- */

const openOverlays = [];

export function closeTopOverlay() {
  const top = openOverlays[openOverlays.length - 1];
  if (top) top();
}

export function modal({
  title,
  subtitle = "",
  body = "",
  footer = "",
  wide = false,
  drawer = false,
  onMount,
  labelledBy = "modal-title",
}) {
  const overlay = document.createElement("div");
  overlay.className = `overlay${drawer ? " right" : ""}`;
  overlay.innerHTML = drawer
    ? `<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">${body}</div>`
    : `<div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">
        <div class="modal-head">
          <div class="grow">
            <h2 id="${labelledBy}">${escapeHtml(title)}</h2>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
          </div>
          <button class="icon-btn" data-close aria-label="Close">${icon("x", 16)}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
      </div>`;

  const previousFocus = document.activeElement;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    const index = openOverlays.indexOf(close);
    if (index >= 0) openOverlays.splice(index, 1);
    if (previousFocus instanceof HTMLElement) previousFocus.focus?.();
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
    if (event.key === "Tab") {
      const focusables = qsa(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        overlay
      ).filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", close));
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  openOverlays.push(close);

  const focusTarget = overlay.querySelector("[data-autofocus]") || overlay.querySelector("input, textarea, select, button");
  setTimeout(() => focusTarget?.focus?.({ preventScroll: true }), 40);

  onMount?.({ overlay, close });

  return { overlay, close };
}

export function confirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
}) {
  return new Promise((resolve) => {
    const { overlay, close } = modal({
      title,
      body: `<p class="muted" style="font-size:13.5px;line-height:1.65">${escapeHtml(message)}</p>`,
      footer: `<button class="btn ghost" data-cancel>${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-confirm>${escapeHtml(confirmLabel)}</button>`,
    });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => {
      close();
      resolve(false);
    });
    overlay.querySelector("[data-confirm]").addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        await onConfirm?.();
        close();
        resolve(true);
      } catch {
        btn.disabled = false;
      }
    });
  });
}

/* ---------------- busy states ---------------- */

export function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.prev = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${escapeHtml(label)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.prev) {
      button.innerHTML = button.dataset.prev;
      delete button.dataset.prev;
    }
  }
}

/* ---------------- states ---------------- */

export function skeletonStats(count = 4) {
  return `<div class="grid cols-4">${Array.from({ length: count })
    .map(() => `<div class="skeleton sk-card"></div>`)
    .join("")}</div>`;
}

export function skeletonList(rows = 4) {
  return `<div>${Array.from({ length: rows })
    .map(
      () =>
        `<div class="skeleton sk-row" style="height:52px"></div>`
    )
    .join("")}</div>`;
}

export function emptyState({ iconName = "sparkle", title, body = "", actions = "" }) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName, 22)}</div>
    <h3>${escapeHtml(title)}</h3>
    ${body ? `<p>${body}</p>` : ""}
    ${actions ? `<div class="actions">${actions}</div>` : ""}
  </div>`;
}

export function errorState(message, retryLabel = "Try again") {
  return `<div class="empty">
    <div class="empty-icon" style="color:#ff9d9d">${icon("alert", 22)}</div>
    <h3>Something went wrong</h3>
    <p>${escapeHtml(message)}</p>
    <div class="actions"><button class="btn sm" data-retry>${escapeHtml(retryLabel)}</button></div>
  </div>`;
}

/* ---------------- misc ---------------- */

export function avatar(name, { large = false } = {}) {
  return `<span class="avatar${large ? " lg" : ""}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

export function batteryBar(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const color = value <= 20 ? "#f87171" : value <= 45 ? "#ffb454" : "#58d68d";
  return `<span class="battery"><span class="battery-bar"><i style="width:${value}%;background:${color}"></i></span>${value}%</span>`;
}

export function statusLabel(status) {
  return (
    {
      connected: "Connected",
      pairing: "Pairing",
      paired: "Paired",
      idle: "Idle",
      offline: "Offline",
    }[status] || status
  );
}

export function deviceIcon(kind) {
  return icon(kind === "glasses" ? "glasses" : kind === "web" ? "monitor" : "phone", 16);
}

export function triggerLabel(kind) {
  return (
    {
      place: "Place",
      calendar: "Calendar",
      routine: "Routine",
      device: "Device",
      time: "Time",
      weather: "Weather",
      person: "Person",
    }[kind] || kind
  );
}

export function triggerIcon(kind) {
  return { place: "dot", calendar: "clock", routine: "refresh", device: "battery", time: "sun", weather: "alert", person: "user" }[kind] || "dot";
}

export function formValues(form) {
  const values = {};
  new FormData(form).forEach((value, key) => {
    values[key] = typeof value === "string" ? value.trim() : value;
  });
  form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
    values[input.name] = input.checked;
  });
  return values;
}

export function showFieldError(form, field, message) {
  const wrap = form.querySelector(`[data-field="${field}"]`);
  if (!wrap) return;
  wrap.classList.add("invalid");
  let node = wrap.querySelector(".error");
  if (!node) {
    node = document.createElement("span");
    node.className = "error";
    wrap.appendChild(node);
  }
  node.textContent = message;
}

export function clearFieldErrors(form) {
  qsa(".field.invalid", form).forEach((field) => field.classList.remove("invalid"));
  qsa(".error", form).forEach((node) => node.remove());
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
