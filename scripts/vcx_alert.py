"""
scripts/vcx_alert.py
VCX price alert checker with Discord embed notifications.
"""

from __future__ import annotations

import os
import sys
import json
import requests
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

# ── Portfolio config ──────────────────────────────────────────────────────────

@dataclass
class Portfolio:
    total_shares: float
    unlocked_shares: float
    locked_shares: float
    invested: float
    unlock_date: str

PORTFOLIO = Portfolio(
    total_shares=154.548438,
    unlocked_shares=5.268704,
    locked_shares=149.279734,
    invested=2160.30,
    unlock_date="2026-09-14",
)

ALERT_HIGH: float = float(os.environ.get("VCX_ALERT_HIGH", "150"))
ALERT_LOW:  float = float(os.environ.get("VCX_ALERT_LOW",  "90"))

DISCORD_WEBHOOK: str = os.environ["DISCORD_WEBHOOK_URL"]

# Public API
AUTH_URL        = "https://api.public.com/userapiauthservice/personal/access-tokens"
ACCOUNT_URL     = "https://api.public.com/userapigateway/trading/account"
QUOTES_URL_TMPL = "https://api.public.com/userapigateway/marketdata/{accountId}/quotes"

STATE_FILE = "/tmp/vcx_alert_state.json"
ET = ZoneInfo("America/New_York")

# Discord embed colors (decimal)
COLOR_GREEN  = 0x10b981
COLOR_RED    = 0xef4444
COLOR_PURPLE = 0x7c3aed

# ── Public API ────────────────────────────────────────────────────────────────

def get_access_token() -> str:
    resp = requests.post(
        AUTH_URL,
        headers={"Content-Type": "application/json"},
        json={"secret": os.environ["PUBLIC_SECRET"]},
        timeout=30,
    )
    resp.raise_for_status()
    token: str | None = resp.json().get("accessToken")
    if not token:
        raise RuntimeError(f"No accessToken in auth response: {resp.text[:200]}")
    return token

def get_brokerage_account_id(token: str) -> str:
    resp = requests.get(ACCOUNT_URL, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    resp.raise_for_status()
    accounts: list[dict[str, str]] = resp.json().get("accounts", [])
    for acct in accounts:
        if acct.get("accountType") == "BROKERAGE":
            account_id = acct.get("accountId", "")
            if account_id:
                return account_id
    raise RuntimeError("No BROKERAGE account found")

def get_vcx_price(token: str, account_id: str) -> float:
    url = QUOTES_URL_TMPL.format(accountId=account_id)
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"instruments": [{"symbol": "VCX", "type": "EQUITY"}]},
        timeout=30,
    )
    resp.raise_for_status()
    quotes: list[dict[str, Any]] = resp.json().get("quotes", [])
    if not quotes:
        raise RuntimeError("No quotes returned for VCX")
    q = quotes[0]
    price = float(q.get("last") or q.get("lastPrice") or q.get("price") or 0)
    if price <= 0:
        bid = float(q.get("bid") or 0)
        ask = float(q.get("ask") or 0)
        price = (bid + ask) / 2 if bid and ask else bid or ask
    if price <= 0:
        raise RuntimeError(f"Could not parse price from quote: {q}")
    return price

def fetch_price() -> float:
    token = get_access_token()
    account_id = get_brokerage_account_id(token)
    return get_vcx_price(token, account_id)

# ── Discord ───────────────────────────────────────────────────────────────────

def send_embed(embed: dict[str, Any]) -> None:
    resp = requests.post(
        DISCORD_WEBHOOK,
        json={"embeds": [embed]},
        timeout=15,
    )
    if resp.status_code not in (200, 204):
        raise RuntimeError(f"Discord error {resp.status_code}: {resp.text[:200]}")
    print(f"Discord embed sent: {embed.get('title', '?')}")

def build_alert_embed(price: float, kind: str) -> dict[str, Any]:
    total_value: float  = PORTFOLIO.total_shares * price
    pnl: float          = total_value - PORTFOLIO.invested
    pnl_pct: float      = (pnl / PORTFOLIO.invested) * 100
    unlocked_val: float = PORTFOLIO.unlocked_shares * price
    now_et: str         = datetime.now(ET).strftime("%b %d %Y, %I:%M:%S %p ET")
    arrow: str          = "▲" if pnl >= 0 else "▼"

    if kind == "high":
        return {
            "title": "🚀 VCX HIGH ALERT",
            "description": f"Price crossed your **${ALERT_HIGH:.0f}** sell target",
            "color": COLOR_GREEN,
            "fields": [
                {"name": "Current Price",   "value": f"**${price:.2f}**",                                   "inline": True},
                {"name": "Portfolio Value", "value": f"${total_value:,.2f}",                                 "inline": True},
                {"name": "P&L",             "value": f"{arrow} ${abs(pnl):,.2f} ({pnl_pct:+.1f}%)",         "inline": True},
                {"name": "Unlocked Value",  "value": f"${unlocked_val:,.2f}",                                "inline": True},
                {"name": "High Target",     "value": f"${ALERT_HIGH:.0f}",                                   "inline": True},
                {"name": "Low Floor",       "value": f"${ALERT_LOW:.0f}",                                    "inline": True},
            ],
            "footer": {"text": f"VCX Dashboard · {now_et}"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return {
        "title": "⚠️ VCX LOW ALERT",
        "description": f"Price dropped below your **${ALERT_LOW:.0f}** floor",
        "color": COLOR_RED,
        "fields": [
            {"name": "Current Price",   "value": f"**${price:.2f}**",                           "inline": True},
            {"name": "Portfolio Value", "value": f"${total_value:,.2f}",                         "inline": True},
            {"name": "P&L",             "value": f"{arrow} ${abs(pnl):,.2f} ({pnl_pct:+.1f}%)", "inline": True},
            {"name": "High Target",     "value": f"${ALERT_HIGH:.0f}",                           "inline": True},
            {"name": "Low Floor",       "value": f"${ALERT_LOW:.0f}",                            "inline": True},
        ],
        "footer": {"text": f"VCX Dashboard · {now_et}"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

def build_summary_embed(price: float, session: str) -> dict[str, Any]:
    total_value:  float = PORTFOLIO.total_shares * price
    pnl:          float = total_value - PORTFOLIO.invested
    pnl_pct:      float = (pnl / PORTFOLIO.invested) * 100
    unlocked_val: float = PORTFOLIO.unlocked_shares * price
    locked_val:   float = PORTFOLIO.locked_shares * price
    now_et:       str   = datetime.now(ET).strftime("%b %d %Y, %I:%M %p ET")
    arrow:        str   = "▲" if pnl >= 0 else "▼"
    dist_to_high: float = (ALERT_HIGH - price) / price * 100

    title = "🔔 Market Open — VCX" if session == "open" else "📊 Market Close — VCX"
    color = COLOR_PURPLE if session == "open" else (COLOR_GREEN if pnl >= 0 else COLOR_RED)
    desc  = "Market just opened. Here's your position." if session == "open" else "Market just closed. Here's your end-of-day summary."

    return {
        "title": title,
        "description": desc,
        "color": color,
        "fields": [
            {"name": "Price",             "value": f"**${price:.2f}**",                           "inline": True},
            {"name": "Total Value",       "value": f"${total_value:,.2f}",                         "inline": True},
            {"name": "P&L",               "value": f"{arrow} ${abs(pnl):,.2f} ({pnl_pct:+.1f}%)", "inline": True},
            {"name": "Unlocked",          "value": f"${unlocked_val:,.2f}",                        "inline": True},
            {"name": "Locked",            "value": f"${locked_val:,.2f}",                          "inline": True},
            {"name": "Unlock Date",       "value": PORTFOLIO.unlock_date,                          "inline": True},
            {"name": "High Target",       "value": f"${ALERT_HIGH:.0f}",                           "inline": True},
            {"name": "Low Floor",         "value": f"${ALERT_LOW:.0f}",                            "inline": True},
            {"name": "Distance to High",  "value": f"{dist_to_high:+.1f}%",                        "inline": True},
        ],
        "footer": {"text": f"VCX Dashboard · {now_et}"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# ── State ─────────────────────────────────────────────────────────────────────

def load_state() -> dict[str, Any]:
    try:
        with open(STATE_FILE) as f:
            data: dict[str, Any] = json.load(f)
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_state(state: dict[str, Any]) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    is_summary:   bool = "--summary" in sys.argv
    session_type: str  = "open" if "--open" in sys.argv else "close"

    print(f"[VCX Alert] Fetching price... summary={is_summary} session={session_type}")

    try:
        price: float = fetch_price()
    except Exception as e:
        print(f"[VCX Alert] Failed to fetch price: {e}")
        sys.exit(1)

    print(f"[VCX Alert] VCX = ${price:.2f}")

    state: dict[str, Any] = load_state()
    prev:  float          = float(state.get("last_price", 0))
    sent:  int            = 0

    if ALERT_HIGH > 0 and prev < ALERT_HIGH <= price:
        send_embed(build_alert_embed(price, "high"))
        sent += 1

    if ALERT_LOW > 0 and prev > ALERT_LOW >= price:
        send_embed(build_alert_embed(price, "low"))
        sent += 1

    if is_summary:
        send_embed(build_summary_embed(price, session_type))
        sent += 1

    state["last_price"]   = price
    state["last_checked"] = datetime.now(timezone.utc).isoformat()
    save_state(state)

    print(f"[VCX Alert] Done. {sent} embeds sent.")

if __name__ == "__main__":
    main()