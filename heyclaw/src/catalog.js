/**
 * Connectable app catalog.
 *
 * Mirrors the gateway's app registry (gateway/src/apps.ts) but rendered as a
 * user-facing catalog. Connecting here links an account for this console; the
 * gateway performs the OAuth handshake in production.
 */
export const APP_CATALOG = [
  {
    slug: "google-calendar",
    name: "Google Calendar",
    category: "Calendars",
    blurb: "Meeting prep before anything with three or more people.",
    scopes: ["calendar.read", "calendar.write"],
    tint: "#4285f4",
    monogram: "GC",
  },
  {
    slug: "gmail",
    name: "Gmail",
    category: "Email",
    blurb: "Package tracking, receipts, and one-line summaries at the door.",
    scopes: ["mail.read", "mail.compose"],
    tint: "#ea4335",
    monogram: "Gm",
  },
  {
    slug: "todoist",
    name: "Todoist",
    category: "Tasks",
    blurb: "Your shopping list, captured hands-free while you cook.",
    scopes: ["tasks.read", "tasks.write"],
    tint: "#e44332",
    monogram: "T",
  },
  {
    slug: "spotify",
    name: "Spotify",
    category: "Music",
    blurb: "Kitchen lights down, Khruangbin on, no phone involved.",
    scopes: ["playback.control", "library.read"],
    tint: "#1db954",
    monogram: "S",
  },
  {
    slug: "notion",
    name: "Notion",
    category: "Notes",
    blurb: "Decisions written down while the meeting is still happening.",
    scopes: ["pages.read", "pages.write"],
    tint: "#111827",
    monogram: "N",
  },
  {
    slug: "homekit",
    name: "HomeKit",
    category: "Home",
    blurb: "Lights, doors, and scenes — spoken, never tapped.",
    scopes: ["lights.write", "scenes.run"],
    tint: "#f59e0b",
    monogram: "H",
  },
  {
    slug: "slack",
    name: "Slack",
    category: "Chat",
    blurb: "Read the room without taking your eyes off what you're doing.",
    scopes: ["messages.read", "messages.write"],
    tint: "#611f69",
    monogram: "Sl",
  },
  {
    slug: "whatsapp",
    name: "WhatsApp",
    category: "Chat",
    blurb: "Send the message out loud; never find your phone first.",
    scopes: ["messages.read", "messages.write"],
    tint: "#25d366",
    monogram: "W",
  },
  {
    slug: "google-maps",
    name: "Google Maps",
    category: "Places",
    blurb: "Turn-by-turn whispers and arrival-aware nudges.",
    scopes: ["location.read"],
    tint: "#34a853",
    monogram: "M",
  },
];

export function catalogEntry(slug) {
  return APP_CATALOG.find((app) => app.slug === slug);
}
