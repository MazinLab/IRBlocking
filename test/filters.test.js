// test/filters.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurveText } from "../js/filters.js";

test("parseCurveText reads fractions, skips header/blank lines, sorts ascending", () => {
  const txt = "wavelength,transmission\n600,0.9\n400,0.1\n\n";
  const r = parseCurveText(txt, "fraction");
  assert.deepEqual(r.wavelength_nm, [400, 600]);
  assert.deepEqual(r.transmission, [0.1, 0.9]);
});

test("parseCurveText converts percent by /100", () => {
  const r = parseCurveText("400,50\n600,90", "percent");
  assert.deepEqual(r.transmission, [0.5, 0.9]);
});

test("parseCurveText converts OD by 10^(-OD)", () => {
  const r = parseCurveText("400,0\n600,2", "od");
  assert.ok(Math.abs(r.transmission[0] - 1) < 1e-12);
  assert.ok(Math.abs(r.transmission[1] - 0.01) < 1e-12);
});

test("parseCurveText clamps to [0,1] and accepts whitespace or comma delimiters", () => {
  const r = parseCurveText("400 150\n600 -10", "percent");
  assert.deepEqual(r.transmission, [1, 0]);
});
