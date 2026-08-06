import { test } from "node:test";
import assert from "node:assert/strict";
import { startingDesign, refine, synthesizeStack, topHatCost, HARD_IR_NM } from "../js/synthesis.js";
import { stackTRA } from "../js/tmm.js";

test("startingDesign returns a chirped, alternating Ta2O5/SiO2 stack of the requested depth", () => {
  const N = 30;
  const layers = startingDesign({ startNm: 900, stopNm: 1300, outFraction: 0 }, { layers: N });
  assert.equal(layers.length, N);
  assert.ok(layers.every((l, i) => l.material === (i % 2 === 0 ? "Ta2O5" : "SiO2") && l.d_nm > 0));
});

test("topHatCost ignores the short-wave side but penalizes long-wave leakage", () => {
  const target = { startNm: 800, stopNm: 1200, outFraction: 0.05 };
  const grid = Float64Array.from([500, 1000, 2000]); // below-start, in-band, long-wave block band
  const leaky = Float64Array.from([1, 1, 1]);
  const blocked = Float64Array.from([1, 1, 0]);
  assert.ok(topHatCost(leaky, grid, target) > topHatCost(blocked, grid, target));
  // transmission below the passband (500 nm) must NOT affect the cost
  assert.equal(
    topHatCost(Float64Array.from([1, 1, 0]), grid, target),
    topHatCost(Float64Array.from([0, 1, 0]), grid, target),
  );
  // one-sided: at or below the out-of-band target is equally free
  assert.equal(
    topHatCost(Float64Array.from([1, 1, 0.0]), grid, target),
    topHatCost(Float64Array.from([1, 1, 0.05]), grid, target),
  );
});

test("topHatCost does not penalize leakage beyond the glass cutoff", () => {
  const target = { startNm: 800, stopNm: 1200, outFraction: 0 };
  const grid = Float64Array.from([1000, HARD_IR_NM + 500]);
  assert.equal(
    topHatCost(Float64Array.from([1, 1]), grid, target),
    topHatCost(Float64Array.from([1, 0]), grid, target),
  );
});

test("synthesized edge filter transmits across the passband and blocks the long-wave IR", () => {
  const t = { startNm: 900, stopNm: 1300, outFraction: 0 };
  const layers = synthesizeStack(t, { layers: 60 });
  assert.ok(layers.every((l) => l.d_nm > 0));
  const inb = stackTRA(layers, Float64Array.from([1000, 1150, 1280])).T;
  assert.ok(inb.every((x) => x > 0.4), `passband transmission too low: ${[...inb]}`);
  const blk = [];
  for (let l = 1400; l <= 2400; l += 50) blk.push(l);
  const Tb = stackTRA(layers, Float64Array.from(blk)).T;
  assert.ok(Math.min(...Tb) < 0.2, `expected deep long-wave blocking; min T=${Math.min(...Tb)}`);
});

test("refine never increases the cost relative to the starting design", () => {
  const t = { startNm: 1000, stopNm: 1300, outFraction: 0.02 };
  const start = startingDesign(t, { layers: 30 });
  const c0 = refine(start, t, { maxSweeps: 0 }).cost;
  const c1 = refine(start, t, { maxSweeps: 40 }).cost;
  assert.ok(c1 <= c0 + 1e-12, `refined cost ${c1} should be ≤ starting cost ${c0}`);
});

test("synthesis refuses a passband whose stop reaches the substrate cutoff", () => {
  // Regression: the block band [stop, hardIrNm] was empty, so topHatCost dropped its blocking term
  // and refine() optimized passband flatness alone while startingDesign built an unscored blocker.
  const target = { startNm: 3000, stopNm: 4000, outFraction: 0.001 };
  assert.throws(() => startingDesign(target, { layers: 20 }), RangeError);
  assert.throws(() => synthesizeStack(target, { layers: 20 }), RangeError);
  assert.throws(() => refine([{ material: "Ta2O5", d_nm: 100 }], target), RangeError);
  // exactly at the cutoff is still empty
  assert.throws(() => synthesizeStack({ ...target, stopNm: HARD_IR_NM }, { layers: 20 }), RangeError);
  // raising the cutoff makes the same target synthesizable
  assert.ok(synthesizeStack(target, { layers: 20, hardIrNm: 5000 }).length === 20);
});

test("topHatCost honors a context-supplied IR cutoff (non-N-BK7 substrates / extended range)", () => {
  const target = { startNm: 950, stopNm: 1400, outFraction: 0 };
  const grid = Float64Array.from([4500]); // between the default 3400 cutoff and an extended 5000 range
  const leak = Float64Array.from([1]);
  assert.equal(topHatCost(leak, grid, target, { hardIrNm: 3400 }), 0); // excluded by the default cutoff
  assert.ok(topHatCost(leak, grid, target, { hardIrNm: 5000 }) > 0); // penalized once the range extends
});
