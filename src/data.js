import { applyPosition, normalizeRecord, parseImport, planFields, valuePlans } from "./dca.js";
import { mutateTxns, rebuildBalances, txnRev, unlinkAccount } from "./txns.js";

const TXN_ENTITIES = new Set(["account_map", "txn_import", "txn", "txn_batch", "txn_classify", "txn_rule"]);

const CATEGORIES = ["居住", "餐饮", "交通", "教育", "医疗", "保险", "日用", "人情", "娱乐", "其他"];
const KINDS = ["现金", "活期", "定期", "货币基金", "公积金", "其他"];
const PROPERTY_KINDS = ["住宅", "商铺", "车位", "土地", "其他"];
const CURRENCIES = ["CNY", "USD", "HKD"];
const MARKETS = ["US", "A", "GOLD", "OTHER"];

export function nowText() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function text(value, max, fallback = "") {
  const cleaned = String(value ?? fallback).trim();
  if (cleaned.length > max) throw new Error("文字过长");
  return cleaned;
}

function requiredText(value, label, max) {
  const cleaned = text(value, max);
  if (!cleaned) throw new Error(`请填写${label}`);
  return cleaned;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("数字无效");
  return parsed;
}

function money(value, label, { required = false, allowNegative = false, allowZero = true } = {}) {
  const parsed = numberOrNull(value);
  if (parsed == null) {
    if (required) throw new Error(`请填写${label}`);
    return null;
  }
  if (!allowNegative && parsed < 0) throw new Error(`${label}不能为负数`);
  if (!allowZero && parsed === 0) throw new Error(`${label}需要大于 0`);
  return Math.round(parsed * 10000) / 10000;
}

function day(value, label, required = false) {
  if (value == null || value === "") {
    if (required) throw new Error(`请填写${label}`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label}请写成 YYYY-MM-DD`);
  }
  return String(value);
}

function oneOf(value, allowed, fallback) {
  const picked = value || fallback;
  if (!allowed.includes(picked)) throw new Error("选项无效");
  return picked;
}

export async function ensureCategories(db, userId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM expense_categories WHERE user_id=?").bind(userId).first();
  if (row.n) return;
  for (let index = 0; index < CATEGORIES.length; index += 1) {
    await db.prepare("INSERT INTO expense_categories(user_id, name, sort_order) VALUES(?, ?, ?)").bind(userId, CATEGORIES[index], index).run();
  }
}

async function owned(db, sql, ...args) {
  const row = await db.prepare(sql).bind(...args).first();
  if (!row) throw new Error("记录不存在");
  return row;
}

export async function mutate(db, userId, body) {
  const entity = body?.entity;
  const op = body?.op;
  const data = body?.data || {};
  const id = body?.id;
  const stamp = nowText();

  if (TXN_ENTITIES.has(entity)) return mutateTxns(db, userId, entity, op, data, id);

  if (entity === "account") {
    if (op === "delete") {
      await owned(db, "SELECT id FROM accounts WHERE user_id=? AND id=?", userId, id);
      await db.batch(unlinkAccount(db, userId, Number(id)));
      await db.prepare("DELETE FROM account_txns WHERE user_id=? AND account_id=?").bind(userId, id).run();
      await db.prepare("DELETE FROM balance_entries WHERE user_id=? AND account_id=?").bind(userId, id).run();
      await db.prepare("DELETE FROM accounts WHERE user_id=? AND id=?").bind(userId, id).run();
      return;
    }
    const fields = [
      requiredText(data.name, "账户名称", 80),
      text(data.institution, 80),
      oneOf(data.kind, KINDS, "活期"),
      oneOf(data.currency, CURRENCIES, "CNY"),
      text(data.note, 300),
    ];
    if (op === "update") {
      await owned(db, "SELECT id FROM accounts WHERE user_id=? AND id=?", userId, id);
      await db.prepare("UPDATE accounts SET name=?, institution=?, kind=?, currency=?, note=? WHERE user_id=? AND id=?").bind(...fields, userId, id).run();
      return;
    }
    await db.prepare("INSERT INTO accounts(user_id, name, institution, kind, currency, note, created_at) VALUES(?,?,?,?,?,?,?)").bind(userId, ...fields, stamp).run();
    return;
  }

  if (entity === "balance") {
    if (op === "delete") {
      const row = await db.prepare("SELECT account_id FROM balance_entries WHERE user_id=? AND id=?").bind(userId, id).first();
      if (!row) throw new Error("记录不存在");
      await db.prepare("DELETE FROM balance_entries WHERE user_id=? AND id=?").bind(userId, id).run();
      await rebuildBalances(db, userId, row.account_id);
      return;
    }
    const accountId = Number(data.account_id);
    await owned(db, "SELECT id FROM accounts WHERE user_id=? AND id=?", userId, accountId);
    const asOf = day(data.as_of_date, "日期", true);
    const balance = money(data.balance, "余额", { required: true, allowNegative: true });
    const note = text(data.note, 300);
    await db.prepare(
      `INSERT INTO balance_entries(user_id, account_id, as_of_date, balance, note, source, created_at)
       VALUES(?,?,?,?,?,'手工',?)
       ON CONFLICT(user_id, account_id, as_of_date) DO UPDATE SET balance=excluded.balance, note=excluded.note, source='手工'`,
    ).bind(userId, accountId, asOf, balance, note, stamp).run();
    await rebuildBalances(db, userId, accountId);
    return;
  }

  if (entity === "holding") {
    if (op === "delete") {
      await owned(db, "SELECT id FROM holdings WHERE user_id=? AND id=?", userId, id);
      await db.prepare("DELETE FROM holdings WHERE user_id=? AND id=?").bind(userId, id).run();
      return;
    }
    const market = oneOf(data.market, MARKETS, "OTHER");
    let currency = oneOf(data.currency, CURRENCIES, "CNY");
    if (market === "US") currency = "USD";
    if (market === "A" || market === "GOLD") currency = "CNY";
    const { canonicalSymbol } = await import("./symbols.js");
    const symbol = canonicalSymbol(market, data.symbol);
    const name = text(data.name, 80) || symbol;
    const quantity = money(data.quantity, "数量", { required: true, allowZero: false });
    const fields = [name, symbol, market, quantity, currency, money(data.avg_cost, "成本价"), money(data.manual_price, "手工现价"), text(data.account_label, 80), text(data.note, 300)];
    if (op === "update") {
      await owned(db, "SELECT id FROM holdings WHERE user_id=? AND id=?", userId, id);
      await db.prepare("UPDATE holdings SET name=?, symbol=?, market=?, quantity=?, currency=?, avg_cost=?, manual_price=?, account_label=?, note=? WHERE user_id=? AND id=?").bind(...fields, userId, id).run();
      return;
    }
    await db.prepare("INSERT INTO holdings(user_id, name, symbol, market, quantity, currency, avg_cost, manual_price, account_label, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(userId, ...fields, stamp).run();
    return;
  }

  if (entity === "property") {
    if (op === "delete") {
      await owned(db, "SELECT id FROM properties WHERE user_id=? AND id=?", userId, id);
      await db.prepare("DELETE FROM properties WHERE user_id=? AND id=?").bind(userId, id).run();
      return;
    }
    let valuedOn = day(data.valued_on, "估值日");
    const currentValue = money(data.current_value, "现值");
    if (currentValue != null && !valuedOn) valuedOn = stamp.slice(0, 10);
    const fields = [
      requiredText(data.name, "名称", 80),
      oneOf(data.kind, PROPERTY_KINDS, "住宅"),
      text(data.city, 40),
      text(data.address, 120),
      money(data.area_sqm, "面积"),
      day(data.acquired_on, "购入日"),
      money(data.purchase_price, "购入价"),
      currentValue,
      valuedOn,
      money(data.mortgage_balance, "贷款余额") || 0,
      money(data.monthly_rent, "月租金") || 0,
      text(data.note, 300),
    ];
    if (op === "update") {
      await owned(db, "SELECT id FROM properties WHERE user_id=? AND id=?", userId, id);
      await db.prepare("UPDATE properties SET name=?, kind=?, city=?, address=?, area_sqm=?, acquired_on=?, purchase_price=?, current_value=?, valued_on=?, mortgage_balance=?, monthly_rent=?, note=? WHERE user_id=? AND id=?").bind(...fields, userId, id).run();
      return;
    }
    await db.prepare("INSERT INTO properties(user_id, name, kind, city, address, area_sqm, acquired_on, purchase_price, current_value, valued_on, mortgage_balance, monthly_rent, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(userId, ...fields, stamp).run();
    return;
  }

  if (entity === "category") {
    const name = requiredText(data.name, "类别名称", 40);
    const order = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM expense_categories WHERE user_id=?").bind(userId).first();
    try {
      await db.prepare("INSERT INTO expense_categories(user_id, name, sort_order) VALUES(?,?,?)").bind(userId, name, order.n).run();
    } catch {
      throw new Error("这个类别已经存在");
    }
    return;
  }

  if (entity === "expense") {
    if (op === "delete") {
      const current = await owned(db, "SELECT id, txn_id FROM expenses WHERE user_id=? AND id=?", userId, id);
      await db.prepare("DELETE FROM expenses WHERE user_id=? AND id=?").bind(userId, id).run();
      if (current.txn_id) {
        await db.prepare("UPDATE account_txns SET treat='不计', category_id=NULL, updated_at=? WHERE user_id=? AND id=?").bind(stamp, userId, current.txn_id).run();
      }
      return;
    }
    const categoryId = Number(data.category_id);
    await owned(db, "SELECT id FROM expense_categories WHERE user_id=? AND id=?", userId, categoryId);
    const fields = [categoryId, day(data.occurred_on, "日期", true), money(data.amount, "金额", { required: true, allowZero: false }), text(data.payee, 80), text(data.note, 300)];
    if (op === "update") {
      const current = await owned(db, "SELECT id, txn_id FROM expenses WHERE user_id=? AND id=?", userId, id);
      await db.prepare("UPDATE expenses SET category_id=?, occurred_on=?, amount=?, payee=?, note=? WHERE user_id=? AND id=?").bind(...fields, userId, id).run();
      if (current.txn_id) {
        await db.prepare("UPDATE account_txns SET category_id=?, updated_at=? WHERE user_id=? AND id=?").bind(categoryId, stamp, userId, current.txn_id).run();
      }
      return;
    }
    await db.prepare("INSERT INTO expenses(user_id, category_id, occurred_on, amount, payee, note, created_at) VALUES(?,?,?,?,?,?,?)").bind(userId, ...fields, stamp).run();
    return;
  }

  if (entity === "budget") {
    const year = Number(data.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("年份无效");
    const categoryId = Number(data.category_id);
    await owned(db, "SELECT id FROM expense_categories WHERE user_id=? AND id=?", userId, categoryId);
    const amount = money(data.amount, "预算", { required: true });
    await db.prepare(
      `INSERT INTO budget_lines(user_id, year, category_id, amount, note)
       VALUES(?,?,?,?,?)
       ON CONFLICT(user_id, year, category_id) DO UPDATE SET amount=excluded.amount, note=excluded.note`,
    ).bind(userId, year, categoryId, amount, text(data.note, 300)).run();
    return;
  }

  if (entity === "dca_plan") {
    if (op === "delete") {
      await owned(db, "SELECT id FROM dca_plans WHERE user_id=? AND id=?", userId, id);
      await db.prepare("DELETE FROM dca_records WHERE user_id=? AND plan_id=?").bind(userId, id).run();
      await db.prepare("DELETE FROM dca_plans WHERE user_id=? AND id=?").bind(userId, id).run();
      return;
    }
    const fields = planFields(data);
    if (op === "update") {
      await owned(db, "SELECT id FROM dca_plans WHERE user_id=? AND id=?", userId, id);
      await db.prepare("UPDATE dca_plans SET name=?, symbol=?, amount=?, cycle=?, debit_day=?, status=?, started_on=?, manual_nav=?, note=? WHERE user_id=? AND id=?").bind(...fields, userId, id).run();
      return;
    }
    await db.prepare("INSERT INTO dca_plans(user_id, name, symbol, amount, cycle, debit_day, status, started_on, manual_nav, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(userId, ...fields, stamp).run();
    return;
  }

  if (entity === "dca_record" || entity === "dca_import") {
    const planId = Number(data.plan_id || 0);
    if (entity === "dca_record" && op === "delete") {
      const current = await owned(db, "SELECT * FROM dca_records WHERE user_id=? AND id=?", userId, id);
      const existing = (await db.prepare("SELECT * FROM dca_records WHERE user_id=? AND plan_id=? ORDER BY trade_date, id").bind(userId, current.plan_id).all()).results;
      applyPosition(existing.filter((row) => row.id !== Number(id)));
      await db.prepare("DELETE FROM dca_records WHERE user_id=? AND id=?").bind(userId, id).run();
      return;
    }
    await owned(db, "SELECT id FROM dca_plans WHERE user_id=? AND id=?", userId, planId);
    const existing = (await db.prepare("SELECT * FROM dca_records WHERE user_id=? AND plan_id=? ORDER BY trade_date, id").bind(userId, planId).all()).results;
    if (entity === "dca_import") {
      const incoming = parseImport(data.text);
      applyPosition(existing.concat(incoming.map((row, index) => ({ ...row, id: 10 ** 12 + index }))));
      for (const row of incoming) {
        await db.prepare("INSERT INTO dca_records(user_id, plan_id, kind, trade_date, amount, nav, shares, fee, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(
          userId, planId, row.kind, row.trade_date, row.amount, row.nav, row.shares, row.fee, row.note, stamp,
        ).run();
      }
      return;
    }
    const normalized = normalizeRecord(data);
    const draft = [];
    let replaced = op !== "update";
    for (const row of existing) {
      if (op === "update" && row.id === Number(id)) {
        draft.push({ ...normalized, id: Number(id) });
        replaced = true;
      } else {
        draft.push(row);
      }
    }
    if (op === "update" && !replaced) throw new Error("记录不存在");
    if (op !== "update") draft.push({ ...normalized, id: 10 ** 12 });
    applyPosition(draft);
    const fields = [planId, normalized.kind, normalized.trade_date, normalized.amount, normalized.nav, normalized.shares, normalized.fee, normalized.note];
    if (op === "update") {
      await db.prepare("UPDATE dca_records SET plan_id=?, kind=?, trade_date=?, amount=?, nav=?, shares=?, fee=?, note=? WHERE user_id=? AND id=?").bind(...fields, userId, id).run();
      return;
    }
    await db.prepare("INSERT INTO dca_records(user_id, plan_id, kind, trade_date, amount, nav, shares, fee, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(userId, ...fields, stamp).run();
    return;
  }

  if (entity === "fx") {
    const code = oneOf(data.code, ["USD", "HKD"]);
    const rate = money(data.rate, "汇率", { required: true, allowZero: false });
    await db.prepare(
      `INSERT INTO fx_rates(user_id, code, rate, source, quoted_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(user_id, code) DO UPDATE SET rate=excluded.rate, source=excluded.source, quoted_at=excluded.quoted_at`,
    ).bind(userId, code, rate, "手工", stamp).run();
    return;
  }

  throw new Error("不支持的操作");
}

export async function loadState(db, userId) {
  await ensureCategories(db, userId);
  const all = async (sql) => (await db.prepare(sql).bind(userId).all()).results;
  const dcaRecords = await all("SELECT * FROM dca_records WHERE user_id=? ORDER BY trade_date, id");
  const dcaPlans = valuePlans(await all("SELECT * FROM dca_plans WHERE user_id=? ORDER BY status, symbol, id"), dcaRecords);
  return {
    accounts: await all("SELECT * FROM accounts WHERE user_id=? ORDER BY id"),
    balances: await all("SELECT * FROM balance_entries WHERE user_id=? ORDER BY as_of_date DESC, id DESC"),
    holdings: await all("SELECT * FROM holdings WHERE user_id=? ORDER BY market, symbol, id"),
    quotes: await all("SELECT * FROM quotes WHERE user_id=? ORDER BY market, symbol"),
    properties: await all("SELECT * FROM properties WHERE user_id=? ORDER BY id"),
    categories: await all("SELECT * FROM expense_categories WHERE user_id=? ORDER BY sort_order, id"),
    expenses: await all(
      `SELECT e.*, c.name AS category
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id AND c.user_id = e.user_id
       WHERE e.user_id=? ORDER BY e.occurred_on DESC, e.id DESC`,
    ),
    budgets: await all("SELECT * FROM budget_lines WHERE user_id=? ORDER BY year, category_id"),
    fx: await all("SELECT * FROM fx_rates WHERE user_id=? ORDER BY code"),
    dcaPlans,
    dcaRecords,
    txnRules: await all("SELECT id, field, keyword, treat, category_id, created_at FROM txn_rules WHERE user_id=? ORDER BY id"),
    txnRev: await txnRev(db, userId),
  };
}
