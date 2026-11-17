import test from "node:test";
import assert from "node:assert/strict";
import { applyPosition, normalizeRecord, normalizeSymbol, parseImport, valuePlans } from "../src/dca.js";

test("fund symbol keeps leading zeros", () => {
  assert.equal(normalizeSymbol("20"), "000020");
});

test("installments, redemption and dividend reinvestment", () => {
  const opening = normalizeRecord({ kind: "期初", trade_date: "2026-01-01", amount: 100, shares: 100, nav: 1 });
  const buy = normalizeRecord({ kind: "定投", trade_date: "2026-02-08", amount: 200, nav: 2 });
  assert.equal(buy.shares, 100);
  const sell = normalizeRecord({ kind: "赎回", trade_date: "2026-03-01", amount: 160, shares: 100, nav: 1.6 });
  const dividend = normalizeRecord({ kind: "红利再投", trade_date: "2026-03-15", amount: 10, shares: 10, nav: 1.5 });
  const position = applyPosition([
    { ...opening, id: 1 },
    { ...buy, id: 2 },
    { ...sell, id: 3 },
    { ...dividend, id: 4 },
  ]);
  assert.equal(position.shares, 110);
  assert.equal(position.cost, 150);
  const [plan] = valuePlans([{ id: 7, cycle: "每月", debit_day: 8, manual_nav: null }], [
    { ...opening, id: 1, plan_id: 7 },
    { ...buy, id: 2, plan_id: 7 },
    { ...sell, id: 3, plan_id: 7 },
    { ...dividend, id: 4, plan_id: 7 },
  ]);
  assert.equal(plan.market_value, 165);
});

test("pasted history uses header names", () => {
  const rows = parseImport("确认日期,类型,扣款金额,确认净值,确认份额\n2026-04-08,定投,100,2,\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 50);
});

test("stopped plan blocks later DCA but keeps redemptions", async () => {
  const { checkRecordAllowed, checkStop, planFields } = await import("../src/dca.js");
  const plan = { name: "沪深300", status: "已停止", stopped_on: "2026-06-30" };
  assert.throws(() => checkRecordAllowed(plan, { kind: "定投", trade_date: "2026-07-05" }));
  checkRecordAllowed(plan, { kind: "定投", trade_date: "2026-06-30" });
  checkRecordAllowed(plan, { kind: "赎回", trade_date: "2026-09-01" });
  assert.throws(() => checkStop("2026-05-01", [{ kind: "定投", trade_date: "2026-06-01" }]));
  const fields = planFields({ name: "A", symbol: "000001", amount: "100", cycle: "每月", debit_day: "8", status: "已结束", stopped_on: "2026-01-02" });
  assert.equal(fields[5], "已停止");
  assert.equal(fields[9], "2026-01-02");
});
