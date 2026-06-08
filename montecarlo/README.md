# 📊 Monte Carlo Trading Simulator

Simulatore **Monte Carlo professionale** per l'analisi del rischio di una strategia di trading.
Carichi il tuo **backtest in formato CSV** ed esegui migliaia di simulazioni per stimare
drawdown, rischio di rovina, probabilità di profitto e l'intero intervallo di esiti possibili.

L'applicazione è **completamente offline**: HTML + JavaScript puro, **nessuna dipendenza**,
nessun server, nessuna libreria esterna. Funziona aprendo un singolo file nel browser.

---

## 🚀 Avvio rapido

1. Apri il file **`index.html`** con un qualsiasi browser moderno (doppio clic).
2. **Carica** il tuo backtest CSV (o premi *"Usa un dataset di esempio"*).
3. **Configura** i parametri della simulazione.
4. Premi **"Esegui simulazione Monte Carlo"**.
5. Analizza i risultati ed **esporta** in CSV/JSON.

> In alternativa, per servirlo via HTTP:
> ```bash
> cd montecarlo && python3 -m http.server 8000
> # apri http://localhost:8000
> ```

---

## 📥 Formato del CSV

Esporta lo storico operazioni dal tuo software (MT4/MT5, TradingView, NinjaTrader,
cTrader, Excel…). È sufficiente **una colonna con il profitto/perdita di ogni operazione**.

Il parser è robusto e gestisce automaticamente:

- **Separatori**: virgola `,`, punto e virgola `;`, tab, pipe `|` (rilevamento automatico).
- **Formati numerici**: italiano `1.234,56`, americano `1,234.56`, simboli di valuta `€ $`, percentuali `%`.
- **Numeri negativi** sia con segno `-` sia in formato contabile `(123)`.
- **Intestazione** opzionale (rilevata automaticamente).

La colonna del P&L viene **individuata automaticamente** (cerca `profit`, `pnl`, `p/l`,
`netto`, `risultato`, `rendimento`…) ma puoi sempre selezionarla manualmente.

Esempio (`sample_backtest.csv`):

```csv
data,simbolo,tipo,profit
2023-01-02,EURUSD,LONG,152.30
2023-01-03,EURUSD,SHORT,-88.10
2023-01-05,GBPUSD,LONG,210.45
```

---

## ⚙️ Metodi di simulazione

| Metodo | Descrizione | A cosa serve |
|---|---|---|
| **Bootstrap** | Ricampiona le operazioni **con reinserimento**. | Stima l'incertezza sui risultati **futuri** proiettando N operazioni. |
| **Permutazione** | Usa **le stesse** operazioni in **ordine casuale**. | Misura il **rischio di sequenza**: come cambia il drawdown a parità di trade. |
| **Parametrico** | Estrae da una distribuzione **Normale** stimata su media e dev. std. | Modello sintetico continuo dei rendimenti. |

### Dimensionamento della posizione

- **Importo fisso** — ogni operazione somma il suo P&L (equity additiva).
- **Capitalizzazione composta** — il rischio scala con l'equity corrente (interesse composto).

> Con il dimensionamento *fisso*, la **Permutazione** non altera l'equity finale (la somma è
> invariante) ma rivela come la **sequenza** influenzi il drawdown. Con la *capitalizzazione
> composta*, invece, anche l'ordine modifica il risultato finale.

---

## 📈 Output e metriche

**KPI principali**: equity finale mediana, probabilità di profitto, rischio di rovina,
max drawdown mediano, VaR 95%, intervallo di confidenza al 90%.

**Grafici** (canvas nativo, alta risoluzione):
- **Grafico a ventaglio** dell'equity con bande percentili (P5–P95, P25–P75, mediana) e curva del backtest reale sovrapposta.
- **Istogramma** dell'equity finale.
- **Istogramma** del max drawdown.
- **Istogramma** dei rendimenti.

**Statistiche complete**:
- Equity finale: media, mediana, P5/P25/P75/P95, scenario migliore/peggiore.
- Rendimento: mediano, medio, deviazione standard.
- Rischio di coda: **VaR 95% / 99%**, **CVaR 95%** (Expected Shortfall).
- Drawdown: mediano, medio, P95, P99, peggiore.
- Probabilità di profitto / perdita, **rischio di rovina**.
- **CAGR** e **Sharpe/Sortino** annualizzati (se imposti le operazioni per anno).
- Statistiche del backtest originale: win rate, profit factor, aspettativa, payoff ratio, ecc.

**Export**: risultati grezzi per simulazione in **CSV** e report di sintesi in **JSON**.

---

## 🧮 Parametri

| Parametro | Significato |
|---|---|
| **Capitale iniziale** | Saldo di partenza del conto. |
| **Numero di simulazioni** | Quanti percorsi casuali generare (default 2000; più = più preciso). |
| **Operazioni per percorso** | Lunghezza di ogni simulazione (proiezione futura). |
| **Soglia di rovina** | % del capitale iniziale sotto cui il conto è considerato "rovinato". |
| **Operazioni per anno** | (Opzionale) abilita CAGR e Sharpe/Sortino annualizzati. |
| **Seed casuale** | Stesso seed ⇒ risultati riproducibili. |
| **Tipo di valore** | Valuta (€/$) oppure percentuale (%). |

---

## 🗂️ Struttura del progetto

```
montecarlo/
├── index.html          # Interfaccia
├── css/styles.css      # Tema scuro professionale
├── js/
│   ├── csv.js          # Parser CSV + parsing numerico internazionale
│   ├── stats.js        # Statistica + RNG con seed (Mulberry32)
│   ├── montecarlo.js   # Motore di simulazione Monte Carlo
│   ├── charts.js       # Grafici su canvas (nessuna libreria)
│   └── app.js          # Orchestrazione UI / export
└── sample_backtest.csv # Dataset di esempio
```

---

## ⚠️ Avvertenza

Strumento di **analisi statistica** a scopo didattico e professionale. Le simulazioni si
basano sui dati storici forniti e **non garantiscono** i risultati futuri.
**Le performance passate non sono indicative di quelle future.**
