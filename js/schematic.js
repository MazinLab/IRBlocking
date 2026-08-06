// js/schematic.js
// Reactive optical-bench schematic. computeLayout is pure; renderSchematic emits SVG.

/** Format a temperature: sub-kelvin as mK, otherwise K. */
export function fmtT(T) {
  return T < 1 ? `${Math.round(T * 1000)} mK` : `${+T.toFixed(3)} K`;
}

/** Map temperature to a hot(red)→cold(blue) color. */
export function tempColor(T) {
  if (T >= 250) return "#ff6b5e";
  if (T >= 40) return "#ffb347";
  if (T >= 2) return "#6db3ff";
  return "#a9d2ff";
}

/**
 * Pure layout for the schematic. Returns geometry the renderer draws.
 * planes ordered source→stage1→stage2→stage3 (increasing x toward the pixel).
 */
export function computeLayout(state, { width = 960, height = 340 } = {}) {
  const planes = [
    { key: "source", label: fmtT(state.source.T), T: state.source.T, D: state.source.D_mm, d: state.source.d_mm },
    ...state.stages.map((st, i) => ({
      key: `stage${i + 1}`, label: fmtT(st.T), T: st.T, D: st.D_mm, d: st.d_mm, name: st.name,
    })),
  ];
  let coldStopKey = null, minSin2 = Infinity;
  for (const p of planes) {
    const r = p.D / 2;
    const sin2 = (r * r) / (r * r + p.d * p.d);
    if (sin2 < minSin2) { minSin2 = sin2; coldStopKey = p.key; }
    p.color = tempColor(p.T);
  }
  const left = 70, right = width - 95, pixelX = right;
  const maxD = Math.max(...planes.map((p) => p.d));
  const maxDiam = Math.max(...planes.map((p) => p.D));
  const axisY = height / 2, maxHalf = height * 0.40;
  for (const p of planes) {
    p.x = right - (p.d / maxD) * (right - left);
    p.apertureHalf = 8 + (p.D / maxDiam) * maxHalf * 0.5;
  }
  return { width, height, axisY, pixelX, planes, coldStopKey, left, right };
}

/** Render the schematic into a container element. */
export function renderSchematic(container, state) {
  const L = computeLayout(state);
  const { width: W, height: H, axisY, pixelX, planes } = L;
  const stop = planes.find((p) => p.key === L.coldStopKey);
  // FOV cone: pixel to the limiting aperture edges, extended to the source plane.
  const src = planes[0];
  const slope = stop.apertureHalf / (pixelX - stop.x);
  const yTop = axisY - slope * (pixelX - src.x);
  const yBot = axisY + slope * (pixelX - src.x);

  const bar = (p) => {
    const topH = p.apertureHalf, t = 70, b = H - 70;
    const isStop = p.key === L.coldStopKey;
    const sw = isStop ? ' stroke="#ff9900" stroke-width="2.5"' : "";
    return `
      <rect x="${p.x - 7}" y="${t}" width="14" height="${axisY - topH - t}" rx="3" fill="${p.color}"${sw}/>
      <rect x="${p.x - 7}" y="${axisY + topH}" width="14" height="${b - (axisY + topH)}" rx="3" fill="${p.color}"${sw}/>
      <text x="${p.x}" y="52" fill="${p.color}" font-size="14" text-anchor="middle" font-weight="700">${p.name || "Source"}</text>
      <text x="${p.x}" y="${H - 50}" fill="${p.color}" font-size="13" text-anchor="middle">${p.label}</text>
      ${isStop ? `<text x="${p.x}" y="${H - 34}" fill="#ff9900" font-size="10" text-anchor="middle">limiting stop</text>` : ""}`;
  };

  container.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" font-family="'JetBrains Mono',monospace">
    <polygon points="${pixelX},${axisY} ${src.x},${yTop} ${src.x},${yBot}"
      fill="#ff9900" fill-opacity="0.12" stroke="#ff9900" stroke-opacity="0.3"/>
    <line x1="${src.x}" y1="${axisY}" x2="${pixelX}" y2="${axisY}" stroke="#ff9900" stroke-opacity="0.4" stroke-dasharray="2 6"/>
    ${planes.map(bar).join("")}
    <rect x="${pixelX - 5}" y="${axisY - 18}" width="14" height="36" rx="2" fill="#ff9900" stroke="#fff" stroke-width="1.5"/>
    <text x="${pixelX + 2}" y="52" fill="#ff9900" font-size="14" text-anchor="middle" font-weight="700">Pixel</text>
    <text x="${pixelX + 2}" y="${H - 50}" fill="#8890a3" font-size="12" text-anchor="middle">detector</text>
  </svg>`;
  return L;
}
