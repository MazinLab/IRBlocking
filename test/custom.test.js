import { test } from "node:test";
import assert from "node:assert/strict";
import { CustomCoating } from "../js/optics.js";
import { defaultState, validate } from "../js/state.js";

test("CustomCoating: 100% inside [start,stop] (edges inclusive), floor outside, no reflection", () => {
  const c = new CustomCoating({ startNm: 1000, stopNm: 1300, outFraction: 0.05 });
  const g = Float64Array.from([500, 1000, 1150, 1300, 2000]);
  const t = c.transmission(g);
  assert.equal(t[0], 0.05); // below band
  assert.equal(t[1], 1); // lower edge inclusive
  assert.equal(t[2], 1); // in band
  assert.equal(t[3], 1); // upper edge inclusive
  assert.equal(t[4], 0.05); // above band
  assert.equal(c.reflection(g)[0], 0);
  assert.equal(c.hasReflection, false);
});

test("CustomCoating clamps out-of-band fraction to [0,1]", () => {
  const hi = new CustomCoating({ startNm: 1, stopNm: 2, outFraction: 1.5 });
  const lo = new CustomCoating({ startNm: 1, stopNm: 2, outFraction: -0.2 });
  assert.equal(hi.transmission(Float64Array.from([5]))[0], 1);
  assert.equal(lo.transmission(Float64Array.from([5]))[0], 0);
});

test("default state has a Custom-coating definition", () => {
  const c = defaultState().custom;
  assert.equal(c.startNm, 950);
  assert.equal(c.stopNm, 1450);
  assert.equal(c.outPct, 0.1);
});

test("Custom passband is validated only when a stage selects the Custom coating", () => {
  const s = defaultState();
  s.custom.startNm = 1000;
  s.custom.stopNm = 500; // stop < start (invalid) but unused
  assert.equal(validate(s).valid, true);
  s.stages[0].coating = "Custom";
  const r = validate(s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.custom);
});

test("Custom out-of-band percentage must be within 0-100 when in use", () => {
  const s = defaultState();
  s.stages[1].coating = "Custom";
  s.custom.outPct = 150;
  const r = validate(s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.custom);
});
