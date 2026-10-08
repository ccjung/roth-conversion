# 🏛️ Roth Conversion & IRMAA Optimizer

**Team:** TaxStack Solutions  
**Track:** Theme 2: Experienced Developers — Modernize What Matters  
**Demo Video:** [Insert YouTube Link Here]  
**Live Application:** [Insert Live URL Here]  

---

## 📌 Project Description
The **Roth Conversion & IRMAA Optimizer** modernizes legacy retirement tax planning by transforming static, brittle financial spreadsheets into an interactive, high-performance web decision engine. Built alongside **IBM Bob**, the application models multi-year Roth conversions against dynamic federal tax brackets, state-level tax exemptions, provisional Social Security taxation, and the Medicare 2-year IRMAA lookback. Featuring automated bracket-filling algorithms, targeted "RMD Taming" strategies, and lifetime break-even projections, it identifies the precise conversion schedule that minimizes lifetime taxes and avoids catastrophic benefit surcharges.

---

## 🚀 The Legacy Problem & Modernization Impact
Retirement tax planning historically relied on complex, error-prone desktop spreadsheets or static financial scripts. These legacy tools fail to account for moving regulatory thresholds, inflation drag, and multi-variable interaction cliffs. We modernized this entire architecture into a modular, reactive web platform powered by a custom JavaScript simulation engine capable of running 30-year lifetime projections in milliseconds.

* **Algorithmic Bracket Optimization:** Replaces manual trial-and-error with an automated optimization sweep that fills income up to exact federal tax brackets and Medicare Part B/D thresholds.
* **Targeted "RMD Taming":** Introduces partial conversion modeling to prevent aggressive over-conversion, targeting an optimal remaining pre-tax balance at age 75 to keep future Required Minimum Distributions inside lower tax brackets.
* **Dynamic Regulatory Compliance:** Natively models the SECURE 2.0 Act's tiered RMD start ages (72, 73, and 75) based on birth year, paired with IRS Uniform Lifetime Table divisors.
* **Two-Year IRMAA Lookback:** Faithfully simulates CMS Medicare rules by tracking a rolling two-year MAGI history to accurately project Part B and Part D premium surcharges starting at age 65.
* **Bracket & Threshold Indexation:** Integrates dynamic inflation adjustments across federal brackets, standard deductions, and IRMAA cliffs over multi-decade retirement horizons.
* **Localized State Tax Nuance:** Implements state-specific wealth preservation logic, including zero-tax exemptions on retirement distributions (e.g., Pennsylvania 72 P.S. §7303(a)(3)).

---

## 🤖 How We Built with IBM Bob
IBM Bob served as our core algorithmic pair programmer and full-stack modernization partner throughout the 3-week sprint:

* **Algorithmic Refactoring & Logic Translation:** Translated complex IRS tax code and CMS Medicare regulations into clean, modular JavaScript functions (`calcIRMAA`, `calcRMD`, and `calcSSTax`).
* **Complex Mathematical Debugging:** Bob diagnosed and resolved a subtle headroom circularity issue between Social Security provisional income and conversion amounts, as well as fixing bracket ceiling overshoots in the optimization loops.
* **Rapid UI Architecture:** Generated the responsive Tailwind CSS layout and Recharts data visualization components, styling interactive multi-decade area charts, stacked bar charts, and year-by-year inspection tables.
* **Code Quality & Modernization Documentation:** Leveraged Bob to verify regulatory edge cases, enforce strict type discipline, and generate comprehensive JSDoc comments.

---

## 📊 Core Features

1. **Manual Simulator:** Test custom conversion schedules across 1–15 years with instant KPI feedback on incremental conversion tax, Medicare surcharge exposure, and remaining brokerage liquidity.
2. **Optimize for Me:** Automatically sweeps every tax bracket ceiling, IRMAA boundary, and equal-spread scenario. Ranks strategies by net lifetime cost and highlights the mathematical optimum.
3. **Break-Even Analysis:** Dynamically tracks annual net worth delta between the conversion strategy and a do-nothing baseline, pinpointing the exact crossover age where tax-free compounding surpasses upfront conversion taxes.
4. **Social Security Claiming Age Explorer:** Evaluates claiming at ages 62, 65, FRA (67), and 70 to measure cumulative taxation, provisional income inclusion, and total transferred estate value.

---

## 🛠️ Tech Stack
* **Frontend Framework:** React 18, Vite
* **Styling & Design System:** Tailwind CSS, Lucide Icons
* **Data Visualization:** Recharts
* **AI & Modernization Assistant:** IBM Bob
* **Languages & Runtime:** JavaScript (ES6+), HTML5, CSS3, Node.js

---

## 💻 Local Deployment Instructions

### Prerequisites
* **Node.js:** v18.0.0 or higher
* **npm:** v9.0.0 or higher

### Installation & Setup
1. Clone the repository:
   ```bash
   git clone [https://github.com/YourUsername/roth-conversion-optimizer.git](https://github.com/YourUsername/roth-conversion-optimizer.git)
   cd roth-conversion-optimizer
   
   
   1. Install dependencies:
   Bash
   npm install
   
   2. Start the local development Server:
   Bash
   npm run dev
   
   3. Open your browser and navigate to:
   http://localhost:5173/
   
   Building for Production
   To build the optimized static production bundle:
   Bash
   npm run build
   npm run preview
 
 
 🔮 Future Roadmap
-watsonx Integration: Implement an autonomous financial assistant powered by watsonx 
to provide natural-language executive summaries and personalized strategic rationales for 
recommended conversion schedules.

-Direct Brokerage Ingestion: Develop secure Open Banking / Plaid API integrations to 
automatically ingest real-time account balances, cost basis, and asset allocations.

-Multi-Scenario PDF Reporting: Enable one-click generation of client-facing, compliance-ready 
executive PDF reports for fee-only financial planners and CPAs.
   