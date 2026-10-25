/** Overview — the morning-after view of what Claw did on its own. */
import { api } from "../api.js";
import { icon } from "../icons.js";
import * as ui from "../ui.js";

const { escapeHtml: esc } = ui;

export async function mountOverview(ctx) {
  const { root, navigate, on, isCurrent } = ctx;
  root.innerHTML = `
    ${ui.skeletonStats(4)}
    <div class="grid" style="margin-top:16px;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr)">
      <div class="skeleton" style="height:260px;border-radius:16px"></div>
      <div class="skeleton" style="height:260px;border-radius:16px"></div>
    </div>`;

  let data;
  try {
    data = await api("/api/overview");
  } catch (err) {
    if (!isCurrent()) return;
    root.innerHTML = ui.errorState(err.message);
    ui.qs("[data-retry]", root)?.addEventListener("click", () => mountOverview(ctx));
    return;
  }
  if (!isCurrent()) return;

  const paint = () => {
    if (!isCurrent()) return;
    const live = ctx.app.live?.session;
    const fresh = data.totals.sessions === 0;

    root.innerHTML = `
      ${live ? liveBanner(live, ctx.app.live.events) : idleBanner(data)}
      ${fresh ? onboarding() : ""}

      <div class="grid cols-4" style="margin-top:16px">
        ${statCard({
          iconName: "live",
          label: "Live today",
          value: data.today.minutes,
          unit: "min",
          foot:
            data.today.sessions === 0
              ? "Glasses have been quiet"
              : `${ui.plural(data.today.sessions, "session")} · ${ui.plural(data.today.actions, "action")}`,
          trend: data.today.sessions > 0 ? "live" : null,
        })}
        ${statCard({
          iconName: "zap",
          label: "Actions today",
          value: data.today.actions,
          unit: "",
          foot: data.today.actions ? "Done without a screen" : "Nothing needed doing yet",
        })}
        ${statCard({
          iconName: "nudges",
          label: "Nudges today",
          value: data.today.nudges,
          unit: "",
          foot: `${data.totals.activeNudges} nudges armed`,
        })}
        ${statCard({
          iconName: "memory",
          label: "Remembered",
          value: data.totals.memories,
          unit: "facts",
          foot: `${data.totals.minutes} minutes of conversation`,
        })}
      </div>

      <div class="overview-grid" style="margin-top:16px">
        <div class="stack" style="gap:16px">
          <section class="card">
            <div class="card-head">
              <h2>Last 14 days</h2>
              <div class="actions">
                <span class="badge plain">${data.totals.sessions} sessions all time</span>
                <button class="btn ghost sm" data-goto="/sessions">All sessions${icon("chevronRight", 14)}</button>
              </div>
            </div>
            <div class="chart">
              ${chartSvg(data.chart)}
              <div class="chart-legend">
                <span><i style="background:linear-gradient(180deg,#ffd79a,#ffb454)"></i>Minutes with Claw</span>
                <span><i style="background:#5eead4;border-radius:50%"></i>Nudges fired</span>
                <span style="margin-left:auto">${data.chart.reduce((s, d) => s + d.nudges, 0)} nudges · ${data.chart.reduce((s, d) => s + d.minutes, 0)} min</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Recent sessions</h2>
              <div class="actions">
                <button class="btn ghost sm" data-goto="/sessions">View all</button>
              </div>
            </div>
            ${
              data.recentSessions.length
                ? `<div class="list">${data.recentSessions
                    .map(
                      (s) => `<button class="list-row" data-session="${s.id}">
                        <span class="thumb ${s.mode === "glasses" ? "accent" : ""}">${ui.deviceIcon(s.mode === "phone" ? "phone" : "glasses")}</span>
                        <span class="grow">
                          <span class="title">${esc(s.title)}</span>
                          <span class="sub">
                            <span>${ui.dateLine(s.startedAt)} · ${ui.timeOfDay(s.startedAt)}</span>
                            <span>${ui.humanDuration(s.durationSeconds)}</span>
                            ${s.actionsCount ? `<span class="badge teal" style="height:16px;font-size:9.5px">${s.actionsCount} actions</span>` : ""}
                          </span>
                        </span>
                        <span class="right faint">${icon("chevronRight", 15)}</span>
                      </button>`
                    )
                    .join("")}</div>`
                : ui.emptyState({
                    iconName: "sessions",
                    title: "No sessions yet",
                    body: "Put the glasses on and say something. The first session shows up here before you've put your phone away.",
                    actions: `<button class="btn primary sm" data-goto="/live">Start a session</button>`,
                  })
            }
          </section>
        </div>

        <div class="stack" style="gap:16px">
          <section class="card">
            <div class="card-head">
              <h2>Devices</h2>
              <div class="actions">
                <button class="icon-btn sm" data-goto="/settings" title="Manage devices">${icon("settings", 15)}</button>
              </div>
            </div>
            <div class="list">
              ${
                data.devices.length
                  ? data.devices
                      .map(
                        (d) => `<div class="list-row" style="cursor:default">
                          <span class="thumb ${d.status === "connected" ? "accent" : ""}">${ui.deviceIcon(d.kind)}</span>
                          <span class="grow">
                            <span class="title">${esc(d.name)}</span>
                            <span class="sub"><span class="status-dot ${d.status}"></span>${ui.statusLabel(d.status)} · ${ui.relTime(d.lastSeen)}</span>
                          </span>
                          <span class="right">${ui.batteryBar(d.battery)}</span>
                        </div>`
                      )
                      .join("")
                  : `<div class="card-body"><p class="muted" style="font-size:12.5px">No devices paired yet.</p></div>`
              }
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Nudges working for you</h2>
              <div class="actions">
                <button class="btn ghost sm" data-goto="/nudges">All${icon("chevronRight", 14)}</button>
              </div>
            </div>
            ${
              data.topNudges.length
                ? `<div class="list">${data.topNudges
                    .map(
                      (n) => `<div class="list-row" data-nudge="${n.id}">
                        <span class="thumb violet">${icon(ui.triggerIcon(n.triggerKind), 15)}</span>
                        <span class="grow">
                          <span class="title">${esc(n.title)}</span>
                          <span class="sub truncate">${esc(n.lastMessage || n.condition)}</span>
                        </span>
                        <span class="right mono faint" style="font-size:10.5px">${n.fireCount}×</span>
                      </div>`
                    )
                    .join("")}</div>`
                : ui.emptyState({
                    iconName: "nudges",
                    title: "No nudges armed",
                    body: "Nudges are the moments Claw decides to say something without being asked.",
                    actions: `<button class="btn sm" data-goto="/nudges">Set one up</button>`,
                  })
            }
          </section>

          <section class="card">
            <div class="card-head"><h2>Activity</h2></div>
            ${
              data.activity.length
                ? `<div class="list">${data.activity
                    .map(
                      (a) => `<div class="list-row" style="cursor:default;align-items:flex-start">
                        <span class="thumb" style="width:26px;height:26px;border-radius:7px;margin-top:1px">${icon(activityIcon(a.kind), 13)}</span>
                        <span class="grow">
                          <span class="title" style="font-weight:500;font-size:12.5px">${esc(a.message)}</span>
                          <span class="sub">${ui.relTime(a.createdAt)}</span>
                        </span>
                      </div>`
                    )
                    .join("")}</div>`
                : `<div class="card-body"><p class="muted" style="font-size:12.5px">Nothing has happened yet — that's about to change.</p></div>`
            }
          </section>
        </div>
      </div>`;

    bind();
  };

  function bind() {
    ui.qsa("[data-goto]", root).forEach((btn) =>
      btn.addEventListener("click", () => navigate(btn.dataset.goto))
    );
    ui.qsa("[data-session]", root).forEach((btn) =>
      btn.addEventListener("click", () => navigate(`/sessions/${btn.dataset.session}`))
    );
    ui.qsa("[data-nudge]", root).forEach((btn) =>
      btn.addEventListener("click", () => navigate("/nudges"))
    );
    ui.qsa("[data-go-live], [data-open-live]", root).forEach((btn) =>
      btn.addEventListener("click", () => navigate("/live"))
    );
  }

  paint();

  // Live-session timer
  let timer = null;
  const tick = () => {
    const node = ui.qs("[data-live-timer]", root);
    if (!node) return;
    const started = ctx.app.live?.session?.startedAt;
    if (!started) return;
    node.textContent = ui.clockDuration((Date.now() - new Date(started).getTime()) / 1000);
  };
  if (ctx.app.live?.session) timer = setInterval(tick, 1000);

  const reload = ui.debounce(async () => {
    try {
      data = await api("/api/overview");
      if (isCurrent()) paint();
    } catch {
      /* keep the last good view */
    }
  }, 600);

  const offAny = on("any", ({ name }) => {
    if (
      [
        "session.started",
        "session.ended",
        "session.deleted",
        "nudge.fired",
        "nudge.updated",
        "memory.created",
        "device.updated",
        "device.created",
      ].includes(name)
    ) {
      reload();
    }
  });

  return () => {
    if (timer) clearInterval(timer);
    reload.cancel?.();
    offAny();
  };
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function statCard({ iconName, label, value, unit, foot, trend }) {
  return `<div class="card stat">
    <div class="stat-top">${icon(iconName, 15)}<span>${esc(label)}</span>
      ${trend ? `<span class="badge danger" style="margin-left:auto;height:17px;font-size:9px"><span class="dot"></span>live</span>` : ""}
    </div>
    <div class="stat-value">${value}${unit ? `<small>${esc(unit)}</small>` : ""}</div>
    <div class="stat-foot">${esc(foot)}</div>
  </div>`;
}

function liveBanner(session, events) {
  const scene = [...(events || [])].reverse().find((e) => e.role === "scene");
  return `<section class="card" style="overflow:hidden;border-color:rgba(248,113,113,0.24);
      background:linear-gradient(110deg, rgba(248,113,113,0.11), rgba(255,180,84,0.06) 45%, transparent 80%)">
    <div class="row wrap" style="padding:16px;gap:14px">
      <span class="rec"><span class="dot"></span>on air</span>
      <div class="grow" style="min-width:180px">
        <div style="font-size:14px;font-weight:600">${esc(session.title)}</div>
        <div class="faint" style="font-size:12px;margin-top:2px">
          ${scene ? esc(scene.text) : "Waiting for the first frame…"}
        </div>
      </div>
      <div class="mono big-timer" data-live-timer style="font-size:22px">${ui.clockDuration(
        (Date.now() - new Date(session.startedAt).getTime()) / 1000
      )}</div>
      <button class="btn primary" data-open-live>Open session${icon("arrowRight", 15)}</button>
    </div>
  </section>`;
}

function idleBanner(data) {
  const device = data.devices.find((d) => d.status === "connected") || data.devices[0];
  return `<section class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span class="thumb accent">${icon("glasses", 17)}</span>
    <div class="grow" style="min-width:200px">
      <div style="font-size:13.5px;font-weight:560">${device ? `${esc(device.name)} is ${ui.statusLabel(device.status).toLowerCase()}` : "No glasses paired yet"}</div>
      <div class="faint" style="font-size:12px">${device ? `${ui.batteryBar(device.battery)} · last seen ${ui.relTime(device.lastSeen)}` : "Pair a device to start streaming camera frames."}</div>
    </div>
    <button class="btn sm ghost" data-goto="/settings">Devices</button>
    <button class="btn primary sm" data-go-live>${icon("live", 15)}Start a session</button>
  </section>`;
}

function onboarding() {
  return `<section class="card" style="margin-top:16px;padding:18px">
    <div class="row wrap" style="gap:16px;align-items:flex-start">
      <div style="flex:1;min-width:240px">
        <div class="eyebrow">Welcome</div>
        <h2 style="font-size:16px;margin-top:6px;font-weight:620">Nothing to see yet — that's the point</h2>
        <p class="muted" style="font-size:13px;margin-top:6px;line-height:1.6;max-width:520px">
          Claw watches the room through your glasses so you don't have to open an app. Start a session here
          and it will see the scene, answer out loud, and remember what matters without a prompt.
        </p>
      </div>
      <div class="stack" style="gap:10px;min-width:220px">
        <button class="btn primary" data-go-live>${icon("live", 15)}Start a live session</button>
        <button class="btn ghost" data-goto="/settings">${icon("glasses", 15)}Pair your glasses</button>
      </div>
    </div>
  </section>`;
}

function activityIcon(kind) {
  return (
    {
      memory: "memory",
      nudge: "nudges",
      session: "sessions",
      connection: "link",
      action: "zap",
      device: "glasses",
      account: "user",
    }[kind] || "dot"
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

function chartSvg(days) {
  const quiet = days.every((d) => d.minutes === 0 && d.nudges === 0);
  const W = 660;
  const H = 168;
  const padL = 30;
  const padR = 10;
  const padT = 14;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxMinutes = Math.max(20, ...days.map((d) => d.minutes));
  const maxNudges = Math.max(4, ...days.map((d) => d.nudges));
  const step = innerW / days.length;
  const barW = Math.min(22, step * 0.5);
  const todayKey = days[days.length - 1]?.date;

  const y = (value, max) => padT + innerH - (value / max) * innerH;
  const grid = [0, 0.5, 1]
    .map((f) => {
      const yy = padT + innerH - f * innerH;
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"
        stroke="rgba(255,255,255,0.055)" stroke-dasharray="${f === 0 ? "0" : "3 5"}"/>
        <text x="${padL - 8}" y="${yy + 3}" text-anchor="end" class="bar-label">${Math.round(maxMinutes * f)}m</text>`;
    })
    .join("");

  const bars = days
    .map((d, i) => {
      const cx = padL + step * i + step / 2;
      const height = Math.max(d.minutes > 0 ? 3 : 0, (d.minutes / maxMinutes) * innerH);
      const top = padT + innerH - height;
      const isToday = d.date === todayKey;
      return `<g>
        <rect x="${cx - barW / 2}" y="${top}" width="${barW}" height="${height}" rx="${Math.min(4, barW / 2)}"
          fill="${isToday ? "url(#todayGrad)" : "url(#barGrad)"}" opacity="${isToday ? 1 : 0.82}">
          <title>${d.label} ${d.day} · ${d.minutes} min · ${d.sessions} sessions</title>
        </rect>
        ${d.minutes === 0 ? `<rect x="${cx - barW / 2}" y="${padT + innerH - 2}" width="${barW}" height="2" rx="1" fill="#2a343d"/>` : ""}
        <text x="${cx}" y="${H - 8}" text-anchor="middle" class="bar-label"
          style="${isToday ? "fill:#ffc978" : ""}">${isToday ? "Today" : d.label}</text>
      </g>`;
    })
    .join("");

  const points = days
    .map((d, i) => {
      const cx = padL + step * i + step / 2;
      const cy = padT + innerH - (d.nudges / maxNudges) * innerH * 0.92 - 4;
      return `${cx},${cy}`;
    })
    .join(" ");

  const dots = days
    .map((d, i) => {
      const cx = padL + step * i + step / 2;
      const cy = padT + innerH - (d.nudges / maxNudges) * innerH * 0.92 - 4;
      return `<circle cx="${cx}" cy="${cy}" r="${d.nudges ? 2.6 : 0}" fill="#5eead4" opacity="0.9">
        <title>${d.label} ${d.day} · ${d.nudges} nudges</title></circle>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity over the last 14 days">
    <defs>
      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6b5533"/><stop offset="100%" stop-color="#332a1c"/>
      </linearGradient>
      <linearGradient id="todayGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffd79a"/><stop offset="100%" stop-color="#c98a2f"/>
      </linearGradient>
    </defs>
    ${grid}
    ${bars}
    <polyline points="${points}" fill="none" stroke="#5eead4" stroke-width="1.2" opacity="0.32"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${
      quiet
        ? `<text x="${padL + innerW / 2}" y="${padT + innerH / 2 - 4}" text-anchor="middle"
             style="fill:#68757f;font-size:12px">Your first session will show up here</text>`
        : ""
    }
  </svg>`;
}
