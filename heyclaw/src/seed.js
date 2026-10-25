/**
 * Seed data.
 *
 * The demo account is a real, ordinary account — every list here is read from
 * SQLite by the same API the browser uses. Running the app on a fresh machine
 * seeds it so the console is never empty on first load.
 */
import {
  all,
  bool,
  daysAgo,
  get,
  logActivity,
  nowIso,
  run,
  tx,
  uid,
  DAY,
} from "./db.js";
import { hashPassword } from "./auth.js";

export const DEMO_EMAIL = "demo@heyclaw.app";
export const DEMO_PASSWORD = "glasses123";

/* ------------------------------------------------------------------ */
/* Deterministic noise for history charts                              */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isoAt = (dayAgo, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - dayAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const DEVICES = [
  {
    name: "Avery's Ray-Ban Meta",
    kind: "glasses",
    model: "Ray-Ban Meta · Wayfarer (Gen 2)",
    firmware: "12.4.2",
    battery: 78,
    status: "connected",
    lastSeenMinAgo: 2,
  },
  {
    name: "iPhone 15 Pro",
    kind: "phone",
    model: "iPhone 15 Pro · phone camera fallback",
    firmware: "iOS 18.2",
    battery: 64,
    status: "paired",
    lastSeenMinAgo: 2,
  },
  {
    name: "Kitchen counter viewer",
    kind: "web",
    model: "WebRTC live viewer",
    firmware: "browser",
    battery: 100,
    status: "idle",
    lastSeenMinAgo: 1450,
  },
];

const MEMORIES = [
  ["Priya is my partner", "Vegetarian. Oat milk in coffee, never dairy. Birthday is March 4.", "person", "learned", 96, 1, 0.02],
  ["I'm allergic to shellfish", "Hard no — including oyster sauce and shrimp paste.", "preference", "told", 100, 1, 0.1],
  ["Home is Dearborn, Michigan", "Front door faces west; packages get left behind the planter.", "place", "told", 95, 1, 0.4],
  ["Coffee is black, espresso after lunch", "No sugar. Afternoon cup before 2pm or I don't sleep.", "preference", "learned", 90, 0, 0.3],
  ["Saturday mornings are groceries", "Usually Whole Foods on Michigan Ave, 9–10am, list lives in Todoist.", "routine", "learned", 87, 0, 1.2],
  ["The 'soft light' is the arc lamp", "By the bookshelf in the living room. Asked for it three times.", "home", "learned", 93, 0, 0.6],
  ["Jonah is my brother", "Lives in Ferndale, training for the Detroit marathon in May.", "person", "learned", 88, 0, 2.4],
  ["Sam is my manager", "Prefers bullet updates. Review cadence is Monday mornings.", "work", "learned", 84, 0, 3.1],
  ["Wind down around 21:30", "Warm low lights, no non-urgent nudges after.", "routine", "learned", 79, 0, 0.9],
  ["Design review is Thursday 2pm", "Same room, four people, always runs long.", "work", "learned", 72, 0, 4.2],
  ["Workouts: Tue/Thu 6:30am", "Gym bag lives by the front door the night before.", "routine", "learned", 75, 0, 5.4],
  ["Focus music: Khruangbin, Nujabes", "Anything with vocals pulls me out of the zone.", "preference", "learned", 76, 0, 6.1],
];

const NUDGES = [
  {
    title: "Grab the package",
    trigger_kind: "place",
    condition: "Arriving home during a delivery window",
    action: "One quiet sentence at the door — then stay silent",
    priority: "high",
    active: 1,
    fire_count: 23,
    lastFired: 0.18,
    events: [
      [0.18, "Package is behind the planter. It looks like it rained."],
      [1.1, "Delivery window closes at 6pm — you're home already."],
      [4.3, "Second package arriving today, signature required."],
    ],
  },
  {
    title: "Meeting prep",
    trigger_kind: "calendar",
    condition: "15 min before a meeting with 3+ people",
    action: "Speak the agenda and the last decision we made",
    priority: "high",
    active: 1,
    fire_count: 41,
    lastFired: 0.9,
    events: [
      [0.9, "Design review in 15. Agenda: empty states, then the nav cut. Last time you parked the icon set."],
      [2.2, "Standup in 15 — three items on your board moved yesterday."],
      [5.6, "Priya's dinner is at 7 tonight. You have a 5:30 that usually runs late."],
    ],
  },
  {
    title: "Grocery gap",
    trigger_kind: "routine",
    condition: "Saturday at 8:30am",
    action: "Read what's missing and offer to fill the list",
    priority: "normal",
    active: 1,
    fire_count: 17,
    lastFired: 3.1,
    events: [
      [3.1, "Out of oat milk and lemons. The list in Todoist is two items behind."],
      [10.2, "You mentioned tacos for Sunday — missing tortillas and lime."],
    ],
  },
  {
    title: "Low battery handoff",
    trigger_kind: "device",
    condition: "Glasses below 20%",
    action: "Switch to the phone camera and say so once",
    priority: "low",
    active: 1,
    fire_count: 6,
    lastFired: 6.4,
    events: [[6.4, "Glasses at 18%. Moving the camera to your phone so we don't drop the feed."]],
  },
  {
    title: "Quiet hours",
    trigger_kind: "time",
    condition: "After 21:30",
    action: "Hold non-urgent nudges until 7:00am",
    priority: "low",
    active: 1,
    fire_count: 88,
    lastFired: 0.55,
    events: [
      [0.55, "Holding two nudges until morning."],
      [1.6, "Quiet hours on. Only Priya and calendar conflicts get through."],
    ],
  },
  {
    title: "Umbrella check",
    trigger_kind: "weather",
    condition: "Rain forecast and I'm leaving home",
    action: "One sentence at the door",
    priority: "normal",
    active: 0,
    fire_count: 12,
    lastFired: 12.5,
    events: [[12.5, "Rain in 40 minutes. The umbrella is in the hall closet."]],
  },
];

const CONNECTIONS = [
  ["google-calendar", "connected", "avery@heyclaw.app", "calendar.read, calendar.write", 44],
  ["gmail", "connected", "avery@heyclaw.app", "mail.read, mail.compose", 44],
  ["todoist", "connected", "avery", "tasks.read, tasks.write", 31],
  ["spotify", "connected", "avery_c", "playback.control, library.read", 12],
  ["notion", "connected", "Avery Chen", "pages.read, pages.write", 9],
  ["homekit", "connected", "Home · 14 accessories", "lights.write, scenes.run", 26],
  ["slack", "disconnected", "", "", null],
  ["whatsapp", "disconnected", "", "", null],
];

const SESSIONS = [
  {
    title: "Saturday kitchen reset",
    dayAgo: 1,
    hour: 8,
    minute: 12,
    minutes: 11,
    mode: "glasses",
    summary: "Noticed the fridge gap, filled the grocery list, and set a Sunday taco reminder.",
    events: [
      ["scene", "Kitchen counter · morning light · 2 objects on the counter", 0, { tags: ["kitchen", "oat milk carton", "lemons"] }],
      ["claw", "You're nearly out of oat milk — want me to add it to Groceries?", 4, {}],
      ["user", "Yeah, and lemons. Actually add whatever's missing for the week.", 9, {}],
      ["action", "Added 3 items to Todoist → Groceries", 10, { tool: "Todoist", tone: "success" }],
      ["claw", "Added oat milk, lemons, and tortillas. That's the taco night covered.", 12, {}],
      ["scene", "Sink · dish rack full · kettle still warm", 26, { tags: ["kitchen", "cleanup"] }],
      ["claw", "Dish rack is full. Not saying anything else — just leaving that here.", 28, {}],
      ["user", "Noted. Remind me Sunday.", 31, {}],
      ["action", "Reminder created · Sunday 4:00pm · 'Taco night prep'", 33, { tool: "Reminders", tone: "success" }],
      ["claw", "Done. I'll bring it up when you're near the kitchen.", 35, {}],
      ["scene", "Kitchen · session ended", 660, { tags: [] }],
    ],
  },
  {
    title: "Walk to Blue Bottle",
    dayAgo: 2,
    hour: 10,
    minute: 30,
    minutes: 8,
    mode: "glasses",
    summary: "Ordered the usual on the walk over and read out the pickup time.",
    events: [
      ["scene", "Sidewalk · Woodward Ave · sun, light foot traffic", 0, { tags: ["outdoors", "street", "coffee"] }],
      ["claw", "Blue Bottle is 90 seconds ahead and your usual is a cortado. Want me to send it in?", 5, {}],
      ["user", "Go ahead.", 8, {}],
      ["action", "Order placed · Blue Bottle Woodward · cortado", 10, { tool: "Square", tone: "success" }],
      ["claw", "Ordered. Pickup at 10:42, name under Avery.", 12, {}],
      ["scene", "Blue Bottle counter · 4 people in line", 300, { tags: ["cafe", "queue"] }],
      ["claw", "Line is longer than the pickup window — your cup is on the end of the bar.", 305, {}],
      ["user", "You're good at this.", 320, {}],
      ["claw", "I try. I'll keep watching until you've got it.", 322, {}],
    ],
  },
  {
    title: "Dinner prep with Priya",
    dayAgo: 3,
    hour: 19,
    minute: 5,
    minutes: 24,
    mode: "glasses",
    summary: "Ran two timers, dimmed the kitchen, and skipped shellfish options.",
    events: [
      ["scene", "Kitchen · two pans on the stove · warm light", 0, { tags: ["kitchen", "cooking", "two people"] }],
      ["user", "Hey Claw, we're doing the lemon pasta — start a timer for the water and one for the sauce.", 6, {}],
      ["action", "2 timers running · water 8:00 · sauce 12:00", 9, { tool: "Timers", tone: "success" }],
      ["claw", "Both running. Heads up — the jar on the counter has shrimp paste. Priya can't have it.", 11, {}],
      ["user", "Good catch. Put it away.", 14, {}],
      ["claw", "Saying it once: shrimp paste, top shelf, away from the pan.", 15, {}],
      ["scene", "Kitchen · lights dimmed · music started", 620, { tags: ["ambience"] }],
      ["action", "Lights → Kitchen 35% · Spotify → Khruangbin radio", 622, { tool: "HomeKit + Spotify", tone: "success" }],
      ["claw", "Sauce timer has two minutes. I turned the kitchen down and put Khruangbin on.", 1020, {}],
      ["user", "Perfect. End session.", 1430, {}],
    ],
  },
  {
    title: "Front door · package",
    dayAgo: 4,
    hour: 15,
    minute: 40,
    minutes: 3,
    mode: "glasses",
    summary: "Proactive nudge: package behind the planter, rain in the forecast.",
    events: [
      ["scene", "Front porch · package on the step · overcast", 0, { tags: ["porch", "package", "clouds"] }],
      ["claw", "Package behind the planter — and the sky says ten minutes. Want it inside?", 3, {}],
      ["user", "Yeah, I'll grab it now.", 8, {}],
      ["action", "Delivery marked received · Amazon", 10, { tool: "Gmail", tone: "success" }],
      ["claw", "Marked received. I'll stop watching the porch.", 12, {}],
    ],
  },
  {
    title: "Meeting prep · design review",
    dayAgo: 5,
    hour: 13,
    minute: 45,
    minutes: 17,
    mode: "glasses",
    summary: "Read the agenda out loud, then kept a private transcript of decisions.",
    events: [
      ["scene", "Desk · laptop open · whiteboard behind", 0, { tags: ["office", "desk"] }],
      ["claw", "Design review in 15. Agenda is empty states, then the nav cut. You parked the icon set last week.", 2, {}],
      ["user", "Read the parking lot.", 7, {}],
      ["claw", "Two items: icon set, and whether to show nudges in the chat list.", 9, {}],
      ["user", "Keep both parked.", 12, {}],
      ["action", "Note saved → Notion · 'Design review parking lot'", 14, { tool: "Notion", tone: "success" }],
      ["scene", "Meeting room · 4 people · screen sharing", 300, { tags: ["meeting"] }],
      ["claw", "Heads up — Sam just said 'nudges in the chat list'. That's your parked item.", 640, {}],
      ["user", "Thanks. Note the decision.", 650, {}],
      ["action", "Decision captured · stays out of chat list", 652, { tool: "Notion", tone: "success" }],
    ],
  },
  {
    title: "Garage · bike ride",
    dayAgo: 8,
    hour: 17,
    minute: 20,
    minutes: 6,
    mode: "phone",
    summary: "Phone-camera session after the glasses battery handoff.",
    events: [
      ["scene", "Garage · bike against the wall · door open", 0, { tags: ["garage", "bike"] }],
      ["claw", "Glasses are charging, so I'm on your phone camera. Lights are still on in the kitchen.", 3, {}],
      ["user", "Turn them off and lock the garage.", 9, {}],
      ["action", "HomeKit · kitchen off · garage door closed", 12, { tool: "HomeKit", tone: "success" }],
      ["claw", "Done. Ride safe — wind is out of the west.", 14, {}],
    ],
  },
];

const ACTIVITY = [
  ["memory", "Learned: Priya takes oat milk, never dairy", 0.02],
  ["nudge", "Nudge fired · Grab the package", 0.18],
  ["session", "Session ended · Saturday kitchen reset · 11 min", 1.2],
  ["connection", "Todoist connected · tasks.write granted", 1.5],
  ["action", "Claw added 3 items to Groceries", 1.2],
  ["memory", "Learned: the 'soft light' is the arc lamp", 2.2],
  ["nudge", "Nudge fired · Quiet hours · held 2 nudges", 2.4],
  ["session", "Session ended · Walk to Blue Bottle · 8 min", 2.4],
  ["action", "Order placed · Blue Bottle Woodward", 2.3],
  ["nudge", "Nudge fired · Grocery gap", 3.1],
  ["session", "Session ended · Dinner prep with Priya · 24 min", 3.6],
  ["connection", "Spotify connected", 12],
];

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

export function seedDemoUser({ force = false } = {}) {
  const existing = get("SELECT * FROM users WHERE email = ?", DEMO_EMAIL);
  if (existing && !force) return existing.id;
  if (existing && force) {
    run("DELETE FROM users WHERE id = ?", existing.id);
  }

  const userId = uid("usr");
  run(
    `INSERT INTO users (id, email, name, password_hash, wake_word, voice, language, autonomy, proactive, retention_days, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    DEMO_EMAIL,
    "Avery Chen",
    hashPassword(DEMO_PASSWORD),
    "Hey Claw",
    "Sol · warm",
    "en-US",
    "proactive",
    1,
    30,
    daysAgo(46, 9)
  );

  tx(() => {
    for (const d of DEVICES) {
      run(
        `INSERT INTO devices (id, user_id, name, kind, model, firmware, battery, status, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid("dev"),
        userId,
        d.name,
        d.kind,
        d.model,
        d.firmware,
        d.battery,
        d.status,
        new Date(Date.now() - d.lastSeenMinAgo * 60_000).toISOString(),
        daysAgo(45, 10)
      );
    }

    for (const [fact, detail, category, source, confidence, pinned, days] of MEMORIES) {
      const created = daysAgo(days, 8);
      run(
        `INSERT INTO memories (id, user_id, fact, detail, category, source, confidence, pinned, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid("mem"),
        userId,
        fact,
        detail,
        category,
        source,
        confidence,
        pinned,
        new Date(Date.now() - days * 0.4 * DAY).toISOString(),
        created,
        created
      );
    }

    const rand = mulberry32(20260421);

    for (const n of NUDGES) {
      const id = uid("ndg");
      const createdAt = daysAgo(30 + Math.floor(rand() * 12), 11);
      run(
        `INSERT INTO nudges (id, user_id, title, trigger_kind, condition, action, priority, active, fire_count, last_fired_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        userId,
        n.title,
        n.trigger_kind,
        n.condition,
        n.action,
        n.priority,
        n.active,
        n.fire_count,
        new Date(Date.now() - n.lastFired * DAY).toISOString(),
        createdAt,
        createdAt
      );
      for (const [ago, message] of n.events) {
        run(
          `INSERT INTO nudge_events (id, nudge_id, user_id, message, kind, fired_at)
           VALUES (?, ?, ?, ?, 'spoken', ?)`,
          uid("nev"),
          id,
          userId,
          message,
          new Date(Date.now() - ago * DAY).toISOString()
        );
      }
    }

    // Older firing history so the 30-day chart has a realistic shape.
    const activeNudges = all("SELECT id, title FROM nudges WHERE user_id = ? AND active = 1", userId);
    for (let day = 1; day <= 30; day += 1) {
      const fires = Math.round(rand() * 4);
      for (let i = 0; i < fires; i += 1) {
        const nudge = activeNudges[Math.floor(rand() * activeNudges.length)];
        if (!nudge) break;
        run(
          `INSERT INTO nudge_events (id, nudge_id, user_id, message, kind, fired_at)
           VALUES (?, ?, ?, ?, 'spoken', ?)`,
          uid("nev"),
          nudge.id,
          userId,
          `${nudge.title} · held for the right moment`,
          isoAt(day, 7 + Math.floor(rand() * 14), Math.floor(rand() * 60))
        );
      }
    }

    for (const [slug, status, label, scopes, days] of CONNECTIONS) {
      run(
        `INSERT INTO connections (id, user_id, slug, status, account_label, scopes, connected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uid("con"),
        userId,
        slug,
        status,
        label,
        scopes,
        days === null ? daysAgo(60, 12) : daysAgo(days, 12)
      );
    }

    for (const s of SESSIONS) {
      const startedAt = isoAt(s.dayAgo, s.hour, s.minute);
      const sessionId = uid("ses");
      const actions = s.events.filter(([role]) => role === "action").length;
      run(
        `INSERT INTO sessions (id, user_id, title, mode, device_id, started_at, ended_at, duration_seconds, summary, actions_count)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        sessionId,
        userId,
        s.title,
        s.mode,
        startedAt,
        new Date(new Date(startedAt).getTime() + s.minutes * 60_000).toISOString(),
        s.minutes * 60,
        s.summary,
        actions
      );
      for (const [role, text, offset, meta] of s.events) {
        run(
          `INSERT INTO events (id, session_id, user_id, role, text, meta, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          uid("evt"),
          sessionId,
          userId,
          role,
          text,
          JSON.stringify(meta || {}),
          new Date(new Date(startedAt).getTime() + offset * 1000).toISOString()
        );
      }
    }

    for (const [kind, message, ago] of ACTIVITY) {
      logActivity(userId, kind, message, new Date(Date.now() - ago * DAY).toISOString());
    }
  });

  return userId;
}

/** Starter content for a brand-new account: real structure, no fake history. */
export function seedNewUser(userId) {
  tx(() => {
    run(
      `INSERT INTO memories (id, user_id, fact, detail, category, source, confidence, pinned, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid("mem"),
      userId,
      "Claw learns from what you say",
      "Mention something twice in conversation and it lands here. Edit or delete anything.",
      "preference",
      "told",
      100,
      1,
      nowIso(),
      nowIso(),
      nowIso()
    );
    logActivity(userId, "account", "Account created — Claw is listening", nowIso());
  });
}

/** Called once at boot. */
export function ensureSeed() {
  if (process.env.HEYCLAW_SEED === "0") return null;
  const userId = seedDemoUser();
  return userId;
}

export function resetDemo() {
  return seedDemoUser({ force: true });
}

export { bool };
