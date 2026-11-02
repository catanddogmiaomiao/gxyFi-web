// 账户明细：导入、修改、删除，以及按明细重算余额快照。规则与 Windows 客户端 statement.py 一致。

const MAX_ROWS = 500;
const MAX_MAP = 12000;
const FINGERPRINT = /^[0-9a-z-]{8,48}$/;
const CLOCK = /^(\d{2}:\d{2}:\d{2})?$/;

function nowText() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function clip(value, max) {
  const cleaned = String(value ?? "").trim();
  if (cleaned.length > max) throw new Error("文字过长");
  return cleaned;
}

function day(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error("交易日期请写成 YYYY-MM-DD");
  return text;
}

function amount(value, label, required) {
  if (value == null || value === "") {
    if (required) throw new Error(`请填写${label}`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}无效`);
  return Math.round(parsed * 100) / 100;
}

export function txnFields(data) {
  const clock = String(data.txn_time || "");
  if (!CLOCK.test(clock)) throw new Error("交易时间请写成 HH:MM:SS");
  return {
    txn_date: day(data.txn_date),
    txn_time: clock,
    amount: amount(data.amount, "金额", true),
    balance: amount(data.balance, "余额", false),
    counterparty: clip(data.counterparty, 120),
    summary: clip(data.summary, 120),
    note: clip(data.note, 300),
  };
}

export function dailyBalances(txns, opening) {
  let running = Number(opening || 0);
  const out = new Map();
  for (const row of txns) {
    if (row.balance != null) running = Number(row.balance);
    else running = Math.round((running + Number(row.amount)) * 100) / 100;
    out.set(row.txn_date, Math.round(running * 100) / 100);
  }
  return out;
}

export function snapshotPoints(txns, opening) {
  const daily = dailyBalances(txns, opening);
  if (!daily.size) return [];
  const days = [...daily.keys()].sort();
  const picks = new Map();
  for (const item of days) picks.set(item.slice(0, 7), item);
  const chosen = new Set([...picks.values(), days[days.length - 1]]);
  return [...chosen].sort().map((item) => [item, daily.get(item)]);
}

function openingOf(account) {
  try {
    const value = JSON.parse(account?.import_map || "{}").opening;
    return value == null ? 0 : Number(value) || 0;
  } catch {
    return 0;
  }
}

async function account(db, userId, accountId) {
  const row = await db.prepare("SELECT id, import_map FROM accounts WHERE user_id=? AND id=?").bind(userId, Number(accountId)).first();
  if (!row) throw new Error("账户不存在");
  return row;
}

export async function rebuildBalances(db, userId, accountId) {
  const owner = await account(db, userId, accountId);
  const txns = (await db.prepare(
    "SELECT txn_date, amount, balance FROM account_txns WHERE user_id=? AND account_id=? ORDER BY txn_date, txn_time, id",
  ).bind(userId, owner.id).all()).results;
  const stamp = nowText();
  const statements = [
    db.prepare("DELETE FROM balance_entries WHERE user_id=? AND account_id=? AND source='明细'").bind(userId, owner.id),
  ];
  for (const [asOf, balance] of snapshotPoints(txns, openingOf(owner))) {
    statements.push(db.prepare(
      `INSERT INTO balance_entries(user_id, account_id, as_of_date, balance, note, source, created_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(user_id, account_id, as_of_date) DO UPDATE SET balance=excluded.balance, note=excluded.note, source=excluded.source`,
    ).bind(userId, owner.id, asOf, balance, "由明细生成", "明细", stamp));
  }
  await db.batch(statements);
}

function mapText(map) {
  if (map == null) return null;
  const text = JSON.stringify(map);
  if (text.length > MAX_MAP) throw new Error("映射设置过大");
  return text;
}

const TREATS = new Set(["", "支出", "退款", "不计", "转账"]);
const RULE_TREATS = new Set(["支出", "退款", "不计"]);
const RULE_FIELDS = new Set(["counterparty", "summary"]);

// 明细删掉时：由明细生成的支出一起删；合并过的手工支出只解除关联。
function unlinkStatements(db, userId, where, args) {
  return [
    db.prepare(`DELETE FROM expenses WHERE user_id=? AND source='明细' AND txn_id IN (SELECT id FROM account_txns WHERE user_id=? AND ${where})`).bind(userId, userId, ...args),
    db.prepare(`UPDATE expenses SET txn_id=NULL WHERE user_id=? AND txn_id IN (SELECT id FROM account_txns WHERE user_id=? AND ${where})`).bind(userId, userId, ...args),
  ];
}

export function unlinkAccount(db, userId, accountId) {
  return unlinkStatements(db, userId, "account_id=?", [accountId]);
}

function expensePayload(txn, treat) {
  const payee = (txn.counterparty || txn.summary || "").slice(0, 80);
  const note = treat === "退款" ? ("退款" + (txn.summary ? " · " + txn.summary : "")).slice(0, 300) : (txn.summary || "").slice(0, 300);
  return { amount: Math.round(-Number(txn.amount) * 100) / 100, payee, note };
}

async function classify(db, userId, data, stamp) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 500) throw new Error("一次最多归类 500 笔");
  const categories = new Set((await db.prepare("SELECT id FROM expense_categories WHERE user_id=?").bind(userId).all()).results.map((row) => row.id));
  const ids = items.map((item) => Number(item.id));
  const txns = new Map();
  for (let start = 0; start < ids.length; start += 90) {
    const part = ids.slice(start, start + 90);
    const marks = part.map(() => "?").join(",");
    (await db.prepare(`SELECT * FROM account_txns WHERE user_id=? AND id IN (${marks})`).bind(userId, ...part).all()).results.forEach((row) => txns.set(row.id, row));
  }
  const mergeIds = items.map((item) => Number(item.expense_id || 0)).filter(Boolean);
  const manual = new Map();
  for (let start = 0; start < mergeIds.length; start += 90) {
    const part = mergeIds.slice(start, start + 90);
    const marks = part.map(() => "?").join(",");
    (await db.prepare(`SELECT id, category_id, txn_id FROM expenses WHERE user_id=? AND id IN (${marks})`).bind(userId, ...part).all()).results.forEach((row) => manual.set(row.id, row));
  }
  const statements = [];
  const used = new Set();
  for (const item of items) {
    const treat = String(item.treat ?? "");
    if (!TREATS.has(treat)) throw new Error("归类无效");
    const txn = txns.get(Number(item.id));
    if (!txn) throw new Error("明细不存在");
    if (treat === "支出" && Number(txn.amount) >= 0) throw new Error("收入不能归为支出");
    if (treat === "退款" && Number(txn.amount) <= 0) throw new Error("只有收入能记为退款");
    statements.push(...unlinkStatements(db, userId, "id=?", [txn.id]));
    let categoryId = null;
    const mergeId = Number(item.expense_id || 0);
    if (treat === "支出" && mergeId) {
      const target = manual.get(mergeId);
      if (!target || (target.txn_id && target.txn_id !== txn.id) || used.has(mergeId)) throw new Error("要合并的手工支出不存在或已经合并过");
      used.add(mergeId);
      categoryId = target.category_id;
      statements.push(db.prepare("UPDATE expenses SET txn_id=? WHERE user_id=? AND id=?").bind(txn.id, userId, mergeId));
    } else if (treat === "支出" || treat === "退款") {
      categoryId = Number(item.category_id);
      if (!categories.has(categoryId)) throw new Error("请选择支出类别");
      const payload = expensePayload(txn, treat);
      statements.push(db.prepare(
        "INSERT INTO expenses(user_id, category_id, occurred_on, amount, payee, note, source, txn_id, created_at) VALUES(?,?,?,?,?,?,'明细',?,?)",
      ).bind(userId, categoryId, txn.txn_date, payload.amount, payload.payee, payload.note, txn.id, stamp));
    }
    statements.push(db.prepare("UPDATE account_txns SET treat=?, category_id=?, updated_at=? WHERE user_id=? AND id=?").bind(treat, categoryId, stamp, userId, txn.id));
  }
  const rules = Array.isArray(data.rules) ? data.rules.slice(0, 200) : [];
  for (const rule of rules) {
    const field = String(rule.field || "");
    const keyword = clip(rule.keyword, 40);
    const treat = String(rule.treat || "");
    if (!RULE_FIELDS.has(field) || !keyword || !RULE_TREATS.has(treat)) continue;
    const categoryId = treat === "不计" ? null : Number(rule.category_id);
    if (treat !== "不计" && !categories.has(categoryId)) continue;
    statements.push(db.prepare(
      `INSERT INTO txn_rules(user_id, field, keyword, treat, category_id, created_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id, field, keyword) DO UPDATE SET treat=excluded.treat, category_id=excluded.category_id`,
    ).bind(userId, field, keyword, treat, categoryId, stamp));
  }
  for (let start = 0; start < statements.length; start += 100) await db.batch(statements.slice(start, start + 100));
  return { classified: items.length };
}

async function count(db, userId, accountId) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM account_txns WHERE user_id=? AND account_id=?").bind(userId, accountId).first()).n;
}

export async function mutateTxns(db, userId, entity, op, data, id) {
  const stamp = nowText();
  if (entity === "account_map") {
    const owner = await account(db, userId, id);
    await db.prepare("UPDATE accounts SET import_map=? WHERE user_id=? AND id=?").bind(mapText(data.map) || "", userId, owner.id).run();
    await rebuildBalances(db, userId, owner.id);
    return {};
  }

  if (entity === "txn_import") {
    const owner = await account(db, userId, data.account_id);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length > MAX_ROWS) throw new Error("一次最多导入 500 笔");
    const batch = clip(data.batch, 80);
    const cleaned = rows.map((row) => {
      const fingerprint = String(row.fingerprint || "");
      if (!FINGERPRINT.test(fingerprint)) throw new Error("明细数据无效");
      return { ...txnFields(row), fingerprint };
    });
    if (data.map !== undefined) {
      await db.prepare("UPDATE accounts SET import_map=? WHERE user_id=? AND id=?").bind(mapText(data.map) || "", userId, owner.id).run();
    }
    const before = await count(db, userId, owner.id);
    for (let start = 0; start < cleaned.length; start += 100) {
      await db.batch(cleaned.slice(start, start + 100).map((row) => db.prepare(
        `INSERT INTO account_txns(user_id, account_id, txn_date, txn_time, amount, balance, counterparty, summary, note, fingerprint, batch, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id, account_id, fingerprint) DO NOTHING`,
      ).bind(userId, owner.id, row.txn_date, row.txn_time, row.amount, row.balance, row.counterparty, row.summary, row.note, row.fingerprint, batch, stamp, stamp)));
    }
    const added = (await count(db, userId, owner.id)) - before;
    if (data.final !== false) await rebuildBalances(db, userId, owner.id);
    return { added, skipped: cleaned.length - added };
  }

  if (entity === "txn_classify") return classify(db, userId, data, stamp);

  if (entity === "txn_rule") {
    if (op !== "delete") throw new Error("规则只能在归类时记住");
    const ids = (Array.isArray(data.ids) ? data.ids : [id]).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) throw new Error("请选择要删除的规则");
    await db.prepare(`DELETE FROM txn_rules WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`).bind(userId, ...ids).run();
    return {};
  }

  if (entity === "txn") {
    if (op === "delete") {
      const ids = (Array.isArray(data.ids) ? data.ids : [id]).map(Number).filter(Number.isInteger).slice(0, 2000);
      if (!ids.length) throw new Error("请选择要删除的明细");
      const touched = new Set();
      for (let start = 0; start < ids.length; start += 90) {
        const part = ids.slice(start, start + 90);
        const marks = part.map(() => "?").join(",");
        const owners = (await db.prepare(`SELECT DISTINCT account_id FROM account_txns WHERE user_id=? AND id IN (${marks})`).bind(userId, ...part).all()).results;
        owners.forEach((row) => touched.add(row.account_id));
        await db.batch([
          ...unlinkStatements(db, userId, `id IN (${marks})`, part),
          db.prepare(`DELETE FROM account_txns WHERE user_id=? AND id IN (${marks})`).bind(userId, ...part),
        ]);
      }
      for (const accountId of touched) await rebuildBalances(db, userId, accountId);
      return {};
    }
    const fields = txnFields(data);
    if (op === "update") {
      const current = await db.prepare("SELECT account_id FROM account_txns WHERE user_id=? AND id=?").bind(userId, Number(id)).first();
      if (!current) throw new Error("记录不存在");
      await db.prepare(
        "UPDATE account_txns SET txn_date=?, txn_time=?, amount=?, balance=?, counterparty=?, summary=?, note=?, updated_at=? WHERE user_id=? AND id=?",
      ).bind(fields.txn_date, fields.txn_time, fields.amount, fields.balance, fields.counterparty, fields.summary, fields.note, stamp, userId, Number(id)).run();
      const updated = await db.prepare("SELECT * FROM account_txns WHERE user_id=? AND id=?").bind(userId, Number(id)).first();
      const payload = expensePayload(updated, updated.treat);
      await db.prepare("UPDATE expenses SET occurred_on=?, amount=?, payee=? WHERE user_id=? AND txn_id=? AND source='明细'")
        .bind(updated.txn_date, payload.amount, payload.payee, userId, updated.id).run();
      await rebuildBalances(db, userId, current.account_id);
      return {};
    }
    const owner = await account(db, userId, data.account_id);
    await db.prepare(
      `INSERT INTO account_txns(user_id, account_id, txn_date, txn_time, amount, balance, counterparty, summary, note, fingerprint, batch, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, owner.id, fields.txn_date, fields.txn_time, fields.amount, fields.balance, fields.counterparty, fields.summary, fields.note, `m-${crypto.randomUUID()}`, "手工补录", stamp, stamp).run();
    await rebuildBalances(db, userId, owner.id);
    return {};
  }

  if (entity === "txn_batch") {
    const owner = await account(db, userId, data.account_id);
    const batch = clip(data.batch, 80);
    await db.batch([
      ...unlinkStatements(db, userId, "account_id=? AND batch=?", [owner.id, batch]),
      db.prepare("DELETE FROM account_txns WHERE user_id=? AND account_id=? AND batch=?").bind(userId, owner.id, batch),
    ]);
    await rebuildBalances(db, userId, owner.id);
    return {};
  }
  return null;
}

export async function txnRev(db, userId) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m, COALESCE(MAX(updated_at), '') AS u FROM account_txns WHERE user_id=?",
  ).bind(userId).first();
  return `${row.n}-${row.m}-${row.u}`;
}

export async function listTxns(db, userId, accountId, limit) {
  const columns = "id, account_id, txn_date, txn_time, amount, balance, counterparty, summary, note, fingerprint, batch, treat, category_id, created_at, updated_at";
  if (accountId) {
    return (await db.prepare(
      `SELECT ${columns} FROM account_txns WHERE user_id=? AND account_id=? ORDER BY txn_date DESC, txn_time DESC, id DESC LIMIT ?`,
    ).bind(userId, Number(accountId), Math.min(Number(limit) || 300, 5000)).all()).results;
  }
  return (await db.prepare(`SELECT ${columns} FROM account_txns WHERE user_id=? ORDER BY account_id, txn_date, txn_time, id`).bind(userId).all()).results;
}
