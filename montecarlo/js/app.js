/* =====================================================================
 *  app.js — Orchestrazione interfaccia: caricamento CSV, configurazione,
 *           esecuzione Monte Carlo, rendering risultati ed export.
 * ===================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    parsed: null, // { headers, rows }
    pnls: null, // Float64Array dei P&L
    pnlColumn: null,
    backtest: null, // analisi backtest originale
    result: null, // risultato MC
  };

  /* ---------- Utilità di formattazione ------------------------------- */
  const currencyFmt = new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
  function money(v) {
    if (!isFinite(v)) return '∞';
    return currencyFmt.format(v);
  }
  function pct(v, dec) {
    if (!isFinite(v)) return '∞';
    return v.toFixed(dec === undefined ? 1 : dec) + '%';
  }
  function num(v, dec) {
    if (!isFinite(v)) return '∞';
    return v.toFixed(dec === undefined ? 2 : dec);
  }

  /* ---------- Caricamento file --------------------------------------- */
  function initUpload() {
    const drop = $('dropzone');
    const input = $('fileInput');

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('dragover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
      if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files.length) loadFile(e.target.files[0]);
    });

    $('loadSampleBtn').addEventListener('click', loadSample);
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => handleCsvText(e.target.result, file.name);
    reader.onerror = () => toast('Errore nella lettura del file.', true);
    reader.readAsText(file);
  }

  function loadSample() {
    // dataset di esempio generato (200 operazioni, edge positivo realistico)
    const rng = Stats.makeRng(99);
    let lines = ['data,operazione,profit'];
    const start = new Date(2023, 0, 2);
    for (let i = 0; i < 200; i++) {
      const win = rng() < 0.52;
      let p;
      if (win) p = 80 + rng() * 320; // vincite
      else p = -(60 + rng() * 220); // perdite
      const d = new Date(start.getTime() + i * 36 * 3600 * 1000);
      const ds = d.toISOString().slice(0, 10);
      lines.push(`${ds},${win ? 'LONG' : 'SHORT'},${p.toFixed(2)}`);
    }
    handleCsvText(lines.join('\n'), 'esempio_backtest.csv');
  }

  function handleCsvText(text, filename) {
    let parsed;
    try {
      parsed = CSV.parse(text);
    } catch (err) {
      toast('CSV non valido: ' + err.message, true);
      return;
    }
    if (!parsed.rows.length) {
      toast('Il file non contiene righe di dati.', true);
      return;
    }
    state.parsed = parsed;
    $('fileName').textContent = filename + '  ·  ' + parsed.rows.length + ' righe';

    // popola il selettore della colonna P&L
    const numCols = CSV.numericColumns(parsed.headers, parsed.rows);
    const sel = $('pnlColumn');
    sel.innerHTML = '';
    for (const h of (numCols.length ? numCols : parsed.headers)) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      sel.appendChild(opt);
    }
    const guess = CSV.guessPnlColumn(parsed.headers, parsed.rows);
    if (guess) sel.value = guess;

    sel.onchange = () => refreshBacktest();
    refreshBacktest();

    $('configSection').classList.remove('hidden');
    $('configSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Analisi backtest originale ----------------------------- */
  function getConfig() {
    const method = document.querySelector('input[name="method"]:checked').value;
    const sizing = document.querySelector('input[name="sizing"]:checked').value;
    return {
      initialCapital: Math.max(1, parseFloat($('initialCapital').value) || 10000),
      numSims: clampInt($('numSims').value, 100, 100000, 2000),
      numTrades: clampInt($('numTrades').value, 1, 100000, state.pnls ? state.pnls.length : 100),
      tradesPerYear: clampInt($('tradesPerYear').value, 0, 100000, 0),
      ruinThresholdPct: clampFloat($('ruinThreshold').value, 0, 100, 50),
      method,
      sizing,
      isPercent: $('isPercent').checked,
      seed: clampInt($('seed').value, 1, 2147483647, 12345),
    };
  }

  function clampInt(v, lo, hi, def) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = def;
    return Math.min(hi, Math.max(lo, n));
  }
  function clampFloat(v, lo, hi, def) {
    let n = parseFloat(v);
    if (isNaN(n)) n = def;
    return Math.min(hi, Math.max(lo, n));
  }

  function extractPnls(column) {
    const arr = [];
    for (const r of state.parsed.rows) {
      const v = CSV.parseNumber(r[column]);
      if (!isNaN(v)) arr.push(v);
    }
    return Float64Array.from(arr);
  }

  function refreshBacktest() {
    const sel = $('pnlColumn');
    state.pnlColumn = sel.value;
    state.pnls = extractPnls(sel.value);
    if (!state.pnls.length) {
      toast('La colonna selezionata non contiene numeri validi.', true);
      return;
    }
    // aggiorna il default del numero di operazioni
    if (!$('numTrades').dataset.touched) $('numTrades').value = state.pnls.length;

    const cfg = getConfig();
    state.backtest = MonteCarlo.analyzeBacktest(state.pnls, cfg);
    renderBacktestStats(state.backtest);
  }

  function renderBacktestStats(b) {
    const grid = $('backtestStats');
    const rows = [
      ['Operazioni totali', b.trades],
      ['Operazioni vincenti', `${b.wins} (${pct(b.winRate)})`],
      ['Operazioni perdenti', b.losses],
      ['Profitto netto', money(b.netProfit)],
      ['Rendimento totale', pct(b.totalReturnPct)],
      ['Profit factor', num(b.profitFactor)],
      ['Aspettativa / operazione', money(b.expectancy)],
      ['Vincita media', money(b.avgWin)],
      ['Perdita media', money(b.avgLoss)],
      ['Payoff ratio', num(b.payoffRatio)],
      ['Miglior operazione', money(b.bestTrade)],
      ['Peggior operazione', money(b.worstTrade)],
      ['Max drawdown', pct(b.maxDrawdownPct)],
      ['Dev. std / operazione', money(b.stdTrade)],
      ['Sharpe ratio', num(b.sharpe)],
      ['Sortino ratio', num(b.sortino)],
    ];
    grid.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="stat"><span class="stat-k">${k}</span><span class="stat-v">${v}</span></div>`
      )
      .join('');
    $('backtestCard').classList.remove('hidden');
  }

  /* ---------- Esecuzione Monte Carlo --------------------------------- */
  function initRun() {
    $('numTrades').addEventListener('input', () => {
      $('numTrades').dataset.touched = '1';
    });
    // ricalcola backtest quando cambiano parametri rilevanti
    ['initialCapital', 'isPercent'].forEach((id) => {
      $(id).addEventListener('change', () => refreshBacktest());
    });
    // disabilita "numero operazioni" in modalità shuffle
    document.querySelectorAll('input[name="method"]').forEach((el) => {
      el.addEventListener('change', updateMethodHints);
    });
    updateMethodHints();

    $('runBtn').addEventListener('click', runSimulation);
    $('exportBtn').addEventListener('click', exportCsv);
    $('exportJsonBtn').addEventListener('click', exportJson);
  }

  function updateMethodHints() {
    const method = document.querySelector('input[name="method"]:checked').value;
    const ntInput = $('numTrades');
    const hint = $('numTradesHint');
    if (method === 'shuffle') {
      ntInput.disabled = true;
      hint.textContent = 'In modalità "Permutazione" è pari al numero di operazioni storiche.';
    } else {
      ntInput.disabled = false;
      hint.textContent = 'Numero di operazioni per ogni percorso simulato (proiezione futura).';
    }
  }

  function runSimulation() {
    if (!state.pnls || !state.pnls.length) {
      toast('Carica prima un backtest valido.', true);
      return;
    }
    const cfg = getConfig();
    const btn = $('runBtn');
    btn.disabled = true;
    btn.textContent = 'Calcolo in corso…';
    $('runSpinner').classList.remove('hidden');

    // differisce per consentire l'aggiornamento dell'interfaccia
    setTimeout(() => {
      const t0 = performance.now();
      try {
        state.result = MonteCarlo.run(state.pnls, cfg);
      } catch (err) {
        console.error(err);
        toast('Errore durante la simulazione: ' + err.message, true);
        resetRunBtn();
        return;
      }
      const dt = Math.round(performance.now() - t0);
      renderResults(state.result, dt);
      resetRunBtn();
      $('resultsSection').classList.remove('hidden');
      $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  }

  function resetRunBtn() {
    const btn = $('runBtn');
    btn.disabled = false;
    btn.textContent = '▶  Esegui simulazione Monte Carlo';
    $('runSpinner').classList.add('hidden');
  }

  /* ---------- Rendering risultati ------------------------------------ */
  function renderResults(result, elapsedMs) {
    const s = result.summary;
    const cfg = result.cfg;

    // KPI principali
    const kpis = [
      { label: 'Equity finale mediana', value: money(s.finalMedian), sub: pct(s.retMedian) + ' rendimento' },
      { label: 'Probabilità di profitto', value: pct(s.probProfit), sub: pct(s.probLoss) + ' in perdita', tone: s.probProfit >= 50 ? 'good' : 'bad' },
      { label: 'Rischio di rovina', value: pct(s.riskOfRuin), sub: `equity < ${pct(s.ruinThresholdPct, 0)} del capitale`, tone: s.riskOfRuin <= 5 ? 'good' : s.riskOfRuin <= 20 ? 'warn' : 'bad' },
      { label: 'Max drawdown mediano', value: pct(s.ddMedian), sub: 'P95: ' + pct(s.ddP95), tone: s.ddMedian <= 20 ? 'good' : s.ddMedian <= 40 ? 'warn' : 'bad' },
      { label: 'VaR 95%', value: pct(s.var95), sub: 'CVaR: ' + pct(s.cvar95), tone: 'warn' },
      { label: 'Intervallo 90% equity', value: money(s.finalP5), sub: '↔ ' + money(s.finalP95) },
    ];
    $('kpiGrid').innerHTML = kpis
      .map(
        (k) =>
          `<div class="kpi ${k.tone || ''}"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.sub}</div></div>`
      )
      .join('');

    // tabella dettagliata
    const detail = [
      ['Simulazioni eseguite', s.nSims.toLocaleString('it-IT')],
      ['Operazioni per percorso', s.nTrades],
      ['Metodo', methodLabel(cfg.method)],
      ['Dimensionamento', cfg.sizing === 'compound' ? 'Capitalizzazione composta' : 'Importo fisso'],
      ['Capitale iniziale', money(s.initialCapital)],
      ['—', '—'],
      ['Equity finale — media', money(s.finalMean)],
      ['Equity finale — mediana (P50)', money(s.finalMedian)],
      ['Equity finale — P5', money(s.finalP5)],
      ['Equity finale — P25', money(s.finalP25)],
      ['Equity finale — P75', money(s.finalP75)],
      ['Equity finale — P95', money(s.finalP95)],
      ['Scenario migliore', money(s.finalBest)],
      ['Scenario peggiore', money(s.finalWorst)],
      ['—', '—'],
      ['Rendimento mediano', pct(s.retMedian)],
      ['Rendimento medio', pct(s.retMean)],
      ['Dev. std rendimenti', pct(s.retStd)],
      ['VaR 95% (perdita max attesa)', pct(s.var95)],
      ['VaR 99%', pct(s.var99)],
      ['CVaR 95% (Expected Shortfall)', pct(s.cvar95)],
      ['—', '—'],
      ['Max drawdown — mediano', pct(s.ddMedian)],
      ['Max drawdown — medio', pct(s.ddMean)],
      ['Max drawdown — P95', pct(s.ddP95)],
      ['Max drawdown — P99', pct(s.ddP99)],
      ['Max drawdown — peggiore', pct(s.ddWorst)],
      ['—', '—'],
      ['Probabilità di profitto', pct(s.probProfit)],
      ['Probabilità di perdita', pct(s.probLoss)],
      [`Rischio di rovina (soglia ${pct(s.ruinThresholdPct, 0)})`, pct(s.riskOfRuin)],
    ];
    if (s.cagrMedian !== undefined) {
      detail.push(['—', '—']);
      detail.push(['CAGR mediano', pct(s.cagrMedian)]);
      detail.push(['CAGR P5', pct(s.cagrP5)]);
      detail.push(['CAGR P95', pct(s.cagrP95)]);
    }
    $('detailStats').innerHTML = detail
      .map(([k, v]) =>
        k === '—'
          ? '<div class="stat sep"></div>'
          : `<div class="stat"><span class="stat-k">${k}</span><span class="stat-v">${v}</span></div>`
      )
      .join('');

    $('elapsed').textContent = `Calcolato in ${elapsedMs} ms`;

    // grafici
    drawAll(result);

    // interpretazione testuale
    $('interpretation').innerHTML = buildInterpretation(s, cfg);
  }

  function methodLabel(m) {
    return m === 'bootstrap'
      ? 'Bootstrap (ricampionamento con reinserimento)'
      : m === 'shuffle'
      ? 'Permutazione (ordine casuale)'
      : 'Parametrico (distribuzione Normale)';
  }

  function drawAll(result) {
    const s = result.summary;
    Charts.drawFanChart($('fanChart'), result, state.backtest.curve);
    Charts.drawHistogram($('finalHist'), result.finals, {
      xlabel: 'Equity finale (€)',
      zeroRef: result.cfg.initialCapital,
      markers: [
        { value: s.finalP5, label: 'P5', color: '#ff5a6a' },
        { value: s.finalMedian, label: 'P50', color: '#38d39f' },
        { value: s.finalP95, label: 'P95', color: '#3884ff' },
        { value: result.cfg.initialCapital, label: 'Cap.', color: '#ffffff' },
      ],
    });
    Charts.drawHistogram($('ddHist'), result.maxDDsPct, {
      xlabel: 'Max drawdown (%)',
      color: '#ff8a5a',
      fmtX: (v) => v.toFixed(0) + '%',
      markers: [
        { value: s.ddMedian, label: 'P50', color: '#38d39f' },
        { value: s.ddP95, label: 'P95', color: '#ffb020' },
      ],
    });
    Charts.drawHistogram($('retHist'), result.returnsPct, {
      xlabel: 'Rendimento (%)',
      zeroRef: 0,
      fmtX: (v) => v.toFixed(0) + '%',
      markers: [
        { value: s.retMedian, label: 'P50', color: '#38d39f' },
        { value: 0, label: '0', color: '#ffffff' },
      ],
    });
  }

  function buildInterpretation(s, cfg) {
    const parts = [];
    parts.push(
      `Su <b>${s.nSims.toLocaleString('it-IT')}</b> simulazioni di <b>${s.nTrades}</b> operazioni ciascuna, ` +
        `partendo da <b>${money(s.initialCapital)}</b>, l'equity finale mediana è <b>${money(s.finalMedian)}</b> ` +
        `(rendimento mediano <b>${pct(s.retMedian)}</b>).`
    );
    parts.push(
      `Nel <b>90%</b> dei casi l'equity finale è compresa tra <b>${money(s.finalP5)}</b> e <b>${money(s.finalP95)}</b>.`
    );
    const probTone = s.probProfit >= 60 ? 'favorevole' : s.probProfit >= 50 ? 'incerto' : 'sfavorevole';
    parts.push(
      `La probabilità di chiudere in profitto è <b>${pct(s.probProfit)}</b> (profilo <b>${probTone}</b>).`
    );
    parts.push(
      `Il drawdown massimo mediano è <b>${pct(s.ddMedian)}</b>, ma nel 5% degli scenari peggiori supera <b>${pct(s.ddP95)}</b> ` +
        `(caso peggiore osservato: <b>${pct(s.ddWorst)}</b>). Dimensiona il rischio di conseguenza.`
    );
    if (s.riskOfRuin > 0.01) {
      parts.push(
        `⚠️ Il <b>rischio di rovina</b> (equity sotto il ${pct(s.ruinThresholdPct, 0)} del capitale) è <b>${pct(s.riskOfRuin)}</b>.`
      );
    } else {
      parts.push(`✅ Il rischio di rovina è trascurabile (&lt; 0,01%).`);
    }
    parts.push(
      `In termini di rischio di coda, il <b>VaR 95%</b> indica una perdita potenziale fino a <b>${pct(s.var95)}</b> ` +
        `e il <b>CVaR 95%</b> (perdita media nel 5% peggiore) è <b>${pct(s.cvar95)}</b>.`
    );
    return parts.map((p) => `<p>${p}</p>`).join('');
  }

  /* ---------- Export ------------------------------------------------- */
  function exportCsv() {
    if (!state.result) return;
    const r = state.result;
    let lines = ['simulazione,equity_finale,rendimento_pct,max_drawdown_pct,rovina'];
    for (let i = 0; i < r.nSims; i++) {
      lines.push(
        `${i + 1},${r.finals[i].toFixed(2)},${r.returnsPct[i].toFixed(4)},${r.maxDDsPct[i].toFixed(4)},${r.ruined[i]}`
      );
    }
    download(lines.join('\n'), 'montecarlo_risultati.csv', 'text/csv');
  }

  function exportJson() {
    if (!state.result) return;
    const payload = {
      generato: new Date().toISOString(),
      configurazione: state.result.cfg,
      backtest_originale: {
        operazioni: state.backtest.trades,
        win_rate: state.backtest.winRate,
        profit_factor: state.backtest.profitFactor,
        profitto_netto: state.backtest.netProfit,
        max_drawdown_pct: state.backtest.maxDrawdownPct,
        sharpe: state.backtest.sharpe,
        sortino: state.backtest.sortino,
      },
      riepilogo_montecarlo: state.result.summary,
    };
    download(JSON.stringify(payload, null, 2), 'montecarlo_report.json', 'application/json');
  }

  function download(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Toast -------------------------------------------------- */
  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 4000);
  }

  /* ---------- Redraw on resize --------------------------------------- */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!state.result) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => drawAll(state.result), 150);
  });

  /* ---------- Avvio -------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    initUpload();
    initRun();
  });
})();
