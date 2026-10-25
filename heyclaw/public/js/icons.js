/** Inline icon set (stroke, 24x24 grid) — no sprite fetch, no icon font. */
const PATHS = {
  overview:
    '<rect x="3" y="3" width="18" height="18" rx="3.5"/><path d="M3 9.5h18"/><path d="M9.5 21V9.5"/>',
  live: '<path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3Z"/><path d="M18.4 15.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z"/>',
  sessions: '<path d="M3 12h2.4l2-5.4L10.6 18l2.6-8.6 1.9 3.9H21"/>',
  nudges: '<path d="M18 8.4a6 6 0 1 0-12 0c0 6.4-2.6 8.1-2.6 8.1h17.2S18 14.8 18 8.4Z"/><path d="M13.7 20.4a2 2 0 0 1-3.4 0"/>',
  memory:
    '<rect x="7" y="7" width="10" height="10" rx="2.4"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 13.5v7M13.5 17h7"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.2 14.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.7 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H2a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.05 8.7a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H8.5a1.7 1.7 0 0 0 1.03-1.56V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H22a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M5.5 6l.8 13a2 2 0 0 0 2 1.9h7.4a2 2 0 0 0 2-1.9l.8-13"/><path d="M10 11v5M14 11v5"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
  pause: '<rect x="7" y="4.5" width="3.5" height="15" rx="1.2"/><rect x="13.5" y="4.5" width="3.5" height="15" rx="1.2"/>',
  play: '<path d="M8 5.2v13.6a1 1 0 0 0 1.52.85l11-6.8a1 1 0 0 0 0-1.7l-11-6.8A1 1 0 0 0 8 5.2Z"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/>',
  mic: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  glasses:
    '<circle cx="6.5" cy="14" r="3.4"/><circle cx="17.5" cy="14" r="3.4"/><path d="M9.9 13.6c.7-.9 3.5-.9 4.2 0"/><path d="M3.1 14V9.6A2.6 2.6 0 0 1 5.7 7H7"/><path d="M20.9 14V9.6A2.6 2.6 0 0 0 18.3 7H17"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M11 18.5h2"/>',
  monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2.4"/><path d="M8 20.5h8M12 16.5v4"/>',
  logout: '<path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9"/><path d="M16 16l4-4-4-4M20 12H9"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8.2v.1"/>',
  star: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.1l-5.6 3 1.2-6.2L3 9.6l6.3-.8L12 3Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  zap: '<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z"/>',
  refresh: '<path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L21 9"/><path d="M21 4v5h-5"/><path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3 15"/><path d="M3 20v-5h5"/>',
  download: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 21h16"/>',
  battery: '<rect x="2.5" y="7.5" width="16" height="9" rx="2.2"/><path d="M21 10.5v3"/><path d="M5.5 10.5v3"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11 6"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-2.6 2.6a4.5 4.5 0 0 0 6.4 6.4L13 18"/>',
  unlink: '<path d="M9 15 6.5 17.5a4 4 0 0 1-5.7-5.7L3.5 9"/><path d="m15 9 2.5-2.5a4 4 0 0 1 5.7 5.7L20.5 15"/><path d="m3 3 18 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/>',
  filter: '<path d="M3 5h18l-7 8.2V21l-4-2.4v-5.4L3 5Z"/>',
  dot: '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  shield: '<path d="M12 2.5 4.5 5.5v6c0 5 3.3 8.3 7.5 10 4.2-1.7 7.5-5 7.5-10v-6L12 2.5Z"/><path d="m9 12 2 2 4-4"/>',
  wave: '<path d="M3 12h2l1.5-4 2 8L11 6l2.5 12 2-9 1.5 3h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M15 8l2 2"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name, size = 18, extra = "") {
  const path = PATHS[name] || PATHS.dot;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    ${extra ? `class="${extra}"` : ""}>${path}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
