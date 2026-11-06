const FAPI = 'https://fapi.binance.com';
const FDATA = 'https://fapi.binance.com/futures/data';

async function getJson(url, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'user-agent': 'kronos-apex/1.0' },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status} ${response.statusText} ${body.slice(0, 200)}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
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
