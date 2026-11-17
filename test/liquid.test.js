import test from "node:test";
import assert from "node:assert/strict";
import { investSnapshot, liquidTrend, sampleDays } from "../src/liquid.js";
import { valuePlans } from "../src/dca.js";

test("spans cover a week, month, year and decade", () => {
  assert.equal(sampleDays("week", "2026-11-17")[0], "2026-11-11");
  assert.equal(sampleDays("week", "2026-11-17").at(-1), "2026-11-17");
  assert.equal(sampleDays("month", "2026-11-17").length, 30);
  const year = sampleDays("year", "2026-11-17");
  assert.equal(year.length, 12);
  assert.equal(year.at(-1), "2026-11-17");
  assert.equal(year.at(-2), "2026-10-31");
  const decade = sampleDays("decade", "2026-11-17");
  assert.equal(decade.length, 10);
  assert.equal(decade[0], "2017-12-31");
  assert.equal(decade.at(-1), "2026-11-17");
});

test("savings carry forward and investments start on the first snapshot", () => {
  const trend = liquidTrend({
    span: "month",
    today: "2026-11-17",
    accounts: [{ id: 1, name: "工资卡", currency: "CNY" }],
    balances: [
      { id: 1, account_id: 1, as_of_date: "2026-10-01", balance: 100 },
      { id: 2, account_id: 1, as_of_date: "2026-11-10", balance: 400 },
    ],
    rates: {},
    liquidDays: [
      { day: "2026-11-10", invest_cny: 50, parts_json: JSON.stringify([{ name: "黄金", group: "投资", amount: 50 }]) },
      { day: "2026-11-17", invest_cny: 80, parts_json: JSON.stringify([{ name: "黄金", group: "投资", amount: 80 }]) },
    ],
  });
  const byDay = Object.fromEntries(trend.points.map((point) => [point.day, point]));
  assert.equal(byDay["2026-11-09"].savings, 100);
  assert.equal(byDay["2026-11-09"].invest, null);
  assert.equal(byDay["2026-11-10"].savings, 400);
  assert.equal(byDay["2026-11-10"].total, 450);
  assert.equal(byDay["2026-11-17"].savings, 400);
  assert.equal(byDay["2026-11-17"].invest, 80);
});

test("sold holding is left out unless it still counts", () => {
  const plans = valuePlans([{ id: 1, name: "沪深300", symbol: "000300", cycle: "每月", debit_day: 8, sell_price: 1.2, count_invested: 0, status: "进行中" }], [
    { id: 1, plan_id: 1, kind: "定投", trade_date: "2026-05-08", amount: 300, nav: 1, shares: 300, fee: 0 },
  ]);
  const leftOut = investSnapshot([], plans, [], {});
  assert.equal(leftOut.invest_cny, 0);
  plans[0].count_invested = 1;
  plans[0].in_invest = true;
  plans[0].market_value = 360;
  const kept = investSnapshot(
    [{ name: "黄金", symbol: "Au(T+D)", market: "GOLD", quantity: 10, currency: "CNY", avg_cost: 800, manual_price: 850, sell_price: 900, count_invested: 1 }],
    plans,
    [],
    {},
  );
  assert.equal(kept.invest_cny, 9000 + 360);
});
