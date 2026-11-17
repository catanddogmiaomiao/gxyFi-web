const CYCLES = ["每月", "每周", "每两周"];
export const STOPPED = "已停止";
const STATUSES = ["进行中", "已暂停", STOPPED];
const STATUS_ALIASES = { 已结束: STOPPED, 停止: STOPPED, 已终止: STOPPED };

export function normalizeStatus(value) {
  const text = String(value || "进行中").trim();
  const status = STATUS_ALIASES[text] || text;
  if (!STATUSES.includes(status)) throw new Error("状态不正确");
  return status;
}

// 停止后份额继续持有，可以记赎回和红利再投，但不能再记停止日期之后的定投。
export function isSold(row) {
  return row != null && row.sell_price != null && row.sell_price !== "";
}

export function saleFields(data) {
  const price = numberOrEmpty(data.sell_price, "卖出价格");
  if (price == null || price <= 0) throw new Error("卖出价格需要大于 0");
  const sold = String(data.sold_on || "").trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sold)) throw new Error("卖出日期请写成 YYYY-MM-DD");
  const flag = data.count_invested;
  const counted = flag === true || flag === 1 || flag === "1" || flag === "on" || flag === "true" || flag === "yes" ? 1 : 0;
  return { sell_price: round4(price), sold_on: sold, count_invested: counted };
}

export function checkRecordAllowed(plan, record) {
  if (isSold(plan)) throw new Error("「" + (plan.name || plan.symbol) + "」已卖出。要继续记确认，请先撤销卖出。");
  if (plan.status !== STOPPED || record.kind !== "定投") return;
  const stopped = plan.stopped_on || "";
  if (!stopped || record.trade_date > stopped) {
    throw new Error("「" + (plan.name || plan.symbol) + "」已在 " + (stopped || "之前") + " 停止定投，不能再记之后的定投扣款。如果恢复了，请先恢复定投。");
  }
}

export function checkStop(stoppedOn, records) {
  const paid = records.filter((row) => row.kind === "定投").map((row) => row.trade_date).sort();
  if (paid.length && stoppedOn < paid[paid.length - 1]) throw new Error("停止日期不能早于最后一笔定投（" + paid[paid.length - 1] + "）");
}

function statusLabel(plan) {
  if (isSold(plan)) {
    const counted = Number(plan.count_invested) === 1 ? "计入投资" : "不计入投资";
    return ["已卖出", plan.sold_on, counted].filter(Boolean).join(" · ");
  }
  if (plan.status !== STOPPED) return plan.status || "";
  return [STOPPED, plan.stopped_on, plan.stop_reason].filter(Boolean).join(" · ");
}
const KINDS = ["期初", "定投", "赎回", "红利再投"];
const WEEKDAYS = ["", "周一", "周二", "周三", "周四", "周五"];
const KIND_ALIASES = {
  期初: "期初",
  持仓: "期初",
  定投: "定投",
  买入: "定投",
  申购: "定投",
  赎回: "赎回",
  卖出: "赎回",
  红利再投: "红利再投",
  分红再投: "红利再投",
};
const HEADER_MAP = {
  确认日期: "trade_date",
  日期: "trade_date",
  类型: "kind",
  扣款金额: "amount",
  申请金额: "amount",
  金额: "amount",
  到账金额: "amount",
  成本金额: "amount",
  成本: "amount",
  确认净值: "nav",
  净值: "nav",
  确认份额: "shares",
  份额: "shares",
  手续费: "fee",
  备注: "note",
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

export function cycleLabel(cycle, debitDay) {
  const day = Number(debitDay);
  if (cycle === "每月") return `每月 ${day} 日`;
  if (day >= 1 && day <= 5) return `${cycle} ${WEEKDAYS[day]}`;
  return `${cycle} ${day}`;
}

export function normalizeSymbol(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,6}$/.test(text)) throw new Error("基金代码是 6 位数字");
  return text.padStart(6, "0");
}

function numberOrEmpty(value, label) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(String(value).trim().replace(/,/g, "").replace(/，/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`${label}不是有效数字`);
  return parsed;
}

export function normalizeRecord(data) {
  const kind = KIND_ALIASES[String(data.kind || "定投").trim()] || "";
  if (!KINDS.includes(kind)) throw new Error("类型只能是期初、定投、赎回或红利再投");
  const tradeDate = String(data.trade_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error("确认日期请写成 YYYY-MM-DD");
  const amount = numberOrEmpty(data.amount, "金额") || 0;
  const fee = numberOrEmpty(data.fee, "手续费") || 0;
  const nav = numberOrEmpty(data.nav, "确认净值");
  let shares = numberOrEmpty(data.shares, "确认份额");
  if (amount < 0 || fee < 0) throw new Error("金额和手续费不能为负数");
  if (nav != null && nav <= 0) throw new Error("确认净值需要大于 0");
  if (kind === "定投") {
    if (amount <= 0) throw new Error("定投需要填写扣款金额");
    if (shares == null) {
      if (nav == null) throw new Error("请填写确认份额，或同时填写确认净值");
      const net = amount - fee;
      if (net <= 0) throw new Error("扣款金额需要大于手续费");
      shares = net / nav;
    }
  } else if (shares == null || shares <= 0) {
    throw new Error("份额需要大于 0");
  }
  if (shares <= 0) throw new Error("份额需要大于 0");
  return {
    kind,
    trade_date: tradeDate,
    amount: round2(amount),
    nav: nav == null ? null : round4(nav),
    shares: round4(shares),
    fee: round2(fee),
    note: String(data.note || "").trim(),
  };
}

export function applyPosition(records) {
  const ordered = [...records].sort((left, right) => left.trade_date.localeCompare(right.trade_date) || (left.id || 0) - (right.id || 0));
  let shares = 0;
  let cost = 0;
  for (const row of ordered) {
    const qty = Number(row.shares || 0);
    if (row.kind === "期初" || row.kind === "定投") {
      shares += qty;
      cost += Number(row.amount || 0);
    } else if (row.kind === "赎回") {
      if (qty - shares > 0.0001) throw new Error(`${row.trade_date} 的赎回份额超过当时持有份额`);
      if (shares <= 0) throw new Error(`${row.trade_date} 赎回时还没有持有份额`);
      const used = Math.min(qty, shares);
      cost -= cost * (used / shares);
      shares -= used;
    } else if (row.kind === "红利再投") {
      shares += qty;
    }
    if (shares <= 0.0001) {
      shares = 0;
      cost = 0;
    } else if (cost < 0) {
      cost = 0;
    }
  }
  return { shares: round4(shares), cost: round2(cost) };
}

export function latestNav(manualNav, records) {
  if (manualNav != null) return { nav: Number(manualNav), source: "手工" };
  const dated = records.filter((row) => row.nav != null);
  if (!dated.length) return { nav: null, source: "" };
  const last = dated.reduce((best, row) => (row.trade_date > best.trade_date || (row.trade_date === best.trade_date && (row.id || 0) > (best.id || 0)) ? row : best));
  return { nav: Number(last.nav), source: "最近确认" };
}

export function valuePlans(plans, records) {
  return plans.map((plan) => {
    const own = records.filter((row) => Number(row.plan_id) === Number(plan.id));
    const position = applyPosition(own);
    const sold = isSold(plan);
    const priced = sold ? { nav: Number(plan.sell_price), source: "已卖出" } : latestNav(plan.manual_nav, own);
    const proceeds = sold ? (position.shares > 0 ? round2(position.shares * priced.nav) : 0) : null;
    const counted = Number(plan.count_invested) === 1;
    const openValue = priced.nav == null || position.shares <= 0 ? null : round2(position.shares * priced.nav);
    const marketValue = sold ? (counted ? proceeds : 0) : openValue;
    const basis = sold ? proceeds : openValue;
    return {
      ...plan,
      ...position,
      nav: priced.nav,
      nav_source: priced.source,
      market_value: marketValue,
      proceeds,
      pnl: basis == null ? null : round2(basis - position.cost),
      sold,
      in_invest: sold ? counted : marketValue != null,
      cycle_label: plan.status === STOPPED ? "不再扣款" : cycleLabel(plan.cycle, plan.debit_day),
      status_label: statusLabel(plan),
      record_count: own.length,
    };
  });
}

export function parseImport(raw) {
  const lines = String(raw || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("没有可导入的记录");
  const split = (line) => line.split(/[,，\t]/).map((part) => part.trim());
  let columns = ["trade_date", "kind", "amount", "nav", "shares", "fee", "note"];
  let start = 0;
  const head = split(lines[0]);
  if (head.some((cell) => HEADER_MAP[cell])) {
    columns = head.map((cell) => HEADER_MAP[cell] || null);
    start = 1;
    if (!columns.includes("trade_date")) throw new Error("表头需要有「确认日期」或「日期」");
  }
  const parsed = [];
  const errors = [];
  for (let index = start; index < lines.length; index += 1) {
    const cells = split(lines[index]);
    const item = {};
    columns.forEach((key, column) => {
      if (key && item[key] == null) item[key] = cells[column] || "";
    });
    try {
      parsed.push(normalizeRecord(item));
    } catch (error) {
      errors.push(`第 ${index + 1} 行：${error.message}`);
    }
  }
  if (errors.length) throw new Error(errors.slice(0, 8).join("\n"));
  if (!parsed.length) throw new Error("没有可导入的记录");
  return parsed;
}

export function planFields(data) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("请填写基金名称");
  const symbol = normalizeSymbol(data.symbol);
  const amount = numberOrEmpty(data.amount, "每期金额");
  if (amount == null || amount <= 0) throw new Error("每期金额需要大于 0");
  const cycle = CYCLES.includes(data.cycle) ? data.cycle : "";
  if (!cycle) throw new Error("扣款周期不正确");
  const debitDay = Number(data.debit_day);
  const limit = cycle === "每月" ? 28 : 5;
  if (!Number.isInteger(debitDay) || debitDay < 1 || debitDay > limit) throw new Error("扣款日不在可选范围内");
  const status = normalizeStatus(data.status);
  const started = String(data.started_on || "").trim();
  if (started && !/^\d{4}-\d{2}-\d{2}$/.test(started)) throw new Error("开始日期请写成 YYYY-MM-DD");
  const manual = numberOrEmpty(data.manual_nav, "最新净值");
  if (manual != null && manual <= 0) throw new Error("最新净值需要大于 0");
  const stop = stopFields(status, data);
  return [name, symbol, round2(amount), cycle, debitDay, status, started || null, manual == null ? null : round4(manual), String(data.note || "").trim(), stop.stopped_on, stop.stop_reason];
}

export function stopFields(status, data) {
  if (status !== STOPPED) return { stopped_on: null, stop_reason: "" };
  const day = String(data.stopped_on || "").trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("停止日期请写成 YYYY-MM-DD");
  return { stopped_on: day, stop_reason: String(data.stop_reason || "").trim().slice(0, 80) };
}
