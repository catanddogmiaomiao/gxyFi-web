/** 非固定资产走势。储蓄按余额快照结转，投资按已保存的每日分项结转。 */

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shiftDay(day, offset) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date));
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

function monthEnd(year, month, today) {
  const next = month === 12 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month, 1));
  next.setUTCDate(next.getUTCDate() - 1);
  const last = next.toISOString().slice(0, 10);
  return last < today ? last : today;
}

export function sampleDays(span, today) {
  if (span === "week") return Array.from({ length: 7 }, (_, index) => shiftDay(today, index - 6));
  if (span === "month") return Array.from({ length: 30 }, (_, index) => shiftDay(today, index - 29));
  if (span === "year") {
    let year = Number(today.slice(0, 4));
    let month = Number(today.slice(5, 7));
    const found = [];
    for (let index = 0; index < 12; index += 1) {
      found.push(monthEnd(year, month, today));
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }
    return found.reverse();
  }
  if (span === "decade") {
    const year = Number(today.slice(0, 4));
    return Array.from({ length: 10 }, (_, index) => {
      const end = `${year - 9 + index}-12-31`;
      return end < today ? end : today;
    });
  }
  throw new Error("时间范围不正确");
}

function labelOf(span, day) {
  if (span === "year") return day.slice(0, 7);
  if (span === "decade") return day.slice(0, 4);
  return day.slice(5);
}

function toCny(amount, currency, rates) {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  if (!currency || currency === "CNY") return Number(amount);
  const rate = rates[currency];
  return rate == null ? null : Number(amount) * Number(rate);
}

export function investSnapshot(holdings, plans, quotes, rates) {
  const parts = [];
  let total = 0;
  for (const holding of holdings) {
    const sold = holding.sell_price != null && holding.sell_price !== "";
    let price = null;
    if (sold) price = Number(holding.sell_price);
    else if (holding.manual_price != null && holding.manual_price !== "") price = Number(holding.manual_price);
    else {
      const quote = (quotes || []).find((row) => row.market === holding.market && row.symbol === holding.symbol && row.ok && row.price != null);
      if (quote) price = Number(quote.price);
    }
    if (price == null) continue;
    const cny = toCny(price * Number(holding.quantity), holding.currency, rates);
    if (cny == null) continue;
    if (sold && Number(holding.count_invested) !== 1) continue;
    const amount = round2(cny);
    if (!amount) continue;
    parts.push({ name: holding.name, group: "投资", amount });
    total += amount;
  }
  for (const plan of plans || []) {
    if (!plan.in_invest || plan.market_value == null) continue;
    const amount = round2(Number(plan.market_value));
    if (!amount) continue;
    parts.push({ name: plan.name, group: "投资", amount });
    total += amount;
  }
  return { invest_cny: round2(total), parts };
}

function savingsAsOf(day, byAccount, rates) {
  let total = 0;
  const parts = [];
  let missing = false;
  for (const rows of byAccount.values()) {
    let chosen = null;
    for (const entry of rows) {
      if (entry.as_of_date <= day) chosen = entry;
      else break;
    }
    if (!chosen) continue;
    const cny = toCny(chosen.balance, chosen.currency, rates);
    if (cny == null) {
      missing = true;
      continue;
    }
    const amount = round2(cny);
    parts.push({ name: chosen.name, group: "储蓄", amount });
    total += amount;
  }
  parts.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "zh-CN"));
  return { total: round2(total), parts, missing };
}

function latestOnOrBefore(days, day) {
  let found = null;
  for (const item of days) {
    if (item <= day) found = item;
    else break;
  }
  return found;
}

export function liquidTrend({ span, today, accounts, balances, rates, liquidDays }) {
  const days = sampleDays(span, today);
  const names = new Map((accounts || []).map((account) => [account.id, { name: account.name, currency: account.currency }]));
  const byAccount = new Map();
  for (const entry of [...(balances || [])].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date) || a.id - b.id)) {
    const account = names.get(entry.account_id);
    if (!account) continue;
    const rows = byAccount.get(entry.account_id) || [];
    rows.push({ ...entry, name: account.name, currency: account.currency });
    byAccount.set(entry.account_id, rows);
  }
  const snaps = new Map();
  for (const row of liquidDays || []) {
    snaps.set(row.day, { invest_cny: Number(row.invest_cny), parts: typeof row.parts_json === "string" ? JSON.parse(row.parts_json || "[]") : row.parts || [] });
  }
  const snapDays = [...snaps.keys()].sort();
  const points = days.map((day) => {
    const savings = savingsAsOf(day, byAccount, rates);
    const investDay = latestOnOrBefore(snapDays, day);
    if (!investDay) {
      return { day, label: labelOf(span, day), savings: savings.total, invest: null, total: null, fx_missing: savings.missing, parts: savings.parts };
    }
    const snap = snaps.get(investDay);
    return {
      day,
      label: labelOf(span, day),
      savings: savings.total,
      invest: round2(snap.invest_cny),
      total: round2(savings.total + snap.invest_cny),
      fx_missing: savings.missing,
      parts: savings.parts.concat(snap.parts),
    };
  });
  const known = points.filter((point) => point.invest != null).map((point) => point.day);
  return { span, points, invest_since: known[0] || snapDays[0] || null };
}
