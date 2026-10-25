#!/usr/bin/env node
/** CLI: seed or reset the demo account. */
import { DEMO_EMAIL, DEMO_PASSWORD, resetDemo, seedDemoUser } from "./seed.js";
import { ensureSeed } from "./seed.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: npm run seed [-- --reset]

  (no flags)   seed the demo account if it does not exist
  --reset      delete the demo account and all of its data, then reseed`);
  process.exit(0);
}

if (args.has("--reset")) {
  resetDemo();
  console.log(`Reset demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
} else {
  const id = seedDemoUser();
  console.log(`Demo account ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (${id})`);
}
