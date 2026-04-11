import { NextResponse } from "next/server";

const AUTH_URL = "https://api.public.com/userapiauthservice/personal/access-tokens";
const ACCOUNT_URL = "https://api.public.com/userapigateway/trading/account";
const QUOTES_URL_TMPL = "https://api.public.com/userapigateway/marketdata/{accountId}/quotes";

type PublicAuthResponse = {
  accessToken?: string;
  token?: string;
  data?: {
    accessToken?: string;
    token?: string;
  };
  validityInMinutes?: number;
};

type PublicAccountResponse = {
  accounts?: Array<{
    accountId?: string;
    accountType?: string;
  }>;
};

type PublicQuotesResponse = {
  quotes?: Array<{
    symbol?: string;
    last?: number | string;
    lastPrice?: number | string;
    price?: number | string;
    bid?: number | string;
    ask?: number | string;
  }>;
  data?: {
    quotes?: Array<{
      symbol?: string;
      last?: number | string;
      lastPrice?: number | string;
      price?: number | string;
      bid?: number | string;
      ask?: number | string;
    }>;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

async function getPersonalAccessToken(): Promise<string> {
  const apiSecret = requireEnv("PUBLIC_SECRET");

  const body: Record<string, string> = {
    secret: apiSecret,
  };

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Public auth failed: ${text}`);
  }

  const data = (await response.json()) as PublicAuthResponse;

  

  const token =
    data.accessToken ||
    data.token ||
    data.data?.accessToken ||
    data.data?.token;

  if (!token) {
    throw new Error("Auth succeeded but no personal access token was returned.");
  }

  return token;
}

async function getAccountId(accessToken: string): Promise<string> {
  const response = await fetch(ACCOUNT_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to load account: ${text}`);
  }

  const data = (await response.json()) as PublicAccountResponse;

  const account = data.accounts?.find((a) => a.accountType === "BROKERAGE");
  const accountId = account?.accountId;

  if (!accountId) {
    throw new Error("Could not find a BROKERAGE accountId in Public account response.");
  }

  return accountId;
}

function parseQuotePrice(quote: {
  last?: number | string;
  lastPrice?: number | string;
  price?: number | string;
  bid?: number | string;
  ask?: number | string;
}): number {
  const last =
    Number(quote.last) ||
    Number(quote.lastPrice) ||
    Number(quote.price) ||
    0;

  const bid = Number(quote.bid) || 0;
  const ask = Number(quote.ask) || 0;

  if (last > 0) return last;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (bid > 0) return bid;
  if (ask > 0) return ask;

  throw new Error("Quote returned but no usable price fields were found.");
}

async function getVCXPrice(accessToken: string, accountId: string): Promise<number> {
  const quotesUrl = QUOTES_URL_TMPL.replace("{accountId}", encodeURIComponent(accountId));

  const response = await fetch(quotesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
      body: JSON.stringify({
  instruments: [{ symbol: "VCX", assetType: "EQUITY" }],
  }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to load VCX quote: ${text}`);
  }

  const data = (await response.json()) as PublicQuotesResponse;

  const quote =
    data.quotes?.[0] ||
    data.data?.quotes?.[0];

  if (!quote) {
    throw new Error("VCX quote was not found in the response.");
  }

  return parseQuotePrice(quote);
}

export async function GET() {
  try {
    const accessToken = await getPersonalAccessToken();
    const accountId = await getAccountId(accessToken);
    const price = await getVCXPrice(accessToken, accountId);

    return NextResponse.json({
      symbol: "VCX",
      price,
      source: "Public API",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        price: null,
        error: error instanceof Error ? error.message : "Unknown VCX route error",
      },
      { status: 500 }
    );
  }
}