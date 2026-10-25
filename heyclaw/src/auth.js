/**
 * Authentication: scrypt password hashes + opaque bearer tokens.
 *
 * The browser keeps the token in localStorage and sends it as
 * `Authorization: Bearer …`; we also set an httpOnly cookie so the app still
 * works if a hostile third-party-cookie policy blocks storage. Either
 * credential resolves to the same session row.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { get, nowIso, run, uid, DAY } from "./db.js";
import { HttpError, badRequest, unauthorized } from "./http.js";

const TOKEN_TTL_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return `scrypt$${SCRYPT.N}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, salt, hash] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hash, "hex");
    const actual = scryptSync(password, salt, expected.length, { ...SCRYPT, N: Number(n) });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

export function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  run(
    "INSERT INTO auth_tokens (token_hash, user_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)",
    sha256(token),
    userId,
    nowIso(),
    new Date(Date.now() + TOKEN_TTL_DAYS * DAY).toISOString(),
    nowIso()
  );
  return token;
}

export function destroySession(token) {
  if (!token) return;
  run("DELETE FROM auth_tokens WHERE token_hash = ?", sha256(token));
}

export function destroyAllSessions(userId) {
  run("DELETE FROM auth_tokens WHERE user_id = ?", userId);
}

export function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const cookie = req.headers.cookie || "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "hc_token") return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function userFromRequest(req) {
  return userFromToken(tokenFromRequest(req));
}

/** Resolve a bearer token (from a header, cookie, or ?token= on an SSE URL). */
export function userFromToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.*, t.token_hash, t.expires_at
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?`,
    sha256(token)
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run("DELETE FROM auth_tokens WHERE token_hash = ?", row.token_hash);
    return null;
  }
  return publicUser(row);
}

export function requireUser(user) {
  if (!user) throw unauthorized();
  return user;
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    wakeWord: row.wake_word,
    voice: row.voice,
    language: row.language,
    autonomy: row.autonomy,
    proactive: !!row.proactive,
    retentionDays: row.retention_days,
    createdAt: row.created_at,
  };
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateSignup({ name, email, password }) {
  const errors = {};
  if (!String(name || "").trim() || String(name).trim().length < 2) {
    errors.name = "Tell us your name (2+ characters)";
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(normalizeEmail(email))) {
    errors.email = "Enter a valid email address";
  }
  if (String(password || "").length < 8) {
    errors.password = "Use at least 8 characters";
  }
  if (Object.keys(errors).length) throw new HttpError(422, "Please fix the highlighted fields", errors);
}

/** Simple per-key failure throttle for sign-in. */
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;

export function assertLoginAllowed(key) {
  const entry = attempts.get(key);
  if (!entry) return;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return;
  }
  if (entry.count >= 12) {
    throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
  }
}

export function noteLoginFailure(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}

export function createUser({ name, email, password }) {
  const cleanEmail = normalizeEmail(email);
  if (get("SELECT id FROM users WHERE email = ?", cleanEmail)) {
    throw new HttpError(409, "That email already has an account", { email: "Email already in use" });
  }
  const id = uid("usr");
  run(
    `INSERT INTO users (id, email, name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    cleanEmail,
    String(name).trim(),
    hashPassword(password),
    nowIso()
  );
  return get("SELECT * FROM users WHERE id = ?", id);
}

export function updatePassword(userId, next) {
  if (String(next || "").length < 8) {
    throw badRequest("New password must be at least 8 characters", { password: "Use at least 8 characters" });
  }
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(next), userId);
}
