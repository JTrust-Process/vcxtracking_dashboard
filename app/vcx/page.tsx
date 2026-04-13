"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type PriceApiResponse = {
  price: number | null;
  symbol?: string;
  source?: string;
  updatedAt?: string;
  error?: string;
};

const portfolio = {
  totalShares: 154.548438,
  unlockedShares: 5.268704,
  lockedShares: 149.279734,
  invested: 2160.3,
  unlockDate: "2026-09-14",
};

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

  const fetchPrice = useCallback(async () => {
    try {
      setIsLoadingPrice(true);
      setPriceError("");
      const res = await fetch("/api/vcx-price", { method: "GET", cache: "no-store" });
      const data: PriceApiResponse = await res.json();
      if (!res.ok) {
        setPriceError("Market may be closed. Showing last known price.");
        return;
      }
      if (typeof data.price === "number" && Number.isFinite(data.price)) {
        setLivePrice(data.price);
        setLastUpdated(data.updatedAt || new Date().toISOString());
        setPricePulse(true);
        setTimeout(() => setPricePulse(false), 1000);
      }
    } catch {
      setPriceError("Market may be closed. Showing last known price.");
    } finally {
      setIsLoadingPrice(false);
    }
  }, []);

  useEffect(() => {
    if (useManualPrice) return;
    fetchPrice();
    const interval = setInterval(fetchPrice, 30000);
    return () => clearInterval(interval);
  }, [useManualPrice, fetchPrice]);

  const daysRemaining = useMemo(() => {
    const unlockDate = new Date(`${portfolio.unlockDate}T00:00:00`);
    const msRemaining = unlockDate.getTime() - new Date().getTime();
    return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  }, []);

  const unlockProgress = useMemo(() => Math.min(100, Math.max(0, ((180 - daysRemaining) / 180) * 100)), [daysRemaining]);
  const totalValue = portfolio.totalShares * currentPrice;
  const unlockedValue = portfolio.unlockedShares * currentPrice;
  const lockedValue = portfolio.lockedShares * currentPrice;
  const profit = totalValue - portfolio.invested;
  const returnPct = portfolio.invested > 0 ? (profit / portfolio.invested) * 100 : 0;
  const customScenarioValue = portfolio.totalShares * scenarioPrice;

  const alertState = useMemo(() => {
    if (currentPrice >= highAlertValue && highAlertValue > 0) return { label: `Above sell target ${money(highAlertValue)}`, color: "#00ffaa" };
    if (currentPrice <= lowAlertValue && lowAlertValue > 0) return { label: `Below floor ${money(lowAlertValue)}`, color: "#ff4d6d" };
    return { label: "Within range", color: "#a78bfa" };
  }, [currentPrice, highAlertValue, lowAlertValue]);

  const scenarioRows = [80, 100, 106.75, 120, 150, 200, 300, 445].map((price) => ({
    price,
    total: portfolio.totalShares * price,
    unlocked: portfolio.unlockedShares * price,
    locked: portfolio.lockedShares * price,
  }));

  const tieredPlan = [
    { trigger: "$150+", pct: "20%", shares: portfolio.totalShares * 0.2, proceeds: portfolio.totalShares * 0.2 * 150, note: "Lock in a strong win while keeping most upside." },
    { trigger: "$200+", pct: "25%", shares: portfolio.totalShares * 0.25, proceeds: portfolio.totalShares * 0.25 * 200, note: "Take another big chunk off the table." },
    { trigger: "$300+", pct: "25%", shares: portfolio.totalShares * 0.25, proceeds: portfolio.totalShares * 0.25 * 300, note: "Scale out heavily if hype returns." },
    { trigger: "Hold", pct: "30%", shares: portfolio.totalShares * 0.3, proceeds: null, note: "Keep final 30% long-term." },
  ];

  function formatTime(iso: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #030712 !important; color: #e2e8f0 !important; font-family: 'Space Grotesk', sans-serif !important; min-height: 100vh; overflow-x: hidden; }
        .vcx-root { min-height: 100vh; background: #030712; position: relative; overflow: hidden; }
        .aurora { position: fixed; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 0; }
        .aurora-1 { position: absolute; width: 800px; height: 800px; border-radius: 50%; background: radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%); top: -200px; left: -200px; animation: drift1 20s ease-in-out infinite; }
        .aurora-2 { position: absolute; width: 600px; height: 600px; border-radius: 50%; background: radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%); top: 10%; right: -100px; animation: drift2 25s ease-in-out infinite; }
        .aurora-3 { position: absolute; width: 500px; height: 500px; border-radius: 50%; background: radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%); bottom: 10%; left: 20%; animation: drift3 18s ease-in-out infinite; }
        @keyframes drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(100px,80px)} }
        @keyframes drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-80px,60px)} }
        @keyframes drift3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(60px,-80px)} }
        .content { position: relative; z-index: 1; padding: 2rem; max-width: 1400px; margin: 0 auto; }
        .glass { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        .glass-strong { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; padding: 1rem 1.5rem; }
        .logo-area { display: flex; align-items: center; gap: 12px; }
        .logo-dot { width: 10px; height: 10px; border-radius: 50%; background: #7c3aed; box-shadow: 0 0 12px rgba(124,58,237,0.8); animation: pulse-dot 2s ease-in-out infinite; }
        @keyframes pulse-dot { 0%,100%{box-shadow:0 0 12px rgba(124,58,237,0.8)} 50%{box-shadow:0 0 24px rgba(124,58,237,1),0 0 40px rgba(124,58,237,0.4)} }
        .logo-text { font-size: 13px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.5); }
        .live-badge { display: flex; align-items: center; gap: 6px; font-size: 11px; font-family: 'Space Mono', monospace; color: #10b981; padding: 4px 12px; border-radius: 100px; border: 1px solid rgba(16,185,129,0.3); background: rgba(16,185,129,0.08); }
        .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; animation: blink 1.5s ease-in-out infinite; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .hero { display: grid; grid-template-columns: 1fr 380px; gap: 1.5rem; margin-bottom: 1.5rem; align-items: stretch; }
        .hero-price-card { padding: 2.5rem 3rem; position: relative; overflow: hidden; }
        .hero-price-card::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: conic-gradient(from 0deg, transparent 0deg, rgba(124,58,237,0.03) 60deg, transparent 120deg); animation: rotate 30s linear infinite; }
        @keyframes rotate { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        .price-label { font-size: 11px; font-family: 'Space Mono', monospace; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(255,255,255,0.35); margin-bottom: 0.75rem; }
        .price-huge { font-size: clamp(4rem, 8vw, 7rem); font-weight: 700; font-family: 'Space Mono', monospace; letter-spacing: -0.02em; line-height: 1; background: linear-gradient(135deg, #ffffff 0%, #a78bfa 50%, #60a5fa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; transition: all 0.3s ease; position: relative; z-index: 1; }
        .price-huge.pulse { filter: drop-shadow(0 0 30px rgba(167,139,250,0.6)); }
        .price-meta { display: flex; align-items: center; gap: 1.5rem; margin-top: 1.5rem; position: relative; z-index: 1; flex-wrap: wrap; }
        .pnl-chip { font-size: 13px; font-family: 'Space Mono', monospace; padding: 6px 14px; border-radius: 100px; font-weight: 700; }
        .pnl-positive { background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #34d399; }
        .pnl-negative { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171; }
        .price-controls { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
        .ctrl-label { font-size: 10px; font-family: 'Space Mono', monospace; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(255,255,255,0.3); margin-bottom: 6px; }
        .ctrl-input { width: 100%; background: rgba(255,255,255,0.05) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 10px !important; color: #e2e8f0 !important; font-family: 'Space Mono', monospace !important; font-size: 14px !important; padding: 10px 14px !important; outline: none !important; transition: border-color 0.2s; }
        .ctrl-input:focus { border-color: rgba(124,58,237,0.5) !important; }
        .ctrl-btn { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; letter-spacing: 0.03em; }
        .ctrl-btn-primary { background: rgba(124,58,237,0.2); border-color: rgba(124,58,237,0.4); color: #c4b5fd; }
        .ctrl-btn-primary:hover { background: rgba(124,58,237,0.35); border-color: rgba(124,58,237,0.6); }
        .ctrl-btn-ghost { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.5); }
        .ctrl-btn-ghost:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.8); }
        .ctrl-btn-active { background: rgba(124,58,237,0.3); border-color: rgba(124,58,237,0.6); color: #c4b5fd; }
        .quick-prices { display: flex; gap: 6px; }
        .quick-btn { flex: 1; padding: 6px 4px; font-size: 11px; font-family: 'Space Mono', monospace; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: rgba(255,255,255,0.4); cursor: pointer; transition: all 0.2s; text-align: center; }
        .quick-btn:hover { background: rgba(124,58,237,0.15); border-color: rgba(124,58,237,0.3); color: #c4b5fd; }
        .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
        .metric-card { padding: 1.25rem 1.5rem; border-radius: 16px; position: relative; overflow: hidden; }
        .metric-accent { position: absolute; top: 0; left: 0; width: 100%; height: 2px; }
        .metric-value { font-size: 1.6rem; font-weight: 700; font-family: 'Space Mono', monospace; line-height: 1; margin-bottom: 4px; letter-spacing: -0.02em; }
        .metric-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.35); }
        .mid-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
        .section-title { font-size: 10px; font-family: 'Space Mono', monospace; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.25); margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .unlock-bar-track { height: 6px; background: rgba(255,255,255,0.08); border-radius: 100px; overflow: hidden; margin: 0.75rem 0; }
        .unlock-bar-fill { height: 100%; border-radius: 100px; background: linear-gradient(90deg, #7c3aed, #a78bfa); transition: width 1s ease; }
        .alert-status { padding: 0.75rem 1rem; border-radius: 10px; font-size: 12px; font-family: 'Space Mono', monospace; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; border: 1px solid; }
        .alert-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .scenario-row { display: grid; grid-template-columns: 80px 1fr 1fr 1fr; gap: 8px; padding: 0.6rem 0.75rem; border-radius: 8px; font-size: 12px; font-family: 'Space Mono', monospace; transition: background 0.2s; border: 1px solid transparent; }
        .scenario-row:hover { background: rgba(124,58,237,0.08); border-color: rgba(124,58,237,0.15); }
        .scenario-row.current-row { background: rgba(124,58,237,0.12); border-color: rgba(124,58,237,0.25); }
        .scenario-header { display: grid; grid-template-columns: 80px 1fr 1fr 1fr; gap: 8px; padding: 0 0.75rem 0.5rem; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.25); }
        .exit-step { padding: 1rem 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); margin-bottom: 0.75rem; transition: all 0.2s; }
        .exit-step:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }
        .exit-trigger { font-family: 'Space Mono', monospace; font-size: 16px; font-weight: 700; color: #a78bfa; margin-bottom: 4px; }
        .exit-action { font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 4px; }
        .exit-proceeds { font-size: 11px; font-family: 'Space Mono', monospace; color: #10b981; }
        .split-row { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
        .split-row:last-child { border-bottom: none; }
        .split-label { color: rgba(255,255,255,0.4); }
        .split-value { font-family: 'Space Mono', monospace; font-weight: 500; }
        .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        .panel { padding: 1.5rem; }
        .error-text { font-size: 11px; font-family: 'Space Mono', monospace; color: #f59e0b; margin-top: 0.5rem; padding: 6px 10px; background: rgba(245,158,11,0.08); border-radius: 6px; border: 1px solid rgba(245,158,11,0.2); }
        @media (max-width: 1100px) { .hero { grid-template-columns: 1fr; } .metrics-grid { grid-template-columns: repeat(2, 1fr); } .mid-grid { grid-template-columns: 1fr; } .bottom-grid { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .metrics-grid { grid-template-columns: 1fr 1fr; } .content { padding: 1rem; } .price-huge { font-size: 3.5rem; } }
      `}</style>

      <div className="vcx-root">
        <div className="aurora">
          <div className="aurora-1" />
          <div className="aurora-2" />
          <div className="aurora-3" />
        </div>

        <div className="content">
          {/* Header */}
          <div className="glass header">
            <div className="logo-area">
              <div className="logo-dot" />
              <span className="logo-text">VCX Position</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {!useManualPrice && (
                <div className="live-badge">
                  <div className="live-dot" />
                  LIVE · 30s
                </div>
              )}
              <span style={{ fontSize: "11px", fontFamily: "'Space Mono', monospace", color: "rgba(255,255,255,0.2)" }}>
                {useManualPrice ? "MANUAL MODE" : `UPDATED ${formatTime(lastUpdated)}`}
              </span>
            </div>
          </div>

          {/* Hero */}
          <div className="hero">
            <div className="glass-strong hero-price-card">
              <div className="price-label">VCX · Current Price</div>
              <div className={`price-huge${pricePulse ? " pulse" : ""}`}>
                {money(currentPrice)}
              </div>
              <div className="price-meta">
                <div className={`pnl-chip ${profit >= 0 ? "pnl-positive" : "pnl-negative"}`}>
                  {profit >= 0 ? "▲" : "▼"} {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(2)}%
                </div>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace" }}>
                  {money(profit)} P&L
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "2px" }}>TOTAL VALUE</div>
                  <div style={{ fontSize: "1.4rem", fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#e2e8f0" }}>{money(totalValue)}</div>
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
              <button className={`ctrl-btn ${useManualPrice ? "ctrl-btn-active" : "ctrl-btn-primary"}`} onClick={() => setUseManualPrice((v) => !v)}>
                {useManualPrice ? "⚡ Switch to Live" : "✎ Use Manual Price"}
              </button>
              <button className="ctrl-btn ctrl-btn-ghost" onClick={fetchPrice} disabled={isLoadingPrice || useManualPrice}>
                {isLoadingPrice ? "Fetching..." : "↻ Refresh Now"}
              </button>
              {priceError && <div className="error-text">{priceError}</div>}
            </div>
          </div>

          {/* Metrics */}
          <div className="metrics-grid">
            {[
              { label: "Total Value", value: money(totalValue), accent: "linear-gradient(90deg,#7c3aed,#a78bfa)", valueColor: "#e2e8f0" },
              { label: "Invested", value: money(portfolio.invested), accent: "linear-gradient(90deg,#0ea5e9,#38bdf8)", valueColor: "#e2e8f0" },
              { label: "Profit / Loss", value: money(profit), accent: profit >= 0 ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#ef4444,#f87171)", valueColor: profit >= 0 ? "#34d399" : "#f87171" },
              { label: "Unlock Countdown", value: `${daysRemaining}d`, accent: "linear-gradient(90deg,#f59e0b,#fbbf24)", valueColor: "#fbbf24" },
            ].map((m) => (
              <div key={m.label} className="glass metric-card">
                <div className="metric-accent" style={{ background: m.accent }} />
                <div className="metric-value" style={{ color: m.valueColor, marginTop: "0.5rem" }}>{m.value}</div>
                <div className="metric-label">{m.label}</div>
              </div>
            ))}
          </div>

          {/* Mid row */}
          <div className="mid-grid">
            <div className="glass panel">
              <div className="section-title">Position Split</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
                {[
                  { label: "Unlocked", sub: "Tradable now", shares: portfolio.unlockedShares, value: unlockedValue, color: "#10b981" },
                  { label: "Locked", sub: "Until 9/14/26", shares: portfolio.lockedShares, value: lockedValue, color: "#7c3aed" },
                ].map((s) => (
                  <div key={s.label} style={{ padding: "1rem", borderRadius: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color, marginBottom: "0.5rem", boxShadow: `0 0 8px ${s.color}` }} />
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "2px" }}>{s.label}</div>
                    <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", marginBottom: "6px", fontFamily: "'Space Mono', monospace" }}>{s.sub}</div>
                    <div style={{ fontSize: "1.1rem", fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#e2e8f0" }}>{number(s.shares)}</div>
                    <div style={{ fontSize: "12px", color: s.color, fontFamily: "'Space Mono', monospace" }}>{money(s.value)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", marginBottom: "6px", fontFamily: "'Space Mono', monospace" }}>
                LOCK RELEASE — {unlockProgress.toFixed(0)}%
              </div>
              <div className="unlock-bar-track">
                <div className="unlock-bar-fill" style={{ width: `${unlockProgress}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono', monospace", marginTop: "4px" }}>
                <span>START</span>
                <span>{daysRemaining}d LEFT</span>
                <span>9/14/26</span>
              </div>
            </div>

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
                <div key={a.label} style={{ marginBottom: "0.75rem" }}>
                  <div className="ctrl-label" style={{ color: a.color, opacity: 0.8 }}>{a.label}</div>
                  <input className="ctrl-input" value={a.value} onChange={(e) => a.setter(e.target.value)} placeholder="0.00" />
                </div>
              ))}
              <div className="split-row" style={{ marginTop: "0.5rem" }}>
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

          {/* Bottom row */}
          <div className="bottom-grid">
            <div className="glass panel">
              <div className="section-title">Scenario Calculator</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
                <div>
                  <div className="ctrl-label">Custom Price</div>
                  <input className="ctrl-input" value={customScenario} onChange={(e) => setCustomScenario(e.target.value)} placeholder="Enter price" />
                </div>
                <div style={{ padding: "0.75rem 1rem", borderRadius: "10px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginBottom: "4px", fontFamily: "'Space Mono', monospace" }}>AT {money(scenarioPrice)}</div>
                  <div style={{ fontSize: "1.2rem", fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#c4b5fd" }}>{money(customScenarioValue)}</div>
                </div>
              </div>
              <div className="scenario-header">
                <span>PRICE</span><span>TOTAL</span><span>UNLOCKED</span><span>LOCKED</span>
              </div>
              {scenarioRows.map((row) => (
                <div key={row.price} className={`scenario-row${Math.abs(row.price - currentPrice) < 2 ? " current-row" : ""}`}>
                  <span style={{ color: "#a78bfa", fontWeight: 700 }}>{money(row.price)}</span>
                  <span style={{ color: "#e2e8f0" }}>{money(row.total)}</span>
                  <span style={{ color: "#34d399" }}>{money(row.unlocked)}</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{money(row.locked)}</span>
                </div>
              ))}
            </div>

            <div className="glass panel">
              <div className="section-title">Tiered Exit Strategy</div>
              {tieredPlan.map((step, i) => (
                <div key={i} className="exit-step">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                    <div className="exit-trigger">{step.trigger}</div>
                    <div style={{ fontSize: "11px", fontFamily: "'Space Mono', monospace", padding: "2px 8px", borderRadius: "100px", background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                      {step.pct}
                    </div>
                  </div>
                  <div className="exit-action">{number(step.shares)} shares · {step.note}</div>
                  {step.proceeds && <div className="exit-proceeds">Est. {money(step.proceeds)}</div>}
                </div>
              ))}
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