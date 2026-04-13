"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  Lock,
  Unlock,
  DollarSign,
  CalendarDays,
  Target,
  Bell,
  RefreshCcw,
  Wifi,
  WifiOff,
} from "lucide-react";

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

  const parsedManualPrice = Number(manualPrice);
  const parsedScenarioPrice = Number(customScenario);
  const parsedAlertHigh = Number(alertHigh);
  const parsedAlertLow = Number(alertLow);

  const currentPrice = useManualPrice
    ? Number.isFinite(parsedManualPrice)
      ? parsedManualPrice
      : 0
    : Number.isFinite(livePrice)
    ? livePrice
    : 0;

  const scenarioPrice = Number.isFinite(parsedScenarioPrice)
    ? parsedScenarioPrice
    : 0;
  const highAlertValue = Number.isFinite(parsedAlertHigh) ? parsedAlertHigh : 0;
  const lowAlertValue = Number.isFinite(parsedAlertLow) ? parsedAlertLow : 0;

  const fetchPrice = useCallback(async () => {
    try {
      setIsLoadingPrice(true);
      setPriceError("");

      const res = await fetch("/api/vcx-price", {
        method: "GET",
        cache: "no-store",
      });

      const data: PriceApiResponse = await res.json();

      if (!res.ok) {
        setPriceError("Market may be closed. Showing last known price.");
        return;
      }

      if (typeof data.price === "number" && Number.isFinite(data.price)) {
        setLivePrice(data.price);
        setLastUpdated(data.updatedAt || new Date().toISOString());
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
    const now = new Date();
    const msRemaining = unlockDate.getTime() - now.getTime();

    return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  }, []);

  const totalValue = useMemo(() => {
    return portfolio.totalShares * currentPrice;
  }, [currentPrice]);

  const unlockedValue = useMemo(() => {
    return portfolio.unlockedShares * currentPrice;
  }, [currentPrice]);

  const lockedValue = useMemo(() => {
    return portfolio.lockedShares * currentPrice;
  }, [currentPrice]);

  const profit = useMemo(() => {
    return totalValue - portfolio.invested;
  }, [totalValue]);

  const returnPct = useMemo(() => {
    if (portfolio.invested <= 0) return 0;
    return (profit / portfolio.invested) * 100;
  }, [profit]);

  const scenarioRows = useMemo(
    () =>
      [80, 100, 106.75, 120, 150, 200, 300, 445].map((price) => ({
        price,
        total: portfolio.totalShares * price,
        unlocked: portfolio.unlockedShares * price,
        locked: portfolio.lockedShares * price,
      })),
    []
  );

  const customScenarioValue = useMemo(() => {
    return portfolio.totalShares * scenarioPrice;
  }, [scenarioPrice]);

  const tieredPlan = useMemo(
    () => [
      {
        trigger: "$150+",
        action: "Sell 20% of total shares",
        shares: portfolio.totalShares * 0.2,
        proceeds: portfolio.totalShares * 0.2 * 150,
        note: "Lock in a strong win while keeping most of the upside.",
      },
      {
        trigger: "$200+",
        action: "Sell another 25%",
        shares: portfolio.totalShares * 0.25,
        proceeds: portfolio.totalShares * 0.25 * 200,
        note: "Take another big chunk of profit off the table.",
      },
      {
        trigger: "$300+",
        action: "Sell another 25%",
        shares: portfolio.totalShares * 0.25,
        proceeds: portfolio.totalShares * 0.25 * 300,
        note: "Scale out heavily if hype returns.",
      },
      {
        trigger: "Hold remainder",
        action: "Keep final 30% long-term",
        shares: portfolio.totalShares * 0.3,
        proceeds: null,
        note: "Leave room for long-term upside without being all-in.",
      },
    ],
    []
  );

  const alertState = useMemo(() => {
    if (currentPrice >= highAlertValue && highAlertValue > 0) {
      return {
        label: `Above your sell watch level of ${money(highAlertValue)}`,
        tone: "text-emerald-600",
      };
    }

    if (currentPrice <= lowAlertValue && lowAlertValue > 0) {
      return {
        label: `Below your downside watch level of ${money(lowAlertValue)}`,
        tone: "text-red-600",
      };
    }

    return {
      label: "Inside your normal watch range",
      tone: "text-slate-600",
    };
  }, [currentPrice, highAlertValue, lowAlertValue]);

  function formatTime(iso: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              VCX Position Dashboard
            </h1>
            <p className="text-sm text-slate-600">
              Live VCX tracking, lock-up visibility, and your tiered exit plan.
            </p>
          </div>

          <div className="w-full rounded-3xl border bg-white p-5 shadow-sm md:w-[430px]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Current VCX Price</h2>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {useManualPrice ? (
                  <WifiOff className="h-4 w-4" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
                {useManualPrice ? "Manual" : "Live API"}
              </div>
            </div>

            <div className="text-3xl font-bold">{money(currentPrice)}</div>
            <div className="mt-1 text-xs text-slate-500">
              Last updated:{" "}
              {useManualPrice ? "Manual override" : formatTime(lastUpdated)}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                className="flex-1 rounded-2xl border bg-white px-3 py-2 text-sm outline-none"
                value={manualPrice}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setManualPrice(e.target.value)
                }
                placeholder="Manual VCX price"
              />
              <button
                className={`rounded-2xl px-4 py-2 text-sm font-medium ${
                  useManualPrice
                    ? "bg-black text-white"
                    : "border bg-white text-slate-900"
                }`}
                onClick={() => setUseManualPrice((v: boolean) => !v)}
              >
                {useManualPrice ? "Use Live" : "Use Manual"}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-2xl border bg-white px-3 py-2 text-sm"
                onClick={() => setManualPrice("106.75")}
              >
                Set 106.75
              </button>
              <button
                className="rounded-2xl border bg-white px-3 py-2 text-sm"
                onClick={() => setManualPrice("445")}
              >
                Set 445
              </button>
              <button
                className="inline-flex items-center rounded-2xl border bg-white px-3 py-2 text-sm"
                onClick={fetchPrice}
                disabled={isLoadingPrice || useManualPrice}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </button>
            </div>

            {isLoadingPrice && !useManualPrice && (
              <p className="mt-3 text-xs text-slate-500">
                Refreshing live price…
              </p>
            )}
            {priceError && !useManualPrice && (
              <p className="mt-3 text-xs text-amber-600">{priceError}</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Total Value"
            value={money(totalValue)}
            subtitle={`${number(portfolio.totalShares)} shares`}
            icon={<DollarSign className="h-5 w-5" />}
          />
          <MetricCard
            title="Total Invested"
            value={money(portfolio.invested)}
            subtitle="Historical cost basis"
            icon={<Target className="h-5 w-5" />}
          />
          <MetricCard
            title="Profit / Loss"
            value={money(profit)}
            subtitle={`${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}% return`}
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <MetricCard
            title="Unlock Countdown"
            value={`${daysRemaining} days`}
            subtitle="Restricted shares unlock"
            icon={<CalendarDays className="h-5 w-5" />}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Panel title="Position Split" className="xl:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Unlock className="h-4 w-4" />
                    <span className="font-medium">Unlocked Shares</span>
                  </div>
                  <Badge text="Tradable Now" secondary />
                </div>
                <div className="text-2xl font-bold">
                  {number(portfolio.unlockedShares)}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Current value: {money(unlockedValue)}
                </div>
              </div>

              <div className="rounded-3xl border bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    <span className="font-medium">Locked Shares</span>
                  </div>
                  <Badge text="Unlocks 9/14/26" />
                </div>
                <div className="text-2xl font-bold">
                  {number(portfolio.lockedShares)}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Current value: {money(lockedValue)}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Alert Watch">
            <div className="space-y-4">
              <div className="rounded-3xl border bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <Bell className="h-4 w-4" />
                  Threshold status
                </div>
                <div className={`mt-2 text-sm ${alertState.tone}`}>
                  {alertState.label}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  High alert
                </label>
                <input
                  className="w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none"
                  value={alertHigh}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setAlertHigh(e.target.value)
                  }
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Low alert
                </label>
                <input
                  className="w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none"
                  value={alertLow}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setAlertLow(e.target.value)
                  }
                />
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Scenario Calculator">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Custom VCX Price
                  </label>
                  <input
                    className="w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none"
                    value={customScenario}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setCustomScenario(e.target.value)
                    }
                    placeholder="Enter scenario price"
                  />
                </div>

                <div className="rounded-3xl border bg-slate-50 p-4">
                  <div className="text-sm text-slate-600">
                    Portfolio Value at {money(scenarioPrice)}
                  </div>
                  <div className="mt-1 text-2xl font-bold">
                    {money(customScenarioValue)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {scenarioRows.map((row) => (
                  <div
                    key={row.price}
                    className="grid grid-cols-2 gap-2 rounded-2xl border p-3 text-sm md:grid-cols-4"
                  >
                    <ScenarioCell label="Price" value={money(row.price)} />
                    <ScenarioCell label="Total" value={money(row.total)} />
                    <ScenarioCell label="Unlocked" value={money(row.unlocked)} />
                    <ScenarioCell label="Locked" value={money(row.locked)} />
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Tiered Exit Strategy">
            <div className="space-y-3">
              {tieredPlan.map((step, index) => (
                <div key={index} className="rounded-3xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{step.trigger}</div>
                    <Badge
                      text={step.action}
                      secondary={index === tieredPlan.length - 1}
                    />
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    Shares: {number(step.shares)}
                  </div>
                  {step.proceeds !== null && (
                    <div className="text-sm text-slate-600">
                      Estimated proceeds at trigger: {money(step.proceeds)}
                    </div>
                  )}
                  <div className="mt-2 text-sm text-slate-500">
                    {step.note}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function money(n: number) {
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(safe);
}

function number(n: number) {
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(safe);
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
        </div>
        <div className="rounded-2xl border bg-slate-50 p-2 text-slate-700">
          {icon}
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl border bg-white p-5 shadow-sm ${className}`}>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Badge({
  text,
  secondary = false,
}: {
  text: string;
  secondary?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        secondary
          ? "bg-slate-100 text-slate-700"
          : "bg-slate-900 text-white"
      }`}
    >
      {text}
    </span>
  );
}

function ScenarioCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}