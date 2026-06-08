/* =====================================================================
 *  charts.js — Grafici su <canvas>, senza librerie esterne
 *  Tema scuro professionale. Gestione retina/devicePixelRatio.
 * ===================================================================== */
(function (global) {
  'use strict';

  const COL = {
    bg: '#0e1320',
    grid: 'rgba(255,255,255,0.06)',
    axis: 'rgba(255,255,255,0.28)',
    text: '#8a93a6',
    textStrong: '#cdd4e0',
    band95: 'rgba(56,132,255,0.10)',
    band75: 'rgba(56,132,255,0.18)',
    median: '#38d39f',
    original: '#ffb020',
    sample: 'rgba(120,140,180,0.12)',
    bar: '#3884ff',
    barNeg: '#ff5a6a',
    marker: '#ffb020',
  };

  function fmtNum(v) {
    if (!isFinite(v)) return '∞';
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function setup(canvas) {
    const dpr = global.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width);
    const h = Math.max(200, rect.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function niceTicks(min, max, count) {
    const range = max - min || 1;
    const rough = range / count;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    step *= pow;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.001; v += step) ticks.push(v);
    return ticks;
  }

  /* ---- Grafico a ventaglio dell'equity (bande percentili) ----------- */
  function drawFanChart(canvas, result, originalCurve) {
    const { ctx, w, h } = setup(canvas);
    const padL = 64;
    const padR = 16;
    const padT = 18;
    const padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const bands = result.bands;
    const bandX = result.bandX;
    const nx = bandX[bandX.length - 1] || 1;

    // range Y
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of [5, 95]) {
      for (let i = 0; i < bands[p].length; i++) {
        if (bands[p][i] < yMin) yMin = bands[p][i];
        if (bands[p][i] > yMax) yMax = bands[p][i];
      }
    }
    if (originalCurve) {
      for (let i = 0; i < originalCurve.length; i++) {
        if (originalCurve[i] < yMin) yMin = originalCurve[i];
        if (originalCurve[i] > yMax) yMax = originalCurve[i];
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
    const padY = (yMax - yMin) * 0.06 || 1;
    yMin -= padY;
    yMax += padY;

    const sx = (xv) => padL + (xv / nx) * plotW;
    const sy = (yv) => padT + plotH - ((yv - yMin) / (yMax - yMin)) * plotH;

    // griglia + assi Y
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const yticks = niceTicks(yMin, yMax, 6);
    for (const t of yticks) {
      const y = sy(t);
      ctx.strokeStyle = COL.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = COL.text;
      ctx.textAlign = 'right';
      ctx.fillText(fmtNum(t), padL - 8, y);
    }
    // asse X (numero operazioni)
    const xticks = niceTicks(0, nx, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of xticks) {
      const x = sx(t);
      ctx.fillStyle = COL.text;
      ctx.fillText(fmtNum(t), x, h - padB + 8);
    }

    // helper per riempire un'area tra due percentili
    function fillBand(pLow, pHigh, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < bandX.length; i++) ctx.lineTo(sx(bandX[i]), sy(bands[pHigh][i]));
      for (let i = bandX.length - 1; i >= 0; i--) ctx.lineTo(sx(bandX[i]), sy(bands[pLow][i]));
      ctx.closePath();
      ctx.fill();
    }
    fillBand(5, 95, COL.band95);
    fillBand(25, 75, COL.band75);

    // alcuni percorsi campione (sottili)
    ctx.strokeStyle = COL.sample;
    ctx.lineWidth = 1;
    for (const path of result.samplePaths) {
      ctx.beginPath();
      ctx.moveTo(sx(bandX[0]), sy(path[0]));
      for (let i = 1; i < path.length; i++) ctx.lineTo(sx(bandX[i]), sy(path[i]));
      ctx.stroke();
    }

    // linea mediana
    ctx.strokeStyle = COL.median;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < bandX.length; i++) {
      const x = sx(bandX[i]);
      const y = sy(bands[50][i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // curva equity originale del backtest
    if (originalCurve) {
      ctx.strokeStyle = COL.original;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const stepX = nx / (originalCurve.length - 1 || 1);
      for (let i = 0; i < originalCurve.length; i++) {
        const x = sx(i * stepX);
        const y = sy(originalCurve[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // linea del capitale iniziale
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    const y0 = sy(result.cfg.initialCapital);
    ctx.beginPath();
    ctx.moveTo(padL, y0);
    ctx.lineTo(w - padR, y0);
    ctx.stroke();
    ctx.setLineDash([]);

    // legenda
    drawLegend(ctx, padL + 4, padT + 4, [
      { c: COL.median, t: 'Mediana (P50)' },
      { c: COL.band75, t: 'P25–P75' },
      { c: COL.band95, t: 'P5–P95' },
      { c: COL.original, t: 'Backtest originale' },
    ]);
  }

  function drawLegend(ctx, x, y, items) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cy = y + 8;
    for (const it of items) {
      ctx.fillStyle = it.c;
      ctx.fillRect(x, cy - 4, 14, 8);
      ctx.fillStyle = COL.textStrong;
      ctx.fillText(it.t, x + 20, cy);
      cy += 16;
    }
  }

  /* ---- Istogramma con marcatori percentili -------------------------- */
  function drawHistogram(canvas, values, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const padL = 56;
    const padR = 14;
    const padT = 16;
    const padB = 40;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const numBins = opts.bins || 40;
    const hist = global.Stats.histogram(values, numBins);
    const lo = hist.bins[0].x0;
    const hi = hist.bins[hist.bins.length - 1].x1;
    const maxC = hist.maxCount || 1;

    const sx = (xv) => padL + ((xv - lo) / (hi - lo || 1)) * plotW;
    const sy = (cv) => padT + plotH - (cv / maxC) * plotH;

    // griglia Y (conteggi)
    ctx.font = '11px system-ui, sans-serif';
    const yt = niceTicks(0, maxC, 5);
    ctx.textBaseline = 'middle';
    for (const t of yt) {
      const y = sy(t);
      ctx.strokeStyle = COL.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = COL.text;
      ctx.textAlign = 'right';
      ctx.fillText(fmtNum(t), padL - 8, y);
    }

    // barre
    const zero = opts.zeroRef !== undefined ? opts.zeroRef : null;
    for (const b of hist.bins) {
      const x0 = sx(b.x0);
      const x1 = sx(b.x1);
      const y = sy(b.count);
      let color = opts.color || COL.bar;
      if (zero !== null) color = b.mid < zero ? COL.barNeg : COL.bar;
      ctx.fillStyle = color;
      ctx.fillRect(x0 + 0.5, y, Math.max(1, x1 - x0 - 1), padT + plotH - y);
    }

    // assi X
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xt = niceTicks(lo, hi, 6);
    for (const t of xt) {
      const x = sx(t);
      ctx.fillStyle = COL.text;
      ctx.fillText(opts.fmtX ? opts.fmtX(t) : fmtNum(t), x, h - padB + 8);
    }

    // marcatori (es. percentili, mediana, soglia)
    if (opts.markers) {
      for (const m of opts.markers) {
        if (m.value < lo || m.value > hi) continue;
        const x = sx(m.value);
        ctx.strokeStyle = m.color || COL.marker;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = m.color || COL.marker;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(m.label, x, padT - 1);
      }
    }

    // titolo asse X
    if (opts.xlabel) {
      ctx.fillStyle = COL.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(opts.xlabel, padL + plotW / 2, h - 4);
    }
  }

  global.Charts = { drawFanChart, drawHistogram, fmtNum };
})(window);
