/** Settings — voice, devices, privacy, and the account itself. */
import { api, auth } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

const VOICES = ["Sol · warm", "Mira · calm", "Kai · bright", "Noa · low"];
const LANGUAGES = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["es-ES", "Español"],
  ["fr-FR", "Français"],
  ["de-DE", "Deutsch"],
  ["ja-JP", "日本語"],
];
const AUTONOMY = [
  ["whisper", "Whisper", "Speaks only when spoken to. Nudges wait for a gap."],
  ["balanced", "Balanced", "Speaks up when it matters, waits otherwise."],
  ["proactive", "Proactive", "Initiates. Interrupts politely when something is time-sensitive."],
];

export async function mountSettings(ctx) {
  const { root, app, on, isCurrent, refreshChrome } = ctx;
  const user = ctx.user;
  let devices = [];

  root.innerHTML = `
    <div class="settings-grid">
      <section class="card">
        <div class="card-head">
          <h2>Profile</h2>
          <div class="actions"><span class="badge plain">member since ${new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span></div>
        </div>
        <div class="card-body">
          <form id="profile-form" class="form-grid" novalidate>
            <div class="field" data-field="name">
              <label for="p-name">Name</label>
              <input class="input" id="p-name" name="name" value="${esc(user.name)}" maxlength="60">
            </div>
            <div class="field">
              <label for="p-email">Email</label>
              <input class="input" id="p-email" value="${esc(user.email)}" disabled>
            </div>
            <div class="span-2 row" style="justify-content:flex-end">
              <button class="btn primary" type="submit" id="save-profile">Save profile</button>
            </div>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Voice & behaviour</h2>
          <div class="actions"><span class="badge accent">${esc(user.voice)}</span></div>
        </div>
        <div class="card-body">
          <form id="voice-form" class="stack" style="gap:16px" novalidate>
            <div class="form-grid">
              <div class="field" data-field="wakeWord">
                <label for="p-wake">Wake word</label>
                <input class="input" id="p-wake" name="wakeWord" value="${esc(user.wakeWord)}" maxlength="40">
                <span class="help">Used for on-demand questions. Nudges don't need it.</span>
              </div>
              <div class="field">
                <label for="p-voice">Voice</label>
                <div class="row" style="gap:6px">
                  <select class="select" id="p-voice" name="voice">
                    ${VOICES.map((v) => `<option ${user.voice === v ? "selected" : ""}>${esc(v)}</option>`).join("")}
                  </select>
                  <button type="button" class="btn sm" id="preview-voice" title="Preview this voice">
                    ${icon("play", 12)}Preview
                  </button>
                </div>
                <span class="help">Preview uses your browser's speech engine as a stand-in for the glasses.</span>
              </div>
              <div class="field">
                <label for="p-lang">Language</label>
                <select class="select" id="p-lang" name="language">
                  ${LANGUAGES.map(([v, l]) => `<option value="${v}" ${user.language === v ? "selected" : ""}>${l}</option>`).join("")}
                </select>
              </div>
              <div class="field">
                <label for="p-retention">Keep transcripts for</label>
                <select class="select" id="p-retention" name="retentionDays">
                  ${[7, 30, 90, 180]
                    .map(
                      (d) =>
                        `<option value="${d}" ${user.retentionDays === d ? "selected" : ""}>${d} days</option>`
                    )
                    .join("")}
                </select>
              </div>
            </div>

            <div class="field">
              <span class="label">How forward should Claw be?</span>
              <div class="radio-cards" id="autonomy">
                ${AUTONOMY.map(
                  ([value, label, blurb]) => `<button type="button" class="radio-card"
                    data-autonomy="${value}" aria-pressed="${user.autonomy === value}">
                    <strong>${label}</strong><span>${blurb}</span>
                  </button>`
                ).join("")}
              </div>
            </div>

            <div class="row" style="justify-content:space-between;gap:14px;padding:12px;border:1px solid var(--line-soft);border-radius:10px;background:var(--surface-2)">
              <div>
                <div style="font-size:13px;font-weight:550">Let Claw speak first</div>
                <div class="help">Turn this off and nudges are recorded but never spoken out loud.</div>
              </div>
              <button type="button" class="switch" role="switch" id="proactive" aria-checked="${user.proactive}"></button>
            </div>

            <div class="row" style="justify-content:flex-end">
              <button class="btn primary" type="submit" id="save-voice">Save voice settings</button>
            </div>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Devices</h2>
          <div class="actions">
            <button class="btn sm" id="pair-btn">${icon("plus", 14)}Pair device</button>
          </div>
        </div>
        <div id="devices">${ui.skeletonList(2)}</div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Security</h2></div>
        <div class="card-body">
          <form id="password-form" class="form-grid" novalidate>
            <div class="field" data-field="current">
              <label for="pw-current">Current password</label>
              <input class="input" id="pw-current" name="current" type="password" autocomplete="current-password">
            </div>
            <div class="field" data-field="next">
              <label for="pw-next">New password</label>
              <input class="input" id="pw-next" name="next" type="password" autocomplete="new-password" placeholder="At least 8 characters">
            </div>
            <div class="field" data-field="confirm">
              <label for="pw-confirm">Confirm new password</label>
              <input class="input" id="pw-confirm" name="confirm" type="password" autocomplete="new-password">
            </div>
            <div class="row" style="align-items:flex-end;justify-content:flex-end">
              <button class="btn" type="submit" id="save-password">Update password</button>
            </div>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Your data</h2></div>
        <div class="card-body stack" style="gap:14px">
          <div class="row wrap" style="gap:14px">
            <div class="grow" style="min-width:240px">
              <div style="font-size:13px;font-weight:550">Export everything</div>
              <p class="help">Sessions, transcripts, memories, nudges, devices, and connections as JSON.</p>
            </div>
            <button class="btn" id="export-btn">${icon("download", 15)}Download JSON</button>
          </div>
          <div class="divider" style="margin:0"></div>
          <div class="row wrap" style="gap:14px">
            <div class="grow" style="min-width:240px">
              <div style="font-size:13px;font-weight:550">Delete session history</div>
              <p class="help">Removes every transcript and action. Memories, nudges, and devices stay.</p>
            </div>
            <button class="btn danger" id="clear-btn">${icon("trash", 15)}Clear history</button>
          </div>
          <div class="divider" style="margin:0"></div>
          <div class="row wrap" style="gap:14px">
            <div class="grow" style="min-width:240px">
              <div style="font-size:13px;font-weight:550">Sign out of this browser</div>
              <p class="help">Other tabs keep their session until they are closed.</p>
            </div>
            <button class="btn ghost" id="signout2">${icon("logout", 15)}Sign out</button>
          </div>
        </div>
      </section>

      <section class="card danger-zone">
        <div class="card-head"><h3>Device & privacy notes</h3></div>
        <div class="card-body">
          <p class="muted" style="font-size:12.5px;line-height:1.7">
            Frames are processed on-device and only sent when a turn needs them. Transcripts are stored in
            your account for ${user.retentionDays} days, then deleted automatically. Nudge firings record the
            sentence spoken, never the audio. The gateway never receives your password.
          </p>
          <div class="row wrap" style="gap:8px;margin-top:12px">
            <span class="badge plain">scrypt passwords</span>
            <span class="badge plain">opaque tokens</span>
            <span class="badge plain">${user.retentionDays}-day retention</span>
            <span class="badge plain">no third-party scripts</span>
          </div>
        </div>
      </section>
    </div>`;

  /* ---------- profile ---------- */

  ui.qs("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = ui.qs("#save-profile");
    const form = event.currentTarget;
    ui.clearFieldErrors(form);
    const name = ui.qs("#p-name").value.trim();
    if (name.length < 2) return ui.showFieldError(form, "name", "At least 2 characters");
    ui.setBusy(button, true, "Saving");
    try {
      const res = await api("/api/settings", { method: "PATCH", body: { name } });
      ctx.user = res.user;
      app.user = res.user;
      ui.qs(".user-chip .meta strong").textContent = res.user.name;
      ui.qs(".user-chip .avatar").textContent = ui.initials(res.user.name);
      ui.toast("Profile saved");
    } catch (err) {
      ui.toast(err.message, { kind: "error" });
    } finally {
      ui.setBusy(button, false);
    }
  });

  /* ---------- voice ---------- */

  let autonomy = user.autonomy;
  let proactive = user.proactive;

  ui.qsa("[data-autonomy]").forEach((btn) =>
    btn.addEventListener("click", () => {
      autonomy = btn.dataset.autonomy;
      ui.qsa("[data-autonomy]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.autonomy === autonomy))
      );
    })
  );

  const VOICE_SHAPE = {
    "Sol · warm": { pitch: 0.95, rate: 0.96 },
    "Mira · calm": { pitch: 1.05, rate: 0.9 },
    "Kai · bright": { pitch: 1.15, rate: 1.06 },
    "Noa · low": { pitch: 0.8, rate: 0.92 },
  };

  ui.qs("#preview-voice").addEventListener("click", () => {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== "function") {
      ui.toast("This browser can't play a voice preview", { kind: "error" });
      return;
    }
    const chosen = ui.qs("#p-voice").value;
    const shape = VOICE_SHAPE[chosen] || { pitch: 1, rate: 1 };
    synth.cancel();
    const utter = new window.SpeechSynthesisUtterance(
      "Hey Claw — the arc lamp is at thirty percent. I'll keep watching the room."
    );
    utter.pitch = shape.pitch;
    utter.rate = shape.rate;
    utter.lang = ui.qs("#p-lang").value;
    const voices = synth.getVoices?.() || [];
    const match = voices.find((v) => v.lang === utter.lang) || voices[0];
    if (match) utter.voice = match;
    synth.speak(utter);
    ui.toast(`Previewing ${chosen}`, { kind: "info", timeout: 2600 });
  });

  const proactiveBtn = ui.qs("#proactive");
  proactiveBtn.addEventListener("click", () => {
    proactive = !proactive;
    proactiveBtn.setAttribute("aria-checked", String(proactive));
  });

  ui.qs("#voice-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = ui.qs("#save-voice");
    ui.setBusy(button, true, "Saving");
    try {
      const res = await api("/api/settings", {
        method: "PATCH",
        body: {
          wakeWord: ui.qs("#p-wake").value.trim(),
          voice: ui.qs("#p-voice").value,
          language: ui.qs("#p-lang").value,
          autonomy,
          proactive,
          retentionDays: Number(ui.qs("#p-retention").value),
        },
      });
      ctx.user = res.user;
      app.user = res.user;
      refreshChrome();
      ui.toast("Voice settings saved");
    } catch (err) {
      const form = event.currentTarget;
      if (err.details) {
        for (const [field, message] of Object.entries(err.details)) ui.showFieldError(form, field, message);
      }
      ui.toast(err.message, { kind: "error" });
    } finally {
      ui.setBusy(button, false);
    }
  });

  /* ---------- devices ---------- */

  function paintDevices() {
    const host = ui.qs("#devices");
    if (!host) return;
    if (!devices.length) {
      host.innerHTML = ui.emptyState({
        iconName: "glasses",
        title: "No devices yet",
        body: "Pair the glasses you wear, or add a phone camera as the fallback when the battery runs low.",
        actions: `<button class="btn primary sm" data-pair>${icon("plus", 14)}Pair a device</button>`,
      });
      ui.qs("[data-pair]", host)?.addEventListener("click", openPair);
      return;
    }
    host.innerHTML = `<div class="list">${devices
      .map(
        (d) => `<div class="list-row" style="cursor:default;align-items:flex-start">
          <span class="thumb ${d.status === "connected" ? "accent" : ""}">${ui.deviceIcon(d.kind)}</span>
          <span class="grow">
            <span class="title" style="gap:8px">
              <input class="input" data-rename="${d.id}" value="${esc(d.name)}" maxlength="60"
                aria-label="Device name"
                style="background:transparent;border-color:transparent;padding:1px 4px;height:24px;font-size:13px;font-weight:550;min-height:0;max-width:240px">
            </span>
            <span class="sub">
              <span class="status-dot ${d.status}"></span>${ui.statusLabel(d.status)}
              <span>·</span><span>${esc(d.model)}</span>
              <span>·</span><span class="mono">${esc(d.firmware)}</span>
              <span>·</span><span>${ui.relTime(d.lastSeen)}</span>
            </span>
          </span>
          <span class="right">
            ${ui.batteryBar(d.battery)}
            <button class="btn sm ghost" data-ping="${d.id}">Ping</button>
            <button class="icon-btn sm danger" data-unpair="${d.id}" title="Unpair" aria-label="Unpair device">${icon("trash", 14)}</button>
          </span>
        </div>`
      )
      .join("")}</div>`;

    ui.qsa("[data-ping]", host).forEach((btn) =>
      btn.addEventListener("click", async (event) => {
        ui.setBusy(event.currentTarget, true, "Ping");
        try {
          const res = await api(`/api/devices/${btn.dataset.ping}/ping`, { method: "POST" });
          devices = devices.map((d) => (d.id === res.device.id ? res.device : d));
          paintDevices();
          ui.toast(`${res.device.name} answered · ${res.device.battery}%`);
        } catch (err) {
          ui.toast(err.message, { kind: "error" });
        }
      })
    );

    ui.qsa("[data-unpair]", host).forEach((btn) =>
      btn.addEventListener("click", () => {
        const device = devices.find((d) => d.id === btn.dataset.unpair);
        ui.confirmDialog({
          title: `Unpair ${device.name}?`,
          message: "Claw will stop opening its camera. You can pair it again any time.",
          confirmLabel: "Unpair",
          danger: true,
          onConfirm: async () => {
            devices = devices.filter((d) => d.id !== device.id);
            paintDevices();
            try {
              await api(`/api/devices/${device.id}`, { method: "DELETE" });
              ui.toast("Device unpaired", { kind: "info" });
            } catch (err) {
              ui.toast(err.message, { kind: "error" });
            }
          },
        });
      })
    );

    ui.qsa("[data-rename]", host).forEach((input) =>
      input.addEventListener("change", async () => {
        const id = input.dataset.rename;
        const name = input.value.trim();
        const device = devices.find((d) => d.id === id);
        if (!device || !name || name === device.name) {
          input.value = device?.name || "";
          return;
        }
        const previous = device.name;
        device.name = name;
        try {
          const res = await api(`/api/devices/${id}`, { method: "PATCH", body: { name } });
          devices = devices.map((d) => (d.id === id ? res.device : d));
          ui.toast("Device renamed");
        } catch (err) {
          device.name = previous;
          input.value = previous;
          ui.toast(err.message, { kind: "error" });
        }
      })
    );
  }

  function openPair() {
    const { overlay, close } = ui.modal({
      title: "Pair a device",
      subtitle: "Real pairing runs over Bluetooth in the app. Here it registers the device and simulates the handshake.",
      body: `
        <form id="pair-form" class="stack" style="gap:14px" novalidate>
          <div class="field" data-field="name">
            <label for="d-name">Name</label>
            <input class="input" id="d-name" name="name" placeholder="Avery's Ray-Ban Meta" maxlength="60" required>
          </div>
          <div class="field" data-field="kind">
            <label for="d-kind">Device type</label>
            <select class="select" id="d-kind" name="kind">
              <option value="glasses">Meta Ray-Ban glasses</option>
              <option value="phone">Phone camera</option>
              <option value="web">Web viewer</option>
            </select>
          </div>
          <p class="help">Developer Mode must be on in the Meta AI app for the glasses to accept a link.</p>
        </form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="pair-confirm">Pair device</button>`,
    });

    overlay.querySelector("#pair-confirm").addEventListener("click", async (event) => {
      const form = overlay.querySelector("#pair-form");
      ui.clearFieldErrors(form);
      const values = ui.formValues(form);
      if (!values.name) return ui.showFieldError(form, "name", "Give the device a name");
      ui.setBusy(event.currentTarget, true, "Pairing…");
      try {
        const res = await api("/api/devices", { method: "POST", body: values });
        devices = [res.device, ...devices];
        paintDevices();
        close();
        ui.toast("Pairing started — this takes a few seconds", { kind: "info" });
      } catch (err) {
        ui.setBusy(event.currentTarget, false);
        if (err.details) {
          for (const [field, message] of Object.entries(err.details)) ui.showFieldError(form, field, message);
        }
      }
    });
  }

  ui.qs("#pair-btn").addEventListener("click", openPair);

  /* ---------- password ---------- */

  ui.qs("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    ui.clearFieldErrors(form);
    const current = ui.qs("#pw-current").value;
    const next = ui.qs("#pw-next").value;
    const confirm = ui.qs("#pw-confirm").value;
    if (!current) return ui.showFieldError(form, "current", "Enter your current password");
    if (next.length < 8) return ui.showFieldError(form, "next", "At least 8 characters");
    if (next !== confirm) return ui.showFieldError(form, "confirm", "Passwords don't match");
    const button = ui.qs("#save-password");
    ui.setBusy(button, true, "Updating");
    try {
      await api("/api/settings/password", { method: "POST", body: { current, next } });
      form.reset();
      ui.toast("Password updated");
    } catch (err) {
      if (err.details) {
        for (const [field, message] of Object.entries(err.details)) ui.showFieldError(form, field, message);
      }
      ui.toast(err.message, { kind: "error" });
    } finally {
      ui.setBusy(button, false);
    }
  });

  /* ---------- data ---------- */

  ui.qs("#export-btn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    ui.setBusy(button, true, "Preparing");
    try {
      const res = await fetch("/api/export", {
        headers: auth.token ? { authorization: `Bearer ${auth.token}` } : {},
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `heyclaw-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      ui.toast("Export downloaded");
    } catch (err) {
      ui.toast(err.message, { kind: "error" });
    } finally {
      ui.setBusy(button, false);
    }
  });

  ui.qs("#clear-btn").addEventListener("click", () => {
    ui.confirmDialog({
      title: "Delete every session?",
      message: "All transcripts, frames, and actions will be removed. Memories, nudges, and devices stay exactly as they are.",
      confirmLabel: "Delete history",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api("/api/settings/clear-sessions", { method: "POST" });
          ui.toast(`Deleted ${ui.plural(res.count, "session")}`);
        } catch (err) {
          ui.toast(err.message, { kind: "error" });
          throw err;
        }
      },
    });
  });

  ui.qs("#signout2").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    auth.clear();
    location.href = "/";
  });

  /* ---------- data loads ---------- */

  try {
    const data = await api("/api/devices");
    if (!isCurrent()) return;
    devices = data.items;
    paintDevices();
  } catch (err) {
    ui.qs("#devices").innerHTML = ui.errorState(err.message);
  }

  const offDevices = on("device.updated", (data) => {
    const idx = devices.findIndex((d) => d.id === data.device.id);
    if (idx >= 0) devices[idx] = data.device;
    else devices.push(data.device);
    paintDevices();
  });
  const offCreated = on("device.created", (data) => {
    if (!devices.some((d) => d.id === data.device.id)) devices.unshift(data.device);
    paintDevices();
  });
  const offDeleted = on("device.deleted", (data) => {
    devices = devices.filter((d) => d.id !== data.id);
    paintDevices();
  });

  return () => {
    offDevices();
    offCreated();
    offDeleted();
    window.speechSynthesis?.cancel?.();
  };
}
