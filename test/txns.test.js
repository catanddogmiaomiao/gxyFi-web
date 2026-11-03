import assert from "node:assert/strict";
import test from "node:test";

import { snapshotPoints, txnFields } from "../src/txns.js";

test("明细生成每月月末和最后一天的余额", () => {
  const withBalance = [
    { txn_date: "2026-09-15", amount: 1000, balance: 1900 },
    { txn_date: "2026-09-30", amount: -200, balance: 1700 },
    { txn_date: "2026-10-08", amount: -100, balance: 1600 },
  ];
  assert.deepEqual(snapshotPoints(withBalance, null), [["2026-09-30", 1700], ["2026-10-08", 1600]]);
  const noBalance = [
    { txn_date: "2026-10-01", amount: 500, balance: null },
    { txn_date: "2026-10-02", amount: -35, balance: null },
  ];
  assert.deepEqual(snapshotPoints(noBalance, 1000), [["2026-10-02", 1465]]);
  assert.deepEqual(snapshotPoints(noBalance, 0, [["2026-09-30", -1000]]), [["2026-10-02", -535]]);
  assert.deepEqual(snapshotPoints([], 0), []);
});

test("明细字段校验", () => {
  assert.equal(txnFields({ txn_date: "2026-10-01", amount: "-35.004" }).amount, -35);
  assert.throws(() => txnFields({ txn_date: "2026/10/01", amount: 1 }));
  assert.throws(() => txnFields({ txn_date: "2026-10-01", amount: 1, txn_time: "9:00" }));
});
