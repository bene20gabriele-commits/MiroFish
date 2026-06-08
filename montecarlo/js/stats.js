/* =====================================================================
 *  stats.js — Funzioni statistiche e generatore di numeri casuali
 * ===================================================================== */
(function (global) {
  'use strict';

  function sum(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  }

  function mean(a) {
    return a.length ? sum(a) / a.length : 0;
  }

  // deviazione standard campionaria (n-1)
  function std(a) {
    const n = a.length;
    if (n < 2) return 0;
    const m = mean(a);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const d = a[i] - m;
      acc += d * d;
    }
    return Math.sqrt(acc / (n - 1));
  }

  function min(a) {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
    return m;
  }

  function max(a) {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  }

  // percentile con interpolazione lineare; richiede array già ORDINATO
  function percentileSorted(sorted, p) {
    const n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    const rank = (p / 100) * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    const frac = rank - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  }

  function percentile(a, p) {
    const sorted = Float64Array.from(a).sort();
    return percentileSorted(sorted, p);
  }

  function median(a) {
    return percentile(a, 50);
  }

  // skewness e kurtosis (eccesso)
  function skewness(a) {
    const n = a.length;
    if (n < 3) return 0;
    const m = mean(a);
    const s = std(a);
    if (s === 0) return 0;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += Math.pow((a[i] - m) / s, 3);
    return acc / n;
  }

  function kurtosis(a) {
    const n = a.length;
    if (n < 4) return 0;
    const m = mean(a);
    const s = std(a);
    if (s === 0) return 0;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += Math.pow((a[i] - m) / s, 4);
    return acc / n - 3;
  }

  /* ---- Generatore casuale con seed (Mulberry32) --------------------- */
  function makeRng(seed) {
    let s = seed >>> 0;
    if (s === 0) s = 0x9e3779b9;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // campione da distribuzione normale (Box-Muller)
  function normal(rng, mu, sigma) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mu + sigma * z;
  }

  // costruisce un istogramma: { bins:[{x0,x1,mid,count}], maxCount }
  function histogram(values, numBins) {
    const lo = min(values);
    const hi = max(values);
    if (!isFinite(lo) || !isFinite(hi) || lo === hi) {
      return { bins: [{ x0: lo, x1: hi, mid: lo, count: values.length }], maxCount: values.length };
    }
    const width = (hi - lo) / numBins;
    const bins = [];
    for (let i = 0; i < numBins; i++) {
      const x0 = lo + i * width;
      bins.push({ x0, x1: x0 + width, mid: x0 + width / 2, count: 0 });
    }
    for (let i = 0; i < values.length; i++) {
      let idx = Math.floor((values[i] - lo) / width);
      if (idx < 0) idx = 0;
      if (idx >= numBins) idx = numBins - 1;
      bins[idx].count++;
    }
    let maxCount = 0;
    for (const b of bins) if (b.count > maxCount) maxCount = b.count;
    return { bins, maxCount };
  }

  global.Stats = {
    sum, mean, std, min, max, percentile, percentileSorted, median,
    skewness, kurtosis, makeRng, normal, histogram,
  };
})(window);
