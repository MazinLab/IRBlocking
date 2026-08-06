// test/state.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultState, validate, buildGridNm } from "../js/state.js";

test("defaultState matches the spec defaults", () => {
  const s = defaultState();
  assert.equal(s.source.T, 280);
  assert.deepEqual(s.stages.map((x) => x.T), [65, 3.5, 0.8]);
  assert.deepEqual(s.stages.map((x) => x.coating), ["ASAHI YSC1100", "ASAHI YSC1100", "(none)"]);
  assert.deepEqual(s.stages.map((x) => x.thickness_mm), [10, 20, 1]);
  assert.deepEqual([s.source.d_mm, ...s.stages.map((x) => x.d_mm)], [200, 150, 100, 50]);
  assert.equal(s.pixel.w_um, 150);
  assert.equal(s.pixel.h_um, 150);
  assert.equal(s.qe, 0.4);
  assert.deepEqual([s.lambdaMinNm, s.lambdaMaxNm, s.resolutionNm], [400, 5000, 1]);
  assert.equal(s.includeStageEmission, true);
});

test("validate passes the default state", () => {
  assert.equal(validate(defaultState()).valid, true);
});

test("validate flags distance ordering violations", () => {
  const s = defaultState();
  s.stages[1].d_mm = 250; // d2 > d1
  const r = validate(s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.ordering);
});

test("validate flags QE, range, resolution, positivity", () => {
  const s = defaultState();
  s.qe = 1.5; s.lambdaMaxNm = 100; s.resolutionNm = 0; s.pixel.w_um = -1;
  const r = validate(s);
  assert.ok(r.errors.qe && r.errors.range && r.errors.resolution && r.errors.pixel_w);
});

test("buildGridNm is inclusive and caps the point count", () => {
  const g = buildGridNm({ lambdaMinNm: 400, lambdaMaxNm: 500, resolutionNm: 1 });
  assert.equal(g.grid.length, 101);
  assert.equal(g.grid[0], 400);
  assert.equal(g.grid[g.grid.length - 1], 500);
  assert.equal(g.coarsened, false);

  const c = buildGridNm({ lambdaMinNm: 0.001, lambdaMaxNm: 1e6, resolutionNm: 0.001 }, 20000);
  assert.equal(c.grid.length, 20000);
  assert.equal(c.coarsened, true);
});

test("validate flags non-finite or negative temperatures (0 K allowed)", () => {
  const nan = defaultState(); nan.source.T = NaN;
  assert.ok(validate(nan).errors.source_T);
  const neg = defaultState(); neg.stages[0].T = -5;
  assert.ok(validate(neg).errors.stage1_T);
  const zero = defaultState(); zero.stages[1].T = 0; // 0 K = no emission, allowed
  assert.equal(validate(zero).valid, true);
});
