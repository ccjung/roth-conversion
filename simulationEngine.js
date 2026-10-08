/**
 * simulationEngine.js
 * Roth Conversion & Retirement Tax Modeling Engine
 *
 * Calculates year-by-year projections for Traditional IRA, Roth IRA, and
 * Taxable Brokerage accounts during a multi-year Roth conversion strategy.
 * Includes federal income tax estimates, 2026 Medicare IRMAA threshold
 * checks, projected RMD comparisons, state income tax, break-even analysis,
 * and Social Security claiming-age comparison.
 */

// ---------------------------------------------------------------------------
// 2025 Federal Income Tax Brackets (IRS Rev. Proc. 2024-40)
// ---------------------------------------------------------------------------
const TAX_BRACKETS = {
  single: [
    { rate: 0.10, min: 0,       max: 11925 },
    { rate: 0.12, min: 11925,   max: 48475 },
    { rate: 0.22, min: 48475,   max: 103350 },
    { rate: 0.24, min: 103350,  max: 197300 },
    { rate: 0.32, min: 197300,  max: 250525 },
    { rate: 0.35, min: 250525,  max: 626350 },
    { rate: 0.37, min: 626350,  max: Infinity },
  ],
  mfj: [
    { rate: 0.10, min: 0,       max: 23850 },
    { rate: 0.12, min: 23850,   max: 96950 },
    { rate: 0.22, min: 96950,   max: 206700 },
    { rate: 0.24, min: 206700,  max: 394600 },
    { rate: 0.32, min: 394600,  max: 501050 },
    { rate: 0.35, min: 501050,  max: 751600 },
    { rate: 0.37, min: 751600,  max: Infinity },
  ],
};

// Standard deductions for 2025 (IRS Rev. Proc. 2024-40)
const STANDARD_DEDUCTION = { single: 15000, mfj: 30000 };

// ---------------------------------------------------------------------------
// State income tax on Roth conversions (IRA distributions), 2024.
//
// Rate = effective marginal rate applied to a traditional→Roth conversion.
//
// KEY EXEMPTION CATEGORIES
// ────────────────────────
// A) NO income tax at all (9 states + DC opt-out):
//    AK, FL, NV, NH, SD, TN, TX, WA, WY  → rate = 0
//
// B) Has income tax but FULLY EXEMPTS IRA distributions / Roth conversions:
//    AL, IL, MS, PA  → rate = 0 (conversion is not taxable income)
//    Sources:
//      PA: 72 P.S. §7303(a)(3) — IRA distributions not taxable PA income
//      IL: 35 ILCS 5/203(a)(2)(F) — retirement income subtracted from base
//      MS: Miss. Code §27-7-15(4) — retirement distributions fully exempt
//      AL: Ala. Code §40-18-19(a)(4) — IRA distributions exempt
//
// C) PARTIAL exemption — only a portion of the conversion may be exempt;
//    model uses the residual marginal rate on the taxable portion:
//    GA: $65k/person retirement exclusion (age 65+); excess taxed at 5.49%
//        → model uses full 5.49% (conservative; actual may be lower)
//    MI: pension/IRA deduction up to $63,990 MFJ (born before 1946);
//        → model uses full 4.25% (conservative)
//    IN: no retirement exclusion for IRA income → full 3.05%
//    NJ: no IRA exclusion for conversions (only pension exclusion applies)
//        → model uses full 10.75%
//
// D) All remaining states: full marginal rate applies to conversion income.
//
// IMPORTANT: State tax law changes frequently. Always verify with a CPA
// licensed in your state before executing a conversion strategy.
// ---------------------------------------------------------------------------
export const STATE_TAX_RATES = {
  // ── No income tax (9 states) ────────────────────────────────────────────
  "None (no state tax)":  0,
  "AK – Alaska":          0,   // no income tax
  "FL – Florida":         0,   // no income tax
  "NV – Nevada":          0,   // no income tax
  "NH – New Hampshire":   0,   // no income tax (interest/dividends only, repealed 2027)
  "SD – South Dakota":    0,   // no income tax
  "TN – Tennessee":       0,   // no income tax
  "TX – Texas":           0,   // no income tax
  "WA – Washington":      0,   // no income tax (capital gains tax only, not ordinary income)
  "WY – Wyoming":         0,   // no income tax
  // ── Full IRA/Roth conversion exemption ──────────────────────────────────
  "AL – Alabama":         0,   // IRA distributions fully exempt (Ala. Code §40-18-19)
  "IL – Illinois":        0,   // retirement income fully exempt (35 ILCS 5/203)
  "MS – Mississippi":     0,   // retirement distributions fully exempt (§27-7-15)
  "PA – Pennsylvania":    0,   // IRA distributions NOT PA taxable income (72 P.S. §7303)
  // ── Taxed at full marginal rate ─────────────────────────────────────────
  "AZ – Arizona":         0.025,
  "AR – Arkansas":        0.044,
  "CA – California":      0.093,
  "CO – Colorado":        0.044,
  "CT – Connecticut":     0.069,
  "DC – Dist. of Columbia": 0.0895,
  "DE – Delaware":        0.066,
  "GA – Georgia":         0.0549, // partial $65k exclusion (age 65+); model uses full rate
  "HI – Hawaii":          0.11,   // IRA-to-Roth conversions taxable in HI
  "IA – Iowa":            0.057,
  "ID – Idaho":           0.058,
  "IN – Indiana":         0.0305, // no IRA exclusion
  "KS – Kansas":          0.057,
  "KY – Kentucky":        0.045,
  "LA – Louisiana":       0.043,
  "MA – Massachusetts":   0.05,
  "MD – Maryland":        0.0575,
  "ME – Maine":           0.0715,
  "MI – Michigan":        0.0425, // partial pension/IRA deduction; model uses full rate
  "MN – Minnesota":       0.098,
  "MO – Missouri":        0.048,
  "MT – Montana":         0.059,
  "NC – North Carolina":  0.0475,
  "ND – North Dakota":    0.025,
  "NE – Nebraska":        0.0684,
  "NJ – New Jersey":      0.1075, // no IRA exclusion for conversions
  "NM – New Mexico":      0.059,
  "NY – New York":        0.0685,
  "OH – Ohio":            0.035,
  "OK – Oklahoma":        0.0475,
  "OR – Oregon":          0.099,
  "RI – Rhode Island":    0.0599,
  "SC – South Carolina":  0.064,
  "UT – Utah":            0.0485,
  "VA – Virginia":        0.0575,
  "VT – Vermont":         0.0875,
  "WI – Wisconsin":       0.0765,
  "WV – West Virginia":   0.065,
};

// Human-readable notes shown in the UI tooltip for each state entry.
export const STATE_TAX_NOTES = {
  "None (no state tax)":  "No state income tax selected.",
  "AK – Alaska":          "No state income tax.",
  "FL – Florida":         "No state income tax.",
  "NV – Nevada":          "No state income tax.",
  "NH – New Hampshire":   "No income tax on wages/conversions (interest & dividends tax repealed 2027).",
  "SD – South Dakota":    "No state income tax.",
  "TN – Tennessee":       "No state income tax.",
  "TX – Texas":           "No state income tax.",
  "WA – Washington":      "No income tax on ordinary income (capital gains tax only, does not apply to conversions).",
  "WY – Wyoming":         "No state income tax.",
  "AL – Alabama":         "✅ IRA distributions & Roth conversions are fully exempt from Alabama income tax (Ala. Code §40-18-19).",
  "IL – Illinois":        "✅ All retirement income (including IRA distributions & Roth conversions) is fully exempt from Illinois income tax (35 ILCS 5/203).",
  "MS – Mississippi":     "✅ Retirement income distributions, including IRA-to-Roth conversions, are fully exempt from Mississippi income tax (§27-7-15).",
  "PA – Pennsylvania":    "✅ IRA distributions are NOT taxable Pennsylvania income (72 P.S. §7303(a)(3)). Roth conversions are effectively $0 PA tax.",
  "GA – Georgia":         "⚠ Partial: $65,000/person retirement income exclusion at age 65+. Excess conversion is taxed at 5.49%. Model uses full rate (conservative).",
  "MI – Michigan":        "⚠ Partial: Pension/IRA deduction available depending on birth year (up to $63,990 MFJ for pre-1946). Model uses full 4.25% (conservative).",
  "IN – Indiana":         "No retirement income exclusion for IRA distributions in Indiana. Full 3.05% applies.",
  "NJ – New Jersey":      "No IRA exclusion for Roth conversions in NJ (pension exclusion does not apply). Full 10.75% applies.",
  "HI – Hawaii":          "IRA-to-Roth conversions are taxable in Hawaii (employer pension exemption does not cover IRA conversions).",
};

// ---------------------------------------------------------------------------
// 2026 Medicare IRMAA Tiers
// Thresholds based on projected 2026 CMS schedule.
// Base Part B monthly premium: $185.00 (projected).
// ---------------------------------------------------------------------------
const IRMAA_TIERS = {
  single: [
    { maxMAGI: 109000,   tier: 0, label: "No IRMAA",  partBMonthly: 185.00, partDMonthly: 0.00  },
    { maxMAGI: 136000,   tier: 1, label: "Tier 1",    partBMonthly: 259.00, partDMonthly: 13.70 },
    { maxMAGI: 163000,   tier: 2, label: "Tier 2",    partBMonthly: 370.00, partDMonthly: 35.30 },
    { maxMAGI: 196000,   tier: 3, label: "Tier 3",    partBMonthly: 480.90, partDMonthly: 57.00 },
    { maxMAGI: 500000,   tier: 4, label: "Tier 4",    partBMonthly: 591.90, partDMonthly: 78.60 },
    { maxMAGI: Infinity, tier: 5, label: "Tier 5",    partBMonthly: 628.90, partDMonthly: 85.80 },
  ],
  mfj: [
    { maxMAGI: 218000,   tier: 0, label: "No IRMAA",  partBMonthly: 185.00, partDMonthly: 0.00  },
    { maxMAGI: 272000,   tier: 1, label: "Tier 1",    partBMonthly: 259.00, partDMonthly: 13.70 },
    { maxMAGI: 326000,   tier: 2, label: "Tier 2",    partBMonthly: 370.00, partDMonthly: 35.30 },
    { maxMAGI: 392000,   tier: 3, label: "Tier 3",    partBMonthly: 480.90, partDMonthly: 57.00 },
    { maxMAGI: 750000,   tier: 4, label: "Tier 4",    partBMonthly: 591.90, partDMonthly: 78.60 },
    { maxMAGI: Infinity, tier: 5, label: "Tier 5",    partBMonthly: 628.90, partDMonthly: 85.80 },
  ],
};

// IRS Uniform Lifetime Table divisors for RMD calculation (ages 72–90+)
const ULT = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
  78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
  84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
  90: 12.2,
};

// ---------------------------------------------------------------------------
// SECURE 2.0 Act — RMD start age rules (enacted Dec 2022)
//
//   Born 1950 or earlier  → age 72  (pre-SECURE / SECURE 1.0)
//   Born 1951 – 1959      → age 73  (SECURE 2.0, effective 2023)
//   Born 1960 or later    → age 75  (SECURE 2.0, effective 2033)
// ---------------------------------------------------------------------------
export function rmdStartAge(birthYear) {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

// ---------------------------------------------------------------------------
// Bracket inflation helpers
// ---------------------------------------------------------------------------

/**
 * Return a copy of the tax bracket array for a given filing status with
 * thresholds compounded by (1 + inflationRate)^yearIndex.
 * yearIndex = 0 (or inflationRate = 0) returns the original 2025 values.
 */
function scaledBrackets(filingStatus, inflationRate, yearIndex) {
  const factor = Math.pow(1 + (inflationRate ?? 0), yearIndex ?? 0);
  if (factor === 1) return TAX_BRACKETS[filingStatus]; // fast path
  return TAX_BRACKETS[filingStatus].map(b => ({
    rate: b.rate,
    min:  b.min  === 0        ? 0        : b.min  * factor,
    max:  b.max  === Infinity ? Infinity : b.max  * factor,
  }));
}

/**
 * Return the standard deduction scaled by inflation.
 */
function scaledStdDed(filingStatus, inflationRate, yearIndex) {
  const factor = Math.pow(1 + (inflationRate ?? 0), yearIndex ?? 0);
  return STANDARD_DEDUCTION[filingStatus] * factor;
}

/**
 * Return a copy of the IRMAA tiers with maxMAGI scaled by inflation.
 */
function scaledIrmaaTiers(filingStatus, inflationRate, yearIndex) {
  const factor = Math.pow(1 + (inflationRate ?? 0), yearIndex ?? 0);
  if (factor === 1) return IRMAA_TIERS[filingStatus]; // fast path
  return IRMAA_TIERS[filingStatus].map(t => ({
    ...t,
    maxMAGI: t.maxMAGI === Infinity ? Infinity : t.maxMAGI * factor,
  }));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Calculate federal income tax owed for a given taxable income.
 * @param {number} taxableIncome
 * @param {"single"|"mfj"} filingStatus
 * @param {number} [inflationRate=0]  Annual bracket inflation rate (0–1)
 * @param {number} [yearIndex=0]      Number of years from base year (2025)
 * @returns {number}
 */
export function calcFederalTax(taxableIncome, filingStatus, inflationRate = 0, yearIndex = 0) {
  if (taxableIncome <= 0) return 0;
  const brackets = scaledBrackets(filingStatus, inflationRate, yearIndex);
  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    tax += (Math.min(taxableIncome, b.max) - b.min) * b.rate;
  }
  return tax;
}

/**
 * Derive effective and marginal tax rates from taxable income.
 * @param {number} taxableIncome
 * @param {"single"|"mfj"} filingStatus
 * @param {number} [inflationRate=0]
 * @param {number} [yearIndex=0]
 * @returns {{ effectiveRate: number, marginalRate: number }}
 */
export function calcTaxRates(taxableIncome, filingStatus, inflationRate = 0, yearIndex = 0) {
  if (taxableIncome <= 0) return { effectiveRate: 0, marginalRate: 0 };
  const brackets = scaledBrackets(filingStatus, inflationRate, yearIndex);
  const tax = calcFederalTax(taxableIncome, filingStatus, inflationRate, yearIndex);
  const effectiveRate = tax / taxableIncome;
  let marginalRate = brackets[0].rate;
  for (const b of brackets) {
    if (taxableIncome > b.min) marginalRate = b.rate;
  }
  return { effectiveRate, marginalRate };
}

// Sentinel "no IRMAA" result — returned for any year where Medicare does not apply.
const NO_IRMAA = {
  tier: 0, label: "No IRMAA", partBMonthly: 0, partDMonthly: 0,
  annualSurcharge: 0, crossesThreshold: false, onMedicare: false,
};

/**
 * Determine the IRMAA tier that actually applies to a person in a given year.
 *
 * Medicare (and therefore IRMAA) only applies at age 65+.
 * IRMAA uses a 2-year lookback: the surcharge for year Y is based on the
 * MAGI reported on the tax return filed for year Y-2.
 *
 * Call this function with:
 *   magi         — the MAGI earned THIS year (will affect IRMAA two years later)
 *   filingStatus — filing status
 *   age          — the person's age THIS year (used to decide if Medicare applies)
 *   magiTwoYearsAgo — MAGI from two years prior (what drives THIS year's IRMAA)
 *                     Pass null/undefined if age < 65 or history not yet available.
 *
 * Returns two separate objects:
 *   currentIRMAA  — the IRMAA surcharge actually owed THIS year (based on 2-yr-ago MAGI)
 *   futureIRMAA   — the IRMAA that THIS year's MAGI will cause in two years (a preview)
 *
 * @param {number} magi
 * @param {"single"|"mfj"} filingStatus
 * @param {number} age
 * @param {number|null} magiTwoYearsAgo
 * @returns {{ currentIRMAA: object, futureIRMAA: object }}
 */
/**
 * @param {number} magi
 * @param {"single"|"mfj"} filingStatus
 * @param {number} [age=65]
 * @param {number|null} [magiTwoYearsAgo=null]
 * @param {number} [inflationRate=0]   Annual IRMAA threshold inflation (0–1)
 * @param {number} [yearIndex=0]       Years from 2025 baseline
 */
export function calcIRMAA(magi, filingStatus, age = 65, magiTwoYearsAgo = null,
                          inflationRate = 0, yearIndex = 0) {
  const tiers = scaledIrmaaTiers(filingStatus, inflationRate, yearIndex);
  const basePremium = IRMAA_TIERS[filingStatus][0].partBMonthly; // premiums not inflation-adjusted

  function tierForMagi(m) {
    if (m == null || m <= 0) return { ...NO_IRMAA, onMedicare: true };
    for (const t of tiers) {
      if (m <= t.maxMAGI) {
        return {
          tier: t.tier, label: t.label,
          partBMonthly: t.partBMonthly, partDMonthly: t.partDMonthly,
          annualSurcharge: round2((t.partBMonthly - basePremium + t.partDMonthly) * 12),
          crossesThreshold: t.tier > 0, onMedicare: true,
        };
      }
    }
    const last = tiers[tiers.length - 1];
    return {
      tier: last.tier, label: last.label,
      partBMonthly: last.partBMonthly, partDMonthly: last.partDMonthly,
      annualSurcharge: round2((last.partBMonthly - basePremium + last.partDMonthly) * 12),
      crossesThreshold: true, onMedicare: true,
    };
  }

  // Before Medicare eligibility — no IRMAA at all
  if (age < 65) {
    return {
      currentIRMAA: { ...NO_IRMAA },
      futureIRMAA:  tierForMagi(magi),
    };
  }

  // On Medicare: current year's surcharge is driven by 2-years-ago MAGI
  const currentIRMAA = tierForMagi(magiTwoYearsAgo);
  const futureIRMAA  = tierForMagi(magi);

  return { currentIRMAA, futureIRMAA };
}

/**
 * Backwards-compatible single-value wrapper used in tests and simple lookups.
 * Returns the IRMAA tier for a given MAGI regardless of age (no lookback).
 * Accepts optional inflation params for forward-looking analysis.
 */
export function calcIRMAARaw(magi, filingStatus, inflationRate = 0, yearIndex = 0) {
  const tiers = scaledIrmaaTiers(filingStatus, inflationRate, yearIndex);
  const basePremium = IRMAA_TIERS[filingStatus][0].partBMonthly;
  for (const t of tiers) {
    if (magi <= t.maxMAGI) {
      return {
        tier: t.tier, label: t.label,
        partBMonthly: t.partBMonthly, partDMonthly: t.partDMonthly,
        annualSurcharge: round2((t.partBMonthly - basePremium + t.partDMonthly) * 12),
        crossesThreshold: t.tier > 0, onMedicare: true,
      };
    }
  }
  const last = tiers[tiers.length - 1];
  return {
    tier: last.tier, label: last.label,
    partBMonthly: last.partBMonthly, partDMonthly: last.partDMonthly,
    annualSurcharge: round2((last.partBMonthly - basePremium + last.partDMonthly) * 12),
    crossesThreshold: true, onMedicare: true,
  };
}

/**
 * Calculate the Required Minimum Distribution for a given balance, age,
 * and birth year (used to derive the correct SECURE 2.0 start age).
 * Returns 0 if the owner has not yet reached their RMD start age.
 * @param {number} balance    Starting balance for the RMD year
 * @param {number} age        Owner's age during the RMD year
 * @param {number} birthYear  Owner's birth year (determines start age)
 * @returns {number}
 */
export function calcRMD(balance, age, birthYear) {
  const startAge = rmdStartAge(birthYear);
  if (age < startAge) return 0;
  const divisor = ULT[Math.min(age, 90)] ?? 12.2;
  return balance / divisor;
}

/** Financial rounding to 2 decimal places. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

/**
 * Run the multi-year Roth conversion simulation.
 *
 * @param {object} inputs
 * @param {number}           inputs.traditionalIRABalance    Starting Traditional IRA ($)
 * @param {number}           inputs.taxableBrokerageBalance  Starting Taxable Brokerage ($, used for taxes)
 * @param {number}           inputs.annualRothConversion     Annual conversion amount ($)
 * @param {number}           inputs.conversionYears          Number of conversion years
 * @param {number}           inputs.growthRate               Annual growth rate (0–1, e.g. 0.07)
 * @param {"single"|"mfj"}   inputs.filingStatus             Tax filing status
 * @param {number}           [inputs.currentAge=60]          Account owner's current age
 * @param {number}           [inputs.otherOrdinaryIncome=0]  Other annual ordinary income ($)
 *
 * @returns {{ inputs: object, years: YearResult[], summary: object }}
 */
export function runSimulation(inputs) {
  const {
    traditionalIRABalance,
    taxableBrokerageBalance,
    annualRothConversion,
    conversionYears,
    growthRate,
    filingStatus,
    currentAge = 60,
    otherOrdinaryIncome = 0,
    payTaxFromConversion = false,
    birthYear = new Date().getFullYear() - currentAge,
    stateTaxRate = 0,
    // Annual bracket/threshold inflation rate (0–1, default 0 = no inflation adjustment).
    inflationRate = 0,
  } = inputs;

  // Input validation
  if (!["single", "mfj"].includes(filingStatus)) {
    throw new Error(`filingStatus must be "single" or "mfj", got: "${filingStatus}"`);
  }
  if (growthRate < 0 || growthRate > 1) {
    throw new Error(`growthRate must be between 0 and 1, got: ${growthRate}`);
  }
  if (!Number.isInteger(conversionYears) || conversionYears < 0) {
    throw new Error(`conversionYears must be a non-negative integer, got: ${conversionYears}`);
  }

  const rmdAge = rmdStartAge(birthYear);

  // Mutable account balances
  let tradIRA      = traditionalIRABalance;
  let rothIRA      = 0;
  let taxBrokerage = taxableBrokerageBalance;

  // Do-nothing baseline: no conversions, Traditional IRA grows untouched
  let baselineTradIRA = traditionalIRABalance;

  const years = [];
  // Rolling 2-year MAGI history for IRMAA lookback: index 0 = 2 years ago, 1 = 1 year ago
  const magiHistory = [null, null];

  for (let i = 0; i < conversionYears; i++) {
    const age = currentAge + i;

    // Inflation-adjusted brackets and thresholds for this year
    const stdDeduction = scaledStdDed(filingStatus, inflationRate, i);

    // Conversion cannot exceed current balance
    const conversionAmount = Math.min(annualRothConversion, tradIRA);

    // --- Federal + State tax ---
    const grossIncome    = otherOrdinaryIncome + conversionAmount;
    const taxableIncome  = Math.max(0, grossIncome - stdDeduction);
    const federalTax     = calcFederalTax(taxableIncome, filingStatus, inflationRate, i);
    const stateTax       = grossIncome * stateTaxRate;
    const totalTax       = federalTax + stateTax;

    const baseGross     = otherOrdinaryIncome;
    const federalBase   = calcFederalTax(Math.max(0, baseGross - stdDeduction), filingStatus, inflationRate, i);
    const stateBase     = baseGross * stateTaxRate;
    const conversionTax = (federalTax + stateTax) - (federalBase + stateBase);

    const { effectiveRate, marginalRate } = calcTaxRates(taxableIncome, filingStatus, inflationRate, i);

    // --- MAGI & IRMAA with 2-year lookback (IRMAA thresholds also inflation-adjusted) ---
    const magi = grossIncome;
    const { currentIRMAA: irmaa, futureIRMAA } = calcIRMAA(
      magi, filingStatus, age, magiHistory[0], inflationRate, i
    );
    magiHistory[0] = magiHistory[1];
    magiHistory[1] = magi;

    // --- Apply conversion (deduct from Trad, add to Roth) ---
    tradIRA -= conversionAmount;

    // Total taxes paid from taxable brokerage (capped at available balance)
    const taxPaidFromBrokerage = Math.min(totalTax, taxBrokerage);
    taxBrokerage -= taxPaidFromBrokerage;

    // Shortfall: tax the brokerage couldn't cover
    const taxShortfall = totalTax - taxPaidFromBrokerage;
    const brokerageExhausted = taxShortfall > 0;

    // If payTaxFromConversion, withhold the shortfall from the Roth deposit
    const rothDeposit = payTaxFromConversion
      ? conversionAmount - taxShortfall
      : conversionAmount;
    rothIRA += Math.max(0, rothDeposit);

    // --- Apply annual growth to all accounts ---
    tradIRA      *= (1 + growthRate);
    rothIRA      *= (1 + growthRate);
    taxBrokerage *= (1 + growthRate);
    baselineTradIRA *= (1 + growthRate);

    // --- RMD projection ---
    // IRS uses the prior year-end balance; approximate with pre-growth balance
    const startOfYearTrad     = tradIRA / (1 + growthRate);
    const startOfYearBaseline = baselineTradIRA / (1 + growthRate);
    const nextAge             = age + 1;

    const projectedRMD = calcRMD(startOfYearTrad,     nextAge, birthYear);
    const baselineRMD  = calcRMD(startOfYearBaseline, nextAge, birthYear);

    years.push({
      year:            i + 1,
      age,
      conversionAmount:        round2(conversionAmount),
      // End-of-year balances (post-growth)
      endingTraditionalIRA:    round2(tradIRA),
      endingRothIRA:           round2(rothIRA),
      endingTaxableBrokerage:  round2(taxBrokerage),
      // Tax analysis
      grossIncome:             round2(grossIncome),
      taxableIncome:           round2(taxableIncome),
      federalTax:              round2(federalTax),
      stateTax:                round2(stateTax),
      totalFederalTax:         round2(totalTax),   // kept for UI compat (fed+state combined)
      conversionTax:           round2(conversionTax),
      taxPaidFromBrokerage:    round2(taxPaidFromBrokerage),
      taxShortfall:            round2(taxShortfall),
      brokerageExhausted,
      effectiveRate:           round2(effectiveRate),
      marginalRate,
      // MAGI & IRMAA (currentIRMAA = actual cost this year; futureIRMAA = impact of this year's income)
      magi:            round2(magi),
      onMedicare:      age >= 65,
      irmaa: {
        tier:              irmaa.tier,
        label:             irmaa.label,
        partBMonthly:      irmaa.partBMonthly,
        partDMonthly:      irmaa.partDMonthly,
        annualSurcharge:   irmaa.annualSurcharge,
        crossesThreshold:  irmaa.crossesThreshold,
        onMedicare:        irmaa.onMedicare ?? (age >= 65),
      },
      futureIRMAA: {
        tier:              futureIRMAA.tier,
        label:             futureIRMAA.label,
        annualSurcharge:   futureIRMAA.annualSurcharge,
        crossesThreshold:  futureIRMAA.crossesThreshold,
      },
      // RMD projections
      projectedRMD:    round2(projectedRMD),
      baselineRMD:     round2(baselineRMD),
      rmdReduction:    round2(baselineRMD - projectedRMD),
    });
  }

  // --- Summary ---
  const totalConverted   = years.reduce((s, y) => s + y.conversionAmount,       0);
  const totalTaxPaid     = years.reduce((s, y) => s + y.conversionTax,          0);
  const totalFedTax      = years.reduce((s, y) => s + y.federalTax,             0);
  const totalStateTax    = years.reduce((s, y) => s + y.stateTax,               0);
  const totalIRMAA       = years.reduce((s, y) => s + y.irmaa.annualSurcharge,  0);
  const totalShortfall   = years.reduce((s, y) => s + y.taxShortfall,           0);
  // Actual dollars deposited into the Roth each year (conversion minus any
  // shortfall withheld when payTaxFromConversion=true; equals conversionAmount
  // when taxes are paid from brokerage with no shortfall).
  const totalRothDeposited = years.reduce((s, y) =>
    s + Math.max(0, y.conversionAmount - (y.brokerageExhausted && payTaxFromConversion ? y.taxShortfall : 0)), 0);
  const exhaustedYears   = years.filter((y) => y.brokerageExhausted).length;
  const last            = years[years.length - 1] ?? {};

  // --- RMD projection at rmdAge ---
  // The conversion loop ends at (currentAge + conversionYears - 1) which is
  // almost always before rmdAge (73 or 75). Compound both the strategy IRA
  // and the do-nothing baseline forward from the end of the conversion window
  // to rmdAge so we can report the actual projected RMD at that age.
  const ageAtLoopEnd   = currentAge + conversionYears; // first age after loop
  const gapYears       = Math.max(0, rmdAge - ageAtLoopEnd);
  const growthFactor   = Math.pow(1 + growthRate, gapYears);

  // End-of-loop balances (tradIRA / baselineTradIRA are already post-growth
  // from inside the loop; compound them forward through the gap).
  const tradIRAAtRmd      = tradIRA      * growthFactor;
  const baselineAtRmd     = baselineTradIRA * growthFactor;

  const projectedRMDAtRmd = calcRMD(tradIRAAtRmd,  rmdAge, birthYear);
  const baselineRMDAtRmd  = calcRMD(baselineAtRmd, rmdAge, birthYear);

  return {
    inputs: { ...inputs },
    years,
    summary: {
      totalYearsModeled:            years.length,
      totalAmountConverted:         round2(totalConverted),
      totalRothDeposited:           round2(totalRothDeposited),
      totalFederalTaxOnConversions: round2(totalTaxPaid),
      totalFederalTaxOnly:          round2(totalFedTax),
      totalStateTaxOnConversions:   round2(totalStateTax),
      totalIRMAASurcharges:         round2(totalIRMAA),
      brokerageExhaustedYears:      exhaustedYears,
      totalUnfundedTax:             round2(totalShortfall),
      finalTraditionalIRA:          last.endingTraditionalIRA  ?? round2(traditionalIRABalance * Math.pow(1 + growthRate, conversionYears)),
      finalRothIRA:                 last.endingRothIRA         ?? 0,
      finalTaxableBrokerage:        last.endingTaxableBrokerage ?? round2(taxableBrokerageBalance * Math.pow(1 + growthRate, conversionYears)),
      rmdStartAge:                  rmdAge,
      projectedRMDAtRmdAge:         round2(projectedRMDAtRmd),
      baselineRMDAtRmdAge:          round2(baselineRMDAtRmd),
      // Keep legacy keys so existing UI code doesn't break
      projectedRMDAtAge73:          round2(projectedRMDAtRmd),
      baselineRMDAtAge73:           round2(baselineRMDAtRmd),
      irmaaBreachYears:             years.filter((y) => y.irmaa.crossesThreshold).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Social Security taxation helper (IRS "combined income" provisional income)
//
// Provisional income = AGI + non-taxable interest + 50% of SS benefit
// Up to 50% of SS taxable if PI > $25k (single) / $32k (MFJ)
// Up to 85% of SS taxable if PI > $34k (single) / $44k (MFJ)
// Thresholds are NOT inflation-adjusted (set in 1983/1993 law).
// ---------------------------------------------------------------------------
const SS_THRESHOLDS = {
  single: { tier1: 25000, tier2: 34000 },
  mfj:    { tier1: 32000, tier2: 44000 },
};

/**
 * Calculate the taxable portion of Social Security benefits.
 * @param {number} ssBenefit       Annual gross SS benefit ($)
 * @param {number} otherAGI        AGI excluding SS (wages, conversion, RMDs, etc.)
 * @param {"single"|"mfj"} filingStatus
 * @returns {{ taxableSS: number, inclusionRate: number }}
 */
export function calcSSTax(ssBenefit, otherAGI, filingStatus) {
  if (!ssBenefit || ssBenefit <= 0) return { taxableSS: 0, inclusionRate: 0 };
  const provisionalIncome = otherAGI + ssBenefit * 0.5;
  const { tier1, tier2 } = SS_THRESHOLDS[filingStatus];
  let taxableSS = 0;
  if (provisionalIncome <= tier1) {
    taxableSS = 0;
  } else if (provisionalIncome <= tier2) {
    taxableSS = Math.min(0.5 * ssBenefit, 0.5 * (provisionalIncome - tier1));
  } else {
    const tier2Amount = Math.min(0.5 * ssBenefit, 0.5 * (tier2 - tier1));
    taxableSS = Math.min(
      0.85 * ssBenefit,
      tier2Amount + 0.85 * (provisionalIncome - tier2)
    );
  }
  taxableSS = Math.min(taxableSS, 0.85 * ssBenefit); // hard cap at 85%
  return {
    taxableSS:     round2(taxableSS),
    inclusionRate: round2(taxableSS / ssBenefit),
  };
}

// ---------------------------------------------------------------------------
// Lifetime projection engine
//
// Extends beyond the conversion window to model the full retirement picture:
// RMD years, SS benefits, estate value. Returns one row per year from
// currentAge to endAge.
// ---------------------------------------------------------------------------

/**
 * Run a full lifetime projection combining conversion years + RMD years.
 *
 * @param {object} inputs
 * @param {number}  inputs.traditionalIRABalance
 * @param {number}  inputs.taxableBrokerageBalance
 * @param {number}  inputs.annualRothConversion
 * @param {number}  inputs.conversionYears
 * @param {number}  inputs.growthRate
 * @param {"single"|"mfj"} inputs.filingStatus
 * @param {number}  [inputs.currentAge=60]
 * @param {number}  [inputs.birthYear]
 * @param {number}  [inputs.otherOrdinaryIncome=0]   Non-SS, non-RMD income (wages, pension)
 * @param {number}  [inputs.socialSecurityBenefit=0] Annual gross SS benefit (starts at ssStartAge)
 * @param {number}  [inputs.ssStartAge=67]           Age SS benefits begin
 * @param {number}  [inputs.endAge=90]               Age to project through
 * @param {boolean} [inputs.payTaxFromConversion=false]
 * @returns {{ years: LifetimeYear[], summary: object }}
 */
export function runLifetimeProjection(inputs) {
  const {
    traditionalIRABalance,
    taxableBrokerageBalance,
    annualRothConversion,
    conversionYears,
    growthRate,
    filingStatus,
    currentAge = 60,
    birthYear = new Date().getFullYear() - currentAge,
    otherOrdinaryIncome = 0,
    socialSecurityBenefit = 0,
    ssStartAge = 67,
    endAge = 90,
    payTaxFromConversion = false,
    stateTaxRate = 0,
    inflationRate = 0,
    conversionSchedule = null,
  } = inputs;

  const rmdAge   = rmdStartAge(birthYear);

  let tradIRA      = traditionalIRABalance;
  let rothIRA      = 0;
  let taxBrokerage = taxableBrokerageBalance;

  const years = [];
  const magiHistoryL = [null, null]; // 2-year MAGI lookback for lifetime projection

  for (let age = currentAge; age <= endAge; age++) {
    const yearIndex       = age - currentAge;
    const isConversionYr  = yearIndex < conversionYears && tradIRA > 0;
    const ss              = age >= ssStartAge ? socialSecurityBenefit : 0;

    // RMD (uses prior year-end balance → we'll compute after growth below)
    // We approximate by working with current tradIRA as start-of-year balance.
    const rmd = calcRMD(tradIRA, age, birthYear);

    // Conversion — use exact schedule amount if provided, otherwise flat rate
    const scheduledAmount = conversionSchedule
      ? (conversionSchedule[yearIndex]?.conversion ?? 0)
      : annualRothConversion;
    const isConversionYr2 = conversionSchedule
      ? (yearIndex < conversionSchedule.length && tradIRA > 0)
      : isConversionYr;
    const conversionAmount = isConversionYr2
      ? Math.min(scheduledAmount, tradIRA)
      : 0;

    // Inflation-adjusted brackets/deduction for this year index
    const stdDed       = scaledStdDed(filingStatus, inflationRate, yearIndex);

    // SS taxation — provisional income uses non-SS income + 50% SS
    const nonSSIncome  = otherOrdinaryIncome + conversionAmount + rmd;
    const { taxableSS, inclusionRate } = calcSSTax(ss, nonSSIncome, filingStatus);

    // Total ordinary income & taxable income
    const grossIncome   = nonSSIncome + taxableSS;
    const taxableIncome = Math.max(0, grossIncome - stdDed);
    const federalTaxL   = calcFederalTax(taxableIncome, filingStatus, inflationRate, yearIndex);
    const stateTaxL     = grossIncome * stateTaxRate;
    const totalTax      = federalTaxL + stateTaxL;

    // Marginal tax from conversion only
    const baseIncome    = otherOrdinaryIncome + rmd + taxableSS;
    const baseFedTax    = calcFederalTax(Math.max(0, baseIncome - stdDed), filingStatus, inflationRate, yearIndex);
    const baseStateTax  = baseIncome * stateTaxRate;
    const baseTax       = baseFedTax + baseStateTax;
    const conversionTax = totalTax - baseTax;

    const { effectiveRate, marginalRate } = calcTaxRates(taxableIncome, filingStatus, inflationRate, yearIndex);

    // MAGI & IRMAA with 2-year lookback (thresholds inflation-adjusted)
    const magi = grossIncome;
    const { currentIRMAA: irmaa, futureIRMAA: futureIrmaa } = calcIRMAA(
      magi, filingStatus, age, magiHistoryL[0], inflationRate, yearIndex
    );
    magiHistoryL[0] = magiHistoryL[1];
    magiHistoryL[1] = magi;

    // Pay taxes from brokerage first
    const taxPaidFromBrokerage = Math.min(totalTax, taxBrokerage);
    taxBrokerage -= taxPaidFromBrokerage;
    const taxShortfall     = totalTax - taxPaidFromBrokerage;
    const brokerageExhausted = taxShortfall > 0;

    // Apply conversion
    tradIRA -= conversionAmount + rmd; // RMD leaves the IRA too
    tradIRA  = Math.max(0, tradIRA);

    const rothDeposit = payTaxFromConversion
      ? Math.max(0, conversionAmount - taxShortfall)
      : conversionAmount;
    rothIRA += rothDeposit;

    // Apply living expenses drawn from taxable (modeled as 0 here — user controls via other income)
    // Apply growth
    tradIRA      = Math.max(0, tradIRA)      * (1 + growthRate);
    rothIRA      *= (1 + growthRate);
    taxBrokerage = Math.max(0, taxBrokerage) * (1 + growthRate);

    // Estate value = all accounts
    const estateValue = tradIRA + rothIRA + taxBrokerage;

    years.push({
      age,
      year:             yearIndex + 1,
      phase:            isConversionYr ? "conversion" : age < rmdAge ? "gap" : "rmd",
      conversionAmount: round2(conversionAmount),
      rmd:              round2(rmd),
      ssBenefit:        round2(ss),
      taxableSS:        round2(taxableSS),
      ssInclusionRate:  round2(inclusionRate),
      grossIncome:      round2(grossIncome),
      taxableIncome:    round2(taxableIncome),
      totalFederalTax:  round2(totalTax),
      conversionTax:    round2(conversionTax),
      taxShortfall:     round2(taxShortfall),
      brokerageExhausted,
      effectiveRate:    round2(effectiveRate),
      marginalRate,
      magi:             round2(magi),
      onMedicare:       age >= 65,
      irmaa: {
        tier:             irmaa.tier,
        label:            irmaa.label,
        partBMonthly:     irmaa.partBMonthly,
        partDMonthly:     irmaa.partDMonthly,
        annualSurcharge:  irmaa.annualSurcharge,
        crossesThreshold: irmaa.crossesThreshold,
        onMedicare:       irmaa.onMedicare ?? (age >= 65),
      },
      futureIRMAA: {
        tier:             futureIrmaa.tier,
        label:            futureIrmaa.label,
        annualSurcharge:  futureIrmaa.annualSurcharge,
        crossesThreshold: futureIrmaa.crossesThreshold,
      },
      endingTraditionalIRA:   round2(tradIRA),
      endingRothIRA:          round2(rothIRA),
      endingTaxableBrokerage: round2(taxBrokerage),
      estateValue:            round2(estateValue),
    });
  }

  const totalTaxPaid      = years.reduce((s, y) => s + y.totalFederalTax, 0);
  const totalIRMAA        = years.reduce((s, y) => s + y.irmaa.annualSurcharge, 0);
  const totalSSTax        = years.reduce((s, y) => s + y.taxableSS, 0);
  const totalConverted    = years.reduce((s, y) => s + y.conversionAmount, 0);
  const last              = years[years.length - 1] ?? {};

  return {
    years,
    summary: {
      totalLifetimeTax:         round2(totalTaxPaid),
      totalLifetimeIRMAA:       round2(totalIRMAA),
      totalLifetimeCost:        round2(totalTaxPaid + totalIRMAA),
      totalTaxableSS:           round2(totalSSTax),
      totalAmountConverted:     round2(totalConverted),
      finalTraditionalIRA:      last.endingTraditionalIRA  ?? 0,
      finalRothIRA:             last.endingRothIRA         ?? 0,
      finalTaxableBrokerage:    last.endingTaxableBrokerage ?? 0,
      estateValueAtEndAge:      last.estateValue           ?? 0,
      rmdStartAge:              rmdAge,
    },
  };
}

// ---------------------------------------------------------------------------
// Bracket-filling optimizer
//
// For each named bracket target (12%, 22%, 24%, IRMAA boundary, etc.),
// compute the optimal per-year conversion using a forward simulation that
// tracks the actual IRA balance year by year (not a flat amount × years).
// ---------------------------------------------------------------------------

/**
 * Given a MAGI ceiling target and a starting IRA balance, compute the
 * maximum conversion that fits under the ceiling each year, then simulate
 * forward until the IRA is drained or maxYears is reached.
 *
 * Returns the year-by-year conversion schedule + total cost.
 */
function bracketFillSchedule(baseInputs, magiCeiling, maxYears) {
  const {
    traditionalIRABalance,
    taxableBrokerageBalance,
    growthRate,
    filingStatus,
    currentAge = 60,
    birthYear = new Date().getFullYear() - currentAge,
    otherOrdinaryIncome = 0,
    socialSecurityBenefit = 0,
    ssStartAge = 67,
    payTaxFromConversion = false,
    stateTaxRate = 0,
    inflationRate = 0,
  } = baseInputs;

  let tradIRA      = traditionalIRABalance;
  let rothIRA      = 0;
  let taxBrokerage = taxableBrokerageBalance;

  const schedule     = [];
  const magiHistoryB = [null, null]; // 2-year MAGI lookback
  let totalTax       = 0;
  let totalIRMAA     = 0;
  let totalSSTax     = 0;

  for (let i = 0; i < maxYears; i++) {
    if (tradIRA <= 0) break;
    const age = currentAge + i;
    const ss  = age >= ssStartAge ? socialSecurityBenefit : 0;

    // Inflation-scaled deduction for this year
    const stdDed = scaledStdDed(filingStatus, inflationRate, i);

    // ── Headroom calculation with SS circularity fix ──────────────────────────
    // Problem: taxable SS increases as conversion increases (provisional income
    // rises), so a static headroom = ceiling - otherIncome overshoots the
    // ceiling once taxableSS is added back to grossIncome.
    //
    // Fix: start with the static estimate, then iteratively reduce the
    // conversion until grossIncome (incl. actual taxableSS) ≤ magiCeiling.
    // This converges in ≤ 5 iterations because taxableSS is monotone in conv.
    let conversion = Math.min(Math.max(0, magiCeiling - otherOrdinaryIncome), tradIRA);
    if (conversion <= 0) break;

    if (ss > 0) {
      for (let iter = 0; iter < 6; iter++) {
        const { taxableSS: tss } = calcSSTax(ss, otherOrdinaryIncome + conversion, filingStatus);
        const gross = otherOrdinaryIncome + conversion + tss;
        if (gross <= magiCeiling + 0.5) break; // within $0.50 rounding tolerance
        // Reduce conversion by the overshoot (tss added to gross)
        conversion = Math.max(0, conversion - (gross - magiCeiling));
      }
      conversion = Math.min(conversion, tradIRA);
    }
    if (conversion <= 0) break;

    // Final income figures with the solved conversion amount
    const nonSSIncome  = otherOrdinaryIncome + conversion;
    const { taxableSS } = calcSSTax(ss, nonSSIncome, filingStatus);
    const grossIncome  = nonSSIncome + taxableSS;
    const taxableInc   = Math.max(0, grossIncome - stdDed);
    const tax          = calcFederalTax(taxableInc, filingStatus, inflationRate, i) + grossIncome * stateTaxRate;
    const magi = grossIncome;
    const { currentIRMAA: irmaa } = calcIRMAA(magi, filingStatus, age, magiHistoryB[0], inflationRate, i);
    magiHistoryB[0] = magiHistoryB[1];
    magiHistoryB[1] = magi;

    const taxPaid = Math.min(tax, taxBrokerage);
    taxBrokerage -= taxPaid;
    const shortfall = tax - taxPaid;

    tradIRA  -= conversion;
    tradIRA   = Math.max(0, tradIRA);
    const deposit = payTaxFromConversion ? Math.max(0, conversion - shortfall) : conversion;
    rothIRA  += deposit;

    tradIRA      *= (1 + growthRate);
    rothIRA      *= (1 + growthRate);
    taxBrokerage  = Math.max(0, taxBrokerage) * (1 + growthRate);

    totalTax   += tax;
    totalIRMAA += irmaa.annualSurcharge;
    totalSSTax += taxableSS;

    const { marginalRate } = calcTaxRates(taxableInc, filingStatus, inflationRate, i);

    schedule.push({
      age, conversion: round2(conversion), tax: round2(tax),
      taxableSS: round2(taxableSS), magi: round2(magi),
      irmaaLabel: irmaa.label, irmaaTier: irmaa.tier,
      marginalRate,
      onMedicare: age >= 65,
      endingTradIRA: round2(tradIRA),
    });
  }

  // Highest marginal rate hit in any conversion year — used by maxTaxBracket filter
  const maxMarginalRate = schedule.length > 0
    ? Math.max(...schedule.map(s => s.marginalRate))
    : 0;

  return {
    schedule,
    yearsUsed:        schedule.length,
    maxMarginalRate,
    totalTax:         round2(totalTax),
    totalIRMAA:       round2(totalIRMAA),
    totalSSTax:       round2(totalSSTax),
    totalCost:        round2(totalTax + totalIRMAA),
    remainingTradIRA: round2(tradIRA),
    finalRothIRA:     round2(rothIRA),
    finalTaxable:     round2(taxBrokerage),
  };
}

/**
 * Human-readable label for a MAGI ceiling.
 */
function ceilingLabel(ceiling, filingStatus, otherIncome, stdDed) {
  const taxableIncome = ceiling - otherIncome - stdDed;
  const brackets      = TAX_BRACKETS[filingStatus];
  const irmaaTiers    = IRMAA_TIERS[filingStatus];

  for (const t of irmaaTiers) {
    if (Math.abs(ceiling - t.maxMAGI) <= 1000)
      return `IRMAA threshold (${t.tier === 0 ? "No surcharge" : t.label}) — $${ceiling.toLocaleString()} MAGI`;
  }
  for (const b of brackets) {
    if (b.max !== Infinity && Math.abs(taxableIncome - b.max) <= 1000)
      return `Top of ${(b.rate * 100).toFixed(0)}% bracket — $${ceiling.toLocaleString()} MAGI`;
    if (taxableIncome >= b.min && taxableIncome < b.max)
      return `Within ${(b.rate * 100).toFixed(0)}% bracket — $${ceiling.toLocaleString()} MAGI`;
  }
  return `Custom: $${ceiling.toLocaleString()} MAGI`;
}

/**
 * Run the full bracket-filling optimizer.
 *
 * Tests every named bracket ceiling + IRMAA boundary + equal-spread options,
 * using a year-by-year forward simulation that correctly tracks the shrinking
 * IRA balance and growing accounts. Scores by total (tax + IRMAA surcharges).
 *
 * @param {object} inputs  All base inputs (no annualRothConversion / conversionYears)
 * @param {object} [opts]
 * @param {number} [opts.maxIRMAATier=0]    Max acceptable IRMAA tier
 * @param {number} [opts.endAge=90]         Lifetime projection end age
 * @returns {{
 *   strategies: BracketStrategy[],        All candidates sorted by cost
 *   recommended: BracketStrategy,         Cheapest
 *   bracketComparison: BracketStrategy[], One entry per named bracket ceiling
 * }}
 */
export function optimizeConversion(inputs, opts = {}) {
  const {
    traditionalIRABalance,
    filingStatus,
    currentAge = 60,
    birthYear = new Date().getFullYear() - currentAge,
    otherOrdinaryIncome = 0,
    socialSecurityBenefit = 0,
    ssStartAge = 67,
    inflationRate = 0,
  } = inputs;

  const {
    maxIRMAATier  = 0,
    endAge        = 90,
    maxTaxBracket = null,
    // rmdIncomeTarget: MAGI ceiling approach (legacy, still supported)
    rmdIncomeTarget = null,
    // targetMaxRMD: direct dollar amount of desired max annual RMD (new, preferred).
    // When set, generates a "RMD Taming" strategy whose goal is keeping the
    // projected RMD at rmdAge ≤ targetMaxRMD.
    targetMaxRMD = null,
  } = opts;

  const rmdAge   = rmdStartAge(birthYear);
  const maxYears = Math.max(1, rmdAge - currentAge);

  // Use year-1 (yearIndex=0) brackets/thresholds as the static ceiling basis for
  // optimizer candidates.  The actual year-by-year simulation inside
  // bracketFillSchedule will use the correct per-year inflation factor.
  const stdDed     = scaledStdDed(filingStatus, inflationRate, 0);
  const brackets   = scaledBrackets(filingStatus, inflationRate, 0);
  const irmaaTiers = scaledIrmaaTiers(filingStatus, inflationRate, 0);

  // Named bracket ceilings (based on year-0 / current-year brackets).
  // magiCeiling = b.max + stdDed  (otherIncome cancels in bracketFillSchedule headroom calc)
  const namedCeilings = [];
  for (const b of brackets) {
    if (b.max === Infinity) continue;
    const magiCeiling = b.max + stdDed;
    namedCeilings.push({
      ceiling: Math.floor(magiCeiling),
      label:   `Fill to top of ${(b.rate * 100).toFixed(0)}% bracket`,
      bracketRate: b.rate,
    });
  }
  // IRMAA tier boundaries (inflation-adjusted year-0 values)
  for (const t of irmaaTiers) {
    if (t.maxMAGI === Infinity) continue;
    namedCeilings.push({
      ceiling: Math.floor(t.maxMAGI),
      label:   `Stay at/below IRMAA ${t.label} threshold (${fmt_$$(t.maxMAGI)} MAGI)`,
      bracketRate: null,
    });
  }

  // Equal-spread options: divide full IRA over 1…maxYears years
  const equalSpreadCeilings = [];
  for (let y = 1; y <= maxYears; y++) {
    const perYear = Math.ceil(traditionalIRABalance / y);
    equalSpreadCeilings.push({
      ceiling: Math.floor(otherOrdinaryIncome + perYear),
      label:   `Equal spread over ${y} yr${y !== 1 ? "s" : ""}`,
      bracketRate: null,
    });
  }

  const allCeilings = [...namedCeilings, ...equalSpreadCeilings];
  const strategies  = [];
  const seen        = new Set();

  // ── Helper: build a full strategy entry from a bracketFillSchedule result ──
  function buildStrategy(result, label, bracketRate, ceiling, extraProps = {}) {
    const maxTierHit = Math.max(...result.schedule.map(s => s.irmaaTier), 0);
    const lifetimeResult = runLifetimeProjection({
      ...inputs,
      annualRothConversion: result.schedule[0]?.conversion ?? 0,
      conversionYears:      result.yearsUsed,
      conversionSchedule:   result.schedule,
      endAge,
    });
    return {
      label,
      bracketRate:          bracketRate ?? null,
      ceiling:              ceiling ?? 0,
      ceilingLabel:         ceilingLabel(ceiling ?? 0, filingStatus, otherOrdinaryIncome, stdDed),
      conversionYears:      result.yearsUsed,
      typicalAnnualAmount:  result.schedule[0]?.conversion ?? 0,
      schedule:             result.schedule,
      maxMarginalRate:      result.maxMarginalRate,
      // Conversion-window costs
      conversionTax:        result.totalTax,
      conversionIRMAA:      result.totalIRMAA,
      conversionSSTax:      result.totalSSTax,
      conversionCost:       result.totalCost,
      remainingTradIRA:     result.remainingTradIRA,
      finalRothIRA:         result.finalRothIRA,
      // Lifetime costs
      lifetimeTax:          lifetimeResult.summary.totalLifetimeTax,
      lifetimeIRMAA:        lifetimeResult.summary.totalLifetimeIRMAA,
      lifetimeCost:         lifetimeResult.summary.totalLifetimeCost,
      lifetimeSSTax:        lifetimeResult.summary.totalTaxableSS,
      estateValue:          lifetimeResult.summary.estateValueAtEndAge,
      lifetimeYears:        lifetimeResult.years,
      maxIRMAATier:         maxTierHit,
      irmaaBreachYears:     result.schedule.filter(s => s.irmaaTier > 0).length,
      ...extraProps,
    };
  }

  for (const { ceiling, label, bracketRate } of allCeilings) {
    const key = String(ceiling);
    if (seen.has(key)) continue;
    seen.add(key);

    const result = bracketFillSchedule(inputs, ceiling, maxYears);
    if (result.yearsUsed === 0) continue;

    const maxTierHit = Math.max(...result.schedule.map(s => s.irmaaTier), 0);
    if (maxTierHit > maxIRMAATier) continue;

    // ── maxTaxBracket filter: skip any strategy that pushes marginal rate above cap ──
    if (maxTaxBracket != null && result.maxMarginalRate > maxTaxBracket + 0.001) continue;

    strategies.push(buildStrategy(result, label, bracketRate, ceiling));
  }

  // ── RMD Taming strategies ─────────────────────────────────────────────────
  // Two entry points:
  //   targetMaxRMD    — direct dollar ceiling on the annual RMD (new, preferred)
  //   rmdIncomeTarget — MAGI ceiling; engine derives maxRmd from it (legacy)
  const effectiveTargetMaxRMD = targetMaxRMD != null && targetMaxRMD > 0
    ? targetMaxRMD
    : rmdIncomeTarget != null && rmdIncomeTarget > 0
      ? Math.max(0, rmdIncomeTarget - otherOrdinaryIncome)  // derive from MAGI ceiling
      : null;

  if (effectiveTargetMaxRMD != null && effectiveTargetMaxRMD > 0) {
    const tamingStrategies = calcRmdTamingCandidates(
      inputs, effectiveTargetMaxRMD, maxYears, maxIRMAATier, maxTaxBracket, endAge, buildStrategy
    );
    for (const s of tamingStrategies) {
      const key = `rmd-tame-${s.ceiling}`;
      if (!seen.has(key)) {
        seen.add(key);
        strategies.push(s);
      }
    }
  }

  if (strategies.length === 0) {
    const bracketMsg = maxTaxBracket != null
      ? ` (bracket cap ${(maxTaxBracket * 100).toFixed(0)}%)`
      : "";
    throw new Error(
      `No valid conversion strategy found${bracketMsg}. Try relaxing the Max Conversion Tax Bracket or IRMAA tier constraint.`
    );
  }

  // Sort by lifetime cost (tax + IRMAA over full retirement)
  strategies.sort((a, b) => a.lifetimeCost - b.lifetimeCost);

  // bracketComparison: one entry per named bracket ceiling (for side-by-side view)
  // Exclude RMD-taming entries from the comparison bar chart (different goal).
  const bracketComparison = namedCeilings
    .map(nc => strategies.find(s => s.ceiling === nc.ceiling && !s.isRmdTaming))
    .filter(Boolean);

  return {
    strategies,
    recommended: strategies[0],
    bracketComparison,
  };
}

// ---------------------------------------------------------------------------
// RMD Taming: partial conversion to cap future RMDs
//
// Rather than draining the IRA entirely, compute the maximum IRA balance at
// rmdAge that keeps the annual RMD below (rmdIncomeTarget - otherIncome), then
// discount that target balance back to today.  Convert only the excess.
//
// Returns an array of strategy objects (one per tested bracket ceiling) that
// use partial conversions spread evenly over the available gap years.
// ---------------------------------------------------------------------------

/**
 * @param {object}   inputs           Same shape as optimizeConversion inputs
 * @param {number}   targetMaxRMD     Desired maximum annual RMD in dollars (e.g. 50000)
 * @param {number}   maxYears         Gap years available before RMD age
 * @param {number}   maxIRMAATier     Max IRMAA tier allowed (from optimizer opts)
 * @param {number|null} maxTaxBracket Marginal rate cap (or null = no cap)
 * @param {number}   endAge           Lifetime projection end age
 * @param {Function} buildStrategy    Shared helper from optimizeConversion
 * @returns {Array}  Array of strategy entries (may be empty)
 */
function calcRmdTamingCandidates(
  inputs, targetMaxRMD, maxYears, maxIRMAATier, maxTaxBracket, endAge, buildStrategy
) {
  const {
    traditionalIRABalance,
    growthRate,
    filingStatus,
    currentAge = 60,
    birthYear  = new Date().getFullYear() - currentAge,
    otherOrdinaryIncome = 0,
  } = inputs;

  const rmdAge    = rmdStartAge(birthYear);
  const gapYears  = Math.max(1, rmdAge - currentAge);

  // Step 1: find the IRS ULT divisor at rmdAge — sets how big the RMD is
  const divisor = ULT[Math.min(rmdAge, 90)] ?? 26.5;

  // Step 2: target IRA balance at rmdAge such that RMD ≤ targetMaxRMD
  // RMD = balance / divisor  →  targetBalance = targetMaxRMD × divisor
  const targetBalAtRmd   = round2(targetMaxRMD * divisor);

  // Step 3: discount the target balance back to today (end of conversion window = rmdAge)
  // The IRA will grow at growthRate for gapYears from NOW to rmdAge.
  // neededBalanceNow × (1+g)^gapYears = targetBalAtRmd
  // → neededBalanceNow = targetBalAtRmd / (1+g)^gapYears
  const growthFactor     = Math.pow(1 + growthRate, gapYears);
  const neededBalNow     = round2(targetBalAtRmd / growthFactor);

  // Step 4: excess to convert = current balance - needed balance (must be > 0)
  const excessToConvert  = Math.max(0, traditionalIRABalance - neededBalNow);
  if (excessToConvert < 1000) return []; // nothing meaningful to convert

  // Step 5: test several per-year conversion amounts:
  //   a) Spread the excess evenly over all gap years
  //   b) Concentrate it into the low-bracket portion only (bracket-limited sub-spreads)
  const testAmounts = [
    { amount: Math.ceil(excessToConvert / gapYears), label: "even spread" },
    { amount: Math.ceil(excessToConvert / Math.max(1, Math.ceil(gapYears * 0.5))), label: "half-period spread" },
  ];

  const results = [];

  for (const { amount, label } of testAmounts) {
    // Build a flat-rate schedule at `amount` per year for up to gapYears
    // using bracketFillSchedule with that amount as the per-year ceiling.
    const ceiling = Math.floor(otherOrdinaryIncome + amount);
    const sched   = bracketFillSchedule(inputs, ceiling, gapYears);
    if (sched.yearsUsed === 0) continue;

    const maxTierHit = Math.max(...sched.schedule.map(s => s.irmaaTier), 0);
    if (maxTierHit > maxIRMAATier) continue;
    if (maxTaxBracket != null && sched.maxMarginalRate > maxTaxBracket + 0.001) continue;

    const rmdAtTarget = round2(targetMaxRMD); // == targetBalAtRmd / divisor
    const entry = buildStrategy(
      sched,
      `RMD Taming — ${label} (target RMD ≤ ${fmt_$$(rmdAtTarget)}/yr at ${rmdAge})`,
      null,
      ceiling,
      {
        isRmdTaming:     true,
        targetBalAtRmd,
        neededBalNow,
        excessToConvert: round2(excessToConvert),
        rmdAtTarget,
        rmdTamingLabel:  `Partial conversion to keep RMD ≤ ${fmt_$$(rmdAtTarget)}/yr at age ${rmdAge}`,
      }
    );
    results.push(entry);
  }

  return results;
}

/** Minimal dollar formatter used inside the engine (no React dependency). */
function fmt_$$(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Break-even analysis
//
// Computes the age at which the Roth conversion strategy's cumulative net
// worth first exceeds the do-nothing (no conversion) baseline's net worth.
// Returns year-by-year data for both strategies plus the break-even age.
// ---------------------------------------------------------------------------

/**
 * Compare a Roth conversion strategy against a do-nothing baseline over a
 * full lifetime horizon, returning the break-even age and year-by-year data.
 *
 * @param {object} inputs  Same shape as runLifetimeProjection
 * @returns {{
 *   breakEvenAge: number|null,   Age at which Roth estate first surpasses baseline (null if never)
 *   years: Array<{
 *     age: number,
 *     rothEstate: number,     Roth strategy total net worth
 *     baselineEstate: number, Do-nothing total net worth
 *     advantage: number,      rothEstate - baselineEstate (negative = baseline winning)
 *     cumulativeTaxSaved: number,
 *   }>
 * }}
 */
export function calcBreakEven(inputs) {
  const {
    endAge = 90,
    currentAge = 60,
  } = inputs;

  // Strategy A: with conversions (as-configured)
  const rothResult = runLifetimeProjection(inputs);

  // Strategy B: do-nothing — no conversions, no conversionSchedule
  const baselineResult = runLifetimeProjection({
    ...inputs,
    annualRothConversion: 0,
    conversionYears:      0,
    conversionSchedule:   null,
  });

  const years      = [];
  let breakEvenAge = null;
  let cumulativeTaxDelta = 0; // extra tax paid by Roth strategy vs baseline

  for (let age = currentAge; age <= endAge; age++) {
    const idx         = age - currentAge;
    const rothYear    = rothResult.years[idx];
    const baseYear    = baselineResult.years[idx];
    if (!rothYear || !baseYear) break;

    cumulativeTaxDelta += (rothYear.totalFederalTax - baseYear.totalFederalTax);

    const rothEstate     = rothYear.estateValue;
    const baselineEstate = baseYear.estateValue;
    const advantage      = rothEstate - baselineEstate;

    if (breakEvenAge === null && advantage >= 0 && age > currentAge) {
      breakEvenAge = age;
    }

    years.push({
      age,
      rothEstate:         round2(rothEstate),
      baselineEstate:     round2(baselineEstate),
      advantage:          round2(advantage),
      cumulativeTaxDelta: round2(cumulativeTaxDelta),
    });
  }

  return { breakEvenAge, years };
}

// ---------------------------------------------------------------------------
// Social Security claiming age comparison
//
// Compares the financial outcome of claiming SS at ages 62, 67, and 70 given
// the same Roth conversion strategy and other inputs.  Uses the SSA bend-point
// approximation: full benefit at 67 (FRA); claiming at 62 reduces by ~30%;
// delaying to 70 increases by ~24% (8%/yr × 3 yrs beyond FRA).
// ---------------------------------------------------------------------------

/**
 * Compare SS claiming at ages 62, 67, and 70 using a lifetime projection.
 *
 * @param {object} inputs    Same shape as runLifetimeProjection inputs.
 *                           inputs.socialSecurityBenefit is the FRA benefit at 67.
 * @returns {{
 *   scenarios: Array<{
 *     claimAge: number,
 *     monthlyBenefit: number,
 *     annualBenefit: number,
 *     lifetimeTax: number,
 *     lifetimeIRMAA: number,
 *     estateValue: number,
 *     lifetimeCost: number,
 *     lifetimeSSTax: number,
 *     years: LifetimeYear[],
 *   }>
 * }}
 */
export function calcSSClaimingComparison(inputs) {
  const fraAnnualBenefit = inputs.socialSecurityBenefit ?? 0;
  const fraMonthly       = fraAnnualBenefit / 12;

  // SSA rules: FRA = 67 for anyone born 1960+; close enough for model
  // Claim at 62 → 70% of FRA benefit (30% reduction)
  // Claim at 67 → 100% of FRA benefit
  // Claim at 70 → 124% of FRA benefit (8%/yr × 3 yrs)
  const CLAIM_SCENARIOS = [
    { age: 62, factor: 0.70 },
    { age: 65, factor: 0.86 },  // 67 − 2 yrs × 6.67%/yr ≈ 86.6%
    { age: 67, factor: 1.00 },
    { age: 70, factor: 1.24 },
  ];

  const scenarios = CLAIM_SCENARIOS.map(({ age: claimAge, factor }) => {
    const annualBenefit = round2(fraAnnualBenefit * factor);
    const monthlyBenefit = round2(fraMonthly * factor);

    const result = runLifetimeProjection({
      ...inputs,
      socialSecurityBenefit: annualBenefit,
      ssStartAge:            claimAge,
    });

    return {
      claimAge,
      monthlyBenefit,
      annualBenefit,
      lifetimeTax:   result.summary.totalLifetimeTax,
      lifetimeIRMAA: result.summary.totalLifetimeIRMAA,
      lifetimeCost:  result.summary.totalLifetimeCost,
      lifetimeSSTax: result.summary.totalTaxableSS,
      estateValue:   result.summary.estateValueAtEndAge,
      totalSS:       round2(result.years.reduce((s, y) => s + y.ssBenefit, 0)),
      years:         result.years,
    };
  });

  return { scenarios };
}
