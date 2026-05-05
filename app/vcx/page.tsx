"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Line,
} from "recharts";

type PriceApiResponse = {
  price: number | null;
  symbol?: string;
  source?: string;
  updatedAt?: string;
  error?: string;
};

type PricePoint = { price: number; pnl: number };
type Notification = { id: number; msg: string; color: string };

const portfolio = {
  totalShares:    154.548438,
  unlockedShares: 5.268704,
  lockedShares:   149.279734,
  invested:       2160.3,
  unlockDate:     "2026-09-14",
  entryDate:      "2025-10-15",
};

const PEAK_PRICE        = 445;
const PROJECTION_PRICES = [80, 100, 120, 150, 200, 300, 445];

const GOALS = [
  { label: "Emergency Fund",  target: 5000  },
  { label: "Car Fund",        target: 15000 },
  { label: "Full Investment", target: 50000 },
  { label: "Peak Value",      target: Math.round(445 * 154.548438) },
];

const RISK_ZONES = [
  { label: "DANGER",      min: 0,   max: 70,       color: "#ef4444", bg: "rgba(239,68,68,0.08)",    border: "rgba(239,68,68,0.25)"    },
  { label: "CAUTION",     min: 70,  max: 120,      color: "#f59e0b", bg: "rgba(245,158,11,0.08)",   border: "rgba(245,158,11,0.25)"   },
  { label: "OPPORTUNITY", min: 120, max: 200,      color: "#10b981", bg: "rgba(16,185,129,0.08)",   border: "rgba(16,185,129,0.25)"   },
  { label: "TARGET",      min: 200, max: Infinity, color: "#a78bfa", bg: "rgba(124,58,237,0.08)",   border: "rgba(124,58,237,0.25)"   },
];

function getRiskZone(price: number) {
  return RISK_ZONES.find((z) => price >= z.min && price < z.max) ?? RISK_ZONES[0];
}

function getNextAction(price: number): { action: string; color: string; detail: string } {
  if (price >= 300) return { action: "SCALE OUT HARD", color: "#a78bfa", detail: "Sell 25% — $300+ target hit." };
  if (price >= 200) return { action: "SELL 25%",       color: "#10b981", detail: "Sell 25% — $200+ target hit." };
  if (price >= 150) return { action: "SELL 20%",       color: "#10b981", detail: "Sell 20% — $150+ target hit." };
  if (price >= 120) return { action: "WATCH CLOSELY",  color: "#f59e0b", detail: "Approaching first sell zone. Monitor for $150." };
  return                    { action: "HOLD",           color: "#60a5fa", detail: "Below first sell trigger. Stay patient." };
}

const FED_LONG  = 0.15;
const FED_SHORT = 0.22;
const PA_RATE   = 0.0307;
const NIIT      = 0.038;

function calcTax(proceeds: number, isLong: boolean) {
  const fed   = proceeds * (isLong ? FED_LONG : FED_SHORT);
  const pa    = proceeds * PA_RATE;
  const niit  = isLong ? proceeds * NIIT : 0;
  const total = fed + pa + niit;
  return { fed, pa, niit, total, net: proceeds - total };
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}
function num(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number.isFinite(n) ? n : 0);
}

function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  const raf  = useRef<number>(0);
  useEffect(() => {
    const start = prev.current;
    const diff  = target - start;
    if (Math.abs(diff) < 0.01) return;
    const startTime = performance.now();
    const step = (now: number) => {
      const t    = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(start + diff * ease);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else { setDisplay(target); prev.current = target; }
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return display;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; pnl: number; price: number; projected: boolean; avg?: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "rgba(3,7,18,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", fontFamily: "'Space Mono',monospace", fontSize: "12px" }}>
      <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: "4px", fontSize: "10px" }}>{d.label}{d.projected ? " (PROJ)" : ""}</div>
      <div style={{ color: d.pnl >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{money(d.pnl)} P&L</div>
      <div style={{ color: "#a78bfa" }}>${d.price.toFixed(2)} / share</div>
      {d.avg !== undefined && <div style={{ color: "#f59e0b", fontSize: "11px", marginTop: "2px" }}>20-avg: ${d.avg.toFixed(2)}</div>}
    </div>
  );
}

function ScenarioTooltip({ price, isLongTerm }: { price: number; isLongTerm: boolean }) {
  const proceeds = portfolio.totalShares * price;
  const tax      = calcTax(proceeds, isLongTerm);
  return (
    <div style={{ position: "absolute", right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)", background: "rgba(3,7,18,0.97)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "10px", padding: "10px 14px", fontFamily: "'Space Mono',monospace", fontSize: "11px", whiteSpace: "nowrap", zIndex: 50, pointerEvents: "none" }}>
      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "6px" }}>TAX ESTIMATE ({isLongTerm ? "LT" : "ST"})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}><span style={{ color: "rgba(255,255,255,0.4)" }}>Gross</span><span style={{ color: "#e2e8f0" }}>{money(proceeds)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}><span style={{ color: "rgba(255,255,255,0.4)" }}>Tax</span><span style={{ color: "#f87171" }}>−{money(tax.total)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "4px", marginTop: "2px" }}><span style={{ color: "rgba(255,255,255,0.4)" }}>Net</span><span style={{ color: "#10b981", fontWeight: 700 }}>{money(tax.net)}</span></div>
      </div>
    </div>
  );
}

export default function VCXDashboardPage() {
  const [livePrice,       setLivePrice]       = useState<number>(106.75);
  const [manualPrice,     setManualPrice]     = useState<string>("106.75");
  const [useManualPrice,  setUseManualPrice]  = useState<boolean>(false);
  const [isLoadingPrice,  setIsLoadingPrice]  = useState<boolean>(false);
  const [priceError,      setPriceError]      = useState<string>("");
  const [lastUpdated,     setLastUpdated]     = useState<string>("");
  const [customScenario,  setCustomScenario]  = useState<string>("200");
  const [alertHigh,       setAlertHigh]       = useState<string>("150");
  const [alertLow,        setAlertLow]        = useState<string>("90");
  const [pricePulse,      setPricePulse]      = useState<boolean>(false);
  const [priceHistory,    setPriceHistory]    = useState<PricePoint[]>([]);
  const [notifications,   setNotifications]   = useState<Notification[]>([]);
  const [isLongTerm,      setIsLongTerm]      = useState<boolean>(true);
  const [sellShares,      setSellShares]      = useState<string>("30");
  const [sellPrice,       setSellPrice]       = useState<string>("150");
  const [activeTab,       setActiveTab]       = useState<"chart"|"tax"|"scenario"|"exit"|"position"|"alerts"|"tools">("chart");
  const [hoveredScenario, setHoveredScenario] = useState<number | null>(null);
  const [activeQuick,     setActiveQuick]     = useState<number | null>(null);
  const [mounted,         setMounted]         = useState(false);
  const [notifEnabled,    setNotifEnabled]    = useState(false);
  const [simSellShares,   setSimSellShares]   = useState<string>("20");

  const alertFiredHigh = useRef(false);
  const alertFiredLow  = useRef(false);

  const parsedManualPrice   = Number(manualPrice);
  const parsedScenarioPrice = Number(customScenario);
  const parsedAlertHigh     = Number(alertHigh);
  const parsedAlertLow      = Number(alertLow);

  const currentPrice   = useManualPrice ? (Number.isFinite(parsedManualPrice) ? parsedManualPrice : 0) : (Number.isFinite(livePrice) ? livePrice : 0);
  const scenarioPrice  = Number.isFinite(parsedScenarioPrice) ? parsedScenarioPrice : 0;
  const highAlertValue = Number.isFinite(parsedAlertHigh)     ? parsedAlertHigh     : 0;
  const lowAlertValue  = Number.isFinite(parsedAlertLow)      ? parsedAlertLow      : 0;

  const totalValue          = portfolio.totalShares    * currentPrice;
  const profit              = totalValue - portfolio.invested;
  const returnPct           = portfolio.invested > 0 ? (profit / portfolio.invested) * 100 : 0;
  const unlockedValue       = portfolio.unlockedShares * currentPrice;
  const lockedValue         = portfolio.lockedShares   * currentPrice;
  const customScenarioValue = portfolio.totalShares    * scenarioPrice;
  const drawdown            = ((currentPrice - PEAK_PRICE) / PEAK_PRICE) * 100;
  const peakValue           = portfolio.totalShares * PEAK_PRICE;

  const daysHeld     = useMemo(() => Math.max(1, Math.ceil((Date.now() - new Date(portfolio.entryDate).getTime()) / 86400000)), []);
  const returnPerDay = returnPct / daysHeld;

  const breakEvenShares   = currentPrice > 0 ? portfolio.invested / currentPrice : 0;
  const breakEvenPct      = (breakEvenShares / portfolio.totalShares) * 100;
  const freeRollShares    = portfolio.totalShares - breakEvenShares;
  const freeRollValue     = freeRollShares * currentPrice;

  const recoveryTargets = [150, 200, 300, 445].map((target) => ({
    target, pctNeeded: ((target - currentPrice) / currentPrice) * 100, value: portfolio.totalShares * target,
  }));

  const breakEvenAfterTax = useMemo(() => {
    const taxRate = (isLongTerm ? FED_LONG + NIIT : FED_SHORT) + PA_RATE;
    return portfolio.invested / (portfolio.totalShares * (1 - taxRate));
  }, [isLongTerm]);

  const simSellNum      = Math.min(Math.max(Number(simSellShares) || 0, 0), portfolio.totalShares);
  const simRemaining    = portfolio.totalShares - simSellNum;
  const simProceeds     = simSellNum * currentPrice;
  const simTax          = calcTax(simProceeds, isLongTerm);
  const simNetProceeds  = simTax.net;
  const simTargetValues = [150, 200, 300].map((t) => ({ target: t, value: simRemaining * t, pnl: simRemaining * t - (portfolio.invested - simNetProceeds) }));

  const worstCasePrice  = 60;
  const worstCaseValue  = portfolio.totalShares * worstCasePrice;
  const worstCaseReturn = ((worstCaseValue / portfolio.invested) - 1) * 100;

  const riskZone   = getRiskZone(currentPrice);
  const nextAction = getNextAction(currentPrice);

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

  const animatedPrice      = useCountUp(currentPrice, 600);
  const animatedTotalValue = useCountUp(totalValue,   800);
  const animatedProfit     = useCountUp(profit,       800);

  const daysRemaining  = useMemo(() => Math.max(0, Math.ceil((new Date(`${portfolio.unlockDate}T00:00:00`).getTime() - Date.now()) / 86400000)), []);
  const unlockProgress = useMemo(() => Math.min(100, Math.max(0, ((180 - daysRemaining) / 180) * 100)), [daysRemaining]);

  const alertState = useMemo(() => {
    if (currentPrice >= highAlertValue && highAlertValue > 0) return { label: `Above sell target ${money(highAlertValue)}`, color: "#10b981" };
    if (currentPrice <= lowAlertValue  && lowAlertValue  > 0) return { label: `Below floor ${money(lowAlertValue)}`,        color: "#ef4444" };
    return { label: "Within range", color: "#a78bfa" };
  }, [currentPrice, highAlertValue, lowAlertValue]);

  const scenarioRows = [80, 100, 106.75, 120, 150, 200, 300, 445].map((price) => ({
    price, total: portfolio.totalShares * price, unlocked: portfolio.unlockedShares * price, locked: portfolio.lockedShares * price,
  }));

  const tieredPlan = [
    { trigger: "$150+", pct: "20%", shares: portfolio.totalShares * 0.2,  proceeds: portfolio.totalShares * 0.2  * 150, note: "Lock in a strong win." },
    { trigger: "$200+", pct: "25%", shares: portfolio.totalShares * 0.25, proceeds: portfolio.totalShares * 0.25 * 200, note: "Take another chunk off." },
    { trigger: "$300+", pct: "25%", shares: portfolio.totalShares * 0.25, proceeds: portfolio.totalShares * 0.25 * 300, note: "Scale out if hype returns." },
    { trigger: "Hold",  pct: "30%", shares: portfolio.totalShares * 0.3,  proceeds: null,                               note: "Keep final 30% long-term." },
  ];

  const sellSharesNum = Math.min(Number(sellShares) || 0, portfolio.totalShares);
  const sellProceeds  = sellSharesNum * (Number(sellPrice) || 0);
  const sellTax       = calcTax(sellProceeds, isLongTerm);
  const taxTiers      = tieredPlan.filter((t) => t.proceeds).map((t) => ({ ...t, tax: calcTax(t.proceeds!, isLongTerm) }));

  const chartData = useMemo(() => {
    const hist = priceHistory.length > 0
      ? priceHistory.map((p, i) => {
          const w = priceHistory.slice(Math.max(0, i - 19), i + 1);
          return { label: `T-${priceHistory.length - i}`, price: p.price, pnl: p.pnl, projected: false, avg: w.reduce((s, x) => s + x.price, 0) / w.length };
        })
      : [{ label: "Now", price: currentPrice, pnl: profit, projected: false, avg: currentPrice }];
    const proj = PROJECTION_PRICES.map((p) => ({ label: `$${p}`, price: p, pnl: portfolio.totalShares * p - portfolio.invested, projected: true, avg: undefined }));
    return [...hist, ...proj];
  }, [priceHistory, currentPrice, profit]);

  const sparkData = useMemo(() =>
    (priceHistory.length > 1 ? priceHistory.slice(-20) : [{ price: currentPrice, pnl: profit }]).map((p) => ({ v: p.price })),
  [priceHistory, currentPrice, profit]);

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
        setPriceHistory((prev) => [...prev.slice(-59), { price: data.price!, pnl: portfolio.totalShares * data.price! - portfolio.invested }]);
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
      pushNotif(`🚀 VCX hit your HIGH target of ${money(highAlertValue)}! Now at ${money(currentPrice)}`, "#10b981");
      fireBrowserNotif("🚀 VCX HIGH ALERT", `Price hit ${money(currentPrice)} — above ${money(highAlertValue)}`);
    } else if (currentPrice < highAlertValue) { alertFiredHigh.current = false; }
    if (lowAlertValue > 0 && currentPrice <= lowAlertValue && !alertFiredLow.current) {
      alertFiredLow.current = true;
      pushNotif(`⚠️ VCX dropped below floor ${money(lowAlertValue)}! Now at ${money(currentPrice)}`, "#ef4444");
      fireBrowserNotif("⚠️ VCX LOW ALERT", `Price dropped to ${money(currentPrice)}`);
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

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: "chart",    label: "PnL Chart"  },
    { id: "tax",      label: "Tax Sim"    },
    { id: "scenario", label: "Scenarios"  },
    { id: "exit",     label: "Exit Plan"  },
    { id: "position", label: "Position"   },
    { id: "alerts",   label: "Alerts"     },
    { id: "tools",    label: "Tools"      },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#030712!important;color:#e2e8f0!important;font-family:'Space Grotesk',sans-serif!important;min-height:100vh;overflow-x:hidden}
        .vcx-root{min-height:100vh;background:#030712;position:relative;overflow:hidden}
        .aurora{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:0}
        .a1{position:absolute;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,0.15) 0%,transparent 70%);top:-200px;left:-200px;animation:d1 20s ease-in-out infinite}
        .a2{position:absolute;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.12) 0%,transparent 70%);top:10%;right:-100px;animation:d2 25s ease-in-out infinite}
        .a3{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(59,130,246,0.1) 0%,transparent 70%);bottom:10%;left:20%;animation:d3 18s ease-in-out infinite}
        @keyframes d1{0%,100%{transform:translate(0,0)}50%{transform:translate(100px,80px)}}
        @keyframes d2{0%,100%{transform:translate(0,0)}50%{transform:translate(-80px,60px)}}
        @keyframes d3{0%,100%{transform:translate(0,0)}50%{transform:translate(60px,-80px)}}
        .content{position:relative;z-index:1;padding:2rem;max-width:1400px;margin:0 auto}
        .glass{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:20px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
        .glass-strong{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:20px;backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px)}
        .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;padding:1rem 1.5rem}
        .logo-area{display:flex;align-items:center;gap:12px}
        .logo-dot{width:10px;height:10px;border-radius:50%;background:#7c3aed;box-shadow:0 0 12px rgba(124,58,237,0.8);animation:pdot 2s ease-in-out infinite}
        @keyframes pdot{0%,100%{box-shadow:0 0 12px rgba(124,58,237,0.8)}50%{box-shadow:0 0 24px rgba(124,58,237,1),0 0 40px rgba(124,58,237,0.4)}}
        .logo-text{font-size:13px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.5)}
        .live-badge{display:flex;align-items:center;gap:6px;font-size:11px;font-family:'Space Mono',monospace;color:#10b981;padding:4px 12px;border-radius:100px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.08)}
        .live-dot{width:6px;height:6px;border-radius:50%;background:#10b981;animation:blink 1.5s ease-in-out infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        .risk-badge{font-size:11px;font-family:'Space Mono',monospace;padding:4px 10px;border-radius:100px;font-weight:700;letter-spacing:.08em}
        .decision-panel{display:grid;grid-template-columns:auto 1fr repeat(4,auto);gap:0;margin-bottom:1.5rem;overflow:hidden}
        .dp-action{padding:1.25rem 2rem;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,0.06)}
        .dp-detail{padding:1.25rem 1.5rem;display:flex;align-items:center;border-right:1px solid rgba(255,255,255,0.06)}
        .dp-stat{padding:1.25rem 1.5rem;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,0.06);min-width:110px}
        .dp-stat:last-child{border-right:none}
        .dp-label{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:4px}
        .dp-value{font-family:'Space Mono',monospace;font-weight:700;font-size:1rem}
        .hero{display:grid;grid-template-columns:1fr 340px;gap:1.5rem;margin-bottom:1.5rem;align-items:stretch}
        .hero-price-card{padding:2rem 2.5rem;position:relative;overflow:hidden}
        .hero-price-card::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:conic-gradient(from 0deg,transparent 0deg,rgba(124,58,237,0.03) 60deg,transparent 120deg);animation:rot 30s linear infinite}
        @keyframes rot{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        .price-label{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:.75rem}
        .price-huge{font-size:clamp(3.5rem,7vw,6rem);font-weight:700;font-family:'Space Mono',monospace;letter-spacing:-.02em;line-height:1;background:linear-gradient(135deg,#ffffff 0%,#a78bfa 50%,#60a5fa 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;position:relative;z-index:1}
        .price-huge.pulse{filter:drop-shadow(0 0 30px rgba(167,139,250,0.6))}
        .price-meta{display:flex;align-items:center;gap:1.25rem;margin-top:1.25rem;position:relative;z-index:1;flex-wrap:wrap}
        .pnl-chip{font-size:13px;font-family:'Space Mono',monospace;padding:5px 12px;border-radius:100px;font-weight:700}
        .pnl-pos{background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#34d399}
        .pnl-neg{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171}
        .price-controls{padding:1.25rem;display:flex;flex-direction:column;gap:.875rem}
        .ctrl-label{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:5px}
        .ctrl-input{width:100%;background:rgba(255,255,255,0.05)!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:10px!important;color:#e2e8f0!important;font-family:'Space Mono',monospace!important;font-size:13px!important;padding:9px 12px!important;outline:none!important;transition:border-color .2s}
        .ctrl-input:focus{border-color:rgba(124,58,237,0.5)!important}
        .ctrl-btn{width:100%;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;letter-spacing:.03em}
        .btn-purple{background:rgba(124,58,237,0.2);border-color:rgba(124,58,237,0.4);color:#c4b5fd}
        .btn-purple:hover{background:rgba(124,58,237,0.35)}
        .btn-ghost{background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5)}
        .btn-ghost:hover{background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.8)}
        .btn-active{background:rgba(124,58,237,0.3);border-color:rgba(124,58,237,0.6);color:#c4b5fd}
        .btn-green{background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3);color:#34d399}
        .btn-green:hover{background:rgba(16,185,129,0.25)}
        .btn-enabled{background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3);color:#34d399}
        .quick-prices{display:flex;gap:5px}
        .quick-btn{flex:1;padding:6px 2px;font-size:10px;font-family:'Space Mono',monospace;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.4);cursor:pointer;transition:all .2s;text-align:center}
        .quick-btn:hover,.quick-btn.active{background:rgba(124,58,237,0.2);border-color:rgba(124,58,237,0.4);color:#c4b5fd}
        .metrics-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:1rem;margin-bottom:1.5rem}
        .metric-card{padding:1.1rem 1.25rem;border-radius:16px;position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s}
        .metric-card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.3)}
        .metric-accent{position:absolute;top:0;left:0;width:100%;height:2px}
        .metric-value{font-size:1.4rem;font-weight:700;font-family:'Space Mono',monospace;line-height:1;margin-bottom:4px;letter-spacing:-.02em}
        .metric-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,0.35)}
        .metric-sub{font-size:10px;color:rgba(255,255,255,0.2);font-family:'Space Mono',monospace;margin-top:3px}
        .main-grid{display:grid;grid-template-columns:1fr 320px;gap:1.5rem}
        .tab-bar{display:flex;gap:3px;margin-bottom:1.25rem;background:rgba(255,255,255,0.03);padding:4px;border-radius:12px;flex-wrap:wrap}
        .tab-btn{flex:1;min-width:80px;padding:6px 8px;border-radius:8px;border:none;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:500;cursor:pointer;transition:all .2s;color:rgba(255,255,255,0.4);background:transparent;letter-spacing:.03em;white-space:nowrap}
        .tab-btn.active{background:rgba(124,58,237,0.25);color:#c4b5fd;border:1px solid rgba(124,58,237,0.3)}
        .section-title{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:1rem;padding-bottom:.6rem;border-bottom:1px solid rgba(255,255,255,0.06)}
        .unlock-bar-track{height:6px;background:rgba(255,255,255,0.08);border-radius:100px;overflow:hidden;margin:.6rem 0;position:relative}
        .unlock-bar-fill{height:100%;border-radius:100px;background:linear-gradient(90deg,#7c3aed,#a78bfa);transition:width 1s ease;position:relative;overflow:hidden}
        .unlock-bar-fill::after{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent);animation:shimmer 2.5s ease-in-out infinite}
        @keyframes shimmer{0%{left:-100%}100%{left:200%}}
        .alert-status{padding:.6rem .875rem;border-radius:10px;font-size:12px;font-family:'Space Mono',monospace;margin-bottom:.875rem;display:flex;align-items:center;gap:8px;border:1px solid}
        .alert-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        .split-row{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
        .split-row:last-child{border-bottom:none}
        .split-label{color:rgba(255,255,255,0.4)}
        .split-value{font-family:'Space Mono',monospace;font-weight:500}
        .scenario-row{display:grid;grid-template-columns:80px 1fr 1fr 1fr;gap:8px;padding:.55rem .75rem;border-radius:8px;font-size:12px;font-family:'Space Mono',monospace;transition:background .2s;border:1px solid transparent;position:relative;cursor:default}
        .scenario-row:hover{background:rgba(124,58,237,0.08);border-color:rgba(124,58,237,0.15)}
        .scenario-row.cur{background:rgba(124,58,237,0.12);border-color:rgba(124,58,237,0.25)}
        .scenario-header{display:grid;grid-template-columns:80px 1fr 1fr 1fr;gap:8px;padding:0 .75rem .4rem;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,0.25)}
        .exit-step{padding:.875rem 1.1rem;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);margin-bottom:.6rem;transition:all .2s}
        .exit-step:hover{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1)}
        .exit-trigger{font-family:'Space Mono',monospace;font-size:15px;font-weight:700;color:#a78bfa;margin-bottom:3px}
        .exit-action{font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:3px}
        .exit-proceeds{font-size:11px;font-family:'Space Mono',monospace;color:#10b981}
        .tax-row{display:flex;justify-content:space-between;padding:.45rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
        .tax-row:last-child{border-bottom:none}
        .tax-label{color:rgba(255,255,255,0.4)}
        .tax-val{font-family:'Space Mono',monospace;font-weight:500}
        .tax-net{font-size:1.1rem;font-family:'Space Mono',monospace;font-weight:700;color:#10b981;margin-top:.6rem;padding-top:.6rem;border-top:1px solid rgba(255,255,255,0.08)}
        .notif-stack{position:fixed;top:1.5rem;right:1.5rem;z-index:1000;display:flex;flex-direction:column;gap:.5rem;pointer-events:none}
        .notif{padding:.75rem 1.25rem;border-radius:12px;font-size:13px;font-family:'Space Mono',monospace;backdrop-filter:blur(20px);border:1px solid;animation:slideIn .3s ease;max-width:360px;pointer-events:auto}
        @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
        .toggle-row{display:flex;gap:8px;margin-bottom:.875rem}
        .toggle-btn{flex:1;padding:7px;border-radius:8px;font-size:11px;font-family:'Space Mono',monospace;cursor:pointer;transition:all .2s;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.4)}
        .toggle-btn.on{background:rgba(124,58,237,0.2);border-color:rgba(124,58,237,0.4);color:#c4b5fd}
        .panel{padding:1.5rem}
        .error-text{font-size:11px;font-family:'Space Mono',monospace;color:#f59e0b;margin-top:.5rem;padding:5px 10px;background:rgba(245,158,11,0.08);border-radius:6px;border:1px solid rgba(245,158,11,0.2)}
        .tax-tier-card{padding:.875rem 1rem;border-radius:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);margin-bottom:.6rem}
        .sim-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.875rem}
        .recovery-row{display:flex;justify-content:space-between;align-items:center;padding:.45rem .75rem;border-radius:8px;font-size:12px;font-family:'Space Mono',monospace;margin-bottom:4px;border:1px solid rgba(255,255,255,0.04);background:rgba(255,255,255,0.02)}
        .two-col{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
        .recharts-cartesian-axis-tick text{fill:rgba(255,255,255,0.25)!important;font-family:'Space Mono',monospace!important;font-size:10px!important}
        .recharts-tooltip-wrapper{outline:none!important}
        @media(max-width:1100px){.main-grid{grid-template-columns:1fr}.metrics-grid{grid-template-columns:repeat(3,1fr)}.decision-panel{grid-template-columns:1fr 1fr}.hero{grid-template-columns:1fr}}
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
              <div className="dp-label">Next Action</div>
              <div style={{ fontSize: "1rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: nextAction.color }}>{nextAction.action}</div>
            </div>
            <div className="dp-detail">
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", fontFamily: "'Space Mono',monospace" }}>{nextAction.detail}</span>
            </div>
            <div className="dp-stat"><div className="dp-label">Value</div><div className="dp-value" style={{ color: "#e2e8f0" }}>{money(totalValue)}</div></div>
            <div className="dp-stat"><div className="dp-label">Return</div><div className="dp-value" style={{ color: profit >= 0 ? "#34d399" : "#f87171" }}>{returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%</div></div>
            <div className="dp-stat"><div className="dp-label">Days Held</div><div className="dp-value" style={{ color: "#a78bfa" }}>{daysHeld}d</div></div>
            <div className="dp-stat"><div className="dp-label">Per Day</div><div className="dp-value" style={{ color: "#f59e0b" }}>{returnPerDay >= 0 ? "+" : ""}{returnPerDay.toFixed(2)}%</div></div>
          </div>

          {/* Hero */}
          <div className="hero" style={fade(80)}>
            <div className="glass-strong hero-price-card">
              <div className="price-label">VCX · Current Price</div>
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
                            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="v" stroke="#a78bfa" strokeWidth={1.5} fill="url(#sparkGrad)" dot={false} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="price-meta">
                <div className={`pnl-chip ${profit >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                  {profit >= 0 ? "▲" : "▼"} {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(2)}%
                </div>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono',monospace" }}>
                  {animatedProfit >= 0 ? "+" : ""}${Math.abs(animatedProfit).toLocaleString("en-US", { maximumFractionDigits: 0 })} P&L
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "2px" }}>TOTAL VALUE</div>
                  <div style={{ fontSize: "1.3rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>
                    ${animatedTotalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>
            </div>

            {/* Price controls — slim right card */}
            <div className="glass price-controls">
              <div>
                <div className="ctrl-label">Manual Override</div>
                <input className="ctrl-input" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="Enter price..." />
              </div>
              <div className="quick-prices">
                {[106.75, 120, 150, 200, 445].map((p) => (
                  <button key={p} className={`quick-btn${activeQuick === p ? " active" : ""}`} onClick={() => { setManualPrice(String(p)); setActiveQuick(p); }}>
                    ${p}
                  </button>
                ))}
              </div>
              <button className={`ctrl-btn ${useManualPrice ? "btn-active" : "btn-purple"}`} onClick={() => setUseManualPrice((v) => !v)}>
                {useManualPrice ? "⚡ Live" : "✎ Manual"}
              </button>
              <button className="ctrl-btn btn-ghost" onClick={fetchPrice} disabled={isLoadingPrice || useManualPrice}>
                {isLoadingPrice ? "Fetching..." : "↻ Refresh"}
              </button>
              {priceError && <div className="error-text">{priceError}</div>}
            </div>
          </div>

          {/* Metrics */}
          <div className="metrics-grid">
            {[
              { label: "Total Value",   value: `$${animatedTotalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, sub: null,                       accent: "linear-gradient(90deg,#7c3aed,#a78bfa)", color: "#e2e8f0",  delay: 160 },
              { label: "Invested",      value: money(portfolio.invested),                                                        sub: null,                       accent: "linear-gradient(90deg,#0ea5e9,#38bdf8)", color: "#e2e8f0",  delay: 200 },
              { label: "Profit / Loss", value: `${animatedProfit >= 0 ? "+" : ""}$${Math.abs(animatedProfit).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, sub: null, accent: profit >= 0 ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#ef4444,#f87171)", color: profit >= 0 ? "#34d399" : "#f87171", delay: 240 },
              { label: "From Peak",     value: `${drawdown.toFixed(1)}%`,                                                        sub: `Peak ${money(peakValue)}`, accent: "linear-gradient(90deg,#ef4444,#f87171)", color: "#f87171", delay: 280 },
              { label: "Unlock",        value: `${daysRemaining}d`,                                                              sub: portfolio.unlockDate,       accent: "linear-gradient(90deg,#f59e0b,#fbbf24)", color: "#fbbf24", delay: 320 },
            ].map((m) => (
              <div key={m.label} className="glass metric-card" style={fade(m.delay)}>
                <div className="metric-accent" style={{ background: m.accent }} />
                <div className="metric-value" style={{ color: m.color, marginTop: ".4rem" }}>{m.value}</div>
                <div className="metric-label">{m.label}</div>
                {m.sub && <div className="metric-sub">{m.sub}</div>}
              </div>
            ))}
          </div>

          {/* Main — full width tabbed panel */}
          <div className="glass panel" style={fade(380)}>
            <div className="tab-bar">
              {tabs.map((t) => (
                <button key={t.id} className={`tab-btn${activeTab === t.id ? " active" : ""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {/* ── Chart ── */}
            {activeTab === "chart" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace" }}>SESSION HISTORY + PROJECTION</div>
                  <div style={{ display: "flex", gap: "12px", fontSize: "11px", fontFamily: "'Space Mono',monospace" }}>
                    <span style={{ color: "#10b981" }}>── Live</span>
                    <span style={{ color: "#f59e0b" }}>── 20-avg</span>
                    <span style={{ color: "rgba(167,139,250,0.6)" }}>- - Projected</span>
                  </div>
                </div>
                {mounted && <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                      <defs>
                        <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
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
                      <Area type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} fill="url(#histGrad)" dot={false} activeDot={{ r: 5, fill: "#10b981", strokeWidth: 0 }} data={chartData.filter((d) => !d.projected)} isAnimationActive animationDuration={800} />
                      <Area type="monotone" dataKey="pnl" stroke="rgba(167,139,250,0.6)" strokeWidth={1.5} strokeDasharray="5 4" fill="url(#projGrad)" dot={false} activeDot={{ r: 4, fill: "#a78bfa", strokeWidth: 0 }} data={chartData.filter((d) => d.projected)} isAnimationActive animationDuration={1000} />
                      <Line type="monotone" dataKey="avg" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" data={chartData.filter((d) => !d.projected && d.avg !== undefined)} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div> }
                <div style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", fontSize: "12px", fontFamily: "'Space Mono',monospace", flexWrap: "wrap" }}>
                  <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>CURRENT PNL</div><div style={{ color: profit >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{money(profit)}</div></div>
                  <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>20-PT AVG</div><div style={{ color: "#f59e0b", fontWeight: 700 }}>{rollingAvg ? `$${rollingAvg.toFixed(2)}` : "—"}</div></div>
                  {priceRange && <>
                    <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>SESSION HIGH</div><div style={{ color: "#10b981" }}>${priceRange.high.toFixed(2)}</div></div>
                    <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>SESSION LOW</div><div style={{ color: "#f87171" }}>${priceRange.low.toFixed(2)}</div></div>
                    <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>SWING</div><div style={{ color: "rgba(255,255,255,0.6)" }}>{priceRange.swing.toFixed(1)}%</div></div>
                  </>}
                  <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>FROM PEAK</div><div style={{ color: "#f87171", fontWeight: 700 }}>{drawdown.toFixed(1)}%</div></div>
                </div>
              </div>
            )}

            {/* ── Tax Sim ── */}
            {activeTab === "tax" && (
              <div className="two-col">
                <div>
                  <div className="ctrl-label">Holding Period</div>
                  <div className="toggle-row">
                    <button className={`toggle-btn${isLongTerm ? " on" : ""}`}  onClick={() => setIsLongTerm(true)}>Long-term · 15% fed</button>
                    <button className={`toggle-btn${!isLongTerm ? " on" : ""}`} onClick={() => setIsLongTerm(false)}>Short-term · 22% fed</button>
                  </div>
                  <div className="sim-grid">
                    <div><div className="ctrl-label">Shares to Sell</div><input className="ctrl-input" value={sellShares} onChange={(e) => setSellShares(e.target.value)} placeholder="0" /></div>
                    <div><div className="ctrl-label">At Price</div><input className="ctrl-input" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0.00" /></div>
                  </div>
                  <div style={{ padding: ".875rem 1rem", borderRadius: "12px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", marginBottom: ".875rem" }}>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: ".4rem", fontFamily: "'Space Mono',monospace" }}>GROSS PROCEEDS</div>
                    <div style={{ fontSize: "1.4rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>{money(sellProceeds)}</div>
                  </div>
                  <div className="tax-row"><span className="tax-label">Federal ({isLongTerm ? "15%" : "22%"})</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(sellTax.fed)}</span></div>
                  <div className="tax-row"><span className="tax-label">PA State (3.07%)</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(sellTax.pa)}</span></div>
                  {isLongTerm && <div className="tax-row"><span className="tax-label">NIIT (3.8%)</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(sellTax.niit)}</span></div>}
                  <div className="tax-row"><span className="tax-label">Total Tax</span><span className="tax-val" style={{ color: "#f87171", fontWeight: 700 }}>−{money(sellTax.total)}</span></div>
                  <div className="tax-net">Take-home: {money(sellTax.net)}</div>
                </div>
                <div>
                  <div className="section-title">Per Exit Tier ({isLongTerm ? "LT" : "ST"})</div>
                  {taxTiers.map((tier, i) => (
                    <div key={i} className="tax-tier-card">
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".4rem" }}>
                        <span style={{ fontFamily: "'Space Mono',monospace", color: "#a78bfa", fontWeight: 700 }}>{tier.trigger}</span>
                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>{tier.pct} · {num(tier.shares)} shares</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "12px", fontFamily: "'Space Mono',monospace" }}>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>GROSS</div><div style={{ color: "#e2e8f0" }}>{money(tier.proceeds!)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>TAX</div><div style={{ color: "#f87171" }}>−{money(tier.tax.total)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>NET</div><div style={{ color: "#10b981" }}>{money(tier.tax.net)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Scenarios ── */}
            {activeTab === "scenario" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                  <div>
                    <div className="ctrl-label">Custom Price</div>
                    <input className="ctrl-input" value={customScenario} onChange={(e) => setCustomScenario(e.target.value)} placeholder="Enter price" />
                  </div>
                  <div style={{ padding: ".75rem 1rem", borderRadius: "10px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}>
                    <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginBottom: "4px", fontFamily: "'Space Mono',monospace" }}>AT {money(scenarioPrice)}</div>
                    <div style={{ fontSize: "1.2rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#c4b5fd" }}>{money(customScenarioValue)}</div>
                  </div>
                </div>
                <div className="scenario-header"><span>PRICE</span><span>TOTAL</span><span>UNLOCKED</span><span>LOCKED</span></div>
                {scenarioRows.map((row) => {
                  const zone = getRiskZone(row.price);
                  return (
                    <div key={row.price} className={`scenario-row${Math.abs(row.price - currentPrice) < 2 ? " cur" : ""}`} onMouseEnter={() => setHoveredScenario(row.price)} onMouseLeave={() => setHoveredScenario(null)}>
                      <span style={{ color: zone.color, fontWeight: 700 }}>{money(row.price)}</span>
                      <span style={{ color: "#e2e8f0" }}>{money(row.total)}</span>
                      <span style={{ color: "#34d399" }}>{money(row.unlocked)}</span>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>{money(row.locked)}</span>
                      {hoveredScenario === row.price && <ScenarioTooltip price={row.price} isLongTerm={isLongTerm} />}
                    </div>
                  );
                })}
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono',monospace", marginTop: ".6rem" }}>
                  ← Hover any row for tax estimate · price color = risk zone
                </div>
              </div>
            )}

            {/* ── Exit Plan ── */}
            {activeTab === "exit" && (
              <div className="two-col">
                <div>
                  {tieredPlan.map((step, i) => (
                    <div key={i} className="exit-step">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "3px" }}>
                        <div className="exit-trigger">{step.trigger}</div>
                        <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", padding: "2px 8px", borderRadius: "100px", background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>{step.pct}</div>
                      </div>
                      <div className="exit-action">{num(step.shares)} shares · {step.note}</div>
                      {step.proceeds && (
                        <>
                          <div className="exit-proceeds">Gross: {money(step.proceeds)}</div>
                          <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: "#10b981", marginTop: "2px" }}>
                            Net ({isLongTerm ? "LT" : "ST"}): {money(calcTax(step.proceeds, isLongTerm).net)}
                          </div>
                        </>
                      )}
                      {step.proceeds && (
                        <button className="ctrl-btn btn-green" style={{ marginTop: "8px", fontSize: "12px", padding: "6px" }}
                          onClick={() => {
                            const triggerNum = parseFloat(step.trigger.replace(/[^0-9.]/g, ""));
                            setSellShares(step.shares.toFixed(3));
                            setSellPrice(String(triggerNum || currentPrice));
                            setActiveTab("tax");
                            pushNotif(`📊 Loaded ${step.trigger} exit into Tax Simulator`, "#10b981");
                          }}
                        >→ Simulate in Tax Calc</button>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="section-title">Recovery Targets</div>
                  {recoveryTargets.map((r) => (
                    <div key={r.target} className="recovery-row">
                      <span style={{ color: getRiskZone(r.target).color, fontWeight: 700 }}>${r.target}</span>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>{r.pctNeeded > 0 ? `+${r.pctNeeded.toFixed(1)}%` : "✓ above"}</span>
                      <span style={{ color: "#e2e8f0" }}>{money(r.value)}</span>
                    </div>
                  ))}
                  <div className="section-title" style={{ marginTop: "1.25rem" }}>Goal-Based Exit</div>
                  {GOALS.map((g) => {
                    const priceNeeded = g.target / portfolio.totalShares;
                    const reached     = totalValue >= g.target;
                    const pctNeeded   = ((priceNeeded - currentPrice) / currentPrice) * 100;
                    return (
                      <div key={g.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: ".5rem .75rem", borderRadius: "10px", marginBottom: "5px", background: reached ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${reached ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)"}`, transition: "all .3s" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span>{reached ? "✅" : "○"}</span>
                          <div>
                            <div style={{ fontSize: "12px", color: reached ? "#34d399" : "rgba(255,255,255,0.6)", fontWeight: reached ? 600 : 400 }}>{g.label}</div>
                            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace" }}>{money(g.target)}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: reached ? "#34d399" : "#f59e0b", fontWeight: 700 }}>
                            {reached ? "REACHED" : `$${priceNeeded.toFixed(2)}`}
                          </div>
                          {!reached && <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace" }}>+{pctNeeded.toFixed(1)}%</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Position ── */}
            {activeTab === "position" && (
              <div className="two-col">
                <div>
                  <div className="section-title">Position Split</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                    {[
                      { label: "Unlocked", sub: "Tradable now",  shares: portfolio.unlockedShares, value: unlockedValue, color: "#10b981" },
                      { label: "Locked",   sub: "Until 9/14/26", shares: portfolio.lockedShares,   value: lockedValue,   color: "#7c3aed" },
                    ].map((s) => (
                      <div key={s.label} style={{ padding: "1rem", borderRadius: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color, marginBottom: ".5rem", boxShadow: `0 0 8px ${s.color}` }} />
                        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>{s.label}</div>
                        <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", marginBottom: "6px", fontFamily: "'Space Mono',monospace" }}>{s.sub}</div>
                        <div style={{ fontSize: "1.1rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>{num(s.shares)}</div>
                        <div style={{ fontSize: "12px", color: s.color, fontFamily: "'Space Mono',monospace" }}>{money(s.value)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "5px", fontFamily: "'Space Mono',monospace" }}>LOCK RELEASE — {unlockProgress.toFixed(0)}%</div>
                  <div className="unlock-bar-track"><div className="unlock-bar-fill" style={{ width: `${unlockProgress}%` }} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono',monospace", marginTop: "4px" }}>
                    <span>START</span><span>{daysRemaining}d LEFT</span><span>9/14/26</span>
                  </div>
                </div>
                <div>
                  <div className="section-title">Minimum Win Lock</div>
                  <div style={{ padding: "1.1rem", borderRadius: "14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: "1rem" }}>
                    <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace", marginBottom: "4px" }}>SHARES TO BREAK EVEN</div>
                    <div style={{ fontSize: "1.5rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#10b981" }}>{breakEvenShares.toFixed(3)}</div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace", marginTop: "2px" }}>{breakEvenPct.toFixed(1)}% of position at {money(currentPrice)}</div>
                  </div>
                  <div className="split-row"><span className="split-label">Investment to recover</span><span className="split-value" style={{ color: "#10b981" }}>{money(portfolio.invested)}</span></div>
                  <div className="split-row"><span className="split-label">Free-roll shares</span><span className="split-value">{freeRollShares.toFixed(3)}</span></div>
                  <div className="split-row"><span className="split-label">Free-roll value</span><span className="split-value" style={{ color: "#a78bfa" }}>{money(freeRollValue)}</span></div>
                  <div className="split-row">
                    <span className="split-label">Break-even after tax ({isLongTerm ? "LT" : "ST"})</span>
                    <span className="split-value" style={{ color: "#f59e0b" }}>{money(breakEvenAfterTax)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Alerts ── */}
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
                  <div className="split-row" style={{ marginTop: ".5rem" }}>
                    <span className="split-label">vs High Target</span>
                    <span className="split-value" style={{ color: currentPrice >= highAlertValue && highAlertValue > 0 ? "#10b981" : "rgba(255,255,255,0.5)" }}>
                      {highAlertValue > 0 ? `${((currentPrice / highAlertValue) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="split-row">
                    <span className="split-label">vs Low Floor</span>
                    <span className="split-value" style={{ color: currentPrice <= lowAlertValue && lowAlertValue > 0 ? "#ef4444" : "rgba(255,255,255,0.5)" }}>
                      {lowAlertValue > 0 ? `${((currentPrice / lowAlertValue) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="split-row"><span className="split-label">Peak ($445)</span><span className="split-value" style={{ color: "#f87171" }}>{drawdown.toFixed(1)}% down</span></div>
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
                </div>
              </div>
            )}

            {/* ── Tools ── */}
            {activeTab === "tools" && (
              <div className="two-col">
                <div>
                  <div className="section-title">Sell Pressure Simulator</div>
                  <div style={{ marginBottom: ".875rem" }}>
                    <div className="ctrl-label">Shares to Sell</div>
                    <input className="ctrl-input" value={simSellShares} onChange={(e) => setSimSellShares(e.target.value)} placeholder="0" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem", marginBottom: ".875rem" }}>
                    <div style={{ padding: ".75rem", borderRadius: "10px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace", marginBottom: "4px" }}>NET PROCEEDS</div>
                      <div style={{ fontSize: "1rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#10b981" }}>{money(simNetProceeds)}</div>
                    </div>
                    <div style={{ padding: ".75rem", borderRadius: "10px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)" }}>
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace", marginBottom: "4px" }}>REMAINING</div>
                      <div style={{ fontSize: "1rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#c4b5fd" }}>{simRemaining.toFixed(3)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace", marginBottom: "6px", letterSpacing: "0.1em" }}>IF REMAINING HIT →</div>
                  {simTargetValues.map((t) => (
                    <div key={t.target} className="recovery-row">
                      <span style={{ color: getRiskZone(t.target).color, fontWeight: 700 }}>${t.target}</span>
                      <span style={{ color: "#e2e8f0" }}>{money(t.value)}</span>
                      <span style={{ color: t.pnl >= 0 ? "#34d399" : "#f87171" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="section-title">Worst Case Acceptance</div>
                  <div style={{ padding: "1rem", borderRadius: "12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", marginBottom: ".875rem" }}>
                    <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace", marginBottom: "4px" }}>IF VCX DROPS TO ${worstCasePrice}</div>
                    <div style={{ fontSize: "1.4rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#f87171" }}>{money(worstCaseValue)}</div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", fontFamily: "'Space Mono',monospace", marginTop: "4px" }}>
                      Still {worstCaseReturn >= 0 ? "+" : ""}{worstCaseReturn.toFixed(0)}% on investment
                    </div>
                  </div>
                  <div className="split-row"><span className="split-label">Invested</span><span className="split-value">{money(portfolio.invested)}</span></div>
                  <div className="split-row"><span className="split-label">Value at ${worstCasePrice}</span><span className="split-value" style={{ color: "#f87171" }}>{money(worstCaseValue)}</span></div>
                  <div className="split-row"><span className="split-label">Return multiple</span><span className="split-value" style={{ color: worstCaseReturn >= 0 ? "#34d399" : "#f87171" }}>{(worstCaseValue / portfolio.invested).toFixed(1)}x</span></div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono',monospace", marginTop: ".6rem", lineHeight: 1.5 }}>
                    Even at ${worstCasePrice} you are still up. The floor is not zero.
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