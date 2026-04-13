// app/api/vcx-alert/route.ts
// Vercel cron backup — add to vercel.json:
// {
//   "crons": [{ "path": "/api/vcx-alert", "schedule": "*/5 13-20 * * 1-5" }]
// }

import { NextResponse } from "next/server";

const AUTH_URL        = "https://api.public.com/userapiauthservice/personal/access-tokens";
const ACCOUNT_URL     = "https://api.public.com/userapigateway/trading/account";
const QUOTES_URL_TMPL = "https://api.public.com/userapigateway/marketdata/{accountId}/quotes";

const PORTFOLIO = {
  totalShares:    154.548438,
  unlockedShares: 5.268704,
  lockedShares:   149.279734,
  invested:       2160.30,
  unlockDate:     "2026-09-14",
};

const COLOR_GREEN  = 0x10b981;
const COLOR_RED    = 0xef4444;
const COLOR_PURPLE = 0x7c3aed;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function fetchVCXPrice(): Promise<number> {
  const secret = requireEnv("PUBLIC_SECRET");
  const authResp = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
    cache: "no-store",
  });
  if (!authResp.ok) throw new Error(`Auth failed: ${await authResp.text()}`);
  const token = (await authResp.json()).accessToken;
  if (!token) throw new Error("No accessToken returned");

  const acctResp = await fetch(ACCOUNT_URL, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!acctResp.ok) throw new Error(`Account failed: ${await acctResp.text()}`);
  const accounts = (await acctResp.json()).accounts ?? [];
  const accountId = accounts.find(
    (a: { accountType: string }) => a.accountType === "BROKERAGE"
  )?.accountId;
  if (!accountId) throw new Error("No BROKERAGE account found");

  const quoteResp = await fetch(
    QUOTES_URL_TMPL.replace("{accountId}", encodeURIComponent(accountId)),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ instruments: [{ symbol: "VCX", type: "EQUITY" }] }),
      cache: "no-store",
    }
  );
  if (!quoteResp.ok) throw new Error(`Quote failed: ${await quoteResp.text()}`);
  const quote = (await quoteResp.json()).quotes?.[0];
  if (!quote) throw new Error("No VCX quote returned");

  const price = Number(quote.last ?? quote.lastPrice ?? quote.price ?? 0);
  if (price > 0) return price;
  const bid = Number(quote.bid ?? 0);
  const ask = Number(quote.ask ?? 0);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  throw new Error("No usable price in quote");
}

async function sendEmbed(embed: object): Promise<void> {
  const webhook = requireEnv("DISCORD_WEBHOOK_URL");
  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!resp.ok) throw new Error(`Discord error: ${await resp.text()}`);
}

function buildAlertEmbed(price: number, kind: "high" | "low", alertHigh: number, alertLow: number) {
  const totalValue   = PORTFOLIO.totalShares * price;
  const pnl          = totalValue - PORTFOLIO.invested;
  const pnlPct       = (pnl / PORTFOLIO.invested) * 100;
  const unlockedVal  = PORTFOLIO.unlockedShares * price;
  const arrow        = pnl >= 0 ? "▲" : "▼";
  const nowET        = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  return kind === "high"
    ? {
        title: "🚀 VCX HIGH ALERT",
        description: `Price crossed your **$${alertHigh}** sell target`,
        color: COLOR_GREEN,
        fields: [
          { name: "Current Price",   value: `**$${price.toFixed(2)}**`,                               inline: true },
          { name: "Portfolio Value", value: `$${totalValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, inline: true },
          { name: "P&L",             value: `${arrow} $${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })} (${pnlPct.toFixed(1)}%)`, inline: true },
          { name: "Unlocked Value",  value: `$${unlockedVal.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, inline: true },
          { name: "High Target",     value: `$${alertHigh}`,                                           inline: true },
          { name: "Low Floor",       value: `$${alertLow}`,                                            inline: true },
        ],
        footer: { text: `VCX Dashboard · ${nowET}` },
        timestamp: new Date().toISOString(),
      }
    : {
        title: "⚠️ VCX LOW ALERT",
        description: `Price dropped below your **$${alertLow}** floor`,
        color: COLOR_RED,
        fields: [
          { name: "Current Price",   value: `**$${price.toFixed(2)}**`,                               inline: true },
          { name: "Portfolio Value", value: `$${totalValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, inline: true },
          { name: "P&L",             value: `${arrow} $${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })} (${pnlPct.toFixed(1)}%)`, inline: true },
          { name: "High Target",     value: `$${alertHigh}`,                                           inline: true },
          { name: "Low Floor",       value: `$${alertLow}`,                                            inline: true },
        ],
        footer: { text: `VCX Dashboard · ${nowET}` },
        timestamp: new Date().toISOString(),
      };
}

function buildSummaryEmbed(price: number, session: "open" | "close", alertHigh: number, alertLow: number) {
  const totalValue  = PORTFOLIO.totalShares * price;
  const pnl         = totalValue - PORTFOLIO.invested;
  const pnlPct      = (pnl / PORTFOLIO.invested) * 100;
  const unlockedVal = PORTFOLIO.unlockedShares * price;
  const lockedVal   = PORTFOLIO.lockedShares * price;
  const arrow       = pnl >= 0 ? "▲" : "▼";
  const nowET       = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const distToHigh  = ((alertHigh - price) / price) * 100;

  return {
    title:       session === "open" ? "🔔 Market Open — VCX" : "📊 Market Close — VCX",
    description: session === "open" ? "Market just opened. Here's your position." : "Market closed. End-of-day summary.",
    color:       session === "open" ? COLOR_PURPLE : (pnl >= 0 ? COLOR_GREEN : COLOR_RED),
    fields: [
      { name: "Price",            value: `**$${price.toFixed(2)}**`,                                                    inline: true },
      { name: "Total Value",      value: `$${totalValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,         inline: true },
      { name: "P&L",              value: `${arrow} $${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })} (${pnlPct.toFixed(1)}%)`, inline: true },
      { name: "Unlocked",         value: `$${unlockedVal.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,        inline: true },
      { name: "Locked",           value: `$${lockedVal.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,          inline: true },
      { name: "Unlock Date",      value: PORTFOLIO.unlockDate,                                                           inline: true },
      { name: "High Target",      value: `$${alertHigh}`,                                                                inline: true },
      { name: "Low Floor",        value: `$${alertLow}`,                                                                 inline: true },
      { name: "Distance to High", value: `${distToHigh > 0 ? "+" : ""}${distToHigh.toFixed(1)}%`,                       inline: true },
    ],
    footer:    { text: `VCX Dashboard · ${nowET}` },
    timestamp: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const price      = await fetchVCXPrice();
    const alertHigh  = Number(process.env.VCX_ALERT_HIGH ?? 150);
    const alertLow   = Number(process.env.VCX_ALERT_LOW  ?? 90);
    const totalValue = PORTFOLIO.totalShares * price;
    const pnl        = totalValue - PORTFOLIO.invested;
    const sent: string[] = [];

    // Threshold alerts (stateless — fires whenever price is beyond threshold)
    if (alertHigh > 0 && price >= alertHigh) {
      await sendEmbed(buildAlertEmbed(price, "high", alertHigh, alertLow));
      sent.push("high-alert");
    }
    if (alertLow > 0 && price <= alertLow) {
      await sendEmbed(buildAlertEmbed(price, "low", alertHigh, alertLow));
      sent.push("low-alert");
    }

    // Market open/close summary window (fires within a 5 min window)
    const nowET = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(nowET);
    const h = etDate.getHours();
    const m = etDate.getMinutes();

    if (h === 9 && m >= 30 && m < 35) {
      await sendEmbed(buildSummaryEmbed(price, "open", alertHigh, alertLow));
      sent.push("open-summary");
    }
    if (h === 16 && m >= 0 && m < 5) {
      await sendEmbed(buildSummaryEmbed(price, "close", alertHigh, alertLow));
      sent.push("close-summary");
    }

    return NextResponse.json({
      price,
      pnl: pnl.toFixed(2),
      embedsSent: sent,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[vcx-alert]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}