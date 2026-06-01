// test/optics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolateHoldClamp, CurveElement } from "../js/optics.js";

test("interpolateHoldClamp linearly interpolates inside the range", () => {
  const wl = [100, 200, 300], v = [0.0, 0.5, 1.0];
  const out = interpolateHoldClamp(wl, v, new Float64Array([150, 250]));
  assert.ok(Math.abs(out[0] - 0.25) < 1e-12);
  assert.ok(Math.abs(out[1] - 0.75) < 1e-12);
});

test("interpolateHoldClamp holds endpoints outside the range (no extrapolation)", () => {
  const wl = [100, 200], v = [0.2, 0.8];
  const out = interpolateHoldClamp(wl, v, new Float64Array([50, 500]));
  assert.equal(out[0], 0.2);
  assert.equal(out[1], 0.8);
});

test("interpolateHoldClamp clamps results to [0,1]", () => {
  const wl = [100, 200], v = [-0.3, 1.7];
  const out = interpolateHoldClamp(wl, v, new Float64Array([100, 200]));
  assert.equal(out[0], 0);
  assert.equal(out[1], 1);
});

test("CurveElement exposes coverage and interpolates transmission; reflection defaults to zeros", () => {
  const c = new CurveElement({ name: "x", wavelength_nm: [400, 600], transmission: [0.1, 0.9] });
  assert.deepEqual(c.coverageNm, [400, 600]);
  const t = c.transmission(new Float64Array([500]));
  assert.ok(Math.abs(t[0] - 0.5) < 1e-12);
  assert.equal(c.reflection(new Float64Array([500]))[0], 0);
});

test("CurveElement carries a reflection curve when provided", () => {
  const c = new CurveElement({ name: "m", wavelength_nm: [400, 600], transmission: [0.1, 0.1], reflection: [0.8, 0.6] });
  assert.ok(Math.abs(c.reflection(new Float64Array([500]))[0] - 0.7) < 1e-12);
});

// append to test/optics.test.js
import { StageElement, TMMElement } from "../js/optics.js";

test("StageElement transmission is substrate × coating; missing parts act as unity", () => {
  const sub = new CurveElement({ name: "s", wavelength_nm: [400, 600], transmission: [0.5, 0.5] });
  const coat = new CurveElement({ name: "c", wavelength_nm: [400, 600], transmission: [0.4, 0.4] });
  const stage = new StageElement({ substrate: sub, coating: coat });
  assert.ok(Math.abs(stage.transmission(new Float64Array([500]))[0] - 0.2) < 1e-12);
  const bare = new StageElement({ substrate: sub }); // coating unity
  assert.ok(Math.abs(bare.transmission(new Float64Array([500]))[0] - 0.5) < 1e-12);
  const empty = new StageElement({}); // both unity
  assert.equal(empty.transmission(new Float64Array([500]))[0], 1);
});

test("StageElement emissivity is 1 − T by default and 1 − T − R with whole-stage reflectance", () => {
  const sub = new CurveElement({ name: "s", wavelength_nm: [400, 600], transmission: [0.5, 0.5] });
  const noR = new StageElement({ substrate: sub });
  assert.ok(Math.abs(noR.emissivity(new Float64Array([500]))[0] - 0.5) < 1e-12);
  const withR = new StageElement({ substrate: sub, reflectance: 0.3 });
  assert.ok(Math.abs(withR.emissivity(new Float64Array([500]))[0] - 0.2) < 1e-12); // 1 - 0.5 - 0.3
});

test("StageElement emissivity floors at 0 when T + R exceeds 1", () => {
  const sub = new CurveElement({ name: "s", wavelength_nm: [400, 600], transmission: [0.9, 0.9] });
  const s = new StageElement({ substrate: sub, reflectance: 0.5 });
  assert.equal(s.emissivity(new Float64Array([500]))[0], 0);
});

test("TMMElement is a stub that throws until implemented", () => {
  assert.throws(() => new TMMElement({ layers: [] }).transmission(new Float64Array([500])), /not yet implemented/i);
});

test("StageElement uses a reflecting coating's R curve in emissivity when no scalar override", () => {
  const sub = new CurveElement({ name: "s", wavelength_nm: [400, 600], transmission: [0.9, 0.9] });
  const mirror = new CurveElement({ name: "m", wavelength_nm: [400, 600], transmission: [0.4, 0.4], reflection: [0.25, 0.25] });
  const stage = new StageElement({ substrate: sub, coating: mirror });
  const g = new Float64Array([500]);
  assert.ok(Math.abs(stage.reflection(g)[0] - 0.25) < 1e-12);
  // T_stage = 0.9*0.4 = 0.36 ; eps = 1 - 0.36 - 0.25 = 0.39
  assert.ok(Math.abs(stage.emissivity(g)[0] - 0.39) < 1e-12);
});

test("scalar reflectance override takes precedence over a coating R curve", () => {
  const mirror = new CurveElement({ name: "m", wavelength_nm: [400, 600], transmission: [0.4, 0.4], reflection: [0.25, 0.25] });
  const stage = new StageElement({ coating: mirror, reflectance: 0.1 });
  assert.ok(Math.abs(stage.reflection(new Float64Array([500]))[0] - 0.1) < 1e-12);
});

test("StageElement uses a MaterialElement substrate's reflection (not only CurveElement)", async () => {
  const { MATERIALS, MaterialElement } = await import("../js/materials.js");
  const sub = new MaterialElement(MATERIALS.Sapphire, 3); // α-based, transparent near 1000 nm
  const stage = new StageElement({ substrate: sub });
  const g = Float64Array.from([1000]);
  const subR = sub.reflection(g)[0];
  assert.ok(subR > 0.1, `expected substrate R≈0.14, got ${subR}`);
  assert.ok(Math.abs(stage.reflection(g)[0] - subR) < 1e-12, "stage must delegate to substrate reflection");
  // transparent window: ε ≈ (1−R)(1−τ) ≈ 0, NOT 1−T ≈ 2R (~0.14) which the old instanceof check produced
  assert.ok(stage.emissivity(g)[0] < 0.01, `expected ~0 emissivity, got ${stage.emissivity(g)[0]}`);
});
