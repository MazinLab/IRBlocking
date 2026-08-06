import { test } from "node:test";
import assert from "node:assert/strict";
import { CustomCoating, SpecCoating } from "../js/optics.js";
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

// --- Custom 2: vendor-style Tavg bounds -------------------------------------

test("SpecCoating uses each row's stated bound as the transmission", () => {
  const c = new SpecCoating([
    { startNm: 950, stopNm: 1400, op: ">=", tPct: 90 },
    { startNm: 1450, stopNm: 2350, op: "<=", tPct: 0.5 },
  ]);
  const t = c.transmission(Float64Array.from([1000, 1400, 1500, 2350]));
  assert.equal(t[0], 0.9); // ">= 90%" -> the floor the spec permits
  assert.equal(t[1], 0.9); // upper edge inclusive
  assert.equal(t[2], 0.005); // "<= 0.5%" -> the ceiling the spec permits
  assert.equal(t[3], 0.005);
  assert.equal(c.hasReflection, false);
});

test("SpecCoating leaves uncovered wavelengths fully transmitting", () => {
  const c = new SpecCoating([{ startNm: 950, stopNm: 1400, op: ">=", tPct: 90 }]);
  const t = c.transmission(Float64Array.from([400, 949, 1425, 5000]));
  assert.deepEqual([...t], [1, 1, 1, 1]);
  assert.deepEqual([...new SpecCoating([]).transmission(Float64Array.from([1000]))], [1]);
});

test("SpecCoating: the lowest overlapping row on the list wins", () => {
  const c = new SpecCoating([
    { startNm: 1000, stopNm: 3000, op: "<=", tPct: 5 },
    { startNm: 2000, stopNm: 2500, op: "<=", tPct: 0.1 }, // overrides the band above
  ]);
  const t = c.transmission(Float64Array.from([1500, 2250, 2750]));
  assert.equal(t[0], 0.05);
  assert.equal(t[1], 0.001);
  assert.equal(t[2], 0.05);
});

test("SpecCoating drops malformed rows and clamps percentages", () => {
  const c = new SpecCoating([
    { startNm: 1000, stopNm: 900, op: "<=", tPct: 1 }, // stop <= start
    { startNm: NaN, stopNm: 2000, op: "<=", tPct: 1 }, // half-typed
    { startNm: 1000, stopNm: 2000, op: "<=", tPct: 500 }, // out of range -> clamps to 1
  ]);
  assert.equal(c.rows.length, 1);
  assert.equal(c.transmission(Float64Array.from([1500]))[0], 1);
});

test("default Custom 2 rows match the transcribed spec", () => {
  const rows = defaultState().custom2.rows;
  assert.deepEqual(rows, [
    { startNm: 950, stopNm: 1400, op: ">=", tPct: 90 },
    { startNm: 1450, stopNm: 2350, op: "<=", tPct: 0.5 },
    { startNm: 2350, stopNm: 2800, op: "<=", tPct: 0.1 },
    { startNm: 2800, stopNm: 3400, op: "<=", tPct: 0.5 },
  ]);
});

test("Custom 2 rows are validated only when a stage selects Custom 2", () => {
  const s = defaultState();
  s.custom2.rows[1].stopNm = 100; // stop < start, but unused
  assert.equal(validate(s).valid, true);
  s.stages[0].coating = "Custom 2";
  const r = validate(s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.custom2_1);
  s.custom2.rows[1].stopNm = 2350;
  s.custom2.rows[2].tPct = 150;
  assert.ok(validate(s).errors.custom2_2);
});
