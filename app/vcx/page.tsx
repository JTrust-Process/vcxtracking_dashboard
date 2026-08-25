"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Line,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
type PriceApiResponse = { price: number | null; symbol?: string; source?: string; updatedAt?: string; error?: string };
type PricePoint       = { price: number; pnl: number };
type Notification     = { id: number; msg: string; color: string };
type ExitTier         = { id: number; targetPrice: string; shares: string; orderType: "Market" | "Limit" };
type Confidence       = "confirmed" | "derived" | "estimate" | "pending";

// ── Data confidence config ────────────────────────────────────────────────────
const CONFIDENCE: Record<Confidence, { label: string; color: string; icon: string }> = {
  confirmed: { label: "Confirmed — Computershare",  color: "#34d399", icon: "✅" },
  derived:   { label: "Derived / calculated",        color: "#60a5fa", icon: "🔵" },
  estimate:  { label: "Manual estimate",             color: "#f59e0b", icon: "🟡" },
  pending:   { label: "Pending detail",              color: "#f87171", icon: "⚠️" },
};

function ConfBadge({ level, tooltip }: { level: Confidence; tooltip?: string }) {
  const c = CONFIDENCE[level];
  return (
    <span
      title={tooltip ?? c.label}
      style={{
        fontSize: "9px", fontFamily: "'Space Mono',monospace", padding: "1px 5px",
        borderRadius: "4px", border: `1px solid ${c.color}44`,
        background: `${c.color}11`, color: c.color, cursor: "help",
        letterSpacing: ".04em", flexShrink: 0,
      }}
    >
      {c.icon} {c.label.split("—")[0].trim()}
    </span>
  );
}

// ── Tax lot (original, confirmed) ─────────────────────────────────────────────
const ORIGINAL_SHARES   = 154.548438;   // ✅ Confirmed
const ORIGINAL_INVESTED = 2160.30;      // ✅ Confirmed
// NOTE: Do NOT derive a blended per-share cost basis from these two figures and
// apply it to individual lots. Computershare tracks actual tax lots with specific
// per-lot basis values that differ from a simple average.

// ── Realized activity ─────────────────────────────────────────────────────────
// TX1: All figures confirmed directly from Computershare statement.
// Lot: 8/3/2023 tax lot. These are LOT-SPECIFIC values, not blended averages.
const TX1 = {
  date:          "2026-08-17",
  settled:       "2026-08-18",
  description:   "Fractional share liquidation",
  shares:        0.268704,    // ✅ Confirmed — Computershare
  salePrice:     38.3342,     // ✅ Confirmed — Computershare
  grossProceeds: 10.30,       // ✅ Confirmed — Computershare
  costBasis:     2.6736,      // ✅ Confirmed — Computershare (8/3/2023 lot basis)
  realizedGain:  7.6264,      // ✅ Confirmed — Computershare
  fees:          0,           // ✅ Confirmed
  taxWithheld:   0,           // ✅ Confirmed
  confidence:    "confirmed" as Confidence,
};

// TX2: $10.71 cleanup payment — proceeds only confirmed; all other fields pending.
// NOTE: 154.548438 − 0.268704 (TX1) = 154.279734 after TX1.
// 154.279734 − 154 (whole shares held) = 0.279734 fractional shares unaccounted for.
// TX2 may represent this 0.279734-share remainder, but this is NOT confirmed.
const TX2 = {
  date:          "2026-08-17",
  settled:       "2026-08-18",
  description:   "Fractional cleanup payment",
  shares:        null,        // ⚠️ Pending — not provided by Computershare
  salePrice:     null,        // ⚠️ Pending
  grossProceeds: 10.71,       // ✅ Confirmed — Computershare
  costBasis:     null,        // ⚠️ Pending — lot-specific basis unknown
  realizedGain:  null,        // ⚠️ Pending — do NOT estimate
  fees:          0,           // ✅ Confirmed
  taxWithheld:   0,           // ✅ Confirmed
  confidence:    "pending" as Confidence,
  note:          "Computershare detail pending. Shares, lot basis, and gain not yet provided. Do not use for tax filing until full transaction detail is confirmed.",
};

// ── Remaining position ────────────────────────────────────────────────────────
const REMAINING_SHARES = 154; // ✅ Confirmed

// PROVISIONAL_REMAINING_BASIS: Upper bound on the 154-share cost basis.
// Actual formula: ORIGINAL_INVESTED − TX1.costBasis − TX2.costBasis (TX2 unknown)
//   = $2,160.30 − $2.6736 − ??? = cannot be finalized until TX2 is confirmed.
// $2,157.63 is the PRE-TX2-RECONCILIATION UPPER BOUND only.
// The actual surviving-lot basis will be lower once TX2's lot basis is subtracted.
// ⚠️ Do NOT use for tax filing. Replace with exact surviving-lot basis once TX2 is reconciled.
const PROVISIONAL_REMAINING_BASIS = ORIGINAL_INVESTED - TX1.costBasis;

const TX1_REALIZED_GAIN    = TX1.realizedGain; // ✅ Confirmed — $7.6264
const TX2_REALIZED_GAIN    = null;             // ⚠️ Pending
const TOTAL_REALIZED_KNOWN = TX1_REALIZED_GAIN;

// ── Portfolio ─────────────────────────────────────────────────────────────────
const portfolio = {
  shares:               REMAINING_SHARES,
  invested:             ORIGINAL_INVESTED,
  provisionalBasis:     PROVISIONAL_REMAINING_BASIS,
  lockupExpired:        "2026-08-13",
  tradableDate:         "2026-08-14",
  entryDate:            "2025-10-15",
};

// ── Computershare fees ────────────────────────────────────────────────────────
const CS_FIXED_FEE  = 25;
const CS_PER_SHARE  = 0.12;
function csFee(shares: number): number {
  return shares > 0 ? CS_FIXED_FEE + shares * CS_PER_SHARE : 0;
}

// ── Price context ─────────────────────────────────────────────────────────────
const PRICE_LEVELS = [
  { label: "Post-lockup support", price: 38.5,  color: "#f59e0b" },
  { label: "Recent range",        price: 42,    color: "#10b981" },
];

// ── Tax constants ─────────────────────────────────────────────────────────────
const FED_LONG  = 0.15;
const FED_SHORT = 0.22;
const PA_RATE   = 0.0307;
const NIIT      = 0.038;

function calcTax(grossProceeds: number, gain: number, isLong: boolean) {
  const taxableGain = Math.max(0, gain);
  const fed   = taxableGain * (isLong ? FED_LONG : FED_SHORT);
  const pa    = taxableGain * PA_RATE;
  const niit  = isLong ? taxableGain * NIIT : 0;
  const total = fed + pa + niit;
  return { fed, pa, niit, total, net: grossProceeds - total };
}

// ── Risk zones ────────────────────────────────────────────────────────────────
const RISK_ZONES = [
  { label: "DEEP VALUE", min: 0,   max: 35,       color: "#ef4444", bg: "rgba(239,68,68,0.08)",    border: "rgba(239,68,68,0.25)"    },
  { label: "SUPPORT",    min: 35,  max: 45,       color: "#f59e0b", bg: "rgba(245,158,11,0.08)",   border: "rgba(245,158,11,0.25)"   },
  { label: "FAIR VALUE", min: 45,  max: 75,       color: "#10b981", bg: "rgba(16,185,129,0.08)",   border: "rgba(16,185,129,0.25)"   },
  { label: "PREMIUM",    min: 75,  max: Infinity, color: "#a78bfa", bg: "rgba(124,58,237,0.08)",   border: "rgba(124,58,237,0.25)"   },
];
function getRiskZone(price: number) {
  return RISK_ZONES.find((z) => price >= z.min && price < z.max) ?? RISK_ZONES[0];
}

// ── Next action ───────────────────────────────────────────────────────────────
function getNextAction(price: number): { action: string; color: string; detail: string } {
  if (price >= 150) return { action: "SCALE OUT",      color: "#a78bfa", detail: "Significant premium. Consider selling per exit plan." };
  if (price >= 75)  return { action: "SELL PARTIAL",   color: "#10b981", detail: "Above fair value. Review exit planner for targets." };
  if (price >= 45)  return { action: "MONITOR",        color: "#f59e0b", detail: "In fair value range. No immediate action needed." };
  if (price >= 35)  return { action: "HOLD — SUPPORT", color: "#f59e0b", detail: "Near post-lockup support. Avoid reactive selling." };
  return                    { action: "HOLD",           color: "#60a5fa", detail: "Below support. Stay patient." };
}

const SCENARIO_PRICES   = [30, 35, 40, 45, 50, 60, 75, 100, 150, 200, 300];
const PROJECTION_PRICES = [35, 40, 45, 50, 75, 100, 150, 200, 300];

// ── Helpers ───────────────────────────────────────────────────────────────────
function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}
function pct(n: number, decimals = 1) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

// ── Count-up hook ─────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  const raf  = useRef<number>(0);
  useEffect(() => {
    const start = prev.current;
    const diff  = target - start;
    if (Math.abs(diff) < 0.01) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(start + diff * e);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else { setDisplay(target); prev.current = target; }
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return display;
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; pnl: number; price: number; projected: boolean; avg?: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "rgba(3,7,18,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", fontFamily: "'Space Mono',monospace", fontSize: "12px" }}>
      <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: "4px", fontSize: "10px" }}>{d.label}{d.projected ? " (PROJ)" : ""}</div>
      <div style={{ color: d.pnl >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{money(d.pnl)} P&L</div>
      <div style={{ color: "#a78bfa" }}>${d.price.toFixed(2)} / share</div>
      {d.avg !== undefined && <div style={{ color: "#f59e0b", fontSize: "11px" }}>20-avg: ${d.avg.toFixed(2)}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VCXDashboardPage() {
  const [livePrice,      setLivePrice]      = useState<number>(42);
  const [manualPrice,    setManualPrice]    = useState<string>("42");
  const [useManualPrice, setUseManualPrice] = useState<boolean>(false);
  const [isLoadingPrice, setIsLoadingPrice] = useState<boolean>(false);
  const [priceError,     setPriceError]     = useState<string>("");
  const [lastUpdated,    setLastUpdated]    = useState<string>("");
  const [alertHigh,      setAlertHigh]      = useState<string>("75");
  const [alertLow,       setAlertLow]       = useState<string>("35");
  const [pricePulse,     setPricePulse]     = useState<boolean>(false);
  const [priceHistory,   setPriceHistory]   = useState<PricePoint[]>([]);
  const [notifications,  setNotifications]  = useState<Notification[]>([]);
  const [isLongTerm,     setIsLongTerm]     = useState<boolean>(true);
  const [activeTab,      setActiveTab]      = useState<"chart"|"exit"|"tax"|"scenario"|"position"|"alerts">("chart");
  const [activeQuick,    setActiveQuick]    = useState<number | null>(null);
  const [mounted,        setMounted]        = useState(false);
  const [notifEnabled,   setNotifEnabled]   = useState(false);
  const [navPrice,       setNavPrice]       = useState<string>("38.50");
  const [navDate,        setNavDate]        = useState<string>("2026-08-13");
  const [customScenario, setCustomScenario] = useState<string>("50");
  const [simShares,      setSimShares]      = useState<string>("30");
  const [simPrice,       setSimPrice]       = useState<string>("75");
  const [exitTiers, setExitTiers] = useState<ExitTier[]>([
    { id: 1, targetPrice: "75",  shares: "30",  orderType: "Market" },
    { id: 2, targetPrice: "100", shares: "50",  orderType: "Market" },
    { id: 3, targetPrice: "150", shares: "74",  orderType: "Limit"  },
  ]);

  const alertFiredHigh = useRef(false);
  const alertFiredLow  = useRef(false);

  // ── Derived values ─────────────────────────────────────────────────────────
  const currentPrice   = useManualPrice ? (Number.isFinite(Number(manualPrice)) ? Number(manualPrice) : 0) : (Number.isFinite(livePrice) ? livePrice : 0);
  const highAlertValue = Number.isFinite(Number(alertHigh)) ? Number(alertHigh) : 0;
  const lowAlertValue  = Number.isFinite(Number(alertLow))  ? Number(alertLow)  : 0;
  const navValue       = Number.isFinite(Number(navPrice))  ? Number(navPrice)  : 0;

  const totalValue     = REMAINING_SHARES * currentPrice;
  const unrealizedGain = totalValue - PROVISIONAL_REMAINING_BASIS;   // 🟡 estimate basis
  const unrealizedPct  = (unrealizedGain / PROVISIONAL_REMAINING_BASIS) * 100;
  // Total return includes only confirmed realized gains; TX2 gain is pending
  const totalReturnKnown = TX1_REALIZED_GAIN + unrealizedGain;
  const navPremium     = navValue > 0 ? ((currentPrice / navValue) - 1) * 100 : null;

  const daysHeld     = useMemo(() => Math.max(1, Math.ceil((Date.now() - new Date(portfolio.entryDate).getTime()) / 86400000)), []);
  const returnPerDay = unrealizedPct / daysHeld;
  const riskZone     = getRiskZone(currentPrice);
  const nextAction   = getNextAction(currentPrice);

  const animatedPrice      = useCountUp(currentPrice, 600);
  const animatedTotalValue = useCountUp(totalValue,   800);
  const animatedUnrealized = useCountUp(unrealizedGain, 800);

  const rollingAvg = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const w = priceHistory.slice(-20);
    return w.reduce((s, p) => s + p.price, 0) / w.length;
  }, [priceHistory]);

  const priceRange = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const prices = priceHistory.slice(-20).map((p) => p.price);
    return { high: Math.max(...prices), low: Math.min(...prices), swing: ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100 };
  }, [priceHistory]);

  const chartData = useMemo(() => {
    const hist = priceHistory.length > 0
      ? priceHistory.map((p, i) => {
          const w = priceHistory.slice(Math.max(0, i - 19), i + 1);
          return { label: `T-${priceHistory.length - i}`, price: p.price, pnl: p.pnl, projected: false, avg: w.reduce((s, x) => s + x.price, 0) / w.length };
        })
      : [{ label: "Now", price: currentPrice, pnl: unrealizedGain, projected: false, avg: currentPrice }];
    const proj = PROJECTION_PRICES.map((p) => ({ label: `$${p}`, price: p, pnl: REMAINING_SHARES * p - PROVISIONAL_REMAINING_BASIS, projected: true, avg: undefined }));
    return [...hist, ...proj];
  }, [priceHistory, currentPrice, unrealizedGain]);

  const sparkData = useMemo(() =>
    (priceHistory.length > 1 ? priceHistory.slice(-20) : [{ price: currentPrice, pnl: unrealizedGain }]).map((p) => ({ v: p.price })),
  [priceHistory, currentPrice, unrealizedGain]);

  const scenarioRows = SCENARIO_PRICES.map((price) => {
    const value = REMAINING_SHARES * price;
    const gain  = value - PROVISIONAL_REMAINING_BASIS;
    return { price, value, gain, ret: (gain / PROVISIONAL_REMAINING_BASIS) * 100 };
  });

  const customScenarioValue = REMAINING_SHARES * (Number(customScenario) || 0);
  const customScenarioGain  = customScenarioValue - PROVISIONAL_REMAINING_BASIS;

  const alertState = useMemo(() => {
    if (currentPrice >= highAlertValue && highAlertValue > 0) return { label: `Above sell watch ${money(highAlertValue)}`, color: "#10b981" };
    if (currentPrice <= lowAlertValue  && lowAlertValue  > 0) return { label: `Below floor ${money(lowAlertValue)}`,       color: "#ef4444" };
    return { label: "Within range", color: "#a78bfa" };
  }, [currentPrice, highAlertValue, lowAlertValue]);

  const exitTierCalcs = useMemo(() => {
    let remaining = REMAINING_SHARES;
    return exitTiers.map((tier) => {
      const tp    = Number(tier.targetPrice) || 0;
      const sh    = Math.min(Number(tier.shares) || 0, remaining);
      const gross = sh * tp;
      const fee   = csFee(sh);
      const basis = (sh / REMAINING_SHARES) * PROVISIONAL_REMAINING_BASIS; // 🟡 estimate — proportional share of estimated remaining basis
      const gain  = gross - basis;
      const tax   = calcTax(gross - fee, gain, isLongTerm);
      const net   = gross - fee - tax.total;
      remaining   = Math.max(0, remaining - sh);
      return { ...tier, sh, gross, fee, tax, net, remaining };
    });
  }, [exitTiers, isLongTerm]);

  const simSharesNum = Math.min(Math.max(Number(simShares) || 0, 0), REMAINING_SHARES);
  const simPriceNum  = Number(simPrice) || 0;
  const simGross     = simSharesNum * simPriceNum;
  const simFee       = csFee(simSharesNum);
  const simBasis     = (simSharesNum / REMAINING_SHARES) * PROVISIONAL_REMAINING_BASIS; // 🟡 estimate — proportional of estimated remaining basis
  const simGain      = simGross - simBasis;
  const simTax       = calcTax(simGross - simFee, simGain, isLongTerm);
  const simNet       = simGross - simFee - simTax.total;
  const simEffFee    = simGross > 0 ? (simFee / simGross) * 100 : 0;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if ("Notification" in window && Notification.permission === "granted") setNotifEnabled(true); }, []);

  const requestNotifPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    setNotifEnabled((await Notification.requestPermission()) === "granted");
  }, []);

  const fireBrowserNotif = useCallback((title: string, body: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/favicon.ico" });
  }, []);

  const pushNotif = useCallback((msg: string, color: string) => {
    const id = Date.now();
    setNotifications((prev) => [...prev.slice(-4), { id, msg, color }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 5000);
  }, []);

  const fetchPrice = useCallback(async () => {
    try {
      setIsLoadingPrice(true); setPriceError("");
      const res  = await fetch("/api/vcx-price", { method: "GET", cache: "no-store" });
      const data: PriceApiResponse = await res.json();
      if (!res.ok) { setPriceError("Market may be closed. Showing last known price."); return; }
      if (typeof data.price === "number" && Number.isFinite(data.price)) {
        setLivePrice(data.price);
        setLastUpdated(data.updatedAt || new Date().toISOString());
        setPricePulse(true);
        setPriceHistory((prev) => [...prev.slice(-59), { price: data.price!, pnl: REMAINING_SHARES * data.price! - PROVISIONAL_REMAINING_BASIS }]);
        setTimeout(() => setPricePulse(false), 1000);
      }
    } catch { setPriceError("Market may be closed. Showing last known price."); }
    finally  { setIsLoadingPrice(false); }
  }, []);

  useEffect(() => {
    if (useManualPrice) return;
    fetchPrice();
    const interval = setInterval(fetchPrice, 30000);
    return () => clearInterval(interval);
  }, [useManualPrice, fetchPrice]);

  useEffect(() => {
    if (highAlertValue > 0 && currentPrice >= highAlertValue && !alertFiredHigh.current) {
      alertFiredHigh.current = true;
      pushNotif(`🚀 VCX above ${money(highAlertValue)} — now ${money(currentPrice)}`, "#10b981");
      fireBrowserNotif("🚀 VCX HIGH ALERT", `Price hit ${money(currentPrice)}`);
    } else if (currentPrice < highAlertValue) { alertFiredHigh.current = false; }
    if (lowAlertValue > 0 && currentPrice <= lowAlertValue && !alertFiredLow.current) {
      alertFiredLow.current = true;
      pushNotif(`⚠️ VCX below floor ${money(lowAlertValue)} — now ${money(currentPrice)}`, "#ef4444");
      fireBrowserNotif("⚠️ VCX LOW ALERT", `Price at ${money(currentPrice)}`);
    } else if (currentPrice > lowAlertValue) { alertFiredLow.current = false; }
  }, [currentPrice, highAlertValue, lowAlertValue, pushNotif, fireBrowserNotif]);

  function formatTime(iso: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  const fade = (delay: number) => ({
    opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(16px)",
    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
  });

  function updateTier(id: number, field: keyof ExitTier, value: string) {
    setExitTiers((prev) => prev.map((t) => t.id === id ? { ...t, [field]: value } : t));
  }
  function addTier() {
    setExitTiers((prev) => [...prev, { id: Date.now(), targetPrice: "", shares: "", orderType: "Market" }]);
  }
  function removeTier(id: number) {
    setExitTiers((prev) => prev.filter((t) => t.id !== id));
  }

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: "chart",    label: "PnL Chart"    },
    { id: "exit",     label: "Exit Planner" },
    { id: "tax",      label: "Tax Sim"      },
    { id: "scenario", label: "Scenarios"    },
    { id: "position", label: "Position"     },
    { id: "alerts",   label: "Alerts"       },
  ];

  const SplitRow = ({ label, value, color, conf, tooltip }: { label: string; value: string; color?: string; conf?: Confidence; tooltip?: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".5rem 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "13px", gap: "8px" }}>
      <span style={{ color: "rgba(255,255,255,0.4)", flex: 1 }}>{label}</span>
      {conf && <ConfBadge level={conf} tooltip={tooltip} />}
      <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 500, color: color ?? "#e2e8f0", flexShrink: 0 }}>{value}</span>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#030712!important;color:#e2e8f0!important;font-family:'Space Grotesk',sans-serif!important;min-height:100vh;overflow-x:hidden}
        .vcx-root{min-height:100vh;background:#030712;position:relative;overflow:hidden}
        .aurora{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:0}
        .a1{position:absolute;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(52,211,153,0.1) 0%,transparent 70%);top:-200px;left:-200px;animation:d1 20s ease-in-out infinite}
        .a2{position:absolute;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.08) 0%,transparent 70%);top:10%;right:-100px;animation:d2 25s ease-in-out infinite}
        .a3{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(59,130,246,0.08) 0%,transparent 70%);bottom:10%;left:20%;animation:d3 18s ease-in-out infinite}
        @keyframes d1{0%,100%{transform:translate(0,0)}50%{transform:translate(100px,80px)}}
        @keyframes d2{0%,100%{transform:translate(0,0)}50%{transform:translate(-80px,60px)}}
        @keyframes d3{0%,100%{transform:translate(0,0)}50%{transform:translate(60px,-80px)}}
        .content{position:relative;z-index:1;padding:2rem;max-width:1400px;margin:0 auto}
        .glass{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:20px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
        .glass-strong{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:20px;backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px)}
        .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;padding:1rem 1.5rem}
        .logo-area{display:flex;align-items:center;gap:12px}
        .logo-dot{width:10px;height:10px;border-radius:50%;background:#34d399;box-shadow:0 0 12px rgba(52,211,153,0.8);animation:pdot 2s ease-in-out infinite}
        @keyframes pdot{0%,100%{box-shadow:0 0 12px rgba(52,211,153,0.8)}50%{box-shadow:0 0 24px rgba(52,211,153,1),0 0 40px rgba(52,211,153,0.4)}}
        .logo-text{font-size:13px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.5)}
        .unlocked-badge{font-size:11px;font-family:'Space Mono',monospace;padding:4px 10px;border-radius:100px;font-weight:700;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.25);color:#34d399}
        .live-badge{display:flex;align-items:center;gap:6px;font-size:11px;font-family:'Space Mono',monospace;color:#10b981;padding:4px 12px;border-radius:100px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.08)}
        .live-dot{width:6px;height:6px;border-radius:50%;background:#10b981;animation:blink 1.5s ease-in-out infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        .risk-badge{font-size:11px;font-family:'Space Mono',monospace;padding:4px 10px;border-radius:100px;font-weight:700;letter-spacing:.08em}
        .decision-panel{display:grid;grid-template-columns:auto 1fr repeat(4,auto);gap:0;margin-bottom:1.5rem;overflow:hidden}
        .dp-action{padding:1.1rem 1.75rem;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,0.06)}
        .dp-detail{padding:1.1rem 1.25rem;display:flex;align-items:center;border-right:1px solid rgba(255,255,255,0.06)}
        .dp-stat{padding:1.1rem 1.25rem;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,0.06);min-width:110px}
        .dp-stat:last-child{border-right:none}
        .dp-label{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:4px}
        .dp-value{font-family:'Space Mono',monospace;font-weight:700;font-size:.95rem}
        .hero{display:grid;grid-template-columns:1fr 320px;gap:1.5rem;margin-bottom:1.5rem;align-items:stretch}
        .hero-price-card{padding:2rem 2.5rem;position:relative;overflow:hidden}
        .hero-price-card::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:conic-gradient(from 0deg,transparent 0deg,rgba(52,211,153,0.02) 60deg,transparent 120deg);animation:rot 30s linear infinite}
        @keyframes rot{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        .price-label{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:.75rem}
        .price-huge{font-size:clamp(3.5rem,7vw,6rem);font-weight:700;font-family:'Space Mono',monospace;letter-spacing:-.02em;line-height:1;background:linear-gradient(135deg,#ffffff 0%,#34d399 50%,#60a5fa 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;position:relative;z-index:1}
        .price-huge.pulse{filter:drop-shadow(0 0 30px rgba(52,211,153,0.5))}
        .price-meta{display:flex;align-items:center;gap:1.25rem;margin-top:1.25rem;position:relative;z-index:1;flex-wrap:wrap}
        .pnl-chip{font-size:13px;font-family:'Space Mono',monospace;padding:5px 12px;border-radius:100px;font-weight:700}
        .pnl-pos{background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.3);color:#34d399}
        .pnl-neg{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171}
        .price-controls{padding:1.25rem;display:flex;flex-direction:column;gap:.875rem}
        .ctrl-label{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:5px}
        .ctrl-input{width:100%;background:rgba(255,255,255,0.05)!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:10px!important;color:#e2e8f0!important;font-family:'Space Mono',monospace!important;font-size:13px!important;padding:9px 12px!important;outline:none!important;transition:border-color .2s}
        .ctrl-input:focus{border-color:rgba(52,211,153,0.5)!important}
        .ctrl-select{width:100%;background:rgba(255,255,255,0.05)!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:10px!important;color:#e2e8f0!important;font-family:'Space Mono',monospace!important;font-size:12px!important;padding:9px 12px!important;outline:none!important;cursor:pointer}
        .ctrl-btn{width:100%;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;letter-spacing:.03em}
        .btn-green{background:rgba(52,211,153,0.12);border-color:rgba(52,211,153,0.3);color:#34d399}
        .btn-green:hover{background:rgba(52,211,153,0.2)}
        .btn-ghost{background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5)}
        .btn-ghost:hover{background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.8)}
        .btn-active{background:rgba(52,211,153,0.18);border-color:rgba(52,211,153,0.4);color:#34d399}
        .btn-red{background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.2);color:#f87171;font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid}
        .btn-add{background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border-radius:10px;padding:8px;cursor:pointer;font-size:12px;width:100%;font-family:'Space Grotesk',sans-serif;transition:all .2s}
        .btn-add:hover{background:rgba(52,211,153,0.06);border-color:rgba(52,211,153,0.25);color:#34d399}
        .btn-enabled{background:rgba(52,211,153,0.12);border-color:rgba(52,211,153,0.3);color:#34d399}
        .quick-prices{display:flex;gap:5px}
        .quick-btn{flex:1;padding:6px 2px;font-size:10px;font-family:'Space Mono',monospace;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.4);cursor:pointer;transition:all .2s;text-align:center}
        .quick-btn:hover,.quick-btn.active{background:rgba(52,211,153,0.12);border-color:rgba(52,211,153,0.3);color:#34d399}
        .metrics-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:1rem;margin-bottom:1.5rem}
        .metric-card{padding:1.1rem 1.25rem;border-radius:16px;position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s}
        .metric-card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.3)}
        .metric-accent{position:absolute;top:0;left:0;width:100%;height:2px}
        .metric-value{font-size:1.35rem;font-weight:700;font-family:'Space Mono',monospace;line-height:1;margin-bottom:4px;letter-spacing:-.02em}
        .metric-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,0.35)}
        .metric-sub{font-size:10px;color:rgba(255,255,255,0.2);font-family:'Space Mono',monospace;margin-top:3px}
        .tab-bar{display:flex;gap:3px;margin-bottom:1.25rem;background:rgba(255,255,255,0.03);padding:4px;border-radius:12px;flex-wrap:wrap}
        .tab-btn{flex:1;min-width:80px;padding:6px 8px;border-radius:8px;border:none;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:500;cursor:pointer;transition:all .2s;color:rgba(255,255,255,0.4);background:transparent;white-space:nowrap}
        .tab-btn.active{background:rgba(52,211,153,0.15);color:#34d399;border:1px solid rgba(52,211,153,0.25)}
        .section-title{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:1rem;padding-bottom:.6rem;border-bottom:1px solid rgba(255,255,255,0.06)}
        .scenario-row{display:grid;grid-template-columns:70px 1fr 1fr 80px;gap:8px;padding:.5rem .75rem;border-radius:8px;font-size:12px;font-family:'Space Mono',monospace;transition:background .2s;border:1px solid transparent}
        .scenario-row:hover{background:rgba(52,211,153,0.05);border-color:rgba(52,211,153,0.1)}
        .scenario-row.cur{background:rgba(52,211,153,0.08);border-color:rgba(52,211,153,0.18)}
        .scenario-header{display:grid;grid-template-columns:70px 1fr 1fr 80px;gap:8px;padding:0 .75rem .4rem;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,0.25)}
        .tax-row{display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px;gap:8px}
        .tax-row:last-child{border-bottom:none}
        .tax-label{color:rgba(255,255,255,0.4)}
        .tax-val{font-family:'Space Mono',monospace;font-weight:500;flex-shrink:0}
        .tax-net{font-size:1.1rem;font-family:'Space Mono',monospace;font-weight:700;color:#34d399;margin-top:.6rem;padding-top:.6rem;border-top:1px solid rgba(255,255,255,0.08)}
        .toggle-row{display:flex;gap:8px;margin-bottom:.875rem}
        .toggle-btn{flex:1;padding:7px;border-radius:8px;font-size:11px;font-family:'Space Mono',monospace;cursor:pointer;transition:all .2s;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.4)}
        .toggle-btn.on{background:rgba(52,211,153,0.12);border-color:rgba(52,211,153,0.3);color:#34d399}
        .alert-status{padding:.6rem .875rem;border-radius:10px;font-size:12px;font-family:'Space Mono',monospace;margin-bottom:.875rem;display:flex;align-items:center;gap:8px;border:1px solid}
        .alert-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        .panel{padding:1.5rem}
        .two-col{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
        .notif-stack{position:fixed;top:1.5rem;right:1.5rem;z-index:1000;display:flex;flex-direction:column;gap:.5rem;pointer-events:none}
        .notif{padding:.75rem 1.25rem;border-radius:12px;font-size:13px;font-family:'Space Mono',monospace;backdrop-filter:blur(20px);border:1px solid;animation:slideIn .3s ease;max-width:360px;pointer-events:auto}
        @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
        .error-text{font-size:11px;font-family:'Space Mono',monospace;color:#f59e0b;padding:5px 10px;background:rgba(245,158,11,0.08);border-radius:6px;border:1px solid rgba(245,158,11,0.2)}
        .warn-text{font-size:11px;font-family:'Space Mono',monospace;color:#ef4444;padding:6px 10px;background:rgba(239,68,68,0.08);border-radius:6px;border:1px solid rgba(239,68,68,0.2);margin-top:.5rem}
        .pending-box{padding:.875rem 1rem;border-radius:10px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);font-size:12px;font-family:'Space Mono',monospace;color:#f87171;line-height:1.6}
        .conf-legend{display:flex;gap:12px;flex-wrap:wrap;padding:.6rem .875rem;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);font-size:10px;font-family:'Space Mono',monospace;margin-bottom:1rem}
        .recharts-cartesian-axis-tick text{fill:rgba(255,255,255,0.25)!important;font-family:'Space Mono',monospace!important;font-size:10px!important}
        .recharts-tooltip-wrapper{outline:none!important}
        @media(max-width:1100px){.hero{grid-template-columns:1fr}.metrics-grid{grid-template-columns:repeat(3,1fr)}.decision-panel{grid-template-columns:1fr 1fr}}
        @media(max-width:700px){.metrics-grid{grid-template-columns:repeat(2,1fr)}.two-col{grid-template-columns:1fr}}
      `}</style>

      <div className="notif-stack">
        {notifications.map((n) => (
          <div key={n.id} className="notif" style={{ borderColor: `${n.color}44`, background: "rgba(3,7,18,0.9)", color: n.color }}>{n.msg}</div>
        ))}
      </div>

      <div className="vcx-root">
        <div className="aurora"><div className="a1" /><div className="a2" /><div className="a3" /></div>
        <div className="content">

          {/* Header */}
          <div className="glass header" style={fade(0)}>
            <div className="logo-area">
              <div className="logo-dot" />
              <span className="logo-text">VCX Position</span>
              <span className="unlocked-badge">🔓 UNRESTRICTED</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div className="risk-badge" style={{ background: riskZone.bg, border: `1px solid ${riskZone.border}`, color: riskZone.color }}>{riskZone.label}</div>
              {!useManualPrice && <div className="live-badge"><div className="live-dot" />LIVE · 30s</div>}
              <button className={`ctrl-btn ${notifEnabled ? "btn-enabled" : "btn-ghost"}`} style={{ width: "auto", padding: "4px 12px", fontSize: "11px", fontFamily: "'Space Mono',monospace" }} onClick={requestNotifPermission}>
                {notifEnabled ? "🔔 On" : "🔔 Alerts"}
              </button>
              <span style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: "rgba(255,255,255,0.2)" }}>
                {useManualPrice ? "MANUAL" : formatTime(lastUpdated)}
              </span>
            </div>
          </div>

          {/* Decision panel */}
          <div className="glass decision-panel" style={fade(40)}>
            <div className="dp-action" style={{ background: `${nextAction.color}0d` }}>
              <div className="dp-label">Action</div>
              <div style={{ fontSize: ".9rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: nextAction.color }}>{nextAction.action}</div>
            </div>
            <div className="dp-detail">
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", fontFamily: "'Space Mono',monospace" }}>{nextAction.detail}</span>
            </div>
            <div className="dp-stat"><div className="dp-label">Market Value</div><div className="dp-value" style={{ color: "#e2e8f0" }}>{money(totalValue)}</div></div>
            <div className="dp-stat"><div className="dp-label">Unrealized</div><div className="dp-value" style={{ color: unrealizedGain >= 0 ? "#34d399" : "#f87171" }}>{pct(unrealizedPct)}</div></div>
            <div className="dp-stat"><div className="dp-label">Days Held</div><div className="dp-value" style={{ color: "#a78bfa" }}>{daysHeld}d</div></div>
            <div className="dp-stat"><div className="dp-label">Per Day</div><div className="dp-value" style={{ color: "#f59e0b" }}>{pct(returnPerDay, 2)}</div></div>
          </div>

          {/* Hero */}
          <div className="hero" style={fade(80)}>
            <div className="glass-strong hero-price-card">
              <div className="price-label">VCX · Current Price · 154 shares unrestricted</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "1.5rem", position: "relative", zIndex: 1 }}>
                <div className={`price-huge${pricePulse ? " pulse" : ""}`}>
                  {animatedPrice < 1000 ? `$${animatedPrice.toFixed(2)}` : `$${animatedPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                </div>
                {mounted && sparkData.length > 1 && (
                  <div style={{ width: 90, height: 36, marginBottom: "0.4rem", opacity: 0.6 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                        <defs>
                          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="v" stroke="#34d399" strokeWidth={1.5} fill="url(#sparkGrad)" dot={false} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              {navValue > 0 && (
                <div style={{ position: "relative", zIndex: 1, marginTop: ".75rem", display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace" }}>
                    NAV {money(navValue)} <span style={{ color: "rgba(255,255,255,0.2)" }}>({navDate})</span>
                  </div>
                  {navPremium !== null && (
                    <div style={{ fontSize: "12px", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: navPremium >= 0 ? "#f59e0b" : "#34d399", padding: "2px 8px", borderRadius: "100px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {navPremium >= 0 ? "+" : ""}{navPremium.toFixed(1)}% vs NAV
                    </div>
                  )}
                  <ConfBadge level="estimate" tooltip="NAV entered manually — update when Computershare publishes" />
                </div>
              )}
              <div className="price-meta">
                <div className={`pnl-chip ${unrealizedGain >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                  {unrealizedGain >= 0 ? "▲" : "▼"} {pct(unrealizedPct)}
                </div>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono',monospace" }}>
                  {unrealizedGain >= 0 ? "+" : ""}${Math.abs(animatedUnrealized).toLocaleString("en-US", { maximumFractionDigits: 0 })} unrealized
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "2px" }}>MARKET VALUE</div>
                  <div style={{ fontSize: "1.3rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>
                    ${animatedTotalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass price-controls">
              <div>
                <div className="ctrl-label">Manual Override</div>
                <input className="ctrl-input" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="Enter price..." />
              </div>
              <div className="quick-prices">
                {[38, 42, 50, 75, 100].map((p) => (
                  <button key={p} className={`quick-btn${activeQuick === p ? " active" : ""}`} onClick={() => { setManualPrice(String(p)); setActiveQuick(p); }}>
                    ${p}
                  </button>
                ))}
              </div>
              <button className={`ctrl-btn ${useManualPrice ? "btn-active" : "btn-green"}`} onClick={() => setUseManualPrice((v) => !v)}>
                {useManualPrice ? "⚡ Live" : "✎ Manual"}
              </button>
              <button className="ctrl-btn btn-ghost" onClick={fetchPrice} disabled={isLoadingPrice || useManualPrice}>
                {isLoadingPrice ? "Fetching..." : "↻ Refresh"}
              </button>
              <div>
                <div className="ctrl-label">NAV <span style={{ color: "rgba(255,255,255,0.25)" }}>(manual estimate)</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "6px" }}>
                  <input className="ctrl-input" value={navPrice} onChange={(e) => setNavPrice(e.target.value)} placeholder="38.50" />
                  <input className="ctrl-input" value={navDate}  onChange={(e) => setNavDate(e.target.value)}  placeholder="YYYY-MM-DD" />
                </div>
              </div>
              {priceError && <div className="error-text">{priceError}</div>}
            </div>
          </div>

          {/* Metrics */}
          <div className="metrics-grid">
            {[
              { label: "Market Value",   value: `$${animatedTotalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,                                                                               sub: "154 shares",              accent: "linear-gradient(90deg,#7c3aed,#a78bfa)", color: "#e2e8f0",  delay: 160 },
              { label: "Cost Basis",     value: money(PROVISIONAL_REMAINING_BASIS),                                                                                                                               sub: "⚠️ upper bound — TX2 pending", accent: "linear-gradient(90deg,#0ea5e9,#38bdf8)", color: "#e2e8f0",  delay: 200 },
              { label: "Unrealized P/L", value: `${unrealizedGain >= 0 ? "+" : ""}$${Math.abs(animatedUnrealized).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,                                    sub: pct(unrealizedPct) + " · 🔵 derived",        accent: unrealizedGain >= 0 ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#ef4444,#f87171)", color: unrealizedGain >= 0 ? "#34d399" : "#f87171", delay: 240 },
              { label: "Realized Gains", value: `+${money(TX1_REALIZED_GAIN)}`,                                                                                                                               sub: "TX1 only · TX2 ⚠️ pending", accent: "linear-gradient(90deg,#f59e0b,#fbbf24)", color: "#fbbf24", delay: 280 },
              { label: "NAV vs Price",   value: navPremium !== null ? `${navPremium >= 0 ? "+" : ""}${navPremium.toFixed(1)}%` : "—",                                                                         sub: navValue > 0 ? `NAV ${money(navValue)} · 🟡 estimate` : "Set NAV →", accent: "linear-gradient(90deg,#f59e0b,#ef4444)", color: navPremium !== null && navPremium > 0 ? "#f59e0b" : "#34d399", delay: 320 },
            ].map((m) => (
              <div key={m.label} className="glass metric-card" style={fade(m.delay)}>
                <div className="metric-accent" style={{ background: m.accent }} />
                <div className="metric-value" style={{ color: m.color, marginTop: ".4rem" }}>{m.value}</div>
                <div className="metric-label">{m.label}</div>
                {m.sub && <div className="metric-sub">{m.sub}</div>}
              </div>
            ))}
          </div>

          {/* Tabbed panel */}
          <div className="glass panel" style={fade(380)}>
            <div className="tab-bar">
              {tabs.map((t) => (
                <button key={t.id} className={`tab-btn${activeTab === t.id ? " active" : ""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {/* Chart */}
            {activeTab === "chart" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace" }}>SESSION HISTORY + PROJECTION · 154 SHARES</div>
                  <div style={{ display: "flex", gap: "12px", fontSize: "11px", fontFamily: "'Space Mono',monospace" }}>
                    <span style={{ color: "#34d399" }}>── Live</span>
                    <span style={{ color: "#f59e0b" }}>── 20-avg</span>
                    <span style={{ color: "rgba(167,139,250,0.6)" }}>- - Projected</span>
                  </div>
                </div>
                {mounted && (
                  <div style={{ width: "100%", height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                        <defs>
                          <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#34d399" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 9, fontFamily: "'Space Mono',monospace" }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 9, fontFamily: "'Space Mono',monospace" }} tickLine={false} axisLine={false} width={48} />
                        <Tooltip content={<ChartTooltip />} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="pnl" stroke="#34d399" strokeWidth={2} fill="url(#histGrad)" dot={false} activeDot={{ r: 5, fill: "#34d399", strokeWidth: 0 }} data={chartData.filter((d) => !d.projected)} isAnimationActive animationDuration={800} />
                        <Area type="monotone" dataKey="pnl" stroke="rgba(167,139,250,0.6)" strokeWidth={1.5} strokeDasharray="5 4" fill="url(#projGrad)" dot={false} activeDot={{ r: 4, fill: "#a78bfa", strokeWidth: 0 }} data={chartData.filter((d) => d.projected)} isAnimationActive animationDuration={1000} />
                        <Line type="monotone" dataKey="avg" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" data={chartData.filter((d) => !d.projected && d.avg !== undefined)} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", fontSize: "12px", fontFamily: "'Space Mono',monospace", flexWrap: "wrap" }}>
                  <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>UNREALIZED PNL</div><div style={{ color: unrealizedGain >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{money(unrealizedGain)}</div></div>
                  <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>20-PT AVG</div><div style={{ color: "#f59e0b", fontWeight: 700 }}>{rollingAvg ? `$${rollingAvg.toFixed(2)}` : "—"}</div></div>
                  {priceRange && <>
                    <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>SESSION HIGH</div><div style={{ color: "#34d399" }}>${priceRange.high.toFixed(2)}</div></div>
                    <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>SESSION LOW</div><div style={{ color: "#f87171" }}>${priceRange.low.toFixed(2)}</div></div>
                    <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>SWING</div><div style={{ color: "rgba(255,255,255,0.6)" }}>{priceRange.swing.toFixed(1)}%</div></div>
                  </>}
                </div>
              </div>
            )}

            {/* Exit Planner */}
            {activeTab === "exit" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>Exit Planner — CS fee: $25 fixed + $0.12/sh</div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button className={`toggle-btn${isLongTerm ? " on" : ""}`}  style={{ padding: "4px 10px", fontSize: "10px" }} onClick={() => setIsLongTerm(true)}>LT · 15%</button>
                    <button className={`toggle-btn${!isLongTerm ? " on" : ""}`} style={{ padding: "4px 10px", fontSize: "10px" }} onClick={() => setIsLongTerm(false)}>ST · 22%</button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "90px 70px 80px 90px 1fr 28px", gap: "8px", padding: "0 .75rem .4rem", fontSize: "9px", letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>
                  <span>Target $</span><span>Shares</span><span>Order</span><span>Gross</span><span>Results (fee + tax → net)</span><span></span>
                </div>
                {exitTierCalcs.map((tier) => (
                  <div key={tier.id} style={{ marginBottom: ".75rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "90px 70px 80px 90px 1fr 28px", gap: "8px", alignItems: "center", padding: ".6rem .75rem", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <input className="ctrl-input" style={{ padding: "5px 8px", fontSize: "12px" }} value={tier.targetPrice} onChange={(e) => updateTier(tier.id, "targetPrice", e.target.value)} placeholder="Price" />
                      <input className="ctrl-input" style={{ padding: "5px 8px", fontSize: "12px" }} value={tier.shares}      onChange={(e) => updateTier(tier.id, "shares", e.target.value)}      placeholder="Sh" />
                      <select className="ctrl-select" style={{ padding: "5px 6px", fontSize: "10px" }} value={tier.orderType} onChange={(e) => updateTier(tier.id, "orderType", e.target.value as "Market"|"Limit")}>
                        <option>Market</option><option>Limit</option>
                      </select>
                      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "12px", color: "#e2e8f0" }}>{tier.sh > 0 ? money(tier.gross) : "—"}</div>
                      <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        {tier.sh > 0 && <>
                          <span style={{ color: "#f87171" }}>Fee {money(tier.fee)}</span>
                          <span style={{ color: "#f87171" }}>Tax {money(tier.tax.total)}</span>
                          <span style={{ color: "#34d399", fontWeight: 700 }}>Net {money(tier.net)}</span>
                          <span style={{ color: "rgba(255,255,255,0.3)" }}>{tier.remaining}sh remain</span>
                        </>}
                      </div>
                      <button className="btn-red" onClick={() => removeTier(tier.id)}>✕</button>
                    </div>
                    {tier.sh > 0 && tier.fee / tier.gross > 0.05 && (
                      <div className="warn-text">⚠️ Fee is {((tier.fee / tier.gross) * 100).toFixed(1)}% of proceeds — sell more shares per transaction to reduce impact</div>
                    )}
                  </div>
                ))}
                <button className="btn-add" onClick={addTier}>+ Add Exit Tier</button>
                {exitTierCalcs.some((t) => t.sh > 0) && (
                  <div style={{ marginTop: "1.25rem", padding: "1rem", borderRadius: "12px", background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.12)" }}>
                    <div className="section-title" style={{ marginBottom: ".75rem" }}>Plan Summary</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1rem", fontSize: "12px", fontFamily: "'Space Mono',monospace" }}>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "3px" }}>TOTAL GROSS</div><div style={{ color: "#e2e8f0" }}>{money(exitTierCalcs.reduce((s, t) => s + t.gross, 0))}</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "3px" }}>TOTAL FEES</div><div style={{ color: "#f87171" }}>−{money(exitTierCalcs.reduce((s, t) => s + t.fee, 0))}</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "3px" }}>TOTAL TAX</div><div style={{ color: "#f87171" }}>−{money(exitTierCalcs.reduce((s, t) => s + t.tax.total, 0))}</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "3px" }}>TOTAL NET</div><div style={{ color: "#34d399", fontWeight: 700 }}>{money(exitTierCalcs.reduce((s, t) => s + t.net, 0))}</div></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tax Sim */}
            {activeTab === "tax" && (
              <div className="two-col">
                <div>
                  <div className="ctrl-label">Holding Period</div>
                  <div className="toggle-row">
                    <button className={`toggle-btn${isLongTerm ? " on" : ""}`}  onClick={() => setIsLongTerm(true)}>Long-term · 15% fed</button>
                    <button className={`toggle-btn${!isLongTerm ? " on" : ""}`} onClick={() => setIsLongTerm(false)}>Short-term · 22% fed</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem", marginBottom: ".875rem" }}>
                    <div><div className="ctrl-label">Shares</div><input className="ctrl-input" value={simShares} onChange={(e) => setSimShares(e.target.value)} placeholder="0" /></div>
                    <div><div className="ctrl-label">At Price</div><input className="ctrl-input" value={simPrice} onChange={(e) => setSimPrice(e.target.value)} placeholder="0.00" /></div>
                  </div>
                  <div style={{ padding: ".875rem 1rem", borderRadius: "12px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", marginBottom: ".875rem" }}>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: ".4rem", fontFamily: "'Space Mono',monospace" }}>GROSS PROCEEDS</div>
                    <div style={{ fontSize: "1.4rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>{money(simGross)}</div>
                  </div>
                  <div className="tax-row"><span className="tax-label">CS fixed fee</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(25)}</span></div>
                  <div className="tax-row"><span className="tax-label">CS processing ({simSharesNum} × $0.12)</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(simSharesNum * 0.12)}</span></div>
                  <div className="tax-row"><span className="tax-label">Realized gain (on {simSharesNum} sh)</span><span className="tax-val" style={{ color: "#34d399" }}>{money(simGain)}</span></div>
                  <div className="tax-row"><span className="tax-label">Federal ({isLongTerm ? "15%" : "22%"}) on gain</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(simTax.fed)}</span></div>
                  <div className="tax-row"><span className="tax-label">PA State (3.07%) on gain</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(simTax.pa)}</span></div>
                  {isLongTerm && <div className="tax-row"><span className="tax-label">NIIT (3.8%) on gain</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(simTax.niit)}</span></div>}
                  <div className="tax-row"><span className="tax-label">All fees + tax</span><span className="tax-val" style={{ color: "#f87171", fontWeight: 700 }}>−{money(simFee + simTax.total)}</span></div>
                  <div className="tax-net">Take-home: {money(simNet)}</div>
                  {simGross > 0 && <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace", marginTop: ".5rem" }}>Effective fee drag: {simEffFee.toFixed(2)}%</div>}
                  {simGross > 0 && simFee / simGross > 0.05 && <div className="warn-text">⚠️ $25 fixed fee = {simEffFee.toFixed(1)}% of gross. Sell more shares to reduce drag.</div>}
                </div>
                <div>
                  <div className="section-title">Basis Check</div>
                  <SplitRow label="Shares being sold"      value={String(simSharesNum)} conf="derived" />
                  <SplitRow label="Cost basis sold (est.)" value={money(simBasis)} conf="pending" tooltip="Proportional share of provisional basis ($2,157.63 upper bound ÷ 154 shares). Will be more accurate once TX2 lot is reconciled and actual lot assignments are known." />
                  <SplitRow label="Realized gain"          value={money(simGain)}  conf="derived" />
                  <SplitRow label="Shares remaining"       value={String(REMAINING_SHARES - simSharesNum)} conf="derived" />
                  <SplitRow label="Remaining basis (upper bound)" value={money(PROVISIONAL_REMAINING_BASIS - simBasis)} conf="pending" tooltip="Upper bound only — overstates actual basis by TX2's unknown lot cost. Replace once TX2 is reconciled." />
                  <SplitRow label="Remaining market value" value={money((REMAINING_SHARES - simSharesNum) * currentPrice)} conf="derived" />

                  <div className="section-title" style={{ marginTop: "1.25rem" }}>Realized Activity</div>
                  <div className="conf-legend">
                    {Object.entries(CONFIDENCE).map(([key, val]) => (
                      <span key={key} style={{ color: val.color }}>{val.icon} {val.label}</span>
                    ))}
                  </div>

                  {/* TX1 */}
                  <div style={{ padding: ".875rem 1rem", borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: ".6rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem" }}>
                      <span style={{ fontSize: "12px", color: "#e2e8f0", fontWeight: 600 }}>Fractional share liquidation</span>
                      <ConfBadge level="confirmed" />
                    </div>
                    <SplitRow label="Date"          value={TX1.date}                         conf="confirmed" />
                    <SplitRow label="Shares sold"   value={`${TX1.shares}`}                  conf="confirmed" />
                    <SplitRow label="Sale price"    value={`$${TX1.salePrice}`}               conf="confirmed" />
                    <SplitRow label="Gross proceeds" value={money(TX1.grossProceeds)}         conf="confirmed" />
                    <SplitRow label="Cost basis"    value={money(TX1.costBasis)}              conf="confirmed" tooltip="8/3/2023 lot basis — confirmed by Computershare" />
                    <SplitRow label="Realized gain" value={`+${money(TX1.realizedGain)}`}    color="#34d399"  conf="confirmed" />
                  </div>

                  {/* TX2 */}
                  <div style={{ padding: ".875rem 1rem", borderRadius: "12px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)", marginBottom: ".6rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem" }}>
                      <span style={{ fontSize: "12px", color: "#e2e8f0", fontWeight: 600 }}>Fractional cleanup payment</span>
                      <ConfBadge level="pending" />
                    </div>
                    <SplitRow label="Date"           value={TX2.date}              conf="confirmed" />
                    <SplitRow label="Gross proceeds" value={money(TX2.grossProceeds)} conf="confirmed" />
                    <SplitRow label="Shares sold"    value="⚠️ Pending"           conf="pending" tooltip="Not provided by Computershare — may be ~0.279734 sh" />
                    <SplitRow label="Cost basis"     value="⚠️ Pending"           conf="pending" />
                    <SplitRow label="Realized gain"  value="⚠️ Pending"           conf="pending" tooltip="Do not estimate for tax filing" />
                    <div style={{ fontSize: "10px", color: "rgba(239,68,68,0.7)", fontFamily: "'Space Mono',monospace", marginTop: ".5rem", lineHeight: 1.5 }}>
                      {TX2.note}
                    </div>
                  </div>

                  <SplitRow label="TX1 confirmed gain"  value={`+${money(TX1_REALIZED_GAIN)}`} color="#34d399"  conf="confirmed" tooltip="Confirmed by Computershare — 8/3/2023 lot" />
                  <SplitRow label="TX2 gain"            value="⚠️ Pending"                     conf="pending"  />
                  <SplitRow label="Unrealized gain"     value={money(unrealizedGain)}            color={unrealizedGain >= 0 ? "#34d399" : "#f87171"} conf="derived" />
                  <div style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", fontSize: "13px", gap: "8px", marginTop: ".25rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: ".75rem" }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>Total return (partial)</span>
                    <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#34d399" }}>{money(totalReturnKnown)} + TX2 pending</span>
                  </div>
                </div>
              </div>
            )}

            {/* Scenarios */}
            {activeTab === "scenario" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                  <div>
                    <div className="ctrl-label">Custom Price</div>
                    <input className="ctrl-input" value={customScenario} onChange={(e) => setCustomScenario(e.target.value)} placeholder="Enter price" />
                  </div>
                  <div style={{ padding: ".75rem 1rem", borderRadius: "10px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}>
                    <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginBottom: "4px", fontFamily: "'Space Mono',monospace" }}>AT ${customScenario}</div>
                    <div style={{ fontSize: "1.2rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#c4b5fd" }}>{money(customScenarioValue)}</div>
                    <div style={{ fontSize: "11px", color: customScenarioGain >= 0 ? "#34d399" : "#f87171", fontFamily: "'Space Mono',monospace" }}>{customScenarioGain >= 0 ? "+" : ""}{money(customScenarioGain)}</div>
                  </div>
                </div>
                <div className="scenario-header"><span>PRICE</span><span>VALUE</span><span>GAIN</span><span>RETURN</span></div>
                {scenarioRows.map((row) => {
                  const zone = getRiskZone(row.price);
                  return (
                    <div key={row.price} className={`scenario-row${Math.abs(row.price - currentPrice) < 1.5 ? " cur" : ""}`}>
                      <span style={{ color: zone.color, fontWeight: 700 }}>${row.price}</span>
                      <span style={{ color: "#e2e8f0" }}>{money(row.value)}</span>
                      <span style={{ color: row.gain >= 0 ? "#34d399" : "#f87171" }}>{row.gain >= 0 ? "+" : ""}{money(row.gain)}</span>
                      <span style={{ color: row.ret >= 0 ? "#34d399" : "#f87171" }}>{pct(row.ret)}</span>
                    </div>
                  );
                })}
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono',monospace", marginTop: ".6rem" }}>
                  ⚠️ P&L uses provisional basis {money(PROVISIONAL_REMAINING_BASIS)} (upper bound — TX2 lot pending) · price color = risk zone
                </div>
              </div>
            )}

            {/* Position */}
            {activeTab === "position" && (
              <div className="two-col">
                <div>
                  <div className="section-title">Reconciled Position</div>
                  <div className="conf-legend">
                    {Object.entries(CONFIDENCE).map(([key, val]) => (
                      <span key={key} style={{ color: val.color }}>{val.icon} {val.label}</span>
                    ))}
                  </div>
                  <SplitRow label="Original shares"       value={`${ORIGINAL_SHARES}`}           conf="confirmed" />
                  <SplitRow label="Original investment"   value={money(ORIGINAL_INVESTED)}        conf="confirmed" />
                  <SplitRow label="TX1 shares liquidated" value={`${TX1.shares}`}                 conf="confirmed" />
                  <SplitRow label="TX1 lot basis"         value={money(TX1.costBasis)}             conf="confirmed" tooltip="8/3/2023 lot — confirmed by Computershare" />
                  <SplitRow label="TX2 shares liquidated" value="⚠️ Pending"                      conf="pending"   tooltip="~0.279734 sh implied by 154 whole remaining, but not confirmed" />
                  <SplitRow label="TX2 lot basis"         value="⚠️ Pending"                      conf="pending"   tooltip="Lot-specific basis not yet provided by Computershare" />
                  <SplitRow label="Remaining shares"      value={`${REMAINING_SHARES}`}           conf="confirmed" />
                  <SplitRow label="Remaining basis (provisional)" value={money(PROVISIONAL_REMAINING_BASIS)} conf="pending" tooltip="UPPER BOUND: $2,160.30 − $2.6736 (TX1) − TX2 basis (unknown). Overstates actual basis by TX2 lot cost. Replace with exact surviving-lot sum once TX2 is reconciled." />
                  <SplitRow label="Tradable since"        value={portfolio.tradableDate}            conf="confirmed" />

                  <div style={{ padding: ".875rem 1rem", borderRadius: "10px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", marginTop: "1rem" }}>
                    <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: "#f87171", fontWeight: 700, marginBottom: ".4rem" }}>⚠️ Action required — TX2 detail</div>
                    <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: "rgba(239,68,68,0.7)", lineHeight: 1.6 }}>
                      Request full transaction detail for the $10.71 payment from Computershare (shares, price, cost basis, and character of payment). Required for accurate tax filing and basis reconciliation. Until confirmed, TX2 gain is excluded from performance totals.
                    </div>
                  </div>
                </div>
                <div>
                  <div className="section-title">Performance (no double counting)</div>
                  <SplitRow label="TX1 realized gain"   value={`+${money(TX1_REALIZED_GAIN)}`}   color="#34d399" conf="derived"  />
                  <SplitRow label="TX2 realized gain"   value="⚠️ Pending"                        conf="pending" />
                  <SplitRow label="Unrealized gain"     value={money(unrealizedGain)}              color={unrealizedGain >= 0 ? "#34d399" : "#f87171"} conf="pending" tooltip="154 × currentPrice − provisional basis ($2,157.63 upper bound). Understates true gain — will decrease once TX2 lot basis is subtracted." />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".75rem 0", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: ".25rem", gap: "8px" }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "13px" }}>Total return (known)</span>
                    <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#34d399", fontSize: "15px" }}>{money(totalReturnKnown)}</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace", marginTop: ".25rem", lineHeight: 1.5 }}>
                    + TX2 gain (pending) to be added when confirmed.<br/>
                    Unrealized and realized do not overlap — different share lots.
                  </div>

                  <div className="section-title" style={{ marginTop: "1.25rem" }}>Confirmed Transactions</div>
                  {[TX1].map((tx, i) => (
                    <div key={i} style={{ padding: ".875rem 1rem", borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: ".6rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".4rem" }}>
                        <span style={{ fontSize: "12px", color: "#e2e8f0", fontWeight: 600 }}>{tx.description}</span>
                        <ConfBadge level="confirmed" />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "11px", fontFamily: "'Space Mono',monospace" }}>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>SHARES</div><div>{tx.shares}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>GROSS</div><div>{money(tx.grossProceeds)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>GAIN 🔵</div><div style={{ color: "#34d399" }}>+{money(tx.realizedGain)}</div></div>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: ".875rem 1rem", borderRadius: "12px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".4rem" }}>
                      <span style={{ fontSize: "12px", color: "#e2e8f0", fontWeight: 600 }}>{TX2.description}</span>
                      <ConfBadge level="pending" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "11px", fontFamily: "'Space Mono',monospace" }}>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>SHARES</div><div style={{ color: "#f87171" }}>⚠️</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>GROSS</div><div>{money(TX2.grossProceeds)} ✅</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>GAIN</div><div style={{ color: "#f87171" }}>⚠️ Pending</div></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Alerts */}
            {activeTab === "alerts" && (
              <div className="two-col">
                <div>
                  <div className="section-title">Alert Watch</div>
                  <div className="alert-status" style={{ borderColor: `${alertState.color}33`, background: `${alertState.color}11`, color: alertState.color }}>
                    <div className="alert-dot" style={{ background: alertState.color, boxShadow: `0 0 6px ${alertState.color}` }} />
                    {alertState.label}
                  </div>
                  {[
                    { label: "High Alert", value: alertHigh, setter: setAlertHigh, color: "#10b981" },
                    { label: "Low Alert",  value: alertLow,  setter: setAlertLow,  color: "#ef4444" },
                  ].map((a) => (
                    <div key={a.label} style={{ marginBottom: ".75rem" }}>
                      <div className="ctrl-label" style={{ color: a.color, opacity: 0.8 }}>{a.label}</div>
                      <input className="ctrl-input" value={a.value} onChange={(e) => a.setter(e.target.value)} placeholder="0.00" />
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "13px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>vs High</span>
                    <span style={{ fontFamily: "'Space Mono',monospace", color: currentPrice >= highAlertValue && highAlertValue > 0 ? "#10b981" : "rgba(255,255,255,0.5)" }}>
                      {highAlertValue > 0 ? `${((currentPrice / highAlertValue) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", fontSize: "13px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>vs Low</span>
                    <span style={{ fontFamily: "'Space Mono',monospace", color: currentPrice <= lowAlertValue && lowAlertValue > 0 ? "#ef4444" : "rgba(255,255,255,0.5)" }}>
                      {lowAlertValue > 0 ? `${((currentPrice / lowAlertValue) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="section-title">Risk Zones</div>
                  {RISK_ZONES.map((z) => (
                    <div key={z.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: ".5rem .75rem", borderRadius: "8px", marginBottom: "4px", background: currentPrice >= z.min && currentPrice < z.max ? z.bg : "transparent", border: `1px solid ${currentPrice >= z.min && currentPrice < z.max ? z.border : "transparent"}`, transition: "all .3s" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: z.color, boxShadow: currentPrice >= z.min && currentPrice < z.max ? `0 0 8px ${z.color}` : "none" }} />
                        <span style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: currentPrice >= z.min && currentPrice < z.max ? z.color : "rgba(255,255,255,0.3)", fontWeight: currentPrice >= z.min && currentPrice < z.max ? 700 : 400 }}>{z.label}</span>
                      </div>
                      <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace" }}>
                        {z.max === Infinity ? `$${z.min}+` : `$${z.min}–$${z.max}`}
                      </span>
                    </div>
                  ))}
                  <div className="section-title" style={{ marginTop: "1.25rem" }}>Price Context</div>
                  {PRICE_LEVELS.map((pl) => (
                    <div key={pl.label} style={{ display: "flex", justifyContent: "space-between", padding: ".45rem 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "13px" }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>{pl.label}</span>
                      <span style={{ fontFamily: "'Space Mono',monospace", color: pl.color, fontWeight: 600 }}>${pl.price}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: ".45rem 0", fontSize: "13px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>Lockup expired / tradable</span>
                    <span style={{ fontFamily: "'Space Mono',monospace", color: "#34d399" }}>{portfolio.lockupExpired} / {portfolio.tradableDate}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}