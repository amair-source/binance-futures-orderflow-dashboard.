const FAPI = 'https://fapi.binance.com';
const FDATA = 'https://fapi.binance.com/futures/data';

let banUntil = 0;
let banLogged = false;
let bannedIp = '';

class BinanceBanError extends Error {
  constructor(message, until) {
    super(message);
    this.name = 'BinanceBanError';
    this.until = until;
  }
}

export function getBinanceBan() {
  if (banUntil && banUntil <= Date.now()) {
    banUntil = 0;
    banLogged = false;
    bannedIp = '';
  }
  if (!banUntil) return null;
  return {
    until: banUntil,
    iso: new Date(banUntil).toISOString(),
    ip: bannedIp || null,
  };
}

function parseBanUntil(response, body) {
  const now = Date.now();
  let until = 0;
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    until = now + retryAfter * 1000;
  }
  const match = /banned until (\d{10,13})/i.exec(body);
  if (match) {
    let raw = Number(match[1]);
    if (raw < 1e12) raw *= 1000;
    if (raw > until) until = raw;
  }
  return until || now + 60000;
}

async function getJson(url, attempts = 2) {
  const activeBan = getBinanceBan();
  if (activeBan) {
    throw new BinanceBanError(
      `Binance IP ban active${activeBan.ip ? ` for ${activeBan.ip}` : ''}; paused until ${activeBan.iso}`,
      activeBan.until,
    );
  }

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'user-agent': 'kronos-apex/1.0' },
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      continue;
    }

    if (response.ok) {
      return await response.json();
    }

    const body = await response.text();
    if (response.status === 418 || response.status === 429) {
      const until = parseBanUntil(response, body);
      if (until > banUntil) {
        banUntil = until;
        banLogged = false;
      }
      const ipMatch = /IP\(([^)]+)\)/.exec(body);
      if (ipMatch) bannedIp = ipMatch[1];
      const iso = new Date(banUntil).toISOString();
      if (!banLogged) {
        console.warn(
          `[binance] rate limited; IP ${bannedIp || 'unknown'} banned until ${iso}`,
        );
        banLogged = true;
      }
      throw new BinanceBanError(
        `Binance rate limit ${response.status}${bannedIp ? ` for IP ${bannedIp}` : ''}; paused until ${iso}`,
        banUntil,
      );
    }

    lastError = new Error(
      `${response.status} ${response.statusText} ${body.slice(0, 200)}`,
    );
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError;
}

export async function fetchKlines(symbol, interval, limit) {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const rows = await getJson(url);
  return rows.map((row) => ({
    t: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    tb: Number(row[9]),
  }));
}

export async function fetchDepth(symbol, limit = 100) {
  const data = await getJson(`${FAPI}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
  return {
    bids: data.bids.map(([price, qty]) => [Number(price), Number(qty)]),
    asks: data.asks.map(([price, qty]) => [Number(price), Number(qty)]),
  };
}

export async function fetchPremium(symbol) {
  const data = await getJson(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`);
  return {
    markPrice: Number(data.markPrice),
    lastFundingRate: Number(data.lastFundingRate),
    nextFundingTime: Number(data.nextFundingTime),
  };
}

export async function fetchOpenInterestHist(symbol, period = '15m', limit = 16) {
  const url = `${FDATA}/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`;
  const rows = await getJson(url);
  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    openInterest: Number(row.sumOpenInterest),
    openInterestValue: Number(row.sumOpenInterestValue),
  }));
}

export async function fetchSymbolData(symbol) {
  const [k4h, k1h, k15, k5, depth, premium, oiHist] = await Promise.all([
    fetchKlines(symbol, '4h', 120),
    fetchKlines(symbol, '1h', 240),
    fetchKlines(symbol, '15m', 240),
    fetchKlines(symbol, '5m', 288),
    fetchDepth(symbol, 100),
    fetchPremium(symbol),
    fetchOpenInterestHist(symbol, '15m', 16).catch(() => []),
  ]);
  return { symbol, k4h, k1h, k15, k5, depth, premium, oiHist };
}
