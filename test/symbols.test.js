import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGold, toSina, toYahoo } from "../src/symbols.js";

test("A share prefixes match the desktop rules", () => {
  assert.equal(toSina("600519"), "sh600519");
  assert.equal(toSina("000001"), "sz000001");
  assert.equal(toSina("513100"), "sh513100");
  assert.equal(toSina("159915"), "sz159915");
  assert.equal(toSina("830799"), "bj830799");
});

test("gold and US symbols are canonical", () => {
  assert.equal(canonicalGold("au(t+d)"), "Au(T+D)");
  assert.equal(toYahoo("brk.b"), "BRK-B");
});
