# Roth Conversion & IRMAA Optimizer

**Team:** TaxStack Solutions  
**Track:** Theme 2 — Experienced Developers: Modernize What Matters  
**Demo Video:** *(insert YouTube link)*  
**Live App:** *https://roth-conversion-eta.vercel.app/*

---

## Project Description

The **Roth Conversion & IRMAA Optimizer** modernizes legacy retirement tax planning by replacing static, error-prone spreadsheets with an interactive, browser-based decision engine. Built alongside **IBM Bob**, the application models multi-year Roth conversions against dynamic federal tax brackets, state-level tax exemptions, provisional Social Security taxation, and the Medicare 2-year IRMAA lookback — and produces a ranked conversion schedule that minimizes lifetime taxes and avoids Medicare surcharge cliffs.

---

## The Legacy Problem & Modernization Impact

Retirement tax planning historically relied on complex desktop spreadsheets or static financial scripts that fail to account for moving regulatory thresholds, inflation drag, and multi-variable interaction cliffs.

| Legacy Approach | This Tool |
|---|---|
| Manual trial-and-error bracket guessing | Automated sweep of every bracket ceiling & IRMAA boundary |
| Flat RMD estimates at a fixed age | SECURE 2.0 tiered start ages (72 / 73 / 75) by birth year |
| Static IRMAA threshold (year 0 only) | Per-year inflation-scaled IRMAA thresholds with 2-yr lookback |
| No Social Security interaction modeling | Provisional income formula (IRS §86) with SS taxation phase-in |
| State tax ignored | 51-state conversion-specific rates and exemptions |

---

## Features

### 📊 Manual Simulator
Test any custom conversion schedule. Instant KPI output: incremental conversion tax, IRMAA surcharge exposure, brokerage liquidity, and projected RMDs vs. the do-nothing baseline. Export year-by-year results to CSV.

### ⚡ Optimize for Me
Sweeps every tax bracket ceiling, IRMAA boundary, and equal-spread option. Ranks strategies by **net lifetime cost** (federal tax + IRMAA + SS tax) and highlights the mathematical optimum. Supports:
- **Max Bracket Cap** — hard ceiling on marginal rate (e.g. never exceed 22%)
- **RMD Taming** — partial conversions that target a remaining balance at RMD age to keep future distributions inside a specified dollar ceiling
- **IRMAA Tolerance** — filter strategies that breach Medicare surcharge tiers

### 🎯 Bracket Comparison
Side-by-side view of every strategy's lifetime cost, peak marginal rate, IRMAA exposure, and SS taxation. Apply any strategy to the Manual Simulator in one click.

### 📈 Break-Even Analysis
Tracks annual net-worth delta between the Roth conversion strategy and the do-nothing baseline. Pinpoints the exact crossover age where tax-free compounding surpasses the upfront conversion tax cost.

### 🔵 Social Security Claiming Age Explorer
Evaluates claiming at ages 62, 65, FRA (67), and 70. Compares cumulative SS taxation, provisional income inclusion, and total estate value across all four scenarios.

---

## Calculation Engine (`simulationEngine.js`)

All math lives in a single pure-JS module with no external calculation dependencies. Key exports:

| Export | Description |
|---|---|
| `runSimulation(inputs)` | Year-by-year projection: balances, taxes, IRMAA, RMDs |
| `optimizeConversion(inputs, opts)` | Ranked strategy sweep with bracket/RMD/IRMAA constraints |
| `runLifetimeProjection(inputs)` | 30-year lifetime income stream for a given strategy |
| `calcBreakEven(inputs)` | Net-worth crossover age vs. do-nothing baseline |
| `calcSSClaimingComparison(inputs)` | 4-scenario Social Security claiming analysis |
| `calcFederalTax(income, status, inflRate, yr)` | 2025 federal tax (IRS Rev. Proc. 2024-40), inflation-scaled |
| `calcIRMAA(magi, status, age, lookbackMagi, ...)` | Medicare Part B/D surcharge with 2-year lookback |
| `calcRMD(balance, age, birthYear)` | RMD using IRS Uniform Lifetime Table + SECURE 2.0 ages |
| `calcSSTax(ssBenefit, otherAGI, status)` | Provisional income formula (up to 85% inclusion) |
| `STATE_TAX_RATES` / `STATE_TAX_NOTES` | 51-state conversion-specific rates & exemption notes |

### Tax Law Accuracy
- **2025 federal brackets** — IRS Rev. Proc. 2024-40 (inflation-indexed per year modeled)
- **SECURE 2.0** — RMD start age 72 (born ≤ 1950), 73 (1951–1959), 75 (1960+)
- **IRMAA 2026 thresholds** — $109k single / $218k MFJ, inflated forward each year
- **CMS 2-year lookback** — IRMAA at age 65 driven by MAGI from age 63
- **SS provisional income** — 50% inclusion above $25k single / $32k MFJ; 85% above $34k / $44k

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5 |
| Charts | Recharts 3 |
| Styling | Inline CSS (no Tailwind dependency) |
| Engine | Vanilla JavaScript ES modules |
| AI Partner | IBM Bob |
| Runtime | Node.js 18+ |

---

## Local Development

### Prerequisites
- **Node.js** v18.0.0 or higher
- **npm** v9.0.0 or higher

### Install & Run

```bash
git clone https://github.com/YourUsername/roth-conversion-optimizer.git
cd roth-conversion-optimizer
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production bundle locally
```

### Run Engine Tests

```bash
node test.mjs
```

Runs 30 unit tests covering federal tax spot checks, IRMAA tier boundaries, SECURE 2.0 RMD start ages, IRS Uniform Lifetime Table divisors, and 2-year lookback logic. All tests must pass before any engine change is merged.

---

## How We Built with IBM Bob

IBM Bob served as our core algorithmic pair programmer throughout the sprint:

- **Regulatory translation** — Converted IRS Rev. Proc. 2024-40 bracket tables, CMS IRMAA schedules, and SECURE 2.0 RMD rules into clean, tested JavaScript functions.
- **Algorithm design** — Bob co-designed the `bracketFillSchedule` iterative solver that resolves the Social Security provisional-income circularity (SS income affects the conversion headroom, which affects SS income) in ≤ 6 iterations.
- **Debugging** — Diagnosed bracket ceiling overshoots in the optimization sweep and the IRMAA lookback age-offset logic.
- **UI architecture** — Generated the five-tab responsive dashboard, Recharts data visualization components, and the print/PDF stylesheet.
- **Test coverage** — Helped author the 30-test suite verifying regulatory edge cases and mathematical invariants.

---

## Project Structure

```
roth-optimizer-hackathon/
├── simulationEngine.js   # All calculation logic — no UI dependencies
├── test.mjs              # 30-test engine validation suite
├── src/
│   ├── App.jsx           # Five-tab React dashboard
│   ├── main.jsx          # Vite entry point
│   └── index.css         # Global styles + @media print stylesheet
├── index.html
├── vite.config.js
└── package.json
```

---

## Future Roadmap

- **watsonx Integration** — Natural-language executive summaries and personalized strategic rationales powered by watsonx, explaining *why* the recommended strategy wins in plain English.
- **Direct Brokerage Ingestion** — Secure Open Banking / Plaid API integration to auto-populate account balances, cost basis, and asset allocations.
- **Multi-Scenario PDF Reports** — One-click generation of client-facing, compliance-ready executive PDF reports for fee-only financial planners and CPAs.
- **RMD Aggregation** — Support for multiple IRA accounts with per-account balance tracking and aggregated RMD calculations.

---

## Disclaimer

This tool is for educational and planning purposes only. It does not constitute tax, legal, or financial advice. Consult a qualified tax professional or CPA before making conversion decisions.
