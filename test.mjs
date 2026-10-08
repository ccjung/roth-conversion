import { runSimulation, calcFederalTax, calcIRMAA, calcIRMAARaw, calcRMD, rmdStartAge } from "./simulationEngine.js";

// --- Test 1: Core simulation ---
console.log("=== TEST 1: 10-Year MFJ Conversion ===\n");
const result = runSimulation({
  traditionalIRABalance:   500000,
  taxableBrokerageBalance: 100000,
  annualRothConversion:    50000,
  conversionYears:         10,
  growthRate:              0.07,
  filingStatus:            "mfj",
  currentAge:              63,
  otherOrdinaryIncome:     30000,
});

console.log("SUMMARY:");
console.table(result.summary);

console.log("\nYEAR-BY-YEAR:");
result.years.forEach(y => {
  console.log(
    `Year ${String(y.year).padStart(2)} (Age ${y.age}): ` +
    `Converted $${y.conversionAmount.toLocaleString().padStart(7)} | ` +
    `Trad IRA $${y.endingTraditionalIRA.toLocaleString().padStart(10)} | ` +
    `Roth $${y.endingRothIRA.toLocaleString().padStart(10)} | ` +
    `Tax $${y.conversionTax.toLocaleString().padStart(7)} | ` +
    `MAGI $${y.magi.toLocaleString().padStart(7)} | ` +
    `IRMAA: ${y.irmaa.label} (Tier ${y.irmaa.tier}) | ` +
    `RMD reduction: $${y.rmdReduction.toLocaleString()}`
  );
});

// --- Test 2: calcFederalTax spot checks ---
console.log("\n=== TEST 2: Federal Tax Spot Checks ===\n");
const taxCases = [
  { income: 0,       status: "single", expected: 0 },
  { income: 11600,   status: "single", expected: 1160 },   // 10% on $11,600 (below 2025 top of 10% at $11,925)
  { income: 50000,   status: "mfj",   expected: 5523 },    // 10% on $23,850 + 12% on $26,150 (2025 brackets)
  { income: 100000,  status: "single", expected: 16914 },  // 10%+12%+22% bands (2025 brackets)
];
taxCases.forEach(({ income, status, expected }) => {
  const tax = calcFederalTax(income, status);
  const pass = Math.abs(tax - expected) < 1;
  console.log(`  calcFederalTax(${income}, "${status}") = $${tax.toFixed(2)} — ${pass ? "PASS ✓" : `FAIL ✗ (expected $${expected})`}`);
});

// --- Test 3: IRMAA threshold checks ---
console.log("\n=== TEST 3: IRMAA Threshold Checks ===\n");

// 3a: Raw tier lookup (age-independent)
const irmaaCases = [
  { magi: 100000, status: "single", expectedTier: 0 },
  { magi: 109001, status: "single", expectedTier: 1 },
  { magi: 200000, status: "single", expectedTier: 4 },
  { magi: 217999, status: "mfj",   expectedTier: 0 },
  { magi: 218001, status: "mfj",   expectedTier: 1 },
];
irmaaCases.forEach(({ magi, status, expectedTier }) => {
  const r = calcIRMAARaw(magi, status);
  const pass = r.tier === expectedTier;
  console.log(`  calcIRMAARaw($${magi.toLocaleString()}, "${status}") → ${r.label} (Tier ${r.tier}) — ${pass ? "PASS ✓" : `FAIL ✗ (expected Tier ${expectedTier})`}`);
});

// 3b: Age-aware with 2-year lookback
console.log("\n  --- 2-year lookback & Medicare eligibility ---");
const lookbackCases = [
  // Age 63 — not on Medicare, no current IRMAA regardless of income
  { magi: 150000, magiTwoYearsAgo: null,   age: 63, status: "single", expectedCurrentTier: 0, expectedCurrentOnMedicare: false, label: "age 63 — not on Medicare" },
  // Age 65 — first Medicare year; lookback MAGI from age 63 (null → Tier 0)
  { magi: 120000, magiTwoYearsAgo: null,   age: 65, status: "single", expectedCurrentTier: 0, expectedCurrentOnMedicare: true,  label: "age 65, no lookback MAGI → Tier 0" },
  // Age 65 — lookback MAGI from age 63 was $150k → Tier 2 for single ($136k–$163k)
  { magi: 120000, magiTwoYearsAgo: 150000, age: 65, status: "single", expectedCurrentTier: 2, expectedCurrentOnMedicare: true,  label: "age 65, lookback $150k → Tier 2" },
  // Age 66 — lookback MAGI from age 64 was $90k → under $109k → Tier 0
  { magi: 200000, magiTwoYearsAgo: 90000,  age: 66, status: "single", expectedCurrentTier: 0, expectedCurrentOnMedicare: true,  label: "age 66, lookback $90k → Tier 0" },
];
lookbackCases.forEach(({ magi, magiTwoYearsAgo, age, status, expectedCurrentTier, expectedCurrentOnMedicare, label }) => {
  const { currentIRMAA } = calcIRMAA(magi, status, age, magiTwoYearsAgo);
  const passTier = currentIRMAA.tier === expectedCurrentTier;
  const passMed  = (currentIRMAA.onMedicare === expectedCurrentOnMedicare);
  const pass = passTier && passMed;
  console.log(`  age ${age}: currentIRMAA Tier=${currentIRMAA.tier} onMedicare=${currentIRMAA.onMedicare} — ${pass ? "PASS ✓" : "FAIL ✗"} · ${label}`);
});

// --- Test 4: SECURE 2.0 rmdStartAge ---
console.log("\n=== TEST 4: SECURE 2.0 RMD Start Age ===\n");
const startAgeCases = [
  { birthYear: 1949, expected: 72, label: "pre-SECURE (born ≤ 1950)" },
  { birthYear: 1950, expected: 72, label: "pre-SECURE boundary" },
  { birthYear: 1951, expected: 73, label: "SECURE 2.0 lower boundary" },
  { birthYear: 1959, expected: 73, label: "SECURE 2.0 upper boundary" },
  { birthYear: 1960, expected: 75, label: "born 1960+ boundary" },
  { birthYear: 1975, expected: 75, label: "born 1975" },
];
startAgeCases.forEach(({ birthYear, expected, label }) => {
  const got = rmdStartAge(birthYear);
  const pass = got === expected;
  console.log(`  rmdStartAge(${birthYear}) = ${got} — ${pass ? "PASS ✓" : `FAIL ✗ (expected ${expected})`} · ${label}`);
});

// --- Test 5: calcRMD respects birth year ---
console.log("\n=== TEST 5: calcRMD with SECURE 2.0 birth year ===\n");
const rmdCases = [
  // born 1955 → start age 73
  { balance: 500000, age: 72, birthYear: 1955, expected: 0,        label: "age 72, born 1955 → no RMD yet" },
  { balance: 500000, age: 73, birthYear: 1955, expected: 18868,    label: "age 73, born 1955 → 500000/26.5" },
  // born 1960 → start age 75
  { balance: 500000, age: 73, birthYear: 1960, expected: 0,        label: "age 73, born 1960 → no RMD yet" },
  { balance: 500000, age: 74, birthYear: 1960, expected: 0,        label: "age 74, born 1960 → no RMD yet" },
  { balance: 500000, age: 75, birthYear: 1960, expected: 20325,    label: "age 75, born 1960 → 500000/24.6" },
  // born 1948 → start age 72
  { balance: 500000, age: 71, birthYear: 1948, expected: 0,        label: "age 71, born 1948 → no RMD yet" },
  { balance: 500000, age: 72, birthYear: 1948, expected: 18248,    label: "age 72, born 1948 → 500000/27.4" },
  // general ULT check
  { balance: 750000, age: 75, birthYear: 1948, expected: 30488,    label: "age 75, born 1948 → 750000/24.6" },
];
rmdCases.forEach(({ balance, age, birthYear, expected, label }) => {
  const rmd = calcRMD(balance, age, birthYear);
  const pass = Math.abs(rmd - expected) < 1;
  console.log(`  calcRMD($${balance.toLocaleString()}, age ${age}, ${birthYear}) = $${rmd.toFixed(2)} — ${pass ? "PASS ✓" : `FAIL ✗ (expected ~$${expected})`} · ${label}`);
});

// --- Test 6: Single filer IRMAA Breach ---
console.log("\n=== TEST 6: Single Filer IRMAA Breach ===\n");
const single = runSimulation({
  traditionalIRABalance:   300000,
  taxableBrokerageBalance: 80000,
  annualRothConversion:    90000,   // pushes MAGI above $109k single threshold
  conversionYears:         5,
  growthRate:              0.06,
  filingStatus:            "single",
  currentAge:              65,
  otherOrdinaryIncome:     25000,
});
single.years.forEach(y => {
  console.log(
    `  Year ${y.year} (Age ${y.age}): MAGI $${y.magi.toLocaleString()} → ${y.irmaa.label} | Annual IRMAA surcharge: $${y.irmaa.annualSurcharge.toLocaleString()}`
  );
});
console.log(`  IRMAA breach years: ${single.summary.irmaaBreachYears} of ${single.summary.totalYearsModeled}`);

// --- Test 7: runSimulation uses correct RMD start age per birth year ---
console.log("\n=== TEST 7: Simulation RMD Start Age Integration ===\n");
const rmdIntegrationCases = [
  { birthYear: 1950, expectedRmdAge: 72, label: "born 1950 → age 72" },
  { birthYear: 1955, expectedRmdAge: 73, label: "born 1955 → age 73" },
  { birthYear: 1962, expectedRmdAge: 75, label: "born 1962 → age 75" },
];
rmdIntegrationCases.forEach(({ birthYear, expectedRmdAge, label }) => {
  const r = runSimulation({
    traditionalIRABalance:   400000,
    taxableBrokerageBalance: 80000,
    annualRothConversion:    40000,
    conversionYears:         5,
    growthRate:              0.07,
    filingStatus:            "single",
    currentAge:              65,
    birthYear,
  });
  const pass = r.summary.rmdStartAge === expectedRmdAge;
  console.log(`  birthYear ${birthYear}: rmdStartAge = ${r.summary.rmdStartAge} — ${pass ? "PASS ✓" : `FAIL ✗ (expected ${expectedRmdAge})`} · ${label}`);
});
