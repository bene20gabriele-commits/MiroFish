/* =====================================================================
 *  montecarlo.js — Motore di simulazione Monte Carlo per il trading
 *
 *  Metodi supportati:
 *   - bootstrap : ricampionamento CON reinserimento (rischio di selezione)
 *   - shuffle   : permutazione casuale delle stesse operazioni (rischio di
 *                 sequenza / path-dependency)
 *   - parametric: estrazione da distribuzione Normale stimata sui dati
 *
 *  Dimensionamento posizione:
 *   - fixed   : importo fisso, equity additiva  (equity += pnl)
 *   - compound: capitalizzazione composta       (equity *= 1 + pnl/capitale)
 * ===================================================================== */
(function (global) {
  'use strict';

  const S = global.Stats;

  /* ---- Statistiche del backtest ORIGINALE (sequenza reale) ---------- */
  function analyzeBacktest(pnls, cfg) {
    const n = pnls.length;
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const grossProfit = S.sum(wins);
    const grossLoss = Math.abs(S.sum(losses));
    const net = S.sum(pnls);

    // curva equity reale + max drawdown reale
    const curve = buildCurve(pnls, cfg);
    const dd = maxDrawdown(curve.equity);

    return {
      trades: n,
      wins: wins.length,
      losses: losses.length,
      winRate: n ? (wins.length / n) * 100 : 0,
      avgWin: wins.length ? S.mean(wins) : 0,
      avgLoss: losses.length ? S.mean(losses) : 0,
      avgTrade: n ? S.mean(pnls) : 0,
      bestTrade: n ? S.max(pnls) : 0,
      worstTrade: n ? S.min(pnls) : 0,
      grossProfit,
      grossLoss,
      netProfit: net,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
      expectancy: n ? net / n : 0,
      payoffRatio:
        losses.length && wins.length
          ? S.mean(wins) / Math.abs(S.mean(losses))
          : Infinity,
      stdTrade: S.std(pnls),
      skew: S.skewness(pnls),
      kurt: S.kurtosis(pnls),
      finalEquity: curve.equity[curve.equity.length - 1],
      totalReturnPct: ((curve.equity[curve.equity.length - 1] - cfg.initialCapital) /
        cfg.initialCapital) * 100,
      maxDrawdownPct: dd.pct,
      maxDrawdownAbs: dd.abs,
      curve: curve.equity,
      // Sharpe / Sortino per-operazione, annualizzati se forniamo op/anno
      sharpe: annualizedSharpe(pnls, cfg),
      sortino: annualizedSortino(pnls, cfg),
    };
  }

  // converte un singolo pnl nell'incremento di equity in base al sizing
  function applyTrade(equity, pnl, cfg) {
    if (cfg.isPercent) {
      const r = pnl / 100;
      if (cfg.sizing === 'compound') return equity * (1 + r);
      return equity + cfg.initialCapital * r;
    }
    if (cfg.sizing === 'compound') {
      return equity * (1 + pnl / cfg.initialCapital);
    }
    return equity + pnl;
  }

  function buildCurve(pnls, cfg) {
    const equity = new Float64Array(pnls.length + 1);
    equity[0] = cfg.initialCapital;
    for (let i = 0; i < pnls.length; i++) {
      equity[i + 1] = applyTrade(equity[i], pnls[i], cfg);
    }
    return { equity };
  }

  function maxDrawdown(equityArr) {
    let peak = equityArr[0];
    let maxPct = 0;
    let maxAbs = 0;
    for (let i = 1; i < equityArr.length; i++) {
      const e = equityArr[i];
      if (e > peak) peak = e;
      const ddAbs = peak - e;
      const ddPct = peak > 0 ? ddAbs / peak : 0;
      if (ddPct > maxPct) maxPct = ddPct;
      if (ddAbs > maxAbs) maxAbs = ddAbs;
    }
    return { pct: maxPct * 100, abs: maxAbs };
  }

  function annualizedSharpe(pnls, cfg) {
    // rendimenti relativi al capitale iniziale
    const rets = pnls.map((p) =>
      cfg.isPercent ? p / 100 : p / cfg.initialCapital
    );
    const m = S.mean(rets);
    const sd = S.std(rets);
    if (sd === 0) return 0;
    const perTrade = m / sd;
    const tpy = cfg.tradesPerYear > 0 ? cfg.tradesPerYear : null;
    return tpy ? perTrade * Math.sqrt(tpy) : perTrade;
  }

  function annualizedSortino(pnls, cfg) {
    const rets = pnls.map((p) =>
      cfg.isPercent ? p / 100 : p / cfg.initialCapital
    );
    const m = S.mean(rets);
    let acc = 0;
    let cnt = 0;
    for (const r of rets) {
      if (r < 0) {
        acc += r * r;
        cnt++;
      }
    }
    const downside = cnt ? Math.sqrt(acc / cnt) : 0;
    if (downside === 0) return Infinity;
    const perTrade = m / downside;
    const tpy = cfg.tradesPerYear > 0 ? cfg.tradesPerYear : null;
    return tpy ? perTrade * Math.sqrt(tpy) : perTrade;
  }

  /* ---- Simulazione Monte Carlo -------------------------------------- */
  function run(pnls, cfg) {
    const rng = S.makeRng(cfg.seed || 12345);
    const nHist = pnls.length;
    let nTrades = cfg.numTrades || nHist;
    if (cfg.method === 'shuffle') nTrades = nHist; // permutazione: lunghezza fissa
    const nSims = cfg.numSims;

    // soglia di rovina sull'equity (frazione del capitale iniziale)
    const ruinFloor = cfg.initialCapital * (cfg.ruinThresholdPct / 100);

    // parametri per il metodo parametrico
    let pMu = 0;
    let pSigma = 0;
    if (cfg.method === 'parametric') {
      pMu = S.mean(pnls);
      pSigma = S.std(pnls);
    }

    // array dei risultati per ogni simulazione
    const finals = new Float64Array(nSims);
    const returnsPct = new Float64Array(nSims);
    const maxDDsPct = new Float64Array(nSims);
    const maxDDsAbs = new Float64Array(nSims);
    const minEquities = new Float64Array(nSims);
    const ruined = new Uint8Array(nSims);
    const cagrs = cfg.tradesPerYear > 0 ? new Float64Array(nSims) : null;

    // bande percentili: campioniamo al massimo ~220 step lungo il percorso
    const maxBandSteps = Math.min(nTrades, 220);
    const bandIdx = new Int32Array(maxBandSteps);
    for (let i = 0; i < maxBandSteps; i++) {
      bandIdx[i] = Math.round(((i + 1) / maxBandSteps) * nTrades);
    }
    // bandData[step] = valori equity di tutte le sim a quello step
    const bandData = [];
    for (let i = 0; i < maxBandSteps; i++) bandData.push(new Float64Array(nSims));

    // conserva un campione di percorsi completi per il disegno (max 60)
    const sampleCount = Math.min(60, nSims);
    const samplePaths = [];

    // buffer riutilizzabile per la permutazione
    const perm = new Int32Array(nHist);

    for (let s = 0; s < nSims; s++) {
      let equity = cfg.initialCapital;
      let peak = equity;
      let maxDDpct = 0;
      let maxDDabs = 0;
      let minEq = equity;
      let isRuined = false;

      // prepara permutazione se necessario
      if (cfg.method === 'shuffle') {
        for (let i = 0; i < nHist; i++) perm[i] = i;
        for (let i = nHist - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = perm[i];
          perm[i] = perm[j];
          perm[j] = tmp;
        }
      }

      const keepPath = s < sampleCount;
      const path = keepPath ? new Float64Array(maxBandSteps + 1) : null;
      if (keepPath) path[0] = equity;

      let bandPtr = 0;
      const tradeIndex1 = bandIdx; // alias

      for (let t = 0; t < nTrades; t++) {
        let pnl;
        if (cfg.method === 'bootstrap') {
          pnl = pnls[(rng() * nHist) | 0];
        } else if (cfg.method === 'shuffle') {
          pnl = pnls[perm[t]];
        } else {
          // parametric
          pnl = S.normal(rng, pMu, pSigma);
        }

        equity = applyTrade(equity, pnl, cfg);

        if (equity > peak) peak = equity;
        const ddAbs = peak - equity;
        const ddPct = peak > 0 ? ddAbs / peak : 0;
        if (ddPct > maxDDpct) maxDDpct = ddPct;
        if (ddAbs > maxDDabs) maxDDabs = ddAbs;
        if (equity < minEq) minEq = equity;
        if (!isRuined && equity <= ruinFloor) isRuined = true;

        // registra il valore per la banda percentile per ogni step campionato
        // raggiunto (il while gestisce eventuali indici duplicati/saltati)
        while (bandPtr < maxBandSteps && t + 1 >= tradeIndex1[bandPtr]) {
          bandData[bandPtr][s] = equity;
          if (keepPath) path[bandPtr + 1] = equity;
          bandPtr++;
        }
      }

      // assicura che eventuali step di banda non riempiti abbiano l'ultimo valore
      while (bandPtr < maxBandSteps) {
        bandData[bandPtr][s] = equity;
        if (keepPath) path[bandPtr + 1] = equity;
        bandPtr++;
      }

      finals[s] = equity;
      returnsPct[s] = ((equity - cfg.initialCapital) / cfg.initialCapital) * 100;
      maxDDsPct[s] = maxDDpct * 100;
      maxDDsAbs[s] = maxDDabs;
      minEquities[s] = minEq;
      ruined[s] = isRuined ? 1 : 0;
      if (cagrs) {
        const years = nTrades / cfg.tradesPerYear;
        const ratio = equity / cfg.initialCapital;
        cagrs[s] = years > 0 && ratio > 0 ? (Math.pow(ratio, 1 / years) - 1) * 100 : -100;
      }
      if (keepPath) samplePaths.push(path);
    }

    // costruisci le bande percentili ordinando ogni step
    const bandPercentiles = [5, 25, 50, 75, 95];
    const bands = {};
    for (const p of bandPercentiles) bands[p] = new Float64Array(maxBandSteps + 1);
    for (const p of bandPercentiles) bands[p][0] = cfg.initialCapital;
    for (let i = 0; i < maxBandSteps; i++) {
      const sorted = Float64Array.from(bandData[i]).sort();
      for (const p of bandPercentiles) {
        bands[p][i + 1] = S.percentileSorted(sorted, p);
      }
    }

    // asse x delle bande (numero progressivo dell'operazione)
    const bandX = new Int32Array(maxBandSteps + 1);
    bandX[0] = 0;
    for (let i = 0; i < maxBandSteps; i++) bandX[i + 1] = bandIdx[i];

    const ruinCount = ruined.reduce((a, b) => a + b, 0);
    const profitCount = finals.reduce(
      (a, v) => a + (v > cfg.initialCapital ? 1 : 0),
      0
    );

    return {
      cfg,
      nSims,
      nTrades,
      finals,
      returnsPct,
      maxDDsPct,
      maxDDsAbs,
      minEquities,
      ruined,
      cagrs,
      bands,
      bandX,
      samplePaths,
      summary: buildSummary({
        cfg, nSims, nTrades, finals, returnsPct, maxDDsPct, maxDDsAbs,
        minEquities, cagrs, ruinCount, profitCount,
      }),
    };
  }

  /* ---- Riepilogo statistico dei risultati MC ------------------------ */
  function buildSummary(d) {
    const finalsSorted = Float64Array.from(d.finals).sort();
    const retSorted = Float64Array.from(d.returnsPct).sort();
    const ddSorted = Float64Array.from(d.maxDDsPct).sort();

    const pct = (arr, p) => S.percentileSorted(arr, p);

    const out = {
      initialCapital: d.cfg.initialCapital,
      nSims: d.nSims,
      nTrades: d.nTrades,

      finalMedian: pct(finalsSorted, 50),
      finalMean: S.mean(d.finals),
      finalP5: pct(finalsSorted, 5),
      finalP25: pct(finalsSorted, 25),
      finalP75: pct(finalsSorted, 75),
      finalP95: pct(finalsSorted, 95),
      finalBest: finalsSorted[finalsSorted.length - 1],
      finalWorst: finalsSorted[0],

      retMedian: pct(retSorted, 50),
      retMean: S.mean(d.returnsPct),
      retP5: pct(retSorted, 5),
      retP95: pct(retSorted, 95),
      retStd: S.std(d.returnsPct),

      // VaR / CVaR sui rendimenti (perdita potenziale)
      var95: -pct(retSorted, 5),
      var99: -pct(retSorted, 1),
      cvar95: -tailMean(retSorted, 5),

      ddMedian: pct(ddSorted, 50),
      ddMean: S.mean(d.maxDDsPct),
      ddP95: pct(ddSorted, 95),
      ddP99: pct(ddSorted, 99),
      ddWorst: ddSorted[ddSorted.length - 1],

      probProfit: (d.profitCount / d.nSims) * 100,
      probLoss: ((d.nSims - d.profitCount) / d.nSims) * 100,
      riskOfRuin: (d.ruinCount / d.nSims) * 100,
      ruinThresholdPct: d.cfg.ruinThresholdPct,
    };

    if (d.cagrs) {
      const cagrSorted = Float64Array.from(d.cagrs).sort();
      out.cagrMedian = pct(cagrSorted, 50);
      out.cagrP5 = pct(cagrSorted, 5);
      out.cagrP95 = pct(cagrSorted, 95);
    }
    return out;
  }

  // media della coda inferiore (CVaR / Expected Shortfall)
  function tailMean(sorted, p) {
    const n = sorted.length;
    const cut = Math.max(1, Math.floor((p / 100) * n));
    let s = 0;
    for (let i = 0; i < cut; i++) s += sorted[i];
    return s / cut;
  }

  global.MonteCarlo = { run, analyzeBacktest, buildCurve, maxDrawdown };
})(window);
