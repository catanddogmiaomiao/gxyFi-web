import { canonicalGold, canonicalSymbol, toSina, toYahoo } from "./symbols.js";

const UA = "gxyFi-web/0.1 (+https://github.com/catanddogmiaomiao/gxyFi-web)";

function timeout() {
  return AbortSignal.timeout(12000);
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: timeout() });
  if (!response.ok) throw new Error(`行情源返回 ${response.status}`);
  return response.json();
}

function parseEast(obj) {
  const data = obj.data;
  if (!data || data.f43 == null || data.f43 === "-") throw new Error("东方财富没有返回价格");
  const scale = 10 ** Number(data.f59 || 2);
  const price = Number(data.f43) / scale;
  if (!(price > 0)) throw new Error("东方财富返回的价格无效");
  const prev = data.f60 == null || data.f60 === "-" ? null : Number(data.f60) / scale;
  return { name: data.f58 || "", price, prev_close: prev, currency: "CNY", quoted_at: "" };
}

function parseSina(text) {
  const matched = text.match(/="(.*)"/s);
  if (!matched || !matched[1].trim()) throw new Error("新浪没有返回这只代码");
  const parts = matched[1].split(",");
  const price = Number(parts[3]);
  const prev = parts[2] ? Number(parts[2]) : null;
  const usable = price > 0 ? price : prev;
  if (!(usable > 0)) throw new Error("新浪返回的价格无效");
  const quoted = parts[30] ? `${parts[30]} ${parts[31] || ""}`.trim() : "";
  return { name: parts[0], price: usable, prev_close: prev, currency: "CNY", quoted_at: quoted };
}

function parseSge(obj) {
  const delay = obj.delaystr || "";
  const matched = delay.match(/(\d{2}:\d{2}):\d{2}/);
  const cutoff = matched ? matched[1] : null;
  let price = null;
  let stamp = "";
  const times = obj.times || [];
  const data = obj.data || [];
  for (let i = 0; i < times.length; i += 1) {
    const value = Number(data[i]);
    if (!(value > 0)) continue;
    if (cutoff && String(times[i]) >= cutoff) continue;
    price = value;
    stamp = String(times[i]);
  }
  if (price == null && Number(obj.now) > 0) price = Number(obj.now);
  if (price == null) throw new Error("上金所没有返回有效价格");
  return {
    name: obj.heyue || "",
    price,
    prev_close: null,
    currency: "CNY",
    quoted_at: stamp ? `${delay} 最新点 ${stamp}` : delay,
  };
}

function previousCloseFromYahoo(result, meta) {
  // chartPreviousClose 在 range=5d 时经常不是上一交易日收盘价，会把当日涨跌算错。
  for (const key of ["previousClose", "regularMarketPreviousClose"]) {
    if (meta[key] != null && meta[key] !== "") return Number(meta[key]);
  }
  const closes = ((((result.indicators || {}).quote || [])[0] || {}).close || []).filter((item) => item != null).map(Number);
  if (closes.length >= 2) return closes[closes.length - 2];
  return meta.chartPreviousClose == null || meta.chartPreviousClose === "" ? null : Number(meta.chartPreviousClose);
}

function parseYahoo(obj) {
  const result = obj.chart && obj.chart.result && obj.chart.result[0];
  if (!result) throw new Error("Yahoo 没有返回行情");
  const meta = result.meta || {};
  if (meta.regularMarketPrice == null) throw new Error("Yahoo 没有返回最新价");
  let quoted = "";
  if (meta.regularMarketTime) quoted = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 16).replace("T", " ");
  return {
    name: meta.shortName || meta.symbol || "",
    price: Number(meta.regularMarketPrice),
    prev_close: previousCloseFromYahoo(result, meta),
    currency: meta.currency || "",
    quoted_at: quoted,
  };
}

async function fetchGold(symbol) {
  const canonical = canonicalGold(symbol);
  const response = await fetch("https://www.sge.com.cn/graph/quotations", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: "https://www.sge.com.cn/",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: `instid=${encodeURIComponent(canonical)}`,
    signal: timeout(),
  });
  if (!response.ok) throw new Error(`上金所返回 ${response.status}`);
  const parsed = parseSge(await response.json());
  parsed.name = parsed.name || canonical;
  parsed.source = "上海黄金交易所（延时）";
  return parsed;
}

async function fetchAShare(symbol) {
  const sina = toSina(symbol);
  const secid = `${sina.startsWith("sh") ? 1 : 0}.${sina.slice(2)}`;
  try {
    const parsed = parseEast(await getJson(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f59`,
      { Referer: "https://quote.eastmoney.com/" },
    ));
    parsed.source = "东方财富";
    return parsed;
  } catch (eastError) {
    const response = await fetch(`https://hq.sinajs.cn/list=${sina}`, {
      headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn" },
      signal: timeout(),
    });
    if (!response.ok) throw eastError;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text;
    try {
      text = new TextDecoder("gbk").decode(bytes);
    } catch {
      text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    }
    const parsed = parseSina(text);
    parsed.source = "新浪财经";
    return parsed;
  }
}

async function fetchUs(symbol, finnhubToken) {
  const yahooSymbol = toYahoo(symbol);
  if (finnhubToken) {
    try {
      const obj = await getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(yahooSymbol)}&token=${encodeURIComponent(finnhubToken)}`);
      if (!obj.c) throw new Error("Finnhub 没有返回最新价");
      return {
        name: yahooSymbol,
        price: Number(obj.c),
        prev_close: obj.pc ? Number(obj.pc) : null,
        currency: "USD",
        quoted_at: obj.t ? new Date(obj.t * 1000).toISOString().slice(0, 16).replace("T", " ") : "",
        source: "Finnhub",
      };
    } catch {
      // Yahoo remains the fallback when the optional token fails.
    }
  }
  const parsed = parseYahoo(await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`,
  ));
  parsed.source = "Yahoo Finance";
  return parsed;
}

async function fetchFx(yahooSymbol) {
  return parseYahoo(await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
  ));
}

function quoteRow(market, symbol, parsed, ok, message) {
  return {
    market,
    symbol,
    name: parsed?.name || "",
    price: parsed?.price ?? null,
    prev_close: parsed?.prev_close ?? null,
    currency: parsed?.currency || "",
    quoted_at: parsed?.quoted_at || "",
    source: parsed?.source || "",
    ok,
    message,
  };
}

export async function fetchOne(market, symbol, finnhubToken) {
  try {
    let parsed;
    let canonical;
    if (market === "GOLD") {
      parsed = await fetchGold(symbol);
      canonical = canonicalGold(symbol);
    } else if (market === "A") {
      parsed = await fetchAShare(symbol);
      canonical = toSina(symbol).slice(2);
    } else if (market === "US") {
      parsed = await fetchUs(symbol, finnhubToken);
      canonical = toYahoo(symbol);
    } else {
      return quoteRow(market, symbol, null, false, "其他资产请填写手工现价");
    }
    return quoteRow(market, canonical, parsed, true, "");
  } catch (error) {
    let shown = symbol;
    try {
      shown = canonicalSymbol(market, symbol);
    } catch {
      shown = symbol;
    }
    return quoteRow(market, shown, null, false, error instanceof Error ? error.message : String(error));
  }
}

export async function refreshUserQuotes(db, userId, finnhubToken) {
  const holdings = (await db.prepare(
    "SELECT market, symbol FROM holdings WHERE user_id=? AND market IN ('US','A','GOLD')",
  ).bind(userId).all()).results;
  const seen = new Set();
  const quotes = [];
  for (const holding of holdings) {
    const key = `${holding.market}:${holding.symbol}`;
    if (seen.has(key) || quotes.length >= 30) continue;
    seen.add(key);
    quotes.push(await fetchOne(holding.market, holding.symbol, finnhubToken));
  }
  const fx = {};
  const errors = [];
  for (const [code, yahooSymbol] of [["USD", "CNY=X"], ["HKD", "HKDCNY=X"]]) {
    try {
      const parsed = await fetchFx(yahooSymbol);
      fx[code] = { rate: parsed.price, source: "Yahoo Finance", quoted_at: parsed.quoted_at || "" };
    } catch (error) {
      errors.push(`${code}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { quotes, fx, errors };
}
