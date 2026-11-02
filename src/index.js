import { loadUsers, pbkdf2Hex, readSession, safeEqual, signSession, throttleBucket, verifyPassword } from "./auth.js";
import { loadState, mutate, nowText } from "./data.js";
import { workbook } from "./excel.js";
import { PAGE } from "./page.js";
import { refreshUserQuotes } from "./quotes.js";
import { listTxns } from "./txns.js";

const WINDOW_MS = 15 * 60 * 1000;

function json(body, status = 200, extra = {}) {
  return respond(JSON.stringify(body), status, { "Content-Type": "application/json; charset=utf-8", ...extra });
}

function respond(body, status, headers) {
  const merged = new Headers(headers);
  merged.set("X-Content-Type-Options", "nosniff");
  merged.set("Referrer-Policy", "no-referrer");
  merged.set("X-Frame-Options", "DENY");
  merged.set("Cache-Control", "no-store");
  return new Response(body, { status, headers: merged });
}

function secure(request) {
  return new URL(request.url).protocol === "https:";
}

function cookie(token, request) {
  const parts = [`gxyfi_session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${token ? 1209600 : 0}`];
  if (secure(request)) parts.push("Secure");
  return parts.join("; ");
}

function tokenFrom(request) {
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const matched = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)gxyfi_session=([^;]+)/);
  return matched ? decodeURIComponent(matched[1]) : "";
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === new URL(request.url).origin;
  const site = request.headers.get("Sec-Fetch-Site");
  return !site || site === "same-origin" || site === "none";
}

function clientError(error) {
  const message = error instanceof Error ? error.message : "";
  if (!message || message.length > 80 || message.includes("D1_") || message.includes("SQLITE")) return "保存失败";
  return message;
}

async function currentUser(request, env) {
  const username = await readSession(env.SESSION_SECRET, tokenFrom(request));
  if (!username) return null;
  const loaded = loadUsers(env.AUTH_USERS);
  if (loaded.error || !loaded.users.some((user) => user.username === username)) return null;
  return username;
}

async function login(request, env) {
  if (!sameOrigin(request)) return json({ error: "拒绝来源不明的登录" }, 403);
  const loaded = loadUsers(env.AUTH_USERS);
  if (loaded.error || !env.SESSION_SECRET) {
    console.error(JSON.stringify({ message: "auth_config_invalid" }));
    return json({ error: "登录暂不可用" }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "账号或密码不正确" }, 401);
  }
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = await throttleBucket(ip, username);
  const existing = await env.DB.prepare("SELECT failures, updated_at FROM auth_throttle WHERE bucket=?").bind(bucket).first();
  const recent = existing && Date.now() - Date.parse(existing.updated_at) < WINDOW_MS;
  if (existing && recent && existing.failures >= 8) return json({ error: "尝试次数过多，请稍后再来" }, 429);
  const verified = await verifyPassword(loaded.users, username, password);
  if (!verified) {
    const failures = recent ? existing.failures + 1 : 1;
    await env.DB.prepare(
      `INSERT INTO auth_throttle(bucket, failures, updated_at) VALUES(?,?,?)
       ON CONFLICT(bucket) DO UPDATE SET failures=excluded.failures, updated_at=excluded.updated_at`,
    ).bind(bucket, failures, new Date().toISOString()).run();
    console.log(JSON.stringify({ message: "login_failed", bucket }));
    return json({ error: "账号或密码不正确" }, 401);
  }
  await env.DB.prepare("DELETE FROM auth_throttle WHERE bucket=?").bind(bucket).run();
  const token = await signSession(env.SESSION_SECRET, verified);
  console.log(JSON.stringify({ message: "login_ok" }));
  return json({ ok: true }, 200, { "Set-Cookie": cookie(token, request) });
}

async function saveQuotes(db, userId, result) {
  for (const quote of result.quotes) {
    await db.prepare(
      `INSERT INTO quotes(user_id, market, symbol, name, price, prev_close, currency, quoted_at, source, fetched_at, ok, message)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, market, symbol) DO UPDATE SET
         name=excluded.name, price=excluded.price, prev_close=excluded.prev_close, currency=excluded.currency,
         quoted_at=excluded.quoted_at, source=excluded.source, fetched_at=excluded.fetched_at, ok=excluded.ok, message=excluded.message`,
    ).bind(
      userId, quote.market, quote.symbol, quote.name || "", quote.price, quote.prev_close, quote.currency || "",
      quote.quoted_at || "", quote.source || "", nowText(), quote.ok ? 1 : 0, quote.message || "",
    ).run();
  }
  for (const [code, item] of Object.entries(result.fx)) {
    await db.prepare(
      `INSERT INTO fx_rates(user_id, code, rate, source, quoted_at) VALUES(?,?,?,?,?)
       ON CONFLICT(user_id, code) DO UPDATE SET rate=excluded.rate, source=excluded.source, quoted_at=excluded.quoted_at`,
    ).bind(userId, code, item.rate, item.source, item.quoted_at || "").run();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/robots.txt") {
        return respond("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain; charset=utf-8" });
      }
      if (url.pathname === "/api/register") return json({ error: "不开放注册" }, 404);
      if (request.method === "POST" && !sameOrigin(request) && url.pathname !== "/api/login") {
        return json({ error: "拒绝来源不明的请求" }, 403);
      }
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 100000) return json({ error: "请求过大" }, 413);

      if (url.pathname === "/" && request.method === "GET") {
        return respond(PAGE, 200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
        });
      }
      if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
      if (url.pathname === "/api/logout" && request.method === "POST") {
        return json({ ok: true }, 200, { "Set-Cookie": cookie("", request) });
      }

      const userId = await currentUser(request, env);
      if (!userId) return json({ error: "请先登录" }, 401);

      if (url.pathname === "/api/state" && request.method === "GET") {
        return json(await loadState(env.DB, userId));
      }
      if (url.pathname === "/api/mutate" && request.method === "POST") {
        let result;
        try {
          result = await mutate(env.DB, userId, await request.json());
        } catch (error) {
          return json({ error: clientError(error) }, 400);
        }
        const state = await loadState(env.DB, userId);
        if (result) state.result = result;
        return json(state);
      }
      if (url.pathname === "/api/txns" && request.method === "GET") {
        return json({ txns: await listTxns(env.DB, userId, url.searchParams.get("account_id"), url.searchParams.get("limit")) });
      }
      if (url.pathname === "/api/quotes/refresh" && request.method === "POST") {
        const result = await refreshUserQuotes(env.DB, userId, env.FINNHUB_TOKEN || "");
        await saveQuotes(env.DB, userId, result);
        const state = await loadState(env.DB, userId);
        state.quoteErrors = result.errors;
        return json(state);
      }
      if (url.pathname === "/api/export.xls" && request.method === "GET") {
        const xml = workbook(await loadState(env.DB, userId));
        return respond(xml, 200, {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"gxyFi-web.xls\"",
        });
      }
      return json({ error: "没有这个地址" }, 404);
    } catch (error) {
      console.error(JSON.stringify({
        message: "request_failed",
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ error: "服务暂时不可用" }, 500);
    }
  },
};

export { pbkdf2Hex, safeEqual };
