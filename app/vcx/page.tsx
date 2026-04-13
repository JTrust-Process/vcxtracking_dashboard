"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PriceApiResponse = {
  price: number | null;
  symbol?: string;
  source?: string;
  updatedAt?: string;
  error?: string;
};

type PricePoint = { t: number; price: number; pnl: number };
type Notification = { id: number; msg: string; color: string };

const portfolio = {
  totalShares: 154.548438,
  unlockedShares: 5.268704,
  lockedShares: 149.279734,
  invested: 2160.3,
  unlockDate: "2026-09-14",
  costBasis: 2160.3 / 154.548438,
};

// PA tax constants
const FED_LONG = 0.15;
const FED_SHORT = 0.22;
const PA_RATE = 0.0307;
const NIIT = 0.038;

function calcTax(proceeds: number, isLong: boolean) {
  const gain = proceeds - portfolio.costBasis * (proceeds / (portfolio.totalShares * (proceeds / portfolio.totalShares)));
  const fed = proceeds * (isLong ? FED_LONG : FED_SHORT);
  const pa = proceeds * PA_RATE;
  const niit = isLong ? proceeds * NIIT : 0;
  const total = fed + pa + niit;
  return { fed, pa, niit, total, net: proceeds - total };
}

export default function VCXDashboardPage() {
  const [livePrice, setLivePrice] = useState<number>(106.75);
  const [manualPrice, setManualPrice] = useState<string>("106.75");
  const [useManualPrice, setUseManualPrice] = useState<boolean>(false);
  const [isLoadingPrice, setIsLoadingPrice] = useState<boolean>(false);
  const [priceError, setPriceError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [customScenario, setCustomScenario] = useState<string>("200");
  const [alertHigh, setAlertHigh] = useState<string>("150");
  const [alertLow, setAlertLow] = useState<string>("90");
  const [pricePulse, setPricePulse] = useState<boolean>(false);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifId, setNotifId] = useState(0);
  const [isLongTerm, setIsLongTerm] = useState<boolean>(true);
  const [sellShares, setSellShares] = useState<string>("30");
  const [sellPrice, setSellPrice] = useState<string>("150");
  const [activeTab, setActiveTab] = useState<"chart" | "tax" | "scenario" | "exit">("chart");
  const alertFiredHigh = useRef(false);
  const alertFiredLow = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const parsedManualPrice = Number(manualPrice);
  const parsedScenarioPrice = Number(customScenario);
  const parsedAlertHigh = Number(alertHigh);
  const parsedAlertLow = Number(alertLow);

  const currentPrice = useManualPrice
    ? Number.isFinite(parsedManualPrice) ? parsedManualPrice : 0
    : Number.isFinite(livePrice) ? livePrice : 0;

  const scenarioPrice = Number.isFinite(parsedScenarioPrice) ? parsedScenarioPrice : 0;
  const highAlertValue = Number.isFinite(parsedAlertHigh) ? parsedAlertHigh : 0;
  const lowAlertValue = Number.isFinite(parsedAlertLow) ? parsedAlertLow : 0;

  const totalValue = portfolio.totalShares * currentPrice;
  const profit = totalValue - portfolio.invested;
  const returnPct = portfolio.invested > 0 ? (profit / portfolio.invested) * 100 : 0;
  const unlockedValue = portfolio.unlockedShares * currentPrice;
  const lockedValue = portfolio.lockedShares * currentPrice;
  const customScenarioValue = portfolio.totalShares * scenarioPrice;

  const pushNotif = useCallback((msg: string, color: string) => {
    const id = Date.now();
    setNotifId(id);
    setNotifications((prev) => [...prev.slice(-4), { id, msg, color }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 5000);
  }, []);

  const fetchPrice = useCallback(async () => {
    try {
      setIsLoadingPrice(true);
      setPriceError("");
      const res = await fetch("/api/vcx-price", { method: "GET", cache: "no-store" });
      const data: PriceApiResponse = await res.json();
      if (!res.ok) { setPriceError("Market may be closed. Showing last known price."); return; }
      if (typeof data.price === "number" && Number.isFinite(data.price)) {
        setLivePrice(data.price);
        setLastUpdated(data.updatedAt || new Date().toISOString());
        setPricePulse(true);
        setPriceHistory((prev) => [...prev.slice(-59), { t: Date.now(), price: data.price!, pnl: portfolio.totalShares * data.price! - portfolio.invested }]);
        setTimeout(() => setPricePulse(false), 1000);
      }
    } catch { setPriceError("Market may be closed. Showing last known price."); }
    finally { setIsLoadingPrice(false); }
  }, []);

  useEffect(() => {
    if (useManualPrice) return;
    fetchPrice();
    const interval = setInterval(fetchPrice, 30000);
    return () => clearInterval(interval);
  }, [useManualPrice, fetchPrice]);

  // Notifications when alert triggers
  useEffect(() => {
    if (highAlertValue > 0 && currentPrice >= highAlertValue && !alertFiredHigh.current) {
      alertFiredHigh.current = true;
      pushNotif(`🚀 VCX hit your HIGH target of ${money(highAlertValue)}! Now at ${money(currentPrice)}`, "#10b981");
    } else if (currentPrice < highAlertValue) {
      alertFiredHigh.current = false;
    }
    if (lowAlertValue > 0 && currentPrice <= lowAlertValue && !alertFiredLow.current) {
      alertFiredLow.current = true;
      pushNotif(`⚠️ VCX dropped below floor ${money(lowAlertValue)}! Now at ${money(currentPrice)}`, "#ef4444");
    } else if (currentPrice > lowAlertValue) {
      alertFiredLow.current = false;
    }
  }, [currentPrice, highAlertValue, lowAlertValue, pushNotif]);

  const daysRemaining = useMemo(() => {
    const unlockDate = new Date(`${portfolio.unlockDate}T00:00:00`);
    return Math.max(0, Math.ceil((unlockDate.getTime() - Date.now()) / 86400000));
  }, []);

  const unlockProgress = useMemo(() => Math.min(100, Math.max(0, ((180 - daysRemaining) / 180) * 100)), [daysRemaining]);

  const alertState = useMemo(() => {
    if (currentPrice >= highAlertValue && highAlertValue > 0) return { label: `Above sell target ${money(highAlertValue)}`, color: "#10b981" };
    if (currentPrice <= lowAlertValue && lowAlertValue > 0) return { label: `Below floor ${money(lowAlertValue)}`, color: "#ef4444" };
    return { label: "Within range", color: "#a78bfa" };
  }, [currentPrice, highAlertValue, lowAlertValue]);

  const scenarioRows = [80, 100, 106.75, 120, 150, 200, 300, 445].map((price) => ({
    price, total: portfolio.totalShares * price,
    unlocked: portfolio.unlockedShares * price, locked: portfolio.lockedShares * price,
  }));

  const tieredPlan = [
    { trigger: "$150+", pct: "20%", shares: portfolio.totalShares * 0.2, proceeds: portfolio.totalShares * 0.2 * 150, note: "Lock in a strong win." },
    { trigger: "$200+", pct: "25%", shares: portfolio.totalShares * 0.25, proceeds: portfolio.totalShares * 0.25 * 200, note: "Take another chunk off." },
    { trigger: "$300+", pct: "25%", shares: portfolio.totalShares * 0.25, proceeds: portfolio.totalShares * 0.25 * 300, note: "Scale out if hype returns." },
    { trigger: "Hold", pct: "30%", shares: portfolio.totalShares * 0.3, proceeds: null, note: "Keep final 30% long-term." },
  ];

  // Sell simulator
  const sellSharesNum = Math.min(Number(sellShares) || 0, portfolio.totalShares);
  const sellPriceNum = Number(sellPrice) || 0;
  const sellProceeds = sellSharesNum * sellPriceNum;
  const sellTax = calcTax(sellProceeds, isLongTerm);

  // Tax tiers for exit plan
  const taxTiers = tieredPlan.filter(t => t.proceeds).map(t => {
    const tx = calcTax(t.proceeds!, isLongTerm);
    return { ...t, tax: tx };
  });

  // Chart drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    const H = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    // Build combined data: session history + projection points
    const projectionPrices = [80, 100, 120, 150, 200, 300, 445];
    const projPoints = projectionPrices.map((p) => ({ price: p, pnl: portfolio.totalShares * p - portfolio.invested, projected: true }));

    const histPoints = priceHistory.map((p) => ({ price: p.price, pnl: p.pnl, projected: false }));
    if (histPoints.length === 0) {
      histPoints.push({ price: currentPrice, pnl: profit, projected: false });
    }

    const allPnl = [...histPoints.map(p => p.pnl), ...projPoints.map(p => p.pnl)];
    const minPnl = Math.min(...allPnl);
    const maxPnl = Math.max(...allPnl);
    const pnlRange = maxPnl - minPnl || 1;

    const pad = { top: 20, right: 20, bottom: 40, left: 70 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const toX = (i: number, total: number) => pad.left + (i / (total - 1)) * chartW;
    const toY = (pnl: number) => pad.top + chartH - ((pnl - minPnl) / pnlRange) * chartH;

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(w - pad.right, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // Y axis labels
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "10px 'Space Mono', monospace";
    ctx.textAlign = "right";
    [minPnl, 0, maxPnl / 2, maxPnl].forEach((v) => {
      const y = toY(v);
      if (y > pad.top && y < h - pad.bottom) {
        ctx.fillText(`$${(v / 1000).toFixed(0)}k`, pad.left - 6, y + 4);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
      }
    });

    const totalPoints = histPoints.length + projPoints.length;
    const allPoints = [
      ...histPoints.map((p, i) => ({ ...p, x: toX(i, totalPoints), y: toY(p.pnl) })),
      ...projPoints.map((p, i) => ({ ...p, x: toX(histPoints.length + i, totalPoints), y: toY(p.pnl) })),
    ];

    // Draw projection fill
    const projStart = allPoints[histPoints.length - 1];
    const projSegment = allPoints.slice(histPoints.length - 1);
    if (projSegment.length > 1) {
      ctx.beginPath();
      ctx.moveTo(projSegment[0].x, projSegment[0].y);
      projSegment.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(projSegment[projSegment.length - 1].x, h - pad.bottom);
      ctx.lineTo(projSegment[0].x, h - pad.bottom);
      ctx.closePath();
      const projGrad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
      projGrad.addColorStop(0, "rgba(167,139,250,0.12)");
      projGrad.addColorStop(1, "rgba(167,139,250,0)");
      ctx.fillStyle = projGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(projSegment[0].x, projSegment[0].y);
      projSegment.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = "rgba(167,139,250,0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw history fill
    if (allPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(allPoints[0].x, allPoints[0].y);
      allPoints.slice(0, histPoints.length).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(allPoints[histPoints.length - 1].x, h - pad.bottom);
      ctx.lineTo(allPoints[0].x, h - pad.bottom);
      ctx.closePath();
      const histGrad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
      histGrad.addColorStop(0, "rgba(16,185,129,0.2)");
      histGrad.addColorStop(1, "rgba(16,185,129,0)");
      ctx.fillStyle = histGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(allPoints[0].x, allPoints[0].y);
      allPoints.slice(0, histPoints.length).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Current price dot with pulse
    const lastHist = allPoints[histPoints.length - 1];
    if (lastHist) {
      ctx.beginPath();
      ctx.arc(lastHist.x, lastHist.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#10b981";
      ctx.fill();
      if (pricePulse) {
        ctx.beginPath();
        ctx.arc(lastHist.x, lastHist.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(16,185,129,0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // X axis labels for projection prices
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "9px 'Space Mono', monospace";
    ctx.textAlign = "center";
    projPoints.forEach((p, i) => {
      const x = toX(histPoints.length + i, totalPoints);
      ctx.fillText(`$${p.price}`, x, h - pad.bottom + 14);
    });

    // "NOW" label
    if (lastHist) {
      ctx.fillStyle = "#10b981";
      ctx.font = "9px 'Space Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("NOW", lastHist.x, h - pad.bottom + 14);
    }

  }, [priceHistory, currentPrice, profit, pricePulse]);

  function formatTime(iso: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: "chart", label: "PnL Chart" },
    { id: "tax", label: "Tax Sim" },
    { id: "scenario", label: "Scenarios" },
    { id: "exit", label: "Exit Plan" },
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
        .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;padding:1rem 1.5rem}
        .logo-area{display:flex;align-items:center;gap:12px}
        .logo-dot{width:10px;height:10px;border-radius:50%;background:#7c3aed;box-shadow:0 0 12px rgba(124,58,237,0.8);animation:pdot 2s ease-in-out infinite}
        @keyframes pdot{0%,100%{box-shadow:0 0 12px rgba(124,58,237,0.8)}50%{box-shadow:0 0 24px rgba(124,58,237,1),0 0 40px rgba(124,58,237,0.4)}}
        .logo-text{font-size:13px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.5)}
        .live-badge{display:flex;align-items:center;gap:6px;font-size:11px;font-family:'Space Mono',monospace;color:#10b981;padding:4px 12px;border-radius:100px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.08)}
        .live-dot{width:6px;height:6px;border-radius:50%;background:#10b981;animation:blink 1.5s ease-in-out infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        .hero{display:grid;grid-template-columns:1fr 380px;gap:1.5rem;margin-bottom:1.5rem;align-items:stretch}
        .hero-price-card{padding:2.5rem 3rem;position:relative;overflow:hidden}
        .hero-price-card::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:conic-gradient(from 0deg,transparent 0deg,rgba(124,58,237,0.03) 60deg,transparent 120deg);animation:rot 30s linear infinite}
        @keyframes rot{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        .price-label{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:.75rem}
        .price-huge{font-size:clamp(4rem,8vw,7rem);font-weight:700;font-family:'Space Mono',monospace;letter-spacing:-.02em;line-height:1;background:linear-gradient(135deg,#ffffff 0%,#a78bfa 50%,#60a5fa 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;transition:all .3s ease;position:relative;z-index:1}
        .price-huge.pulse{filter:drop-shadow(0 0 30px rgba(167,139,250,0.6))}
        .price-meta{display:flex;align-items:center;gap:1.5rem;margin-top:1.5rem;position:relative;z-index:1;flex-wrap:wrap}
        .pnl-chip{font-size:13px;font-family:'Space Mono',monospace;padding:6px 14px;border-radius:100px;font-weight:700}
        .pnl-pos{background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#34d399}
        .pnl-neg{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171}
        .price-controls{padding:1.5rem;display:flex;flex-direction:column;gap:1rem}
        .ctrl-label{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:6px}
        .ctrl-input{width:100%;background:rgba(255,255,255,0.05)!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:10px!important;color:#e2e8f0!important;font-family:'Space Mono',monospace!important;font-size:14px!important;padding:10px 14px!important;outline:none!important;transition:border-color .2s}
        .ctrl-input:focus{border-color:rgba(124,58,237,0.5)!important}
        .ctrl-btn{width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;letter-spacing:.03em}
        .btn-purple{background:rgba(124,58,237,0.2);border-color:rgba(124,58,237,0.4);color:#c4b5fd}
        .btn-purple:hover{background:rgba(124,58,237,0.35);border-color:rgba(124,58,237,0.6)}
        .btn-ghost{background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5)}
        .btn-ghost:hover{background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.8)}
        .btn-active{background:rgba(124,58,237,0.3);border-color:rgba(124,58,237,0.6);color:#c4b5fd}
        .btn-green{background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3);color:#34d399}
        .btn-green:hover{background:rgba(16,185,129,0.25)}
        .quick-prices{display:flex;gap:6px}
        .quick-btn{flex:1;padding:6px 4px;font-size:11px;font-family:'Space Mono',monospace;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.4);cursor:pointer;transition:all .2s;text-align:center}
        .quick-btn:hover{background:rgba(124,58,237,0.15);border-color:rgba(124,58,237,0.3);color:#c4b5fd}
        .metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem}
        .metric-card{padding:1.25rem 1.5rem;border-radius:16px;position:relative;overflow:hidden}
        .metric-accent{position:absolute;top:0;left:0;width:100%;height:2px}
        .metric-value{font-size:1.6rem;font-weight:700;font-family:'Space Mono',monospace;line-height:1;margin-bottom:4px;letter-spacing:-.02em}
        .metric-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,0.35)}
        .main-grid{display:grid;grid-template-columns:1fr 360px;gap:1.5rem;margin-bottom:1.5rem}
        .tab-bar{display:flex;gap:4px;margin-bottom:1.25rem;background:rgba(255,255,255,0.03);padding:4px;border-radius:12px}
        .tab-btn{flex:1;padding:7px 12px;border-radius:8px;border:none;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;color:rgba(255,255,255,0.4);background:transparent;letter-spacing:.03em}
        .tab-btn.active{background:rgba(124,58,237,0.25);color:#c4b5fd;border:1px solid rgba(124,58,237,0.3)}
        .section-title{font-size:10px;font-family:'Space Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:1.25rem;padding-bottom:.75rem;border-bottom:1px solid rgba(255,255,255,0.06)}
        .unlock-bar-track{height:6px;background:rgba(255,255,255,0.08);border-radius:100px;overflow:hidden;margin:.75rem 0}
        .unlock-bar-fill{height:100%;border-radius:100px;background:linear-gradient(90deg,#7c3aed,#a78bfa);transition:width 1s ease}
        .alert-status{padding:.75rem 1rem;border-radius:10px;font-size:12px;font-family:'Space Mono',monospace;margin-bottom:1rem;display:flex;align-items:center;gap:8px;border:1px solid}
        .alert-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        .split-row{display:flex;justify-content:space-between;align-items:center;padding:.55rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
        .split-row:last-child{border-bottom:none}
        .split-label{color:rgba(255,255,255,0.4)}
        .split-value{font-family:'Space Mono',monospace;font-weight:500}
        .scenario-row{display:grid;grid-template-columns:80px 1fr 1fr 1fr;gap:8px;padding:.6rem .75rem;border-radius:8px;font-size:12px;font-family:'Space Mono',monospace;transition:background .2s;border:1px solid transparent}
        .scenario-row:hover{background:rgba(124,58,237,0.08);border-color:rgba(124,58,237,0.15)}
        .scenario-row.cur{background:rgba(124,58,237,0.12);border-color:rgba(124,58,237,0.25)}
        .scenario-header{display:grid;grid-template-columns:80px 1fr 1fr 1fr;gap:8px;padding:0 .75rem .5rem;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,0.25)}
        .exit-step{padding:1rem 1.25rem;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);margin-bottom:.75rem;transition:all .2s}
        .exit-step:hover{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1)}
        .exit-trigger{font-family:'Space Mono',monospace;font-size:16px;font-weight:700;color:#a78bfa;margin-bottom:4px}
        .exit-action{font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px}
        .exit-proceeds{font-size:11px;font-family:'Space Mono',monospace;color:#10b981}
        .tax-row{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
        .tax-row:last-child{border-bottom:none}
        .tax-label{color:rgba(255,255,255,0.4)}
        .tax-val{font-family:'Space Mono',monospace;font-weight:500}
        .tax-net{font-size:1.1rem;font-family:'Space Mono',monospace;font-weight:700;color:#10b981;margin-top:.75rem;padding-top:.75rem;border-top:1px solid rgba(255,255,255,0.08)}
        .notif-stack{position:fixed;top:1.5rem;right:1.5rem;z-index:1000;display:flex;flex-direction:column;gap:.5rem;pointer-events:none}
        .notif{padding:.75rem 1.25rem;border-radius:12px;font-size:13px;font-family:'Space Mono',monospace;backdrop-filter:blur(20px);border:1px solid;animation:slideIn .3s ease;max-width:360px;pointer-events:auto}
        @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
        .toggle-row{display:flex;gap:8px;margin-bottom:1rem}
        .toggle-btn{flex:1;padding:8px;border-radius:8px;font-size:12px;font-family:'Space Mono',monospace;cursor:pointer;transition:all .2s;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.4)}
        .toggle-btn.on{background:rgba(124,58,237,0.2);border-color:rgba(124,58,237,0.4);color:#c4b5fd}
        .panel{padding:1.5rem}
        .right-col{display:flex;flex-direction:column;gap:1.5rem}
        .canvas-wrap{width:100%;height:260px;position:relative}
        canvas{width:100%!important;height:100%!important;display:block}
        .error-text{font-size:11px;font-family:'Space Mono',monospace;color:#f59e0b;margin-top:.5rem;padding:6px 10px;background:rgba(245,158,11,0.08);border-radius:6px;border:1px solid rgba(245,158,11,0.2)}
        .tax-tier-card{padding:1rem;border-radius:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);margin-bottom:.75rem}
        .sim-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem}
        @media(max-width:1100px){.hero{grid-template-columns:1fr}.metrics-grid{grid-template-columns:repeat(2,1fr)}.main-grid{grid-template-columns:1fr}}
        @media(max-width:600px){.metrics-grid{grid-template-columns:1fr 1fr}.content{padding:1rem}.price-huge{font-size:3.5rem}}
      `}</style>

      {/* Notifications */}
      <div className="notif-stack">
        {notifications.map((n) => (
          <div key={n.id} className="notif" style={{ borderColor: `${n.color}44`, background: `rgba(3,7,18,0.9)`, color: n.color }}>
            {n.msg}
          </div>
        ))}
      </div>

      <div className="vcx-root">
        <div className="aurora">
          <div className="a1" /><div className="a2" /><div className="a3" />
        </div>

        <div className="content">
          {/* Header */}
          <div className="glass header">
            <div className="logo-area">
              <div className="logo-dot" />
              <span className="logo-text">VCX Position</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {!useManualPrice && <div className="live-badge"><div className="live-dot" />LIVE · 30s</div>}
              <span style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: "rgba(255,255,255,0.2)" }}>
                {useManualPrice ? "MANUAL MODE" : `UPDATED ${formatTime(lastUpdated)}`}
              </span>
            </div>
          </div>

          {/* Hero */}
          <div className="hero">
            <div className="glass-strong hero-price-card">
              <div className="price-label">VCX · Current Price</div>
              <div className={`price-huge${pricePulse ? " pulse" : ""}`}>{money(currentPrice)}</div>
              <div className="price-meta">
                <div className={`pnl-chip ${profit >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                  {profit >= 0 ? "▲" : "▼"} {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(2)}%
                </div>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono',monospace" }}>{money(profit)} P&L</span>
                <div style={{ marginLeft: "auto" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "2px" }}>TOTAL VALUE</div>
                  <div style={{ fontSize: "1.4rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>{money(totalValue)}</div>
                </div>
              </div>
            </div>

            <div className="glass price-controls">
              <div>
                <div className="ctrl-label">Manual Override</div>
                <input className="ctrl-input" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="Enter price..." />
              </div>
              <div className="quick-prices">
                {[106.75, 120, 150, 200, 445].map((p) => (
                  <button key={p} className="quick-btn" onClick={() => setManualPrice(String(p))}>
                    ${p}
                  </button>
                ))}
              </div>
              <button className={`ctrl-btn ${useManualPrice ? "btn-active" : "btn-purple"}`} onClick={() => setUseManualPrice((v) => !v)}>
                {useManualPrice ? "⚡ Switch to Live" : "✎ Use Manual Price"}
              </button>
              <button className="ctrl-btn btn-ghost" onClick={fetchPrice} disabled={isLoadingPrice || useManualPrice}>
                {isLoadingPrice ? "Fetching..." : "↻ Refresh Now"}
              </button>
              {priceError && <div className="error-text">{priceError}</div>}
            </div>
          </div>

          {/* Metrics */}
          <div className="metrics-grid">
            {[
              { label: "Total Value", value: money(totalValue), accent: "linear-gradient(90deg,#7c3aed,#a78bfa)", color: "#e2e8f0" },
              { label: "Invested", value: money(portfolio.invested), accent: "linear-gradient(90deg,#0ea5e9,#38bdf8)", color: "#e2e8f0" },
              { label: "Profit / Loss", value: money(profit), accent: profit >= 0 ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#ef4444,#f87171)", color: profit >= 0 ? "#34d399" : "#f87171" },
              { label: "Unlock Countdown", value: `${daysRemaining}d`, accent: "linear-gradient(90deg,#f59e0b,#fbbf24)", color: "#fbbf24" },
            ].map((m) => (
              <div key={m.label} className="glass metric-card">
                <div className="metric-accent" style={{ background: m.accent }} />
                <div className="metric-value" style={{ color: m.color, marginTop: ".5rem" }}>{m.value}</div>
                <div className="metric-label">{m.label}</div>
              </div>
            ))}
          </div>

          {/* Main content grid */}
          <div className="main-grid">
            {/* Left: tabbed panel */}
            <div className="glass panel">
              <div className="tab-bar">
                {tabs.map((t) => (
                  <button key={t.id} className={`tab-btn${activeTab === t.id ? " active" : ""}`} onClick={() => setActiveTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === "chart" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono',monospace" }}>
                      SESSION HISTORY + PROJECTION
                    </div>
                    <div style={{ display: "flex", gap: "12px", fontSize: "11px", fontFamily: "'Space Mono',monospace" }}>
                      <span style={{ color: "#10b981" }}>── Live</span>
                      <span style={{ color: "rgba(167,139,250,0.6)" }}>- - Projected</span>
                    </div>
                  </div>
                  <div className="canvas-wrap">
                    <canvas ref={canvasRef} />
                  </div>
                  <div style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", fontSize: "12px", fontFamily: "'Space Mono',monospace" }}>
                    <div>
                      <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>CURRENT PNL</div>
                      <div style={{ color: profit >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>{money(profit)}</div>
                    </div>
                    <div>
                      <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>AT $445</div>
                      <div style={{ color: "#a78bfa", fontWeight: 700 }}>{money(portfolio.totalShares * 445 - portfolio.invested)}</div>
                    </div>
                    <div>
                      <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>DATAPOINTS</div>
                      <div style={{ color: "#e2e8f0" }}>{priceHistory.length} pts</div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "tax" && (
                <div>
                  <div style={{ marginBottom: "1.25rem" }}>
                    <div className="ctrl-label">Holding Period</div>
                    <div className="toggle-row">
                      <button className={`toggle-btn${isLongTerm ? " on" : ""}`} onClick={() => setIsLongTerm(true)}>Long-term (&gt;1yr) · 15% fed</button>
                      <button className={`toggle-btn${!isLongTerm ? " on" : ""}`} onClick={() => setIsLongTerm(false)}>Short-term · 22% fed</button>
                    </div>
                    <div className="sim-grid">
                      <div>
                        <div className="ctrl-label">Shares to Sell</div>
                        <input className="ctrl-input" value={sellShares} onChange={(e) => setSellShares(e.target.value)} placeholder="0" />
                      </div>
                      <div>
                        <div className="ctrl-label">At Price</div>
                        <input className="ctrl-input" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0.00" />
                      </div>
                    </div>
                    <div style={{ padding: "1rem", borderRadius: "12px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", marginBottom: "1rem" }}>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: ".5rem", fontFamily: "'Space Mono',monospace" }}>GROSS PROCEEDS</div>
                      <div style={{ fontSize: "1.4rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>{money(sellProceeds)}</div>
                    </div>
                    <div className="tax-row"><span className="tax-label">Federal ({isLongTerm ? "15%" : "22%"})</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(sellTax.fed)}</span></div>
                    <div className="tax-row"><span className="tax-label">PA State (3.07%)</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(sellTax.pa)}</span></div>
                    {isLongTerm && <div className="tax-row"><span className="tax-label">NIIT (3.8%)</span><span className="tax-val" style={{ color: "#f87171" }}>−{money(sellTax.niit)}</span></div>}
                    <div className="tax-row"><span className="tax-label">Total Tax</span><span className="tax-val" style={{ color: "#f87171", fontWeight: 700 }}>−{money(sellTax.total)}</span></div>
                    <div className="tax-net">Take-home: {money(sellTax.net)}</div>
                  </div>

                  <div className="section-title" style={{ marginTop: "1.5rem" }}>Per Exit Tier ({isLongTerm ? "Long-term" : "Short-term"})</div>
                  {taxTiers.map((tier, i) => (
                    <div key={i} className="tax-tier-card">
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem" }}>
                        <span style={{ fontFamily: "'Space Mono',monospace", color: "#a78bfa", fontWeight: 700 }}>{tier.trigger}</span>
                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>{tier.pct} · {number(tier.shares)} shares</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "12px", fontFamily: "'Space Mono',monospace" }}>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>GROSS</div><div style={{ color: "#e2e8f0" }}>{money(tier.proceeds!)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>TAX</div><div style={{ color: "#f87171" }}>−{money(tier.tax.total)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "2px" }}>NET</div><div style={{ color: "#10b981" }}>{money(tier.tax.net)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "scenario" && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
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
                  {scenarioRows.map((row) => (
                    <div key={row.price} className={`scenario-row${Math.abs(row.price - currentPrice) < 2 ? " cur" : ""}`}>
                      <span style={{ color: "#a78bfa", fontWeight: 700 }}>{money(row.price)}</span>
                      <span style={{ color: "#e2e8f0" }}>{money(row.total)}</span>
                      <span style={{ color: "#34d399" }}>{money(row.unlocked)}</span>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>{money(row.locked)}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "exit" && (
                <div>
                  {tieredPlan.map((step, i) => (
                    <div key={i} className="exit-step">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                        <div className="exit-trigger">{step.trigger}</div>
                        <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", padding: "2px 8px", borderRadius: "100px", background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>{step.pct}</div>
                      </div>
                      <div className="exit-action">{number(step.shares)} shares · {step.note}</div>
                      {step.proceeds && (
                        <>
                          <div className="exit-proceeds">Gross: {money(step.proceeds)}</div>
                          <div style={{ fontSize: "11px", fontFamily: "'Space Mono',monospace", color: "#10b981", marginTop: "2px" }}>
                            Net ({isLongTerm ? "LT" : "ST"}): {money(calcTax(step.proceeds, isLongTerm).net)}
                          </div>
                        </>
                      )}
                      {step.proceeds && (
                        <button
                          className="ctrl-btn btn-green"
                          style={{ marginTop: "10px", fontSize: "12px", padding: "7px" }}
                          onClick={() => {
                            const triggerNum = parseFloat(step.trigger.replace(/[^0-9.]/g, ""));
                            setSellShares(step.shares.toFixed(3));
                            setSellPrice(String(triggerNum || currentPrice));
                            setActiveTab("tax");
                            pushNotif(`📊 Loaded ${step.trigger} exit into Tax Simulator`, "#10b981");
                          }}
                        >
                          → Simulate in Tax Calculator
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="right-col">
              {/* Position split */}
              <div className="glass panel">
                <div className="section-title">Position Split</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
                  {[
                    { label: "Unlocked", sub: "Tradable now", shares: portfolio.unlockedShares, value: unlockedValue, color: "#10b981" },
                    { label: "Locked", sub: "Until 9/14/26", shares: portfolio.lockedShares, value: lockedValue, color: "#7c3aed" },
                  ].map((s) => (
                    <div key={s.label} style={{ padding: "1rem", borderRadius: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color, marginBottom: ".5rem", boxShadow: `0 0 8px ${s.color}` }} />
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>{s.label}</div>
                      <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", marginBottom: "6px", fontFamily: "'Space Mono',monospace" }}>{s.sub}</div>
                      <div style={{ fontSize: "1.1rem", fontFamily: "'Space Mono',monospace", fontWeight: 700, color: "#e2e8f0" }}>{number(s.shares)}</div>
                      <div style={{ fontSize: "12px", color: s.color, fontFamily: "'Space Mono',monospace" }}>{money(s.value)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "6px", fontFamily: "'Space Mono',monospace" }}>
                  LOCK RELEASE — {unlockProgress.toFixed(0)}%
                </div>
                <div className="unlock-bar-track">
                  <div className="unlock-bar-fill" style={{ width: `${unlockProgress}%` }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono',monospace", marginTop: "4px" }}>
                  <span>START</span><span>{daysRemaining}d LEFT</span><span>9/14/26</span>
                </div>
              </div>

              {/* Alert watch */}
              <div className="glass panel">
                <div className="section-title">Alert Watch</div>
                <div className="alert-status" style={{ borderColor: `${alertState.color}33`, background: `${alertState.color}11`, color: alertState.color }}>
                  <div className="alert-dot" style={{ background: alertState.color, boxShadow: `0 0 6px ${alertState.color}` }} />
                  {alertState.label}
                </div>
                {[
                  { label: "High Alert", value: alertHigh, setter: setAlertHigh, color: "#10b981" },
                  { label: "Low Alert", value: alertLow, setter: setAlertLow, color: "#ef4444" },
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function money(n: number) {
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(safe);
}

function number(n: number) {
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(safe);
}