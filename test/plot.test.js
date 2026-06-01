// test/plot.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { niceTicks, decadeTicks } from "../js/plot.js";

test("niceTicks returns rounded, ascending, in-range ticks", () => {
  const t = niceTicks(400, 5000, 5);
  assert.ok(t.length >= 3);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
  assert.ok(t[0] >= 400 - 1e-9 && t[t.length - 1] <= 5000 + 1e-9);
});

test("decadeTicks returns powers of ten spanning the positive range", () => {
  const t = decadeTicks(0.05, 9000);
  assert.deepEqual(t, [0.1, 1, 10, 100, 1000]);
});

test("decadeTicks handles a non-positive lower bound by using the max only", () => {
  const t = decadeTicks(0, 50);
  assert.ok(t.every((x) => x > 0) && t[t.length - 1] <= 100);
});
