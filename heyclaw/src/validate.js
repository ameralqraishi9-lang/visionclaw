/** Field validation helpers — small, explicit, and 422-shaped. */
import { HttpError } from "./http.js";

export function text(value, { label, min = 1, max = 500, field = "name" } = {}) {
  const clean = String(value ?? "").trim();
  if (clean.length < min) {
    const msg = min <= 1 ? `${label} is required` : `${label} needs at least ${min} characters`;
    throw new HttpError(422, msg, { [field]: msg });
  }
  if (clean.length > max) {
    const msg = `${label} is limited to ${max} characters`;
    throw new HttpError(422, msg, { [field]: msg });
  }
  return clean;
}

export function optionalText(value, opts) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return text(value, opts);
}

export function choice(value, allowed, { label = "Value", field = "value", fallback } = {}) {
  if (fallback !== undefined && (value === undefined || value === null || value === "")) {
    return fallback;
  }
  const clean = String(value ?? "");
  if (!allowed.includes(clean)) {
    const msg = `${label} must be one of: ${allowed.join(", ")}`;
    throw new HttpError(422, msg, { [field]: msg });
  }
  return clean;
}

export function int(value, { label = "Value", min = 0, max = 100, field = "value", fallback } = {}) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const msg = `${label} must be a number`;
    throw new HttpError(422, msg, { [field]: msg });
  }
  const clamped = Math.round(Math.min(max, Math.max(min, n)));
  return clamped;
}

export function truthy(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}
