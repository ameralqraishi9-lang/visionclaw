#!/usr/bin/env node
/**
 * Headless smoke test.
 *
 * Boots a throwaway server with a temp database, loads the real client bundle
 * inside jsdom (against the real API), then walks every view and a few of the
 * write flows. Catches the class of bug a type checker can't: broken
 * selectors, undefined handlers, and render-time exceptions.
 *
 *   npm run smoke
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT || 3117);
const base = `http://127.0.0.1:${PORT}`;
const failures = [];
const errors = [];

const ok = (label) => console.log(`  \x1b[32m✓\x1b[0m ${label}`);
const bad = (label, extra = "") => {
  failures.push(label);
  console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? ` — ${extra}` : ""}`);
};
const check = (condition, label, extra) => (condition ? ok(label) : bad(label, extra));

async function waitFor(fn, { timeout = 6000, interval = 60 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

const dbDir = mkdtempSync(join(tmpdir(), "heyclaw-smoke-"));
const server = spawn(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "src/server.js"],
  {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HEYCLAW_DB: join(dbDir, "smoke.db"), HEYCLAW_LOG: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const stop = () => {
  try {
    server.kill("SIGKILL");
  } catch {
    /* already gone */
  }
};

async function main() {
  const healthy = await waitFor(async () => {
    try {
      const res = await fetch(`${base}/api/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }, { timeout: 12_000 });
  if (!healthy) throw new Error(`server never became healthy:\n${serverLog}`);
  ok("server boots with a fresh database");

  const html = await (await fetch(`${base}/`)).text();
  check(html.includes("Hey Claw"), "index.html is served");

  const dom = new JSDOM(html, { url: `${base}/`, pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};

  for (const key of [
    "document",
    "location",
    "history",
    "CustomEvent",
    "Event",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "Node",
    "FormData",
    "localStorage",
    "sessionStorage",
    "getComputedStyle",
    "DOMParser",
    "MutationObserver",
    "SVGElement",
  ]) {
    globalThis[key] = window[key];
  }
  globalThis.window = window;

  window.addEventListener("error", (event) => errors.push(event.message));
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
  process.on("unhandledRejection", (reason) => errors.push(String(reason)));
  const realError = console.error;
  console.error = (...args) => {
    errors.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "));
    realError(...args);
  };

  // Fetch against the throwaway server; EventSource is stubbed (jsdom has none).
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    realFetch(typeof input === "string" ? new URL(input, base).toString() : input, init);
  const streams = [];
  class StubEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      streams.push(this);
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    emit(name, data) {
      for (const fn of this.listeners.get(name) || []) fn({ data: JSON.stringify(data) });
    }
    close() {}
  }
  globalThis.EventSource = StubEventSource;
  window.EventSource = StubEventSource;

  const app = await import(new URL("../public/js/app.js", import.meta.url));
  const $ = (sel) => window.document.querySelector(sel);
  const $$ = (sel) => [...window.document.querySelectorAll(sel)];
  const text = () => window.document.body.textContent.replace(/\s+/g, " ");

  check(await waitFor(() => $("#demo-btn")), "auth screen renders");
  check(!!$('input[name="email"]') && !!$('input[name="password"]'), "sign-in form is present");

  /* ---------------- demo login ---------------- */
  $("#demo-btn").click();
  check(await waitFor(() => $(".sidebar")), "demo login enters the shell");
  check((await waitFor(() => $("#page-title")))?.textContent === "Overview", "lands on Overview");
  check(await waitFor(() => $$(".stat").length >= 4), "overview stat cards render");
  check(await waitFor(() => $$(".chart svg rect").length > 5), "activity chart renders bars");
  check(text().includes("Saturday kitchen reset"), "seeded sessions appear on the overview");
  check(!!$(".device-pill"), "sidebar shows the paired device");

  /* ---------------- routes ---------------- */
  const routes = [
    ["/live", "Live"],
    ["/sessions", "Sessions"],
    ["/nudges", "Nudges"],
    ["/memory", "Memory"],
    ["/apps", "Apps"],
    ["/settings", "Settings"],
    ["/overview", "Overview"],
  ];
  for (const [path, title] of routes) {
    app.navigate(path);
    const ready = await waitFor(() => {
      const heading = $("#page-title");
      return heading?.textContent === title && $("#view")?.innerHTML.trim().length > 200;
    });
    check(ready, `${title} view renders (${path})`);
  }

  /* ---------------- live session ---------------- */
  app.navigate("/live");
  await waitFor(() => $('[data-start="glasses"]'));
  check(text().includes("The glasses are off"), "live view starts in the off state");
  $('[data-start="glasses"]')?.click();
  check(await waitFor(() => $(".viewfinder.on")), "starting a session opens the viewfinder");

  const input = $("#say-input");
  if (input) {
    input.value = "Dim the lights, please";
    $("#send-btn").click();
    check(await waitFor(() => text().includes("Dim the lights, please")), "voice turn is echoed optimistically");
    // The server writes the real turn; replay it into the stub stream.
    await sleep(2200);
    const state = await (await fetch(`${base}/api/live/state`, {
      headers: { authorization: `Bearer ${window.localStorage.getItem("heyclaw.token")}` },
    })).json();
    if (state.session) {
      for (const event of state.session.events) streams.at(-1)?.emit("event", event);
      check(await waitFor(() => text().toLowerCase().includes("arc lamp") || text().includes("Dropped")), "Claw replies with an action");
      check(await waitFor(() => $$(".turn-action").length > 0), "action chip renders in the transcript");
    } else {
      bad("live state round-trips");
    }
  }
  $("#stop-btn")?.click();
  check(await waitFor(() => $(".viewfinder.off")), "ending the session closes the viewfinder");

  /* ---------------- nudges ---------------- */
  app.navigate("/nudges");
  await waitFor(() => $$(".nudge").length > 0);
  check($$(".nudge").length >= 5, "nudge cards render from seed data");
  const toggle = $("[data-toggle]");
  const before = toggle.getAttribute("aria-checked");
  toggle.click();
  check(
    await waitFor(() => $("[data-toggle]")?.getAttribute("aria-checked") !== before),
    "nudge toggle flips optimistically"
  );
  await sleep(500);
  $("[data-toggle]").click();
  await sleep(400);

  const testBtn = $("[data-test]");
  testBtn.click();
  check(await waitFor(() => $(".toast")), "testing a nudge shows a toast");

  $("#new-nudge").click();
  check(await waitFor(() => $("#nudge-form")), "new nudge modal opens");
  $("#n-title").value = "Smoke test nudge";
  $("#n-condition").value = "When the smoke test runs";
  $("#n-action").value = "Say it worked";
  $("#save-nudge").click();
  check(await waitFor(() => text().includes("Smoke test nudge")), "created nudge appears in the grid");
  $("#nudge-form") && document;
  // close any leftover modal
  window.document.querySelector(".overlay [data-close]")?.click();

  /* ---------------- memory ---------------- */
  app.navigate("/memory");
  await waitFor(() => $$(".memory-row").length > 0);
  check($$(".memory-row").length >= 10, "seeded memories render");
  const pinBtn = $("[data-pin]");
  pinBtn.click();
  await sleep(500);
  check(!!$("[data-pin]"), "pin toggle survives the rerender");
  $("#new-memory").click();
  check(await waitFor(() => $("#memory-form")), "add-memory modal opens");
  $("#m-fact").value = "Smoke test fact";
  $("#save-memory").click();
  check(await waitFor(() => text().includes("Smoke test fact")), "new memory appears in the list");

  /* ---------------- apps ---------------- */
  app.navigate("/apps");
  await waitFor(() => $$(".app-card").length > 0);
  check($$(".app-card").length >= 6, "connection catalog renders");
  const connectBtn = $("[data-connect]");
  if (connectBtn) {
    connectBtn.click();
    check(await waitFor(() => $$(".app-card .status-dot.connected").length >= 6), "connecting an app updates its card");
  } else {
    bad("an unconnected app was available to connect");
  }

  /* ---------------- sessions detail ---------------- */
  app.navigate("/sessions");
  await waitFor(() => $$("[data-id]").length > 0);
  check($$("[data-id]").length >= 5, "session list renders");
  $("[data-id]").click();
  check(await waitFor(() => $(".drawer")), "session drawer opens");
  check(await waitFor(() => text().includes("Transcript")), "drawer shows the transcript");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check(await waitFor(() => !$(".drawer")), "escape closes the drawer");

  /* ---------------- settings ---------------- */
  app.navigate("/settings");
  await waitFor(() => $$("[data-ping]").length > 0);
  check($$("[data-ping]").length >= 1, "devices list renders in settings");
  $("[data-ping]").click();
  check(await waitFor(() => text().includes("answered") || text().includes("Ping")), "ping runs without error");

  /* ---------------- search palette ---------------- */
  const paletteKey = new window.KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
  window.document.dispatchEvent(paletteKey);
  check(await waitFor(() => $("#palette-q")), "command palette opens on ⌘K");
  const pq = $("#palette-q");
  pq.value = "priya";
  pq.dispatchEvent(new window.Event("input", { bubbles: true }));
  check(await waitFor(() => text().includes("Priya is my partner"), { timeout: 4000 }), "palette searches memory");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  /* ---------------- auth guard ---------------- */
  window.localStorage.removeItem("heyclaw.token");
  window.document.dispatchEvent(new window.CustomEvent("hc:unauthorized"));
  check(await waitFor(() => $("#demo-btn")), "unauthorized returns to the auth screen");

  await sleep(300);
  if (errors.length) {
    console.log("\n  Console errors:");
    for (const error of errors.slice(0, 8)) console.log(`   · ${error}`);
    console.log(`\n  Where: the first stack tr\u0061ce follows\n${errors[0]}`);
    failures.push(`${errors.length} console error(s)`);
  }
}

try {
  await main();
} catch (err) {
  bad("smoke run crashed", err.message);
  console.log(serverLog.slice(-1500));
} finally {
  stop();
}

console.log("");
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failure(s):\x1b[0m ${failures.join(", ")}`);
  process.exit(1);
} else {
  console.log("\x1b[32mAll smoke checks passed.\x1b[0m");
  process.exit(0);
}
