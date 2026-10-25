/** Shared vocabulary + small derived helpers used by the API. */
import { all } from "./db.js";

export const TRIGGER_KINDS = [
  "place",
  "calendar",
  "routine",
  "device",
  "time",
  "weather",
  "person",
];

export const MEMORY_CATEGORIES = [
  "person",
  "place",
  "preference",
  "routine",
  "work",
  "home",
  "other",
];

export const AUTONOMY = ["whisper", "balanced", "proactive"];

export const LANGUAGES = ["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "ja-JP"];

export const VOICES = ["Sol · warm", "Mira · calm", "Kai · bright", "Noa · low"];

/** A few learned facts, used to make live replies feel personal. */
export function creationFacts(userId) {
  return all(
    `SELECT fact FROM memories WHERE user_id = ? ORDER BY pinned DESC, confidence DESC LIMIT 6`,
    userId
  );
}
