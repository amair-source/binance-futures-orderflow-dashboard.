export function last(array) {
  return array.length ? array[array.length - 1] : undefined;
}

export function lastNumber(array) {
  for (let i = array.length - 1; i >= 0; i -= 1) {
    if (typeof array[i] === 'number' && Number.isFinite(array[i])) return array[i];
  }
  return null;
}

export function sum(array) {
  let total = 0;
  for (const value of array) total += value;
  return total;
}

export function average(array) {
  return array.length ? sum(array) / array.length : 0;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let running = 0;
  for (let i = 0; i < values.length; i += 1) {
    running += values[i];
    if (i >= period) running -= values[i - period];
    if (i >= period - 1) out[i] = running / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < 2) return out;
  const trs = [null];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  let seed = 0;
  for (let i = 1; i <= period && i < trs.length; i += 1) seed += trs[i];
  if (candles.length > period) out[period] = seed / period;
  for (let i = period + 1; i < candles.length; i += 1) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

export function cvdSeries(candles) {
  const out = new Array(candles.length).fill(0);
  let running = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    running += 2 * c.tb - c.v;
    out[i] = running;
  }
  return out;
}

export function vwap(candles, fromTime = 0) {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    if (c.t < fromTime) continue;
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    vol += c.v;
  }
  return vol > 0 ? pv / vol : null;
}

export function findPivots(candles, k = 2) {
  const pivots = [];
  for (let i = k; i < candles.length - k; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= k; j += 1) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow = false;
    }
    if (isHigh) pivots.push({ i, type: 'high', price: candles[i].h });
    if (isLow) pivots.push({ i, type: 'low', price: candles[i].l });
  }
  return pivots;
}

export function pivotTrend(pivots) {
  const highs = pivots.filter((p) => p.type === 'high').slice(-3);
  const lows = pivots.filter((p) => p.type === 'low').slice(-3);
  if (highs.length < 2 || lows.length < 2) return 'mixed';
  const hUp = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const lUp = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const hDown = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const lDown = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (hUp && lUp) return 'bull';
  if (hDown && lDown) return 'bear';
  return 'mixed';
}

export function volumeProfile(candles, buckets = 50) {
  if (!candles.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const step = (hi - lo) / buckets;
  const vols = new Array(buckets).fill(0);
  for (const c of candles) {
    const a = Math.max(0, Math.min(buckets - 1, Math.floor((c.l - lo) / step)));
    const b = Math.max(0, Math.min(buckets - 1, Math.floor((c.h - lo) / step)));
    const span = b - a + 1;
    const per = c.v / span;
    for (let j = a; j <= b; j += 1) vols[j] += per;
  }
  const total = sum(vols);
  let pocIndex = 0;
  for (let i = 1; i < buckets; i += 1) if (vols[i] > vols[pocIndex]) pocIndex = i;
  let lower = pocIndex;
  let upper = pocIndex;
  let covered = vols[pocIndex];
  while (covered < total * 0.7 && (lower > 0 || upper < buckets - 1)) {
    const below = lower > 0 ? vols[lower - 1] : -1;
    const above = upper < buckets - 1 ? vols[upper + 1] : -1;
    if (above >= below) {
      upper += 1;
      covered += Math.max(0, above);
    } else {
      lower -= 1;
      covered += Math.max(0, below);
    }
  }
  return {
    low: lo,
    high: hi,
    step,
    poc: lo + (pocIndex + 0.5) * step,
    val: lo + lower * step,
    vah: lo + (upper + 1) * step,
    buckets: vols.map((v, i) => ({ price: lo + (i + 0.5) * step, volume: v })),
  };
}

export function adx(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n < period * 2 + 1) return out;
  const tr = new Array(n).fill(0);
  const plusDm = new Array(n).fill(0);
  const minusDm = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    tr[i] = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    const up = c.h - p.h;
    const down = p.l - c.l;
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
  }
  const smoothTr = new Array(n).fill(null);
  const smoothPlus = new Array(n).fill(null);
  const smoothMinus = new Array(n).fill(null);
  let trSum = 0;
  let plusSum = 0;
  let minusSum = 0;
  for (let i = 1; i <= period; i += 1) {
    trSum += tr[i];
    plusSum += plusDm[i];
    minusSum += minusDm[i];
  }
  smoothTr[period] = trSum;
  smoothPlus[period] = plusSum;
  smoothMinus[period] = minusSum;
  const dx = new Array(n).fill(null);
  for (let i = period; i < n; i += 1) {
    if (i > period) {
      smoothTr[i] = smoothTr[i - 1] - smoothTr[i - 1] / period + tr[i];
      smoothPlus[i] = smoothPlus[i - 1] - smoothPlus[i - 1] / period + plusDm[i];
      smoothMinus[i] = smoothMinus[i - 1] - smoothMinus[i - 1] / period + minusDm[i];
    }
    const plusDi = smoothTr[i] > 0 ? (100 * smoothPlus[i]) / smoothTr[i] : 0;
    const minusDi = smoothTr[i] > 0 ? (100 * smoothMinus[i]) / smoothTr[i] : 0;
    const diSum = plusDi + minusDi;
    dx[i] = diSum > 0 ? (100 * Math.abs(plusDi - minusDi)) / diSum : 0;
  }
  let running = 0;
  for (let i = period; i < period * 2; i += 1) running += dx[i];
  running /= period;
  out[period * 2 - 1] = running;
  for (let i = period * 2; i < n; i += 1) {
    running = (running * (period - 1) + dx[i]) / period;
    out[i] = running;
  }
  return out;
}
