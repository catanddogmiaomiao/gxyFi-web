import { webcrypto } from "node:crypto";

const crypto = globalThis.crypto ?? webcrypto;
const encoder = new TextEncoder();
const DUMMY_USER = {
  username: "",
  salt: "00000000000000000000000000000000",
  hash: "0000000000000000000000000000000000000000000000000000000000000000",
};

export function loadUsers(raw) {
  if (!raw) return { error: "unconfigured" };
  let users;
  try {
    users = JSON.parse(raw);
  } catch {
    return { error: "unconfigured" };
  }
  if (!Array.isArray(users) || users.length < 1 || users.length > 3) return { error: "unconfigured" };
  for (const user of users) {
    if (!user || typeof user.username !== "string" || typeof user.salt !== "string" || typeof user.hash !== "string") {
      return { error: "unconfigured" };
    }
  }
  return { users };
}

export async function pbkdf2Hex(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function safeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right))),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(leftBytes, rightBytes);
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) diff |= leftBytes[index] ^ rightBytes[index];
  return diff === 0;
}

export async function verifyPassword(users, username, password) {
  const found = users.find((user) => user.username === username) || DUMMY_USER;
  const actual = await pbkdf2Hex(password, found.salt);
  const match = await safeEqual(actual, found.hash);
  if (!match || found === DUMMY_USER) return null;
  return found.username;
}

function bytesToB64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hmacKey(secret, use) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);
}

export async function signSession(secret, username) {
  const payload = bytesToB64Url(encoder.encode(JSON.stringify({ u: username, exp: Date.now() + 14 * 24 * 60 * 60 * 1000 })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${bytesToB64Url(signature)}`;
}

export async function readSession(secret, token) {
  if (!secret || !token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), b64UrlToBytes(signature), encoder.encode(payload));
  } catch {
    return null;
  }
  if (!valid) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payload)));
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

export async function throttleBucket(ip, username) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${ip}\n${username}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
