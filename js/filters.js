// js/filters.js
// Filter-curve library: bundled JSON loader + 2-column user import with explicit units.

/**
 * Parse a 2-column text curve into {wavelength_nm, transmission} (fractions, ascending).
 * unit: "fraction" | "percent" | "od". Units are explicit — never inferred from magnitude.
 * Skips blank lines and any line whose first non-space char is a letter or '#' (headers).
 */
export function parseCurveText(text, unit) {
  const pairs = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[A-Za-z#]/.test(line)) continue;
    const parts = line.split(/[\s,]+/).map(Number);
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) continue;
    let v = parts[1];
    if (unit === "percent") v /= 100;
    else if (unit === "od") v = Math.pow(10, -v);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    pairs.push([parts[0], v]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return { wavelength_nm: pairs.map((p) => p[0]), transmission: pairs.map((p) => p[1]) };
}

/**
 * Load the bundled curve library. Fetches data/filters/index.json then each curve JSON.
 * Returns a Map<name, curveDoc>. Requires being served over HTTP (not file://).
 */
export async function loadLibrary(base = "data/filters") {
  const index = await (await fetch(`${base}/index.json`)).json();
  const lib = new Map();
  for (const entry of index) {
    const doc = await (await fetch(`${base}/${entry.file}`)).json();
    lib.set(doc.name, doc);
  }
  return lib;
}
