import { useState, useMemo, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import {
  runSimulation, optimizeConversion, runLifetimeProjection, calcIRMAARaw,
  calcBreakEven, calcSSClaimingComparison, STATE_TAX_RATES, STATE_TAX_NOTES,
} from "../simulationEngine.js";

// ─── Formatting helpers ───────────────────────────────────────────────────────
const fmt$ = (n) =>
  n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n) =>
  n == null ? "—" : (n * 100).toFixed(1) + "%";

/**
 * Deflate a nominal dollar amount to real (inflation-adjusted) dollars.
 * @param {number} nominalValue  The future nominal dollar amount
 * @param {number} years         Number of years from today (0 = today's dollars)
 * @param {number} inflationRate Annual inflation rate as a decimal (e.g. 0.025)
 * @param {boolean} showReal     When false, returns nominalValue unchanged
 */
function toRealDollars(nominalValue, years, inflationRate, showReal) {
  if (!showReal || !inflationRate || years <= 0) return nominalValue;
  return nominalValue / Math.pow(1 + inflationRate, years);
}

// ─── Reusable UI primitives ───────────────────────────────────────────────────
function Card({ title, children, accent }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      padding: "20px 24px",
      borderTop: accent ? `3px solid ${accent}` : undefined,
    }}>
      {title && (
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#57606a", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function StatBox({ label, value, sub, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? "#1f2328" }}>{value}</div>
      <div style={{ fontSize: 13, color: "#57606a", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: "#8b949e", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function InputField({ label, id, value, onChange, type = "number", min, max, step, note, prefix, suffix }) {
  // Keep a local string draft so the user can freely edit (backspace, clear,
  // type mid-number) without the parent state fighting the input cursor.
  const [draft, setDraft] = useState(String(value));

  // Sync draft when the parent value changes from outside (e.g. age → birthYear)
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  if (type !== "number") {
    // Non-numeric fields: pass through directly
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: "#1f2328" }}>{label}</label>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, padding: "7px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, outline: "none", background: "#fff" }}
        />
        {note && <span style={{ fontSize: 12, color: "#8b949e" }}>{note}</span>}
      </div>
    );
  }

  function handleChange(e) {
    const raw = e.target.value;
    setDraft(raw);
    // Only propagate a parsed number when the field has a real value
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) onChange(parsed);
  }

  function handleBlur() {
    // On blur: commit a clean number string, defaulting to 0 if empty/invalid
    const parsed = parseFloat(draft);
    const clean = isNaN(parsed) ? 0 : parsed;
    setDraft(String(clean));
    onChange(clean);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: "#1f2328" }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {prefix && <span style={{ fontSize: 14, color: "#57606a" }}>{prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={handleChange}
          onBlur={handleBlur}
          style={{
            flex: 1,
            padding: "7px 10px",
            border: "1px solid #d0d7de",
            borderRadius: 6,
            fontSize: 14,
            outline: "none",
            background: "#fff",
          }}
        />
        {suffix && <span style={{ fontSize: 14, color: "#57606a" }}>{suffix}</span>}
      </div>
      {note && <span style={{ fontSize: 12, color: "#8b949e" }}>{note}</span>}
    </div>
  );
}

// ─── IRMAA badge ──────────────────────────────────────────────────────────────
function IRMAAbadge({ label, crosses, isFuture, notOnMedicare }) {
  // Not on Medicare yet — show a preview of future IRMAA impact
  if (notOnMedicare) {
    const bg    = crosses ? "#fef3c7" : "#f7f8fa";
    const color = crosses ? "#92400e" : "#8b949e";
    return (
      <span style={{ background: bg, color, borderRadius: 4, padding: "2px 7px", fontSize: 12, fontStyle: "italic" }}
        title="Not on Medicare yet. Shows impact this income will have on IRMAA in 2 years.">
        {crosses ? `⚠ ${label} (future)` : "N/A"}
      </span>
    );
  }
  const bg = crosses ? "#fff3cd" : "#d1fae5";
  const color = crosses ? "#92400e" : "#065f46";
  return (
    <span style={{ background: bg, color, borderRadius: 4, padding: "2px 7px", fontSize: 12, fontWeight: 600 }}>
      {label}
    </span>
  );
}

// ─── Plain-English optimizer narrative ───────────────────────────────────────
function generateNarrative(recommended, strategies, baseInputs) {
  if (!recommended || !strategies?.length) return null;

  const { filingStatus, currentAge, otherOrdinaryIncome = 0 } = baseInputs;
  const statusLabel = filingStatus === "mfj" ? "married filing jointly" : "single";

  const best     = recommended;
  const worst    = strategies[strategies.length - 1];
  const doNothing = strategies.find(s => s.conversionYears <= 1 && s.typicalAnnualAmount < 10000) ?? worst;

  const savingsVsWorst  = worst.lifetimeCost  - best.lifetimeCost;
  const savingsVsDN     = doNothing.lifetimeCost - best.lifetimeCost;
  const estateBoost     = best.estateValue    - (doNothing.estateValue ?? 0);

  const bracketPct = best.ceilingLabel.match(/(\d+)%/)?.[1];
  const irmaaNote  = best.lifetimeIRMAA > 0
    ? ` Along the way, the optimizer accepts ${fmt$(best.lifetimeIRMAA)} in total Medicare IRMAA surcharges — a deliberate tradeoff, since the reduction in future RMD taxation more than offsets the premium increase.`
    : ` Importantly, this strategy keeps MAGI below every IRMAA threshold, so Medicare Part B/D premiums stay at the base rate throughout retirement.`;

  const rmdNote = best.conversionYears > 0
    ? ` By converting ${fmt$(best.typicalAnnualAmount)}/yr for ${best.conversionYears} year${best.conversionYears !== 1 ? "s" : ""} before RMDs begin, the Traditional IRA balance — and therefore every future taxable Required Minimum Distribution — is meaningfully reduced.`
    : "";

  const ssNote = best.lifetimeSSTax != null
    ? ` Lower RMDs during the Social Security overlap years also reduce provisional income, which means less of your Social Security benefit is subject to the 50%/85% inclusion tax.`
    : "";

  const savingsNote = savingsVsWorst > 5000
    ? ` Compared to the most expensive strategy modeled (${worst.ceilingLabel}), this approach saves <strong>${fmt$(savingsVsWorst)}</strong> in lifetime taxes and IRMAA surcharges.`
    : "";

  const estateNote = estateBoost > 0
    ? ` The projected estate at age ${baseInputs.endAge ?? 90} is <strong>${fmt$(best.estateValue)}</strong> — a <strong>${fmt$(estateBoost)}</strong> improvement over doing nothing.`
    : ` The projected estate at age ${baseInputs.endAge ?? 90} is <strong>${fmt$(best.estateValue)}</strong>.`;

  return (
    `For a <em>${statusLabel}</em> filer starting at age ${currentAge} with ${fmt$(baseInputs.traditionalIRABalance)} in a Traditional IRA and ${fmt$(otherOrdinaryIncome)}/yr in other income, the optimizer recommends <strong>${best.ceilingLabel}</strong>.` +
    rmdNote +
    irmaaNote +
    ssNote +
    savingsNote +
    estateNote
  );
}

// ─── Optimizer panel ──────────────────────────────────────────────────────────
function OptimizerPanel({ optResult, onApply, baseInputs }) {
  if (!optResult) return null;
  const { recommended, strategies, bracketComparison } = optResult;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = strategies[selectedIdx] ?? recommended;

  const fmtK = v => v == null ? "—" : "$" + (v / 1000).toFixed(0) + "k";

  // Lifetime chart data for selected strategy
  const lifetimeChartData = selected.lifetimeYears?.map(y => ({
    age: y.age,
    "Trad IRA":       Math.round(y.endingTraditionalIRA),
    "Roth IRA":       Math.round(y.endingRothIRA),
    "Taxable":        Math.round(y.endingTaxableBrokerage),
    "Fed Tax":        Math.round(y.totalFederalTax),
    "MAGI":           Math.round(y.magi),
    "Taxable SS":     Math.round(y.taxableSS),
    "IRMAA Surcharge":Math.round(y.irmaa?.annualSurcharge ?? 0),
    "Estate":         Math.round(y.estateValue),
  })) ?? [];

  // Bracket comparison bar data
  const bracketBarData = bracketComparison.filter(Boolean).map(s => ({
    name: s.bracketRate != null ? `${(s.bracketRate * 100).toFixed(0)}% bracket` : s.label.split(" ")[3] ?? s.label,
    "Lifetime Tax":   s.lifetimeTax,
    "Lifetime IRMAA": s.lifetimeIRMAA,
    "Taxable SS":     s.lifetimeSSTax,
    "Estate Value":   s.estateValue,
    yrs:              s.conversionYears,
    amt:              s.typicalAnnualAmount,
  }));

  const irmaaLine = selected.lifetimeYears?.[0]
    ? (selected.lifetimeYears[0].irmaa?.partBMonthly != null ? undefined : undefined)
    : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Recommended banner */}
      <div style={{
        background: recommended.isRmdTaming
          ? "linear-gradient(135deg,#eff6ff,#dbeafe)"
          : "linear-gradient(135deg,#f0fdf4,#dcfce7)",
        border: `1px solid ${recommended.isRmdTaming ? "#93c5fd" : "#86efac"}`,
        borderRadius: 10, padding: "18px 22px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: recommended.isRmdTaming ? "#1e40af" : "#166534" }}>
            {recommended.isRmdTaming ? "🎯" : "✅"} Optimal Strategy (lowest lifetime tax + IRMAA)
          </span>
          {recommended.isRmdTaming && (
            <span style={{ background: "#3b82d4", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
              RMD TAMING
            </span>
          )}
          {recommended.maxMarginalRate != null && (
            <span style={{
              background: recommended.maxMarginalRate >= 0.32 ? "#fee2e2" : recommended.maxMarginalRate >= 0.24 ? "#fef3c7" : "#d1fae5",
              color:      recommended.maxMarginalRate >= 0.32 ? "#991b1b" : recommended.maxMarginalRate >= 0.24 ? "#92400e" : "#065f46",
              borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
            }}>
              Peak rate: {(recommended.maxMarginalRate * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 14 }}>
          <StatBox label="Typical Annual Conv." value={fmt$(recommended.typicalAnnualAmount)} color={recommended.isRmdTaming ? "#1e40af" : "#166534"} />
          <StatBox label="Conversion Years"    value={`${recommended.conversionYears} yrs`}  color="#1f2328" />
          <StatBox label="Lifetime Tax"        value={fmt$(recommended.lifetimeTax)}          color="#ef4444" />
          <StatBox label="Lifetime IRMAA"      value={fmt$(recommended.lifetimeIRMAA)}        color="#f59e0b" />
          <StatBox label="Estate at 90"        value={fmt$(recommended.estateValue)}          color="#10b981" />
        </div>
        <div style={{ fontSize: 13, color: recommended.isRmdTaming ? "#1e40af" : "#166534", marginBottom: 8 }}>
          {recommended.ceilingLabel}
        </div>
        {recommended.isRmdTaming && recommended.rmdAtTarget > 0 && (
          <div style={{ fontSize: 12, color: "#1e40af", marginBottom: 12, background: "#dbeafe", borderRadius: 6, padding: "6px 10px" }}>
            🎯 Partial conversion only — targets RMD ≤ <strong>{fmt$(recommended.rmdAtTarget)}/yr</strong> at RMD age.
            Trad IRA needed to hold (present value): <strong>{fmt$(recommended.neededBalNow)}</strong> ·
            Excess converted: <strong>{fmt$(recommended.excessToConvert)}</strong>
          </div>
        )}
        <button onClick={() => onApply(recommended.typicalAnnualAmount, recommended.conversionYears)}
          style={{ background: recommended.isRmdTaming ? "#3b82d4" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Apply to Simulator →
        </button>
      </div>

      {/* Plain-English narrative */}
      {(() => {
        const narrative = generateNarrative(recommended, strategies, baseInputs ?? {});
        if (!narrative) return null;
        return (
          <Card title="Why This Strategy Wins — Plain-English Explanation">
            <p style={{ fontSize: 14, color: "#1f2328", lineHeight: 1.75 }}
              dangerouslySetInnerHTML={{ __html: narrative }} />
            <div style={{ marginTop: 12, fontSize: 12, color: "#8b949e", borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
              This explanation is generated from the optimizer&apos;s actual numbers. All dollar amounts are nominal (not inflation-adjusted). Tax projections use 2025 federal brackets and 2026 IRMAA thresholds.
            </div>
          </Card>
        );
      })()}

      {/* Bracket comparison — side-by-side bar chart */}
      {bracketBarData.length > 0 && (
        <Card title="Bracket Strategy Comparison — Lifetime Cost & Estate Impact">
          <div style={{ marginBottom: 10, fontSize: 13, color: "#57606a" }}>Each bar = filling to the top of that tax bracket. Lower lifetime cost = better strategy for your situation.</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bracketBarData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 12 }} />
              <Tooltip formatter={v => fmt$(v)} />
              <Legend />
              <Bar dataKey="Lifetime Tax"   fill="#ef4444" radius={[3,3,0,0]} stackId="cost" />
              <Bar dataKey="Lifetime IRMAA" fill="#f59e0b" radius={[3,3,0,0]} stackId="cost" />
              <Bar dataKey="Taxable SS"     fill="#a855f7" radius={[3,3,0,0]} stackId="cost" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f7f8fa" }}>
                  {["Strategy","Conv. Yrs","$/yr","Peak Rate","Lifetime Tax","IRMAA","SS Taxed","Estate @90",""].map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: h === "Strategy" || h === "" ? "left" : "right", fontWeight: 600, color: "#57606a", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {strategies.slice(0, 12).map((s, i) => {
                  // Re-crown BEST: when RMD taming is active, the constrained winner
                  // is the cheapest taming entry, not necessarily index 0.
                  const constrainedBestIdx = (() => {
                    // The constrained winner is the lowest-lifetimeCost strategy
                    // that matches the active constraint type.
                    // Since strategies are sorted by lifetimeCost, the first
                    // RMD-taming entry (if any taming entries exist) or the first
                    // bracket-capped entry is the constrained best.
                    const hasTaming = strategies.some(x => x.isRmdTaming);
                    if (hasTaming) {
                      return strategies.findIndex(x => x.isRmdTaming);
                    }
                    // No taming active — index 0 is always best
                    return 0;
                  })();
                  const isBest = i === constrainedBestIdx;
                  return (
                  <tr key={i} onClick={() => setSelectedIdx(i)}
                    style={{ background: i === selectedIdx ? "#eff6ff" : s.isRmdTaming ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#fafafa", cursor: "pointer" }}>
                    <td style={{ ...td, textAlign: "left", maxWidth: 300, whiteSpace: "normal" }}>
                      {isBest && <span style={{ background: "#16a34a", color: "#fff", borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 700, marginRight: 5 }}>BEST</span>}
                      {s.isRmdTaming && <span style={{ background: "#3b82d4", color: "#fff", borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 700, marginRight: 5 }}>🎯 RMD TAMING</span>}
                      {s.ceilingLabel}
                      {s.isRmdTaming && s.rmdAtTarget > 0 && (
                        <div style={{ fontSize: 10, color: "#3b82d4", marginTop: 2 }}>
                          Targets RMD ≤ {fmt$(s.rmdAtTarget)}/yr · converts only excess above needed balance
                        </div>
                      )}
                    </td>
                    <td style={td}>{s.conversionYears}</td>
                    <td style={td}>{fmt$(s.typicalAnnualAmount)}</td>
                    <td style={{ ...td, color: s.maxMarginalRate >= 0.32 ? "#ef4444" : s.maxMarginalRate >= 0.24 ? "#f59e0b" : "#10b981" }}>
                      {s.maxMarginalRate != null ? (s.maxMarginalRate * 100).toFixed(0) + "%" : "—"}
                    </td>
                    <td style={{ ...td, color: "#ef4444" }}>{fmt$(s.lifetimeTax)}</td>
                    <td style={{ ...td, color: s.lifetimeIRMAA > 0 ? "#f59e0b" : "#8b949e" }}>{s.lifetimeIRMAA > 0 ? fmt$(s.lifetimeIRMAA) : "—"}</td>
                    <td style={{ ...td, color: "#a855f7" }}>{fmt$(s.lifetimeSSTax)}</td>
                    <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{fmt$(s.estateValue)}</td>
                    <td style={{ ...td, textAlign: "left" }}>
                      <button onClick={e => { e.stopPropagation(); onApply(s.typicalAnnualAmount, s.conversionYears); }}
                        style={{ background: "none", border: "1px solid #d0d7de", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", color: "#57606a" }}>Apply</button>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 6 }}>Click a row to see its lifetime charts below.</div>
        </Card>
      )}

      {/* Lifetime income stream chart for selected strategy */}
      <Card title={`Lifetime Income Streams — ${selected.ceilingLabel}`}>
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>
          Shows how conversions, RMDs, Social Security, and taxable SS stack up year-by-year through retirement.
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={lifetimeChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} label={{ value: "Age", position: "insideBottom", offset: -2, fontSize: 11 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <Legend />
            <Bar dataKey="Fed Tax"         fill="#ef4444" stackId="inc" radius={[0,0,0,0]} />
            <Bar dataKey="IRMAA Surcharge" fill="#f59e0b" stackId="inc" />
            <Bar dataKey="Taxable SS"      fill="#a855f7" stackId="inc" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* MAGI & SS inclusion rate */}
      <Card title={`MAGI & Social Security Taxation — ${selected.ceilingLabel}`}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={lifetimeChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left"  tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <Legend />
            <Line yAxisId="left"  type="monotone" dataKey="MAGI"       stroke="#3b82d4" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="Taxable SS"  stroke="#a855f7" strokeWidth={2} dot={false} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Estate / account balances */}
      <Card title={`Account Balances & Estate Value — ${selected.ceilingLabel}`}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={lifetimeChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <Legend />
            <Line type="monotone" dataKey="Trad IRA"  stroke="#3b82d4" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Roth IRA"  stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Taxable"   stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="5 3" />
            <Line type="monotone" dataKey="Estate"    stroke="#1f2328" strokeWidth={2} dot={false} strokeDasharray="3 2" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Year-by-year detail for selected strategy */}
      <Card title={`Year-by-Year Detail — ${selected.ceilingLabel}`}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f7f8fa" }}>
                {["Age","Phase","Conversion","RMD","SS Benefit","Taxable SS","SS %","Fed Tax","MAGI","IRMAA","Trad IRA","Roth IRA","Estate"].map(h => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#57606a", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.lifetimeYears?.map((y, i) => {
                const phaseColor = y.phase === "conversion" ? "#dbeafe" : y.phase === "rmd" ? "#fef3c7" : "#fff";
                return (
                  <tr key={i} style={{ background: phaseColor }}>
                    <td style={td}>{y.age}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                        background: y.phase === "conversion" ? "#bfdbfe" : y.phase === "rmd" ? "#fde68a" : "#e5e7eb",
                        color: y.phase === "conversion" ? "#1e40af" : y.phase === "rmd" ? "#92400e" : "#57606a" }}>
                        {y.phase.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...td, color: "#3b82d4" }}>{y.conversionAmount > 0 ? fmt$(y.conversionAmount) : "—"}</td>
                    <td style={{ ...td, color: "#f59e0b" }}>{y.rmd > 0 ? fmt$(y.rmd) : "—"}</td>
                    <td style={td}>{y.ssBenefit > 0 ? fmt$(y.ssBenefit) : "—"}</td>
                    <td style={{ ...td, color: "#a855f7" }}>{y.taxableSS > 0 ? fmt$(y.taxableSS) : "—"}</td>
                    <td style={td}>{y.taxableSS > 0 ? (y.ssInclusionRate * 100).toFixed(0) + "%" : "—"}</td>
                    <td style={{ ...td, color: "#ef4444" }}>{fmt$(y.totalFederalTax)}</td>
                    <td style={td}>{fmt$(y.magi)}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <IRMAAbadge
                        label={y.onMedicare ? (y.irmaa?.label ?? "—") : (y.futureIRMAA?.label ?? "—")}
                        crosses={y.onMedicare ? y.irmaa?.crossesThreshold : y.futureIRMAA?.crossesThreshold}
                        notOnMedicare={!y.onMedicare}
                      />
                    </td>
                    <td style={td}>{fmt$(y.endingTraditionalIRA)}</td>
                    <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{fmt$(y.endingRothIRA)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{fmt$(y.estateValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#57606a" }}>
          <span style={{ background: "#bfdbfe", padding: "2px 8px", borderRadius: 3 }}>Blue = Conversion phase</span>
          <span style={{ background: "#fde68a", padding: "2px 8px", borderRadius: 3 }}>Yellow = RMD phase</span>
          <span style={{ background: "#e5e7eb", padding: "2px 8px", borderRadius: 3 }}>Gray = Gap (no conversion, no RMD)</span>
        </div>
      </Card>
    </div>
  );
}

// ─── Tax brackets reference (2024) ───────────────────────────────────────────
const BRACKETS = {
  single: [
    { rate: 0.10, max: 11600 },
    { rate: 0.12, max: 47150 },
    { rate: 0.22, max: 100525 },
    { rate: 0.24, max: 191950 },
    { rate: 0.32, max: 243725 },
    { rate: 0.35, max: 609350 },
  ],
  mfj: [
    { rate: 0.10, max: 23200 },
    { rate: 0.12, max: 94300 },
    { rate: 0.22, max: 201050 },
    { rate: 0.24, max: 383900 },
    { rate: 0.32, max: 487450 },
    { rate: 0.35, max: 731200 },
  ],
};
const STD_DED = { single: 14600, mfj: 29200 };
const BRACKET_COLORS = {
  "10%": "#6ee7b7", "12%": "#34d399", "22%": "#3b82d4",
  "24%": "#7c5cd8", "32%": "#f59e0b", "35%": "#ef4444", "37%": "#991b1b",
};

// ─── Bracket Comparison panel ─────────────────────────────────────────────────
function BracketPanel({ baseInputs, ssIncome, ssStartAge, endAge, onApply }) {
  const [selectedBracket, setSelectedBracket] = useState(null);

  // Build one scenario per bracket ceiling
  const scenarios = useMemo(() => {
    const { filingStatus, otherOrdinaryIncome = 0 } = baseInputs;
    const brackets = BRACKETS[filingStatus];
    const stdDed   = STD_DED[filingStatus];
    const results  = [];

    for (const b of brackets) {
      const label     = `${(b.rate * 100).toFixed(0)}%`;
      const magiTop   = b.max + stdDed + otherOrdinaryIncome; // MAGI at bracket top
      const annual    = Math.max(0, magiTop - otherOrdinaryIncome); // max conversion
      if (annual <= 0) continue;

      // How many years to drain the IRA at this rate (capped at years to RMD)
      const rmdAge    = baseInputs.birthYear
        ? (baseInputs.birthYear <= 1950 ? 72 : baseInputs.birthYear <= 1959 ? 73 : 75)
        : 75;
      const maxYrs    = Math.max(1, rmdAge - (baseInputs.currentAge ?? 60));
      const numYears  = Math.min(Math.ceil(baseInputs.traditionalIRABalance / annual), maxYrs);

      try {
        const lifetime = runLifetimeProjection({
          ...baseInputs,
          annualRothConversion:  annual,
          conversionYears:       numYears,
          socialSecurityBenefit: ssIncome,
          ssStartAge,
          endAge,
        });
        results.push({
          label,
          rate:         b.rate,
          magiTop:      Math.round(magiTop),
          annualAmount: Math.round(annual),
          numYears,
          lifetimeTax:  lifetime.summary.totalLifetimeTax,
          lifetimeIRMAA:lifetime.summary.totalLifetimeIRMAA,
          lifetimeSSTax:lifetime.summary.totalTaxableSS,
          lifetimeCost: lifetime.summary.totalLifetimeCost,
          estateValue:  lifetime.summary.estateValueAtEndAge,
          finalTradIRA: lifetime.summary.finalTraditionalIRA,
          finalRothIRA: lifetime.summary.finalRothIRA,
          years:        lifetime.years,
        });
      } catch (_) { /* skip invalid */ }
    }
    return results;
  }, [baseInputs, ssIncome, ssStartAge, endAge]);

  const best = scenarios.length > 0
    ? scenarios.reduce((a, b) => a.lifetimeCost < b.lifetimeCost ? a : b)
    : null;

  const active = selectedBracket
    ? scenarios.find(s => s.label === selectedBracket)
    : best;

  // Comparison bar chart data
  const barData = scenarios.map(s => ({
    name:            `${s.label} bracket`,
    "Lifetime Tax":  Math.round(s.lifetimeTax),
    "Lifetime IRMAA":Math.round(s.lifetimeIRMAA),
    "SS Taxed":      Math.round(s.lifetimeSSTax),
    estateValue:     Math.round(s.estateValue),
    label:           s.label,
  }));

  // Lifetime chart for active scenario
  const lifetimeData = active?.years.map(y => ({
    age:             y.age,
    "Trad IRA":      Math.round(y.endingTraditionalIRA),
    "Roth IRA":      Math.round(y.endingRothIRA),
    "Taxable":       Math.round(y.endingTaxableBrokerage),
    "Fed Tax":       Math.round(y.totalFederalTax),
    "IRMAA":         Math.round(y.irmaa?.annualSurcharge ?? 0),
    "Taxable SS":    Math.round(y.taxableSS ?? 0),
    "MAGI":          Math.round(y.magi),
  })) ?? [];

  if (scenarios.length === 0) {
    return <div style={{ padding: 20, color: "#57606a" }}>Enter your inputs on the left to see bracket strategies.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Strategy selector chips */}
      <Card title="Select a Tax Bracket Target">
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 14 }}>
          Each strategy converts the maximum amount that keeps your MAGI within the top of that bracket each year, repeating until the Traditional IRA is drained. Click a bracket to explore it.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {scenarios.map(s => {
            const isBest   = s.label === best?.label;
            const isActive = s.label === (active?.label);
            return (
              <button key={s.label} onClick={() => setSelectedBracket(s.label)}
                style={{
                  padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
                  background: isActive ? (BRACKET_COLORS[s.label] ?? "#3b82d4") : "#f7f8fa",
                  color:      isActive ? "#fff" : "#1f2328",
                  border:     isActive ? `2px solid ${BRACKET_COLORS[s.label] ?? "#3b82d4"}` : "2px solid #e5e7eb",
                  position:   "relative",
                }}>
                {isBest && <span style={{ position: "absolute", top: -8, right: -8, background: "#16a34a", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>★ BEST</span>}
                {s.label} bracket
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, opacity: 0.85 }}>
                  {s.numYears} yr{s.numYears !== 1 ? "s" : ""} · {fmt$(s.annualAmount)}/yr
                </div>
              </button>
            );
          })}
        </div>

        {/* Summary comparison table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f7f8fa" }}>
                {["Bracket","Annual Conv.","Years","MAGI ceiling","Lifetime Tax","Lifetime IRMAA","SS Taxed","Total Cost","Estate @90","Apply"].map(h => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: h === "Bracket" ? "left" : "right", fontWeight: 600, color: "#57606a", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, i) => {
                const isBest   = s.label === best?.label;
                const isActive = s.label === active?.label;
                return (
                  <tr key={i} onClick={() => setSelectedBracket(s.label)}
                    style={{ background: isActive ? "#eff6ff" : isBest ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#fafafa", cursor: "pointer" }}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: BRACKET_COLORS[s.label] ?? "#ccc", marginRight: 6 }} />
                      <strong>{s.label}</strong>
                      {isBest && <span style={{ marginLeft: 6, fontSize: 10, background: "#16a34a", color: "#fff", borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>BEST</span>}
                    </td>
                    <td style={td}>{fmt$(s.annualAmount)}</td>
                    <td style={td}>{s.numYears}</td>
                    <td style={{ ...td, color: "#57606a" }}>{fmt$(s.magiTop)}</td>
                    <td style={{ ...td, color: "#ef4444" }}>{fmt$(s.lifetimeTax)}</td>
                    <td style={{ ...td, color: s.lifetimeIRMAA > 0 ? "#f59e0b" : "#8b949e" }}>{s.lifetimeIRMAA > 0 ? fmt$(s.lifetimeIRMAA) : "—"}</td>
                    <td style={{ ...td, color: "#a855f7" }}>{fmt$(s.lifetimeSSTax)}</td>
                    <td style={{ ...td, fontWeight: isActive ? 700 : 400, color: isBest ? "#166534" : undefined }}>{fmt$(s.lifetimeCost)}</td>
                    <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{fmt$(s.estateValue)}</td>
                    <td style={{ ...td, textAlign: "left" }}>
                      <button onClick={e => { e.stopPropagation(); onApply(s.annualAmount, s.numYears); }}
                        style={{ background: isBest ? "#16a34a" : "none", color: isBest ? "#fff" : "#57606a", border: isBest ? "none" : "1px solid #d0d7de", borderRadius: 5, padding: "3px 10px", fontSize: 12, cursor: "pointer" }}>
                        Apply
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Side-by-side lifetime cost bar chart */}
      <Card title="Lifetime Cost by Bracket — Tax + IRMAA + Taxable SS">
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>Stacked bars show how much of your lifetime income goes to tax under each strategy. Lower = better.</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 12 }} />
            <Tooltip formatter={v => fmt$(v)} />
            <Legend />
            <Bar dataKey="Lifetime Tax"   fill="#ef4444" stackId="a" radius={[0,0,0,0]} />
            <Bar dataKey="Lifetime IRMAA" fill="#f59e0b" stackId="a" />
            <Bar dataKey="SS Taxed"       fill="#a855f7" stackId="a" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Estate value comparison */}
      <Card title="Estate Value at Age 90 by Bracket">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000000).toFixed(1) + "M"} tick={{ fontSize: 12 }} />
            <Tooltip formatter={v => fmt$(v)} />
            <Bar dataKey="estateValue" name="Estate Value" fill="#10b981" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Detailed lifetime view for selected bracket */}
      {active && (
        <>
          <Card title={`${active.label} Bracket — Lifetime Account Balances`}
            accent={BRACKET_COLORS[active.label] ?? "#3b82d4"}>
            <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>
              Converting <strong>{fmt$(active.annualAmount)}/yr</strong> for <strong>{active.numYears} years</strong> · MAGI ceiling <strong>{fmt$(active.magiTop)}</strong> · Lifetime cost <strong>{fmt$(active.lifetimeCost)}</strong>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={lifetimeData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="age" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
                <Legend />
                <Line type="monotone" dataKey="Trad IRA" stroke="#3b82d4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Roth IRA" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Taxable"  stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card title={`${active.label} Bracket — Annual Tax, IRMAA & Taxable SS`}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={lifetimeData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="age" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
                <Legend />
                <Bar dataKey="Fed Tax"    fill="#ef4444" stackId="b" />
                <Bar dataKey="IRMAA"      fill="#f59e0b" stackId="b" />
                <Bar dataKey="Taxable SS" fill="#a855f7" stackId="b" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Year-by-year table */}
          <Card title={`${active.label} Bracket — Year-by-Year Detail`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f7f8fa" }}>
                    {["Age","Phase","Conversion","MAGI","Fed Tax","Eff. Rate","IRMAA","Taxable SS","Trad IRA","Roth IRA","Estate"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#57606a", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.years.map((y, i) => {
                    const bg = y.phase === "conversion" ? "#dbeafe" : y.phase === "rmd" ? "#fef3c7" : "#fff";
                    return (
                      <tr key={i} style={{ background: bg }}>
                        <td style={td}>{y.age}</td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                            background: y.phase === "conversion" ? "#bfdbfe" : y.phase === "rmd" ? "#fde68a" : "#e5e7eb",
                            color: y.phase === "conversion" ? "#1e40af" : y.phase === "rmd" ? "#92400e" : "#57606a" }}>
                            {y.phase.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ ...td, color: "#3b82d4" }}>{y.conversionAmount > 0 ? fmt$(y.conversionAmount) : "—"}</td>
                        <td style={td}>{fmt$(y.magi)}</td>
                        <td style={{ ...td, color: "#ef4444" }}>{fmt$(y.totalFederalTax)}</td>
                        <td style={td}>{fmtPct(y.effectiveRate)}</td>
                        <td style={{ ...td, color: y.irmaa?.crossesThreshold ? "#f59e0b" : "#8b949e" }}>
                          {y.onMedicare ? (y.irmaa?.annualSurcharge > 0 ? fmt$(y.irmaa.annualSurcharge) : "—") : "N/A"}
                        </td>
                        <td style={{ ...td, color: "#a855f7" }}>{y.taxableSS > 0 ? fmt$(y.taxableSS) : "—"}</td>
                        <td style={td}>{fmt$(y.endingTraditionalIRA)}</td>
                        <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{fmt$(y.endingRothIRA)}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{fmt$(y.estateValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#57606a" }}>
              <span style={{ background: "#bfdbfe", padding: "2px 8px", borderRadius: 3 }}>Blue = Conversion</span>
              <span style={{ background: "#fde68a", padding: "2px 8px", borderRadius: 3 }}>Yellow = RMD</span>
              <span style={{ background: "#e5e7eb", padding: "2px 8px", borderRadius: 3 }}>Gray = Gap</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // Inputs
  const [tradIRA,            setTradIRA]            = useState(500000);
  const [brokerage,          setBrokerage]          = useState(100000);
  const [conversion,         setConversion]         = useState(50000);
  const [years,              setYears]              = useState(10);
  const [growth,             setGrowth]             = useState(7);
  const [filing,             setFiling]             = useState("mfj");
  const [age,                setAge]                = useState(63);
  const [birthYear,          setBirthYear]          = useState(new Date().getFullYear() - 63);
  const [otherIncome,        setOtherIncome]        = useState(30000);
  const [payFromConversion,  setPayFromConversion]  = useState(false);
  const [activeTab,          setActiveTab]          = useState("manual");
  const [maxIRMAATier,       setMaxIRMAATier]       = useState(5);
  const [maxTaxBracket,      setMaxTaxBracket]      = useState("none");
  const [rmdTamingEnabled,   setRmdTamingEnabled]   = useState(false);
  const [targetMaxRMD,       setTargetMaxRMD]       = useState(0);
  const [annualInflation,    setAnnualInflation]    = useState(2.5);
  const [ssIncome,           setSsIncome]           = useState(24000);
  const [ssStartAge,         setSsStartAge]         = useState(67);
  const [endAge,             setEndAge]             = useState(90);
  const [stateKey,           setStateKey]           = useState("None (no state tax)");
  const [showRealDollars,    setShowRealDollars]    = useState(false);
  const [inflationRate,      setInflationRate]      = useState(2.5);
  const stateTaxRate = STATE_TAX_RATES[stateKey] ?? 0;

  // Helper: deflate a nominal value for display. yearsOut = year index from now.
  const realFmt = useCallback((nominalValue, yearsOut) =>
    fmt$(toRealDollars(nominalValue, yearsOut, inflationRate / 100, showRealDollars)),
  [showRealDollars, inflationRate]);

  // Shared base inputs object — used by simulation, optimizer, and all panels
  const baseInputs = {
    traditionalIRABalance:   tradIRA,
    taxableBrokerageBalance: brokerage,
    growthRate:              growth / 100,
    filingStatus:            filing,
    currentAge:              Math.round(age),
    birthYear:               Math.round(birthYear),
    otherOrdinaryIncome:     otherIncome,
    payTaxFromConversion:    payFromConversion,
    stateTaxRate,
    inflationRate:           annualInflation / 100,
  };

  // Run simulation
  const { result, error } = useMemo(() => {
    try {
      const r = runSimulation({
        ...baseInputs,
        annualRothConversion: conversion,
        conversionYears:      Math.round(years),
      });
      return { result: r, error: null };
    } catch (e) {
      return { result: null, error: e.message };
    }
  }, [tradIRA, brokerage, conversion, years, growth, filing, age, birthYear, otherIncome, payFromConversion, stateTaxRate]);

  const s = result?.summary;

  // Optimizer
  const { optResult, optError } = useMemo(() => {
    if (activeTab !== "optimize") return { optResult: null, optError: null };
    try {
      const bracketCap = maxTaxBracket === "none" ? null : Number(maxTaxBracket);

      // targetMaxRMD takes priority if set; rmdTamingEnabled uses the 24%-bracket floor
      const resolvedTargetMaxRMD =
        targetMaxRMD > 0
          ? targetMaxRMD
          : rmdTamingEnabled
            ? (() => {
                // Keep RMD + otherIncome below the top of the 24% bracket.
                // maxRmd = bracketTop24 + stdDed - otherIncome (MAGI ceiling minus other income).
                const stdDeds       = { single: 15000, mfj: 30000 };
                const bracketTops24 = { single: 197300, mfj: 394600 };
                return Math.max(0, bracketTops24[filing] + (stdDeds[filing] ?? 0) - otherIncome);
              })()
            : null;

      const r = optimizeConversion({
        ...baseInputs,
        socialSecurityBenefit: ssIncome,
        ssStartAge:            Math.round(ssStartAge),
      }, {
        maxIRMAATier,
        endAge:         Math.round(endAge),
        maxTaxBracket:  bracketCap,
        targetMaxRMD:   resolvedTargetMaxRMD,
      });
      return { optResult: r, optError: null };
    } catch (e) {
      return { optResult: null, optError: e.message };
    }
  }, [activeTab, tradIRA, brokerage, growth, filing, age, birthYear, otherIncome, ssIncome, ssStartAge,
      payFromConversion, stateTaxRate, annualInflation, maxIRMAATier, endAge,
      maxTaxBracket, rmdTamingEnabled, targetMaxRMD]);

  function applyOptimized(amount, numYears) {
    setConversion(amount);
    setYears(numYears);
    setActiveTab("manual");
  }

  // Chart data — balance columns are optionally deflated to real dollars
  const inflationDecimal = inflationRate / 100;
  const chartData = result?.years.map((y, i) => ({
    name: `Yr ${y.year}\n(${y.age})`,
    age: y.age,
    "Trad IRA":      Math.round(toRealDollars(y.endingTraditionalIRA,  i + 1, inflationDecimal, showRealDollars)),
    "Roth IRA":      Math.round(toRealDollars(y.endingRothIRA,         i + 1, inflationDecimal, showRealDollars)),
    "Taxable":       Math.round(toRealDollars(y.endingTaxableBrokerage, i + 1, inflationDecimal, showRealDollars)),
    "Conv. Tax":     Math.round(y.conversionTax),      // always nominal
    "Baseline RMD":  Math.round(y.baselineRMD),
    "Projected RMD": Math.round(y.projectedRMD),
    "MAGI":          Math.round(y.magi),               // always nominal (tax-relevant)
  })) ?? [];

  const irmaaLine = filing === "single" ? 109000 : 218000;

  return (
    <div className="print-root" style={{ minHeight: "100vh", background: "#f0f2f5", padding: "24px 16px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Print-only report header — hidden on screen, visible when printing */}
        <div className="print-header" style={{ borderBottom: "2px solid #1f2328", paddingBottom: 12, marginBottom: 4 }}>
          <strong style={{ fontSize: 18 }}>🏦 Roth Conversion Optimizer — Report</strong>
          <span style={{ float: "right", fontSize: 12, color: "#57606a" }}>
            Generated {new Date().toLocaleDateString()} · Age {Math.round(age)} · {filing === "mfj" ? "MFJ" : "Single"} · {fmt$(tradIRA)} Trad IRA
          </span>
        </div>

        {/* Header */}
        <div style={{ background: "#1f2328", borderRadius: 10, padding: "20px 28px", color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                🏦 Roth Conversion Optimizer
              </h1>
              <p style={{ color: "#8b949e", marginTop: 4, fontSize: 14 }}>
                Multi-year Roth conversion &amp; retirement tax modeling · 2025 brackets · 2026 IRMAA thresholds
              </p>
            </div>

            {/* Toolbar: inflation toggle + print button */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* Inflation toggle */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: showRealDollars ? "#1a3a2a" : "#2d333b",
                borderRadius: 8, padding: "8px 12px", border: "1px solid #30363d",
              }}>
                <input
                  type="checkbox"
                  id="realDollars"
                  checked={showRealDollars}
                  onChange={e => setShowRealDollars(e.target.checked)}
                  style={{ cursor: "pointer", accentColor: "#10b981", width: 15, height: 15 }}
                />
                <label htmlFor="realDollars" style={{ fontSize: 13, color: "#cdd9e5", cursor: "pointer", whiteSpace: "nowrap" }}>
                  Real dollars
                </label>
                {showRealDollars && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={inflationRate}
                      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setInflationRate(v); }}
                      style={{ width: 38, padding: "3px 6px", borderRadius: 4, border: "1px solid #444c56", background: "#161b22", color: "#cdd9e5", fontSize: 12, textAlign: "center" }}
                    />
                    <span style={{ fontSize: 12, color: "#8b949e" }}>% inflation</span>
                  </div>
                )}
              </div>

              {/* Print/PDF button */}
              <button
                className="no-print"
                onClick={() => window.print()}
                style={{
                  background: "#2d333b", color: "#cdd9e5", border: "1px solid #30363d",
                  borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                }}
              >
                🖨 Print / PDF
              </button>
            </div>
          </div>
        </div>

        {/* Inflation active banner */}
        {showRealDollars && (
          <div style={{
            background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8,
            padding: "10px 16px", fontSize: 13, color: "#166534",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontWeight: 700 }}>📉 Real-dollar mode ON ({inflationRate}% inflation)</span>
            <span style={{ color: "#4ade80" }}>—</span>
            <span>Account balances and estate values are shown in today&apos;s purchasing power. Tax amounts remain nominal (inflation does not change your actual tax bill).</span>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} className="no-print">
          {[
            ["manual",    "📊 Manual Simulator"],
            ["brackets",  "🎯 Bracket Comparison"],
            ["optimize",  "⚡ Optimize for Me"],
            ["breakeven", "📈 Break-Even"],
            ["ssclaiming","🔵 SS Claiming Age"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              padding: "9px 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: activeTab === id ? "#1f2328" : "#fff",
              color:      activeTab === id ? "#fff"     : "#57606a",
              border:     activeTab === id ? "2px solid #1f2328" : "2px solid #e5e7eb",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Inputs + Summary row */}
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>

          {/* Inputs panel */}
          <Card title="Inputs">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <InputField label="Traditional IRA Balance" id="tradIRA" value={tradIRA} onChange={setTradIRA} min={0} step={1000} prefix="$" />
              <InputField label="Taxable Brokerage (for taxes)" id="brokerage" value={brokerage} onChange={setBrokerage} min={0} step={1000} prefix="$" note="Used to pay conversion taxes each year" />
              {activeTab === "manual" && (
                <InputField label="Annual Roth Conversion" id="conversion" value={conversion} onChange={setConversion} min={0} step={1000} prefix="$" />
              )}
              <InputField label="Other Annual Income" id="otherIncome" value={otherIncome} onChange={setOtherIncome} min={0} step={1000} prefix="$" note="Wages, Social Security, pension, etc." />
              {activeTab === "manual" && (
                <InputField label="Conversion Years" id="years" value={years} onChange={setYears} min={1} max={30} step={1} suffix="yrs" />
              )}
              {(activeTab === "optimize" || activeTab === "breakeven" || activeTab === "ssclaiming") && (<>
                <InputField label="Annual SS Benefit (FRA at 67)" id="ssIncome" value={ssIncome} onChange={setSsIncome} min={0} step={1000} prefix="$"
                  note={activeTab === "ssclaiming" ? "Enter your full benefit at age 67 (FRA). Other claiming ages are calculated automatically." : "Annual gross Social Security benefit"} />
                <InputField label="SS Start Age" id="ssStartAge" value={ssStartAge} onChange={setSsStartAge} min={62} max={70} step={1} suffix="yrs"
                  note={activeTab === "ssclaiming" ? "Used for Break-Even & Optimizer (SS tab compares all ages automatically)" : "Age you begin collecting SS benefits"} />
                <InputField label="Project Through Age" id="endAge" value={endAge} onChange={setEndAge} min={75} max={100} step={1} suffix="yrs" note="Lifetime projection end age" />
              </>)}
              {activeTab === "optimize" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* ── Max Conversion Tax Bracket ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>Max Conversion Tax Bracket</label>
                    <select value={maxTaxBracket} onChange={e => setMaxTaxBracket(e.target.value)}
                      style={{ padding: "7px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, background: "#fff" }}>
                      <option value="none">No limit — consider all brackets</option>
                      <option value="0.12">Cap at 12% bracket</option>
                      <option value="0.22">Cap at 22% bracket</option>
                      <option value="0.24">Cap at 24% bracket</option>
                      <option value="0.32">Cap at 32% bracket</option>
                    </select>
                    <span style={{ fontSize: 12, color: "#57606a" }}>
                      Excludes any strategy whose conversion income crosses the selected bracket. Use this to avoid large tax bills during the conversion window.
                    </span>
                    {maxTaxBracket !== "none" && (
                      <div style={{
                        fontSize: 12, color: "#92400e", background: "#fef3c7",
                        border: "1px solid #fcd34d", borderRadius: 6, padding: "6px 10px",
                      }}>
                        ⚠ Capping at {(Number(maxTaxBracket) * 100).toFixed(0)}% may leave a large Traditional IRA balance that generates heavy RMDs later. Consider pairing with <strong>RMD Taming</strong> below.
                      </div>
                    )}
                  </div>

                  {/* ── RMD Taming ── */}
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 8,
                    background: (rmdTamingEnabled || targetMaxRMD > 0) ? "#eff6ff" : "#f7f8fa",
                    border: `1px solid ${(rmdTamingEnabled || targetMaxRMD > 0) ? "#93c5fd" : "#e5e7eb"}`,
                    borderRadius: 8, padding: "10px 12px",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <input
                        id="rmdTaming"
                        type="checkbox"
                        checked={rmdTamingEnabled}
                        onChange={e => setRmdTamingEnabled(e.target.checked)}
                        style={{ marginTop: 3, cursor: "pointer", accentColor: "#3b82d4" }}
                      />
                      <div>
                        <label htmlFor="rmdTaming" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          🎯 Target RMD Taming (24% bracket floor)
                        </label>
                        <p style={{ fontSize: 12, color: "#57606a", marginTop: 2 }}>
                          Only convert the excess that would push future RMDs into the 24% bracket at age {birthYear <= 1950 ? 72 : birthYear <= 1959 ? 73 : 75}. Works best when the Trad IRA exceeds $2–4M.
                        </p>
                      </div>
                    </div>

                    {/* Target Max RMD — direct dollar input */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 13, fontWeight: 600 }}>
                        Target Max Age-{birthYear <= 1950 ? 72 : birthYear <= 1959 ? 73 : 75} RMD ($)
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, color: "#57606a" }}>$</span>
                        <InputField
                          label="" id="targetMaxRMD" value={targetMaxRMD}
                          onChange={v => setTargetMaxRMD(Math.max(0, v))}
                          min={0} step={5000}
                        />
                      </div>
                      <span style={{ fontSize: 12, color: "#57606a" }}>
                        Leave at 0 to use the 24% bracket floor above. Enter a dollar amount (e.g. 50000) to set a custom RMD ceiling — the optimizer will only convert the IRA balance that would generate RMDs above this target.
                      </span>
                      {targetMaxRMD > 0 && (
                        <div style={{ fontSize: 12, color: "#1e40af", background: "#dbeafe", borderRadius: 5, padding: "5px 8px" }}>
                          🎯 Target: RMD ≤ {fmt$(targetMaxRMD)}/yr · Target IRA balance at RMD age ≈ {fmt$(Math.round(targetMaxRMD * (birthYear <= 1950 ? 27.4 : birthYear <= 1959 ? 26.5 : 24.6)))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── IRMAA Tolerance ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>IRMAA Tolerance</label>
                    <select value={maxIRMAATier} onChange={e => setMaxIRMAATier(Number(e.target.value))}
                      style={{ padding: "7px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, background: "#fff" }}>
                      <option value={5}>No limit — optimizer picks best plan (recommended)</option>
                      <option value={0}>Tier 0 only — avoid IRMAA entirely</option>
                      <option value={1}>Tier 1 max — up to $259/mo Part B</option>
                      <option value={2}>Tier 2 max — up to $370/mo Part B</option>
                      <option value={3}>Tier 3 max — up to $481/mo Part B</option>
                      <option value={4}>Tier 4 max — up to $592/mo Part B</option>
                    </select>
                    <span style={{ fontSize: 12, color: "#57606a" }}>
                      The optimizer scores by <strong>lifetime cost</strong> — it will accept IRMAA surcharges only if the overall lifetime tax bill is lower.
                    </span>
                  </div>

                </div>
              )}
              {activeTab === "brackets" && (<>
                <InputField label="Annual SS Benefit" id="ssIncomeBracket" value={ssIncome} onChange={setSsIncome} min={0} step={1000} prefix="$" note="Annual gross Social Security benefit" />
                <InputField label="SS Start Age" id="ssStartAgeBracket" value={ssStartAge} onChange={setSsStartAge} min={62} max={70} step={1} suffix="yrs" />
                <InputField label="Project Through Age" id="endAgeBracket" value={endAge} onChange={setEndAge} min={75} max={100} step={1} suffix="yrs" />
              </>)}
              <InputField label="Annual Growth Rate" id="growth" value={growth} onChange={setGrowth} min={0} max={20} step={0.5} suffix="%" />
              <InputField label="Annual Inflation Rate" id="inflation" value={annualInflation} onChange={setAnnualInflation} min={0} max={10} step={0.1} suffix="%"
                note="Used to index tax brackets, standard deduction, and IRMAA thresholds forward each year. 0% = frozen 2025 law." />
              <InputField label="Current Age" id="age" value={age} onChange={(v) => { setAge(v); setBirthYear(new Date().getFullYear() - v); }} min={18} max={85} step={1} suffix="yrs" />
              <InputField label="Birth Year" id="birthYear" value={birthYear} onChange={setBirthYear} min={1930} max={2000} step={1}
                note={
                  birthYear <= 1950 ? "RMD starts at age 72 (pre-SECURE)" :
                  birthYear <= 1959 ? "RMD starts at age 73 (SECURE 2.0)" :
                  "RMD starts at age 75 (SECURE 2.0, born 1960+)"
                }
              />

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor="filing" style={{ fontSize: 13, fontWeight: 600 }}>Filing Status</label>
                <select
                  id="filing"
                  value={filing}
                  onChange={(e) => setFiling(e.target.value)}
                  style={{ padding: "7px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, background: "#fff" }}
                >
                  <option value="single">Single</option>
                  <option value="mfj">Married Filing Jointly</option>
                </select>
              </div>

              {/* State income tax */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor="stateTax" style={{ fontSize: 13, fontWeight: 600 }}>State Tax on Roth Conversion</label>
                <select
                  id="stateTax"
                  value={stateKey}
                  onChange={(e) => setStateKey(e.target.value)}
                  style={{ padding: "7px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, background: "#fff" }}
                >
                  {/* Group: no-tax states */}
                  <optgroup label="── No income tax (9 states)">
                    {Object.entries(STATE_TAX_RATES)
                      .filter(([k]) => ["None (no state tax)","AK – Alaska","FL – Florida","NV – Nevada","NH – New Hampshire","SD – South Dakota","TN – Tennessee","TX – Texas","WA – Washington","WY – Wyoming"].includes(k))
                      .map(([k]) => (
                        <option key={k} value={k}>{k} — $0</option>
                      ))}
                  </optgroup>
                  {/* Group: has income tax but conversion fully exempt */}
                  <optgroup label="── IRA/Roth conversion fully exempt">
                    {Object.entries(STATE_TAX_RATES)
                      .filter(([k, v]) => v === 0 && !["None (no state tax)","AK – Alaska","FL – Florida","NV – Nevada","NH – New Hampshire","SD – South Dakota","TN – Tennessee","TX – Texas","WA – Washington","WY – Wyoming"].includes(k))
                      .map(([k]) => (
                        <option key={k} value={k}>{k} — $0 (conversion exempt)</option>
                      ))}
                  </optgroup>
                  {/* Group: taxed */}
                  <optgroup label="── Taxed (marginal rate on conversion)">
                    {Object.entries(STATE_TAX_RATES)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => (
                        <option key={k} value={k}>{k} — {(v * 100).toFixed(2)}%</option>
                      ))}
                  </optgroup>
                </select>

                {/* Dynamic note for selected state */}
                {(() => {
                  const note  = STATE_TAX_NOTES[stateKey];
                  const rate  = STATE_TAX_RATES[stateKey] ?? 0;
                  const isExempt = rate === 0;
                  const isPartial = note?.startsWith("⚠");
                  const bg    = isExempt  ? "#f0fdf4" : isPartial ? "#fef9f0" : "#f7f8fa";
                  const color = isExempt  ? "#166534" : isPartial ? "#92400e" : "#57606a";
                  const border= isExempt  ? "#86efac" : isPartial ? "#fcd34d" : "#e5e7eb";
                  return note ? (
                    <div style={{ fontSize: 12, color, background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: "6px 10px", lineHeight: 1.5 }}>
                      {note}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "#8b949e" }}>
                      Applied to conversion income. Verify your state&apos;s rules with a CPA.
                    </span>
                  );
                })()}
              </div>

              {/* Tax funding toggle */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                background: payFromConversion ? "#fff7ed" : "#f7f8fa",
                border: `1px solid ${payFromConversion ? "#fed7aa" : "#e5e7eb"}`,
                borderRadius: 8, padding: "10px 12px",
              }}>
                <input
                  id="payFromConv"
                  type="checkbox"
                  checked={payFromConversion}
                  onChange={(e) => setPayFromConversion(e.target.checked)}
                  style={{ marginTop: 3, cursor: "pointer", accentColor: "#f59e0b" }}
                />
                <div>
                  <label htmlFor="payFromConv" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Pay tax shortfall from conversion
                  </label>
                  <p style={{ fontSize: 12, color: "#57606a", marginTop: 2 }}>
                    When brokerage runs dry, withhold unpaid taxes from the Roth deposit instead of leaving them unfunded.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Summary / Bracket / Optimize panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {activeTab === "brackets" && (
              <BracketPanel
                baseInputs={baseInputs}
                ssIncome={ssIncome}
                ssStartAge={Math.round(ssStartAge)}
                endAge={Math.round(endAge)}
                onApply={applyOptimized}
              />
            )}
            {activeTab === "breakeven" && (
              <BreakEvenPanel
                baseInputs={{ ...baseInputs, annualRothConversion: conversion, conversionYears: Math.round(years) }}
                ssIncome={ssIncome}
                ssStartAge={Math.round(ssStartAge)}
                endAge={Math.round(endAge)}
              />
            )}
            {activeTab === "ssclaiming" && (
              <SSClaimingPanel
                baseInputs={{ ...baseInputs, annualRothConversion: conversion, conversionYears: Math.round(years) }}
                fraAnnualBenefit={ssIncome}
                endAge={Math.round(endAge)}
              />
            )}
            {activeTab === "optimize" && (
              <>
                {optError && (
                  <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", color: "#991b1b", fontSize: 14 }}>
                    ⚠ {optError}
                  </div>
                )}
                <OptimizerPanel optResult={optResult} onApply={applyOptimized} baseInputs={{ ...baseInputs, endAge: Math.round(endAge) }} />
              </>
            )}
            {activeTab === "manual" && error && (
              <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", color: "#991b1b", fontSize: 14 }}>
                ⚠ {error}
              </div>
            )}
            {activeTab === "manual" && (<>

            {/* Brokerage exhausted warning */}
            {s?.brokerageExhaustedYears > 0 && (
              <div style={{
                background: "#fff7ed", border: "1px solid #fed7aa",
                borderRadius: 8, padding: "12px 16px", fontSize: 13,
              }}>
                <strong style={{ color: "#92400e" }}>⚠ Brokerage runs out of funds</strong>
                <p style={{ color: "#78350f", marginTop: 4 }}>
                  The taxable brokerage cannot cover taxes in{" "}
                  <strong>{s.brokerageExhaustedYears} year{s.brokerageExhaustedYears !== 1 ? "s" : ""}</strong>.
                  Total unfunded tax: <strong>{fmt$(s.totalUnfundedTax)}</strong>.{" "}
                  {payFromConversion
                    ? "Those taxes are being withheld from each year's Roth deposit — less money enters the Roth."
                    : 'Toggle "Pay tax shortfall from conversion" above to model withholding from the Roth deposit instead.'}
                </p>
              </div>
            )}

            {s && (
              <>
                <Card title={`Conversion Window Summary — ${s.totalYearsModeled} yr${s.totalYearsModeled !== 1 ? "s" : ""} (ages ${Math.round(age)}–${Math.round(age) + s.totalYearsModeled - 1})`} accent="#3b82d4">
                  <div style={{ fontSize: 12, color: "#57606a", marginBottom: 12, padding: "6px 10px", background: "#f0f9ff", borderRadius: 6, border: "1px solid #bae6fd" }}>
                    ℹ These totals cover the <strong>conversion window only</strong>. The <strong>⚡ Optimize for Me</strong> tab shows lifetime totals (including RMDs, Social Security taxation, and IRMAA through retirement).
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
                    <StatBox label="Total Converted" value={fmt$(s.totalAmountConverted)} color="#3b82d4" />
                    <StatBox label="Conversion Years" value={`${s.totalYearsModeled} yr${s.totalYearsModeled !== 1 ? "s" : ""}`} color="#57606a" />
                  </div>
                </Card>

                {/* ── Total Tax Cost Summary ── */}
                {(() => {
                  // incremental tax attributable to the conversion (marginal delta)
                  const convTax      = s.totalFederalTaxOnConversions;   // marginal fed+state on conversion
                  const stateTax     = s.totalStateTaxOnConversions ?? 0;
                  const fedTaxOnly   = s.totalFederalTaxOnly ?? convTax; // gross federal on all income
                  const grossFedState= fedTaxOnly + stateTax;            // gross fed+state on all income
                  const irmaa        = s.totalIRMAASurcharges;
                  // Primary total: incremental conversion tax + IRMAA
                  const totalAll     = convTax + irmaa;
                  const converted    = s.totalAmountConverted;
                  const rothDeposited = s.totalRothDeposited ?? converted;
                  const effRate      = converted > 0 ? totalAll / converted : 0;
                  return (
                    <Card title="Total Tax Cost — Conversion Window" accent="#ef4444">
                      {/* Big total banner */}
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 8,
                        padding: "14px 18px", marginBottom: 16,
                      }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Incremental Conversion Tax + IRMAA
                          </div>
                          <div style={{ fontSize: 30, fontWeight: 800, color: "#dc2626", lineHeight: 1.1, marginTop: 2 }}>
                            {fmt$(totalAll)}
                          </div>
                          <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 4 }}>
                            Marginal cost rate on conversions: <strong>{fmtPct(effRate)}</strong>
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 3 }}>
                            Total Household Tax (incl. baseline income): {fmt$(fedTaxOnly + irmaa)}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, color: "#57606a" }}>of <strong>{fmt$(converted)}</strong> converted</div>
                          {irmaa > 0 && (
                            <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 4, fontWeight: 600 }}>
                              ⚠ Includes {s.irmaaBreachYears} IRMAA yr{s.irmaaBreachYears !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Breakdown row */}
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${stateTaxRate > 0 ? 4 : 3}, 1fr)`, gap: 14 }}>
                        <div style={{ background: "#fef2f2", borderRadius: 8, padding: "12px 14px", borderTop: "3px solid #ef4444" }}>
                          <div style={{ fontSize: 11, color: "#991b1b", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
                            Federal Tax on Conversion
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: "#dc2626" }}>{fmt$(convTax)}</div>
                          <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 3 }}>
                            {converted > 0 ? fmtPct(convTax / converted) : "—"} marginal rate
                          </div>
                          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 3 }}>
                            Gross fed tax all income: {fmt$(fedTaxOnly)}
                          </div>
                        </div>

                        {stateTaxRate > 0 && (
                          <div style={{ background: "#faf5ff", borderRadius: 8, padding: "12px 14px", borderTop: "3px solid #7c5cd8" }}>
                            <div style={{ fontSize: 11, color: "#5b21b6", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
                              State Tax ({(stateTaxRate * 100).toFixed(2)}%)
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: "#7c5cd8" }}>{fmt$(stateTax)}</div>
                            <div style={{ fontSize: 11, color: "#4c1d95", marginTop: 3 }}>
                              {converted > 0 ? fmtPct(stateTax / converted) : "—"} of conversions
                            </div>
                          </div>
                        )}

                        <div style={{
                          background: irmaa > 0 ? "#fffbeb" : "#f7f8fa",
                          borderRadius: 8, padding: "12px 14px",
                          borderTop: `3px solid ${irmaa > 0 ? "#f59e0b" : "#e5e7eb"}`,
                        }}>
                          <div style={{ fontSize: 11, color: irmaa > 0 ? "#92400e" : "#8b949e", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
                            Medicare IRMAA
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: irmaa > 0 ? "#d97706" : "#8b949e" }}>
                            {irmaa > 0 ? fmt$(irmaa) : "$0"}
                          </div>
                          <div style={{ fontSize: 11, color: "#92400e", marginTop: 3 }}>
                            {irmaa > 0
                              ? `${s.irmaaBreachYears} yr${s.irmaaBreachYears !== 1 ? "s" : ""} above threshold`
                              : "No surcharge this window"}
                          </div>
                        </div>

                        <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "12px 14px", borderTop: "3px solid #10b981" }}>
                          <div style={{ fontSize: 11, color: "#065f46", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
                            Net Into Roth
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: "#059669" }}>
                            {fmt$(rothDeposited)}
                          </div>
                          <div style={{ fontSize: 11, color: "#047857", marginTop: 3 }}>
                            {converted > 0 ? fmtPct(rothDeposited / converted) : "—"} of conversion deposited
                          </div>
                          <div style={{ fontSize: 11, color: "#57606a", marginTop: 4, fontStyle: "italic" }}>
                            {payFromConversion && s.brokerageExhaustedYears > 0
                              ? `Taxes withheld from Roth in ${s.brokerageExhaustedYears} yr${s.brokerageExhaustedYears !== 1 ? "s" : ""} — reduced from ${fmt$(converted)}`
                              : "Taxes paid from brokerage — full conversion deposited"}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })()}

                <Card title="Final Balances" accent="#10b981">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                    <StatBox label={`Traditional IRA${showRealDollars ? " (real $)" : ""}`} value={realFmt(s.finalTraditionalIRA, s.totalYearsModeled)} color="#1f2328" />
                    <div style={{ textAlign: "center", position: "relative" }}>
                      <StatBox label={`Roth IRA (tax-free)${showRealDollars ? " (real $)" : ""}`} value={realFmt(s.finalRothIRA, s.totalYearsModeled)} color="#10b981" />
                      <div style={{ marginTop: 6, display: "inline-block", background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                        ✓ 100% Tax-Free to Heirs (SECURE 2.0 Compliant)
                      </div>
                    </div>
                    <StatBox label={`Taxable Brokerage${showRealDollars ? " (real $)" : ""}`} value={realFmt(s.finalTaxableBrokerage, s.totalYearsModeled)} color="#57606a" />
                  </div>
                  {showRealDollars && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#8b949e" }}>
                      Deflated at {inflationRate}% inflation over {s.totalYearsModeled} yr{s.totalYearsModeled !== 1 ? "s" : ""} · Nominal: {fmt$(s.finalTraditionalIRA)} Trad / {fmt$(s.finalRothIRA)} Roth / {fmt$(s.finalTaxableBrokerage)} Taxable
                    </div>
                  )}
                </Card>

                <Card title={`RMD Projection at Age ${s.rmdStartAge} (SECURE 2.0)`} accent="#7c5cd8">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                    <StatBox label={`Projected RMD (age ${s.rmdStartAge})`} value={fmt$(s.projectedRMDAtRmdAge)} color="#7c5cd8" />
                    <StatBox label="Baseline RMD (no conv.)" value={fmt$(s.baselineRMDAtRmdAge)} color="#8b949e" />
                    <StatBox label="Annual RMD Saved"
                      value={fmt$(s.baselineRMDAtRmdAge - s.projectedRMDAtRmdAge)}
                      color="#10b981"
                      sub={`less taxable income at age ${s.rmdStartAge} · est. ${fmt$((s.baselineRMDAtRmdAge - s.projectedRMDAtRmdAge) * 0.24)} in federal tax avoided annually`} />
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: "#8b949e" }}>
                    RMD amounts are shown in nominal dollars. The tax impact of RMDs depends on nominal income, not inflation-adjusted income.
                  </div>
                </Card>
              </>
            )}
            </>)}
          </div>
        </div>

        {/* Charts — manual tab only */}
        {activeTab === "manual" && chartData.length > 0 && (
          <>
            {/* Account Balances chart */}
            <Card title={`Account Balances — End of Year${showRealDollars ? ` (real ${inflationRate}% infl.)` : ""}`}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => fmt$(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="Trad IRA"  stroke="#3b82d4" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Roth IRA"  stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Taxable"   stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* MAGI vs IRMAA threshold */}
            <Card title="Projected MAGI vs. Inflating IRMAA Thresholds">
              <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 8 }}>
                IRMAA thresholds adjust for inflation each year internally. The reference line shows the year-0 threshold; the engine applies per-year scaled thresholds to determine surcharges.
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => fmt$(v)} />
                  <Legend />
                  <Bar dataKey="MAGI" fill="#3b82d4" radius={[4, 4, 0, 0]} />
                  {/* Reference line drawn via a flat invisible bar + custom label */}
                  <Bar
                    dataKey={() => irmaaLine}
                    name={`IRMAA Threshold (${fmt$(irmaaLine)})`}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    legendType="line"
                  />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Annual conversion tax */}
            <Card title="Annual Federal Tax on Conversion">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => fmt$(v)} />
                  <Legend />
                  <Bar dataKey="Conv. Tax" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* RMD comparison */}
            <Card title="Projected RMD: Conversion Strategy vs Do-Nothing Baseline">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => fmt$(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="Baseline RMD"   stroke="#8b949e" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  <Line type="monotone" dataKey="Projected RMD"  stroke="#7c5cd8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* Year-by-year table */}
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "10px 14px", marginBottom: 0, fontSize: 13, color: "#1e40af" }}>
              <strong>ℹ️ Medicare IRMAA Lookback:</strong> Medicare IRMAA surcharges at age 65 are determined by your MAGI from age 63 due to the CMS 2-year lookback rule. Plan your conversions with this lag in mind.
            </div>
            <Card title="Year-by-Year Breakdown">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => exportCSV(
                  result.years.map(y => ({
                    "Year": y.year, "Age": y.age,
                    "Converted": y.conversionAmount,
                    "Trad IRA": y.endingTraditionalIRA,
                    "Roth IRA": y.endingRothIRA,
                    "Taxable": y.endingTaxableBrokerage,
                    "Fed Tax": y.federalTax,
                    "State Tax": y.stateTax,
                    "Total Tax": y.totalFederalTax,
                    "MAGI": y.magi,
                    "IRMAA Tier": y.irmaa.label,
                    "IRMAA Surcharge": y.irmaa.annualSurcharge,
                    "Eff. Rate": (y.effectiveRate * 100).toFixed(2) + "%",
                    "RMD Saved": y.rmdReduction,
                    "Tax Shortfall": y.taxShortfall,
                  })),
                  ["Year","Age","Converted","Trad IRA","Roth IRA","Taxable","Fed Tax","State Tax","Total Tax","MAGI","IRMAA Tier","IRMAA Surcharge","Eff. Rate","RMD Saved","Tax Shortfall"],
                  "roth-conversion-simulation.csv"
                )}
                  style={{ background: "#3b82d4", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                  ⬇ Export CSV
                </button>
              </div>
              {/* Reconciliation note */}
              <div style={{ fontSize: 12, color: "#57606a", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
                <strong>ℹ Column guide:</strong>{" "}
                <span style={{ color: "#ef4444", fontWeight: 600 }}>Incr. Conv. Tax</span> = incremental tax caused by the conversion only (sums to the Tax Cost card).{" "}
                <span style={{ color: "#57606a" }}>Gross Fed Tax</span> = total federal tax on all income including the ${otherIncome.toLocaleString()} other income that would be taxed regardless of any conversion.{" "}
                Difference = <strong>${(s?.totalFederalTaxOnly ?? 0) - (s?.totalFederalTaxOnConversions ?? 0) > 0 ? fmt$((s?.totalFederalTaxOnly ?? 0) - (s?.totalFederalTaxOnConversions ?? 0)) : "—"}</strong> of baseline tax on other income.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f7f8fa" }}>
                      {["Yr", "Age", "Converted", "Trad IRA", "Roth IRA", "Taxable",
                        "Incr. Conv. Tax", "Gross Fed Tax",
                        stateTaxRate > 0 ? "State Tax" : null,
                        stateTaxRate > 0 ? "Gross Total Tax" : null,
                        "Tax Shortfall", "Eff. Rate", "MAGI", "IRMAA", "RMD Saved"
                      ].filter(Boolean).map((h) => (
                        <th key={h} style={{
                          padding: "8px 10px", textAlign: "right", fontWeight: 600,
                          color: h === "Incr. Conv. Tax" ? "#991b1b" : "#57606a",
                          borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.years.map((y, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                        <td style={td}>{y.year}</td>
                        <td style={td}>{y.age}</td>
                        <td style={td}>{fmt$(y.conversionAmount)}</td>
                        {/* Account balances: apply real-dollar deflation based on year index */}
                        <td style={td}>{realFmt(y.endingTraditionalIRA, i + 1)}</td>
                        <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{realFmt(y.endingRothIRA, i + 1)}</td>
                        <td style={{ ...td, color: y.endingTaxableBrokerage === 0 ? "#ef4444" : undefined }}>
                          {realFmt(y.endingTaxableBrokerage, i + 1)}
                        </td>
                        {/* Tax columns always nominal — actual dollars owed to IRS */}
                        <td style={{ ...td, color: "#991b1b", fontWeight: 600 }}>{fmt$(y.conversionTax)}</td>
                        <td style={{ ...td, color: "#ef4444" }}>{fmt$(y.federalTax)}</td>
                        {stateTaxRate > 0 && <td style={{ ...td, color: "#7c5cd8" }}>{fmt$(y.stateTax)}</td>}
                        {stateTaxRate > 0 && <td style={{ ...td, color: "#ef4444", fontWeight: 600 }}>{fmt$(y.totalFederalTax)}</td>}
                        <td style={{ ...td, color: y.brokerageExhausted ? "#dc6f20" : "#8b949e", fontWeight: y.brokerageExhausted ? 600 : 400 }}>
                          {y.brokerageExhausted ? fmt$(y.taxShortfall) : "—"}
                        </td>
                        <td style={td}>{fmtPct(y.effectiveRate)}</td>
                        <td style={td}>{fmt$(y.magi)}</td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <IRMAAbadge
                            label={y.onMedicare ? y.irmaa.label : (y.futureIRMAA?.label ?? "—")}
                            crosses={y.onMedicare ? y.irmaa.crossesThreshold : y.futureIRMAA?.crossesThreshold}
                            notOnMedicare={!y.onMedicare}
                          />
                        </td>
                        <td style={{ ...td, color: "#7c5cd8", fontWeight: 600 }}>{fmt$(y.rmdReduction)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        <div style={{ textAlign: "center", fontSize: 12, color: "#8b949e", padding: "8px 0 16px" }}>
          Uses 2025 federal tax brackets (IRS Rev. Proc. 2024-40) · 2026 projected Medicare IRMAA thresholds · IRS Uniform Lifetime Table for RMDs
          {showRealDollars && ` · Balance columns deflated at ${inflationRate}% inflation`}
        </div>
      </div>
    </div>
  );
}

const td = {
  padding: "7px 10px",
  textAlign: "right",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
};

// ─── CSV export utility ────────────────────────────────────────────────────────
function exportCSV(rows, headers, filename) {
  const esc = v => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.map(esc).join(","),
    ...rows.map(row => headers.map(h => esc(row[h])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Break-even panel ─────────────────────────────────────────────────────────
function BreakEvenPanel({ baseInputs, ssIncome, ssStartAge, endAge, onApply }) {
  const breakEvenData = useMemo(() => {
    try {
      return calcBreakEven({
        ...baseInputs,
        socialSecurityBenefit: ssIncome,
        ssStartAge,
        endAge,
      });
    } catch {
      return null;
    }
  }, [baseInputs, ssIncome, ssStartAge, endAge]);

  if (!breakEvenData) {
    return <div style={{ padding: 20, color: "#57606a" }}>Enter inputs on the left to see break-even analysis.</div>;
  }

  const { breakEvenAge, years } = breakEvenData;
  const chartData = years.map(y => ({
    age:         y.age,
    "Roth Strategy":  y.rothEstate,
    "Do Nothing":     y.baselineEstate,
    "Advantage":      y.advantage,
  }));

  const rothFinal    = years[years.length - 1]?.rothEstate ?? 0;
  const baseFinal    = years[years.length - 1]?.baselineEstate ?? 0;
  const lastAdvantage = years[years.length - 1]?.advantage ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Hero banner */}
      <div style={{
        background: breakEvenAge != null ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "linear-gradient(135deg,#fef9f0,#fef3c7)",
        border: `1px solid ${breakEvenAge != null ? "#86efac" : "#fcd34d"}`,
        borderRadius: 10, padding: "20px 24px",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: breakEvenAge != null ? "#166534" : "#92400e", marginBottom: 12 }}>
          {breakEvenAge != null
            ? `✅ Roth strategy surpasses do-nothing at age ${breakEvenAge}`
            : "⚠ Roth strategy does not overtake do-nothing within the projection window"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          <StatBox label="Break-Even Age"      value={breakEvenAge ?? "N/A"} color={breakEvenAge ? "#166534" : "#92400e"} />
          <StatBox label={`Roth Estate (${endAge})`}     value={fmt$(rothFinal)}  color="#10b981" />
          <StatBox label={`Baseline Estate (${endAge})`} value={fmt$(baseFinal)}  color="#8b949e" />
          <StatBox label="Net Advantage"        value={fmt$(lastAdvantage)} color={lastAdvantage >= 0 ? "#10b981" : "#ef4444"} />
        </div>
        {breakEvenAge != null && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#166534" }}>
            Despite paying upfront conversion taxes, the Roth strategy's tax-free growth and lower RMD burden creates a net worth advantage that begins at age <strong>{breakEvenAge}</strong> and compounds through retirement.
          </div>
        )}
      </div>

      {/* Net worth comparison chart */}
      <Card title="Total Net Worth: Roth Strategy vs Do-Nothing Baseline">
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>
          Shows cumulative total estate value (Traditional + Roth + Taxable) for each strategy. The cross-over is the break-even point.
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} label={{ value: "Age", position: "insideBottom", offset: -2, fontSize: 11 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <Legend />
            {breakEvenAge != null && (
              <ReferenceLine x={breakEvenAge} stroke="#16a34a" strokeDasharray="6 3"
                label={{ value: `Break-even ${breakEvenAge}`, position: "top", fontSize: 11, fill: "#16a34a" }} />
            )}
            <Line type="monotone" dataKey="Roth Strategy" stroke="#10b981" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="Do Nothing"    stroke="#8b949e" strokeWidth={2} dot={false} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Advantage / deficit area chart */}
      <Card title="Roth Advantage Over Do-Nothing (annual net worth delta)">
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>
          Green = Roth strategy is ahead. Red = do-nothing is still ahead. The transition from red to green is the break-even age.
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1.5} />
            {breakEvenAge != null && (
              <ReferenceLine x={breakEvenAge} stroke="#16a34a" strokeDasharray="5 3" />
            )}
            <Area type="monotone" dataKey="Advantage" stroke="#10b981" fill="#bbf7d0"
              strokeWidth={2} dot={false}
              baseValue={0} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Year-by-year table with CSV export */}
      <Card title="Year-by-Year Break-Even Detail">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={() => exportCSV(
            years.map(y => ({
              Age: y.age,
              "Roth Estate": y.rothEstate,
              "Baseline Estate": y.baselineEstate,
              "Net Advantage": y.advantage,
              "Cumulative Tax Delta": y.cumulativeTaxDelta,
            })),
            ["Age","Roth Estate","Baseline Estate","Net Advantage","Cumulative Tax Delta"],
            "break-even.csv"
          )}
            style={{ background: "#3b82d4", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            ⬇ Export CSV
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f7f8fa" }}>
                {["Age","Roth Estate","Do-Nothing Estate","Net Advantage","Cumulative Tax Delta"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#57606a", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y, i) => (
                <tr key={i} style={{ background: y.advantage >= 0 ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={td}>{y.age}{y.age === breakEvenAge ? " ⭐" : ""}</td>
                  <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{fmt$(y.rothEstate)}</td>
                  <td style={{ ...td, color: "#57606a" }}>{fmt$(y.baselineEstate)}</td>
                  <td style={{ ...td, color: y.advantage >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {y.advantage >= 0 ? "+" : ""}{fmt$(y.advantage)}
                  </td>
                  <td style={{ ...td, color: y.cumulativeTaxDelta < 0 ? "#10b981" : "#ef4444" }}>
                    {y.cumulativeTaxDelta >= 0 ? "+" : ""}{fmt$(y.cumulativeTaxDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Social Security claiming comparison panel ────────────────────────────────
function SSClaimingPanel({ baseInputs, fraAnnualBenefit, endAge }) {
  const result = useMemo(() => {
    if (!fraAnnualBenefit || fraAnnualBenefit <= 0) return null;
    try {
      return calcSSClaimingComparison({
        ...baseInputs,
        socialSecurityBenefit: fraAnnualBenefit,
        endAge,
      });
    } catch {
      return null;
    }
  }, [baseInputs, fraAnnualBenefit, endAge]);

  const [selectedAge, setSelectedAge] = useState(67);

  if (!fraAnnualBenefit || fraAnnualBenefit <= 0) {
    return <div style={{ padding: 20, color: "#57606a" }}>Enter an annual SS benefit (FRA amount at 67) in the inputs panel to see the claiming age comparison.</div>;
  }
  if (!result) {
    return <div style={{ padding: 20, color: "#57606a" }}>Computing…</div>;
  }

  const { scenarios } = result;
  const selected = scenarios.find(s => s.claimAge === selectedAge) ?? scenarios[2];
  const bestEstate = scenarios.reduce((a, b) => a.estateValue > b.estateValue ? a : b);
  const bestSS     = scenarios.reduce((a, b) => a.totalSS > b.totalSS ? a : b);
  const bestCost   = scenarios.reduce((a, b) => a.lifetimeCost < b.lifetimeCost ? a : b);

  const COLORS = { 62: "#f59e0b", 65: "#3b82d4", 67: "#7c5cd8", 70: "#10b981" };
  const LABELS = { 62: "Early (62)", 65: "Age 65", 67: "FRA (67)", 70: "Maximum (70)" };

  // Summary comparison bar data
  const barData = scenarios.map(s => ({
    name:    LABELS[s.claimAge] ?? `Age ${s.claimAge}`,
    "Total SS Received":  Math.round(s.totalSS),
    "Lifetime Tax":       Math.round(s.lifetimeTax),
    "Lifetime IRMAA":     Math.round(s.lifetimeIRMAA),
    "Estate Value":       Math.round(s.estateValue),
    claimAge: s.claimAge,
  }));

  // Lifetime chart for selected scenario
  const lifetimeData = selected.years.map(y => ({
    age:          y.age,
    "SS Benefit": Math.round(y.ssBenefit),
    "Taxable SS": Math.round(y.taxableSS ?? 0),
    "MAGI":       Math.round(y.magi),
    "Estate":     Math.round(y.estateValue),
    "Fed Tax":    Math.round(y.totalFederalTax),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Claiming age chip selector */}
      <Card title="Select a Claiming Age to Explore">
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 14 }}>
          Based on an FRA (age 67) benefit of <strong>{fmt$(fraAnnualBenefit)}/yr</strong> ({fmt$(fraAnnualBenefit / 12)}/mo).
          The SSA adjusts your benefit based on when you claim relative to your Full Retirement Age.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {scenarios.map(s => {
            const isActive  = s.claimAge === selectedAge;
            const isBestEst = s.claimAge === bestEstate.claimAge;
            const color     = COLORS[s.claimAge] ?? "#57606a";
            return (
              <button key={s.claimAge} onClick={() => setSelectedAge(s.claimAge)}
                style={{
                  padding: "12px 18px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
                  background: isActive ? color : "#f7f8fa",
                  color:      isActive ? "#fff" : "#1f2328",
                  border:     isActive ? `2px solid ${color}` : "2px solid #e5e7eb",
                  position:   "relative",
                }}>
                {isBestEst && <span style={{ position: "absolute", top: -8, right: -8, background: "#16a34a", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>★ BEST</span>}
                {LABELS[s.claimAge] ?? `Age ${s.claimAge}`}
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 3, opacity: 0.9 }}>
                  {fmt$(s.monthlyBenefit)}/mo · {fmt$(s.annualBenefit)}/yr
                </div>
              </button>
            );
          })}
        </div>

        {/* Summary comparison table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f7f8fa" }}>
                {["Claim Age","Monthly","Annual","Total SS Received","Lifetime Tax","IRMAA","SS Taxed","Total Cost","Estate @"+endAge].map(h => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#57606a", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, i) => {
                const isBest   = s.claimAge === bestEstate.claimAge;
                const isActive = s.claimAge === selectedAge;
                return (
                  <tr key={i} onClick={() => setSelectedAge(s.claimAge)}
                    style={{ background: isActive ? "#eff6ff" : isBest ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#fafafa", cursor: "pointer" }}>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COLORS[s.claimAge] ?? "#ccc", marginRight: 6 }} />
                      Age {s.claimAge}
                      {isBest && <span style={{ marginLeft: 6, fontSize: 10, background: "#16a34a", color: "#fff", borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>BEST</span>}
                    </td>
                    <td style={td}>{fmt$(s.monthlyBenefit)}</td>
                    <td style={td}>{fmt$(s.annualBenefit)}</td>
                    <td style={{ ...td, color: COLORS[s.claimAge] ?? "#57606a", fontWeight: 600 }}>{fmt$(s.totalSS)}</td>
                    <td style={{ ...td, color: "#ef4444" }}>{fmt$(s.lifetimeTax)}</td>
                    <td style={{ ...td, color: s.lifetimeIRMAA > 0 ? "#f59e0b" : "#8b949e" }}>{s.lifetimeIRMAA > 0 ? fmt$(s.lifetimeIRMAA) : "—"}</td>
                    <td style={{ ...td, color: "#a855f7" }}>{fmt$(s.lifetimeSSTax)}</td>
                    <td style={td}>{fmt$(s.lifetimeCost)}</td>
                    <td style={{ ...td, color: "#10b981", fontWeight: 600 }}>{fmt$(s.estateValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Estate comparison bar */}
      <Card title="Estate Value by Claiming Age">
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>
          Higher estate = more wealth transferred. This is driven by delaying SS to avoid taxable SS income, which reduces IRMAA and taxes during RMD years.
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 24, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }}
              domain={['dataMin - 100000', 'dataMax + 100000']} />
            <Tooltip formatter={v => fmt$(v)} />
            <Bar dataKey="Estate Value" fill="#10b981" radius={[4,4,0,0]}
              label={{ position: "top", formatter: v => "$" + (v/1000).toFixed(0)+"k", fontSize: 10, fill: "#1f2328" }} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Total SS received vs lifetime cost */}
      <Card title="Total SS Received vs Lifetime Tax + IRMAA by Claiming Age">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} />
            <Legend />
            <Bar dataKey="Total SS Received" fill="#7c5cd8" radius={[3,3,0,0]} />
            <Bar dataKey="Lifetime Tax"      fill="#ef4444" stackId="cost" />
            <Bar dataKey="Lifetime IRMAA"    fill="#f59e0b" stackId="cost" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Lifetime detail for selected scenario */}
      <Card title={`${LABELS[selected.claimAge] ?? `Age ${selected.claimAge}`} — Annual SS & MAGI Through Retirement`}
        accent={COLORS[selected.claimAge] ?? "#57606a"}>
        <div style={{ fontSize: 13, color: "#57606a", marginBottom: 10 }}>
          Claiming at <strong>age {selected.claimAge}</strong> · <strong>{fmt$(selected.monthlyBenefit)}/mo</strong> ({(selected.annualBenefit / (fraAnnualBenefit||1) * 100).toFixed(0)}% of FRA benefit) · Total SS received: <strong>{fmt$(selected.totalSS)}</strong>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={lifetimeData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left"  tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <Legend />
            <Line yAxisId="left"  type="monotone" dataKey="SS Benefit" stroke={COLORS[selected.claimAge] ?? "#7c5cd8"} strokeWidth={2} dot={false} />
            <Line yAxisId="left"  type="monotone" dataKey="Taxable SS" stroke="#a855f7" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            <Line yAxisId="right" type="monotone" dataKey="MAGI"       stroke="#3b82d4" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title={`${LABELS[selected.claimAge] ?? `Age ${selected.claimAge}`} — Estate Value`}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={lifetimeData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt$(v)} labelFormatter={v => `Age ${v}`} />
            <Area type="monotone" dataKey="Estate" stroke="#10b981" fill="#d1fae5" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
