// js/plot.js
// Hand-drawn semilog spectrum plot (counts/nm vs wavelength) in LCARS colors.

const C = {
  grid: "rgba(255,153,0,0.12)", axis: "rgba(255,153,0,0.55)",
  tick: "#8890a3", label: "#ffcc66", total: "#ff9900", clamp: "rgba(204,102,102,0.12)",
};

/** Linear "nice" ticks: ~count steps of 1/2/5×10^k within [min,max]. */
export function niceTicks(min, max, count = 5) {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/** Decade (power-of-ten) ticks covering a positive value range. */
export function decadeTicks(lo, hi) {
  if (!(hi > 0)) return [1];
  const top = Math.floor(Math.log10(hi));
  const bot = lo > 0 ? Math.ceil(Math.log10(lo)) : top - 4;
  const ticks = [];
  for (let e = bot; e <= top; e++) ticks.push(10 ** e);
  return ticks;
}

/**
 * Draw the spectrum. data = {gridNm, total, perEmitter, emitterMeta:[{label,color}]}.
 * opts.clampRegions = [[loNm,hiNm], ...] shaded as out-of-coverage.
 */
export function drawSpectrum(canvas, data, opts = {}) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const overlay = data.overlay || null; // {values: Float64Array (0..1), color, label}
  const m = { l: 70, r: overlay ? 64 : 16, t: 16, b: 44 };
  const px = (W - m.l - m.r), py = (H - m.t - m.b);
  ctx.clearRect(0, 0, W, H);

  const { gridNm, total, perEmitter = [], emitterMeta = [] } = data;
  const xMin = gridNm[0], xMax = gridNm[gridNm.length - 1];
  // positive max across all series for log y
  let yMax = 0;
  const scan = (arr) => { for (const v of arr) if (v > yMax) yMax = v; };
  scan(total); perEmitter.forEach(scan);
  if (!(yMax > 0)) yMax = 1;
  const yFloor = yMax / 1e8; // 8 decades
  const X = (nm) => m.l + ((nm - xMin) / (xMax - xMin || 1)) * px;
  const Y = (v) => {
    const c = v <= yFloor ? yFloor : v;
    return m.t + py * (1 - (Math.log10(c) - Math.log10(yFloor)) / (Math.log10(yMax) - Math.log10(yFloor) || 1));
  };

  // clamp shading
  ctx.fillStyle = C.clamp;
  for (const [lo, hi] of (opts.clampRegions || [])) {
    const a = X(Math.max(lo, xMin)), b = X(Math.min(hi, xMax));
    if (b > a) ctx.fillRect(a, m.t, b - a, py);
  }
  // grid + axes
  ctx.strokeStyle = C.grid; ctx.fillStyle = C.tick;
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = "center";
  for (const xt of niceTicks(xMin, xMax, 6)) {
    const x = X(xt); ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + py); ctx.stroke();
    ctx.fillText(String(Math.round(xt)), x, H - m.b + 16);
  }
  ctx.textAlign = "right";
  for (const yt of decadeTicks(yFloor, yMax)) {
    const y = Y(yt); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + px, y); ctx.stroke();
    ctx.fillStyle = C.tick; ctx.fillText(yt.toExponential(0), m.l - 6, y + 3);
  }
  ctx.strokeStyle = C.axis; ctx.strokeRect(m.l, m.t, px, py);
  ctx.fillStyle = C.label; ctx.textAlign = "center";
  ctx.fillText("Wavelength (nm)", m.l + px / 2, H - 6);
  ctx.save(); ctx.translate(14, m.t + py / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText("counts / s / nm", 0, 0); ctx.restore();

  // series: per-emitter then total on top
  const drawSeries = (arr, color, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
    let pen = false;
    for (let i = 0; i < gridNm.length; i++) {
      if (arr[i] <= yFloor) { pen = false; continue; }   // break the line at zeros
      const x = X(gridNm[i]), y = Y(arr[i]);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  perEmitter.forEach((arr, i) => drawSeries(arr, (emitterMeta[i] && emitterMeta[i].color) || C.tick, 1));
  drawSeries(total, C.total, 2);
  ctx.lineWidth = 1;

  // secondary right axis: designed-coating throughput, log scale (% transmission)
  if (overlay) {
    const col = overlay.color || "#5fd3bc";
    const floor = overlay.floor || 1e-5; // throughput floor (0.001%); deeper blocking breaks the line
    const lf = Math.log10(floor);
    const Y2 = (t) => {
      const c = t <= floor ? floor : t > 1 ? 1 : t;
      return m.t + py * (1 - (Math.log10(c) - lf) / (0 - lf));
    };
    ctx.fillStyle = col;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = "left";
    for (let e = 0; e >= lf; e--) {
      const pct = 10 ** e * 100;
      ctx.fillText(String(+pct.toPrecision(3)), m.l + px + 6, Y2(10 ** e) + 3);
    }
    ctx.save();
    ctx.translate(W - 4, m.t + py / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("throughput (%, log)", 0, 0);
    ctx.restore();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < gridNm.length; i++) {
      if (overlay.values[i] <= floor) { pen = false; continue; } // break where below the floor
      const x = X(gridNm[i]), y = Y2(overlay.values[i]);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}
