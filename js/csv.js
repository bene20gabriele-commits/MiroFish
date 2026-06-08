/* =====================================================================
 *  csv.js — Parser CSV robusto + parsing numerico internazionale
 *  Nessuna dipendenza esterna.
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ---- Rilevamento automatico del separatore di colonna ------------- */
  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
    const candidates = [',', ';', '\t', '|'];
    let best = ',';
    let bestCount = -1;
    for (const d of candidates) {
      // conta solo le occorrenze fuori dalle virgolette
      let count = 0;
      let inQ = false;
      for (let i = 0; i < firstLine.length; i++) {
        const c = firstLine[i];
        if (c === '"') inQ = !inQ;
        else if (c === d && !inQ) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        best = d;
      }
    }
    return best;
  }

  /* ---- Parsing di una riga CSV rispettando le virgolette ------------ */
  function parseLine(line, delim) {
    const out = [];
    let field = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQ = true;
      } else if (c === delim) {
        out.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    out.push(field);
    return out.map((s) => s.trim());
  }

  /* ---- Parsing numerico tollerante (formati IT / US / valuta / %) ---- */
  function parseNumber(raw) {
    if (raw === null || raw === undefined) return NaN;
    let s = String(raw).trim();
    if (s === '') return NaN;

    // segno tra parentesi: (123) => -123 (formato contabile)
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
      negative = true;
      s = s.slice(1, -1);
    }

    // rimuove simboli di valuta, spazi, percentuale e apici
    s = s.replace(/[%\s $€£¥'']/g, '');
    s = s.replace(/[A-Za-z]/g, ''); // eventuali codici valuta (USD, EUR...)

    if (s === '' || s === '-' || s === '+') return NaN;

    const hasDot = s.indexOf('.') !== -1;
    const hasComma = s.indexOf(',') !== -1;

    if (hasDot && hasComma) {
      // l'ultimo separatore che compare è quello decimale
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        // formato IT: 1.234,56
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        // formato US: 1,234.56
        s = s.replace(/,/g, '');
      }
    } else if (hasComma) {
      // solo virgola: decimale (12,5) oppure separatore migliaia (1,234)
      const parts = s.split(',');
      if (parts.length === 2 && parts[1].length !== 3) {
        s = parts[0] + '.' + parts[1]; // decimale
      } else if (parts.length === 2 && parts[0].length > 3) {
        s = parts[0] + '.' + parts[1]; // decimale (es. 1234,5)
      } else {
        s = s.replace(/,/g, ''); // migliaia
      }
    }
    // se solo punto: lasciato così com'è (decimale o migliaia US gestito sopra)

    let n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    if (negative) n = -n;
    return n;
  }

  /* ---- Parsing completo del file CSV -------------------------------- */
  function parse(text) {
    // rimuove BOM
    text = text.replace(/^﻿/, '');
    const delim = detectDelimiter(text);
    const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (rawLines.length === 0) {
      return { headers: [], rows: [], delimiter: delim };
    }

    const headers = parseLine(rawLines[0], delim);
    // Verifica se la prima riga sembra un'intestazione (contiene testo non numerico)
    const firstLooksHeader = headers.some(
      (h) => h !== '' && isNaN(parseNumber(h))
    );

    const dataStart = firstLooksHeader ? 1 : 0;
    const finalHeaders = firstLooksHeader
      ? headers
      : headers.map((_, i) => 'Colonna ' + (i + 1));

    const rows = [];
    for (let i = dataStart; i < rawLines.length; i++) {
      const cells = parseLine(rawLines[i], delim);
      const obj = {};
      for (let c = 0; c < finalHeaders.length; c++) {
        obj[finalHeaders[c]] = cells[c] !== undefined ? cells[c] : '';
      }
      rows.push(obj);
    }
    return { headers: finalHeaders, rows: rows, delimiter: delim };
  }

  /* ---- Euristica: individua la colonna con i P&L delle operazioni ---- */
  function guessPnlColumn(headers, rows) {
    const keywords = [
      'profit', 'p&l', 'pnl', 'p/l', 'pl', 'net', 'netto', 'profitto',
      'utile', 'risultato', 'result', 'return', 'rendimento', 'gain',
      'guadagno', 'pips', 'points', 'punti', 'pip',
    ];
    const lower = headers.map((h) => String(h).toLowerCase());

    // 1) corrispondenza esatta/inclusione per parola chiave (priorità all'ordine)
    for (const kw of keywords) {
      for (let i = 0; i < lower.length; i++) {
        if (lower[i].includes(kw)) {
          // verifica che la colonna contenga numeri
          if (columnIsNumeric(headers[i], rows)) return headers[i];
        }
      }
    }
    // 2) fallback: l'ultima colonna numerica con valori sia positivi che negativi
    let candidate = null;
    for (let i = headers.length - 1; i >= 0; i--) {
      if (columnIsNumeric(headers[i], rows)) {
        const vals = rows
          .map((r) => parseNumber(r[headers[i]]))
          .filter((n) => !isNaN(n));
        const hasNeg = vals.some((v) => v < 0);
        const hasPos = vals.some((v) => v > 0);
        if (hasNeg && hasPos) return headers[i];
        if (!candidate) candidate = headers[i];
      }
    }
    return candidate;
  }

  function columnIsNumeric(header, rows) {
    let numeric = 0;
    let total = 0;
    for (const r of rows) {
      const v = r[header];
      if (v === undefined || v === '') continue;
      total++;
      if (!isNaN(parseNumber(v))) numeric++;
      if (total >= 40) break;
    }
    return total > 0 && numeric / total >= 0.7;
  }

  function numericColumns(headers, rows) {
    return headers.filter((h) => columnIsNumeric(h, rows));
  }

  global.CSV = {
    parse,
    parseNumber,
    guessPnlColumn,
    numericColumns,
    columnIsNumeric,
    detectDelimiter,
  };
})(window);
