#!/usr/bin/env node
/**
 * Visual QA pass: renders the console in real Chromium and writes screenshots.
 * Not part of `npm test` (it needs puppeteer + a chromium build); used during
 * development to check layout, hierarchy, and the empty/loading states.
 *
 *   node tools/shots.mjs [outDir]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] || join(tmpdir(), "heyclaw-shots"));
const PORT = Number(process.env.SHOT_PORT || 3217);
const base = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

const dbDir = mkdtempSync(join(tmpdir(), "heyclaw-shots-db-"));
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HEYCLAW_DB: join(dbDir, "shots.db"), HEYCLAW_LOG: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", (d) => process.stderr.write(d));

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const until = async (fn, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await sleep(80);
  }
  return false;
};

try {
  const up = await until(async () => {
    try {
      return (await fetch(`${base}/api/healthz`)).ok;
    } catch {
      return false;
    }
  });
  if (!up) throw new Error("server did not start");

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--font-render-hinting=none", "--force-color-profile=srgb"],
    defaultViewport: { width: 1440, height: 960, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  page.on("requestfailed", (req) => problems.push(`requestfailed: ${req.url()}`));

  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
    console.log(`shot ${name} @ ${stamp()}`);
  };

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await until(() => page.$("#demo-btn"));
  await sleep(300);
  await shot("01-login");

  await page.click("#demo-btn");
  await until(() => page.$(".stat"));
  await sleep(1000);
  await shot("02-overview");

  await page.evaluate(() => window.scrollTo(0, 620));
  await sleep(400);
  await shot("03-overview-scroll");

  await page.goto(`${base}/live`, { waitUntil: "domcontentloaded" });
  await until(() => page.$('[data-start="glasses"]'));
  await sleep(600);
  await shot("04-live-off");

  await page.click('[data-start="glasses"]');
  await until(() => page.$(".viewfinder.on"));
  await sleep(1500);
  await page.type("#say-input", "Dim the lights a little, then remind me to call Priya");
  await page.keyboard.press("Enter");
  await sleep(2600);
  await shot("05-live-on");

  await page.goto(`${base}/nudges`, { waitUntil: "domcontentloaded" });
  await until(() => page.$(".nudge"));
  await sleep(600);
  await shot("06-nudges");

  await page.click("#new-nudge");
  await until(() => page.$("#nudge-form"));
  await sleep(400);
  await shot("07-nudge-modal");
  await page.keyboard.press("Escape");

  await page.goto(`${base}/memory`, { waitUntil: "domcontentloaded" });
  await until(() => page.$(".memory-row"));
  await sleep(500);
  await shot("08-memory");

  await page.goto(`${base}/apps`, { waitUntil: "domcontentloaded" });
  await until(() => page.$(".app-card"));
  await sleep(500);
  await shot("09-apps");

  await page.goto(`${base}/sessions`, { waitUntil: "domcontentloaded" });
  await until(() => page.$("[data-id]"));
  await sleep(400);
  await shot("10-sessions");
  await page.click("[data-id]");
  await until(() => page.$(".drawer .memory-row, .drawer .turn"));
  await sleep(600);
  await shot("11-session-drawer");

  await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
  await until(() => page.$("[data-ping]"));
  await sleep(500);
  await shot("12-settings");
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(300);
  await shot("13-settings-scroll");

  // Empty states: a brand-new account has no history at all.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/?auth=signup`, { waitUntil: "domcontentloaded" });
  await page.type("#name", "Riley Okafor");
  await page.type("#email", `riley${Date.now()}@heyclaw.app`);
  await page.type("#password", "testpass123");
  await page.click("#auth-submit");
  await until(() => page.$(".stat"));
  await sleep(900);
  await shot("14-new-account-overview");
  await page.goto(`${base}/sessions`, { waitUntil: "domcontentloaded" });
  await sleep(700);
  await shot("15-sessions-empty");

  // Mobile — log out (cookie included) so the demo login path runs again.
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }));
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await until(() => page.$("#demo-btn"));
  await sleep(400);
  await shot("16-mobile-login");
  await page.click("#demo-btn");
  await until(() => page.$(".stat"));
  await sleep(900);
  await shot("17-mobile-overview");
  await page.click("#menu-btn");
  await sleep(500);
  await shot("18-mobile-nav");
  await page.goto(`${base}/live`, { waitUntil: "domcontentloaded" });
  await sleep(900);
  await shot("19-mobile-live");
  await page.goto(`${base}/nudges`, { waitUntil: "domcontentloaded" });
  await sleep(900);
  await shot("20-mobile-nudges");

  console.log(problems.length ? `\nProblems:\n${[...new Set(problems)].join("\n")}` : "\nNo console errors.");
  await browser.close();
} catch (err) {
  console.error("shots failed:", err);
  process.exitCode = 1;
} finally {
  server.kill("SIGKILL");
}
