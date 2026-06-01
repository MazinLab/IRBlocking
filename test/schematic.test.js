// test/schematic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLayout, fmtT } from "../js/schematic.js";
import { defaultState } from "../js/state.js";

test("fmtT formats sub-kelvin as mK and >=1 K as K", () => {
  assert.equal(fmtT(0.8), "800 mK");
  assert.equal(fmtT(4), "4 K");
  assert.equal(fmtT(300), "300 K");
});

test("computeLayout orders planes left(source)→right(pixel) by distance", () => {
  const L = computeLayout(defaultState());
  const xs = L.planes.map((p) => p.x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], "x increases source→stage3");
  assert.ok(L.planes[L.planes.length - 1].x < L.pixelX, "pixel is right of stage 3");
});

test("computeLayout marks the smallest-angular-radius aperture as the limiting stop", () => {
  const s = defaultState();
  s.stages[1].D_mm = 6; // make stage 2 clearly the smallest angular radius
  const L = computeLayout(s);
  assert.equal(L.coldStopKey, "stage2");
});
