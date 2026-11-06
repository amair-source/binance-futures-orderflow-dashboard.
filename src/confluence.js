import {
  adx,
  atr,
  cvdSeries,
  ema,
  findPivots,
  last,
  lastNumber,
  pivotTrend,
  sum,
  volumeProfile,
} from './indicators.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const pct = (value, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;

function analyzeHTF(k4h, k1h) {
  const c4 = k4h.slice(0, -1);
  const c1 = k1h.slice(0, -1);
  const closes = c1.map((c) => c.c);
  const e20 = lastNumber(ema(closes, 20));
  const e50 = lastNumber(ema(closes, 50));
  const e200 = lastNumber(ema(closes, 200));
  const price = last(c1)?.c ?? null;
  let trend1h = 'mixed';
  if (e20 != null && e50 != null && e200 != null && price != null) {
    if (price > e200 && e20 > e50) trend1h = 'bull';
    else if (price < e200 && e20 < e50) trend1h = 'bear';
  }
  const trend4h = pivotTrend(findPivots(c4, 2));
  let dir = 'mixed';
  if (trend1h === 'bull' && trend4h === 'bull') dir = 'bull';
  else if (trend1h === 'bear' && trend4h === 'bear') dir = 'bear';
  else if (trend1h === 'bull' && trend4h !== 'bear') dir = 'bull';
  else if (trend1h === 'bear' && trend4h !== 'bull') dir = 'bear';
  else if (trend4h === 'bull' && trend1h !== 'bear') dir = 'bull';
  else if (trend4h === 'bear' && trend1h !== 'bull') dir = 'bear';
  return { dir, trend1h, trend4h, ema20: e20, ema50: e50, ema200: e200 };
}

function analyzeStructure(candles, atrValue) {
  const pivots = findPivots(candles, 2);
  let trend = pivotTrend(pivots);
  const events = [];
  const broken = new Set();
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const body = Math.abs(current.c - current.o);
    const range = current.h - current.l;
    const displacement = body >= 0.8 * atrValue && range >= 1.2 * atrValue;
    for (const pivot of pivots) {
      if (pivot.i > i - 2 || broken.has(pivot.i)) continue;
      if (
        pivot.type === 'high' &&
        current.c > pivot.price &&
        previous.c <= pivot.price
      ) {
        broken.add(pivot.i);
        events.push({
          i,
          dir: 'bull',
          level: pivot.price,
          type: trend === 'bear' ? 'CHOCH' : 'BOS',
          displacement,
          body,
        });
        trend = 'bull';
      } else if (
        pivot.type === 'low' &&
        current.c < pivot.price &&
        previous.c >= pivot.price
      ) {
        broken.add(pivot.i);
        events.push({
          i,
          dir: 'bear',
          level: pivot.price,
          type: trend === 'bull' ? 'CHOCH' : 'BOS',
          displacement,
          body,
        });
        trend = 'bear';
      }
    }
  }
  const highs = pivots.filter((p) => p.type === 'high');
  const lows = pivots.filter((p) => p.type === 'low');
  return {
    trend,
    event: last(events) ?? null,
    events,
    pivots,
    lastSwingHigh: last(highs)?.price ?? null,
    lastSwingLow: last(lows)?.price ?? null,
  };
}

function analyzePOI(candles, structure, price, atrValue) {
  const result = { long: { ob: null, fvg: null }, short: { ob: null, fvg: null } };
  const events = structure.events;

  for (const dir of ['bull', 'bear']) {
    const side = dir === 'bull' ? 'long' : 'short';
    const event = [...events].reverse().find((item) => item.dir === dir);
    if (event) {
      for (let j = event.i - 1; j >= Math.max(0, event.i - 20); j -= 1) {
        const candle = candles[j];
        const opposite = dir === 'bull' ? candle.c < candle.o : candle.c > candle.o;
        if (!opposite) continue;
        const top = candle.h;
        const bottom = candle.l;
        const distance = price > top ? price - top : price < bottom ? bottom - price : 0;
        const invalid = dir === 'bull' ? price < bottom - 0.3 * atrValue : price > top + 0.3 * atrValue;
        const touched = candles
          .slice(j + 1, -1)
          .some((later) => later.l <= top && later.h >= bottom);
        result[side].ob = {
          side,
          i: j,
          top,
          bottom,
          mid: (top + bottom) / 2,
          distance,
          near: !invalid && distance <= 0.6 * atrValue,
          fresh: !touched,
          detail: `${touched ? '' : 'fresh '}${dir === 'bull' ? 'demand' : 'supply'} OB ${bottom.toFixed(4)}-${top.toFixed(4)}`,
        };
        break;
      }
    }
  }

  for (let i = 2; i < candles.length; i += 1) {
    const c = candles[i];
    const back = candles[i - 2];
    if (c.l > back.h) {
      const bottom = back.h;
      const top = c.l;
      if (top - bottom < 0.1 * atrValue) continue;
      const mitigated = candles.slice(i + 1).some((later) => later.l <= bottom);
      if (mitigated) continue;
      const distance = price > top ? price - top : price < bottom ? bottom - price : 0;
      if (distance <= 0.7 * atrValue && price >= bottom - 0.2 * atrValue) {
        result.long.fvg = {
          side: 'long',
          i,
          top,
          bottom,
          mid: (top + bottom) / 2,
          distance,
          near: true,
          detail: `bullish FVG ${bottom.toFixed(4)}-${top.toFixed(4)}`,
        };
      }
    } else if (c.h < back.l) {
      const bottom = c.h;
      const top = back.l;
      if (top - bottom < 0.1 * atrValue) continue;
      const mitigated = candles.slice(i + 1).some((later) => later.h >= top);
      if (mitigated) continue;
      const distance = price > top ? price - top : price < bottom ? bottom - price : 0;
      if (distance <= 0.7 * atrValue && price <= top + 0.2 * atrValue) {
        result.short.fvg = {
          side: 'short',
          i,
          top,
          bottom,
          mid: (top + bottom) / 2,
          distance,
          near: true,
          detail: `bearish FVG ${bottom.toFixed(4)}-${top.toFixed(4)}`,
        };
      }
    }
  }
  return result;
}

function analyzeSweep(candles, atrValue) {
  const pivots = findPivots(candles, 2);
  const result = { bull: null, bear: null };
  const start = Math.max(3, candles.length - 24);
  for (let i = start; i < candles.length; i += 1) {
    const candle = candles[i];
    const priorLows = pivots.filter((p) => p.type === 'low' && p.i <= i - 3);
    const priorHighs = pivots.filter((p) => p.type === 'high' && p.i <= i - 3);
    const lowLevel = last(priorLows);
    const highLevel = last(priorHighs);
    const range = Math.max(candle.h - candle.l, 1e-9);
    const lowerWick = Math.min(candle.o, candle.c) - candle.l;
    const upperWick = candle.h - Math.max(candle.o, candle.c);
    if (
      lowLevel &&
      candle.l < lowLevel.price &&
      candle.c > lowLevel.price &&
      lowLevel.price - candle.l <= 1.2 * atrValue
    ) {
      result.bull = {
        level: lowLevel.price,
        i,
        low: candle.l,
        rejection: lowerWick / range,
        detail: `sell-side sweep below ${lowLevel.price.toFixed(4)} (rejection ${((lowerWick / range) * 100).toFixed(0)}%)`,
      };
    }
    if (
      highLevel &&
      candle.h > highLevel.price &&
      candle.c < highLevel.price &&
      candle.h - highLevel.price <= 1.2 * atrValue
    ) {
      result.bear = {
        level: highLevel.price,
        i,
        high: candle.h,
        rejection: upperWick / range,
        detail: `buy-side sweep above ${highLevel.price.toFixed(4)} (rejection ${((upperWick / range) * 100).toFixed(0)}%)`,
      };
    }
  }
  return result;
}

function analyzeSR(structure, price, atrValue, levels) {
  const pivots = structure.pivots;
  const resistances = pivots
    .filter((p) => p.type === 'high' && p.price > price)
    .map((p) => p.price);
  const supports = pivots
    .filter((p) => p.type === 'low' && p.price < price)
    .map((p) => p.price);
  if (levels.pdh != null && levels.pdh > price) resistances.push(levels.pdh);
  if (levels.pdl != null && levels.pdl < price) supports.push(levels.pdl);
  const resistance = resistances.length ? Math.min(...resistances) : null;
  const support = supports.length ? Math.max(...supports) : null;
  const supportDist = support != null ? (price - support) / atrValue : null;
  const resistanceDist = resistance != null ? (resistance - price) / atrValue : null;
  return {
    support,
    resistance,
    supportDist,
    resistanceDist,
    atSupport: supportDist != null && supportDist <= 0.5,
    atResistance: resistanceDist != null && resistanceDist <= 0.5,
    abovePdh: levels.pdh != null && price > levels.pdh,
    belowPdl: levels.pdl != null && price < levels.pdl,
  };
}

function analyzeTrendline(candles, structure, price, atrValue) {
  const pivots = structure.pivots;
  const lastIndex = candles.length - 1;
  const project = (points) => {
    if (points.length < 2) return null;
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    const span = b.i - a.i;
    if (span < 3) return null;
    const slope = (b.price - a.price) / span;
    const value = b.price + slope * (lastIndex - b.i);
    return {
      slope,
      value,
      from: a.price,
      to: b.price,
      slopePct: price > 0 ? (slope / price) * 100 : 0,
    };
  };
  const lows = pivots.filter((p) => p.type === 'low');
  const highs = pivots.filter((p) => p.type === 'high');
  const up = project(lows);
  const down = project(highs);
  const upValid =
    Boolean(up) &&
    up.slope > 0 &&
    price >= up.value - 0.2 * atrValue &&
    price - up.value <= 0.8 * atrValue;
  const downValid =
    Boolean(down) &&
    down.slope < 0 &&
    price <= down.value + 0.2 * atrValue &&
    down.value - price <= 0.8 * atrValue;
  return {
    up: up ? { ...up, valid: upValid } : null,
    down: down ? { ...down, valid: downValid } : null,
  };
}

function analyzeBreakout(structure, price, atrValue, levels, bars) {
  const event = structure.event;
  const recent = Boolean(event && event.i >= bars - 20);
  const longBos =
    recent &&
    event.dir === 'bull' &&
    event.type === 'BOS' &&
    price >= event.level - 0.25 * atrValue;
  const shortBos =
    recent &&
    event.dir === 'bear' &&
    event.type === 'BOS' &&
    price <= event.level + 0.25 * atrValue;
  const long = longBos || (levels.pdh != null && price > levels.pdh);
  const short = shortBos || (levels.pdl != null && price < levels.pdl);
  const level = long ? levels.pdh ?? event?.level : short ? levels.pdl ?? event?.level : null;
  return {
    long,
    short,
    detail: long
      ? `bullish break above ${Number(level ?? price).toFixed(4)}`
      : short
        ? `bearish break below ${Number(level ?? price).toFixed(4)}`
        : 'no recent breakout',
  };
}

function premiumDiscount(candles, price) {
  const window = candles.slice(-96);
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of window) {
    if (c.h > hi) hi = c.h;
    if (c.l < lo) lo = c.l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) {
    return { pos: 0.5, hi: price, lo: price };
  }
  return { pos: (price - lo) / (hi - lo), hi, lo };
}

function analyzeOrderflow(candles, depth, price, atrValue) {
  const deltas = candles.map((c) => 2 * c.tb - c.v);
  const recentDelta = sum(deltas.slice(-12));
  const cvd = cvdSeries(candles);
  const slope = cvd[cvd.length - 1] - cvd[Math.max(0, cvd.length - 13)];
  const pivots = findPivots(candles, 2);
  const highPivots = pivots.filter((p) => p.type === 'high').slice(-2);
  const lowPivots = pivots.filter((p) => p.type === 'low').slice(-2);
  let divergence = null;
  if (highPivots.length === 2) {
    const [a, b] = highPivots;
    if (b.price > a.price && cvd[b.i] < cvd[a.i]) divergence = 'bear';
  }
  if (lowPivots.length === 2) {
    const [a, b] = lowPivots;
    if (b.price < a.price && cvd[b.i] > cvd[a.i]) divergence = divergence ?? 'bull';
  }

  const bids = depth?.bids ?? [];
  const asks = depth?.asks ?? [];
  const bestBid = bids[0]?.[0] ?? price;
  const bestAsk = asks[0]?.[0] ?? price;
  const mid = (bestBid + bestAsk) / 2;
  const spreadPct = mid > 0 ? (bestAsk - bestBid) / mid : 0;
  const band = 0.005;
  let bidVolume = 0;
  let askVolume = 0;
  let bidWall = { price: 0, qty: 0 };
  let askWall = { price: 0, qty: 0 };
  for (const [p, q] of bids) {
    if (p < mid * (1 - band)) continue;
    bidVolume += q;
    if (q > bidWall.qty) bidWall = { price: p, qty: q };
  }
  for (const [p, q] of asks) {
    if (p > mid * (1 + band)) continue;
    askVolume += q;
    if (q > askWall.qty) askWall = { price: p, qty: q };
  }
  const total = bidVolume + askVolume;
  const imbalance = total > 0 ? (bidVolume - askVolume) / total : 0;

  return {
    recentDelta,
    cvdSlope: slope,
    divergence,
    imbalance,
    spreadPct,
    bidWall,
    askWall,
    mid,
    atrPct: price > 0 ? atrValue / price : 0,
  };
}

function analyzeFunding(premium, oiHist) {
  const rate = Number.isFinite(premium?.lastFundingRate) ? premium.lastFundingRate : 0;
  let oiChange = 0;
  if (oiHist && oiHist.length >= 2) {
    const first = oiHist[0].openInterest;
    const latest = oiHist[oiHist.length - 1].openInterest;
    if (first > 0) oiChange = (latest - first) / first;
  }
  return { rate, oiChange };
}

function previousDayLevels(k1h) {
  const days = new Map();
  for (const c of k1h.slice(0, -1)) {
    const key = new Date(c.t).toISOString().slice(0, 10);
    const bucket = days.get(key) ?? { high: -Infinity, low: Infinity };
    bucket.high = Math.max(bucket.high, c.h);
    bucket.low = Math.min(bucket.low, c.l);
    days.set(key, bucket);
  }
  const keys = [...days.keys()].sort();
  const target = keys[keys.length - 2];
  const bucket = target ? days.get(target) : null;
  return bucket ? { pdh: bucket.high, pdl: bucket.low } : { pdh: null, pdl: null };
}

function inKillzone(now = new Date()) {
  const hour = now.getUTCHours();
  return (hour >= 7 && hour < 10) || (hour >= 12 && hour < 15);
}

function pickEntry(side, price, atrValue, poi) {
  const isLong = side === 'long';
  const sidePoi = poi[side];
  const zones = [];
  if (sidePoi.ob?.near) zones.push({ ...sidePoi.ob, kind: 'OB' });
  if (sidePoi.fvg?.near) zones.push({ ...sidePoi.fvg, kind: 'FVG' });

  for (const zone of zones) {
    if (isLong && price <= zone.top) {
      return { entryType: 'BUY', price, zone, note: `market at ${zone.kind}` };
    }
    if (!isLong && price >= zone.bottom) {
      return { entryType: 'SELL', price, zone, note: `market at ${zone.kind}` };
    }
  }

  let best = null;
  for (const zone of zones) {
    if (isLong && price > zone.top) {
      const distance = price - zone.top;
      if (distance <= 0.75 * atrValue && (!best || distance < best.distance)) {
        best = {
          entryType: 'BUY LIMIT',
          price: zone.top,
          zone,
          distance,
          note: `limit at ${zone.kind} top`,
        };
      }
    } else if (!isLong && price < zone.bottom) {
      const distance = zone.bottom - price;
      if (distance <= 0.75 * atrValue && (!best || distance < best.distance)) {
        best = {
          entryType: 'SELL LIMIT',
          price: zone.bottom,
          zone,
          distance,
          note: `limit at ${zone.kind} bottom`,
        };
      }
    }
  }
  if (best) return best;
  return { entryType: isLong ? 'BUY' : 'SELL', price, zone: null, note: 'market' };
}

function buildSetup(side, price, atrValue, poi, sweep, pivots, levels, minRROption = 2) {
  const isLong = side === 'long';
  const plan = pickEntry(side, price, atrValue, poi);
  const entry = plan.price;
  const candidates = [isLong ? entry - 0.9 * atrValue : entry + 0.9 * atrValue];
  if (plan.zone) candidates.push(isLong ? plan.zone.bottom : plan.zone.top);
  if (isLong && sweep.bull) candidates.push(sweep.bull.low);
  if (!isLong && sweep.bear) candidates.push(sweep.bear.high);

  let invalidation = isLong ? Math.min(...candidates) : Math.max(...candidates);
  let stop = isLong ? invalidation - 0.25 * atrValue : invalidation + 0.25 * atrValue;
  let risk = Math.abs(entry - stop);
  const maxRisk = entry * 0.025;
  if (!(risk > 0) || risk > maxRisk) {
    stop = isLong ? entry - maxRisk : entry + maxRisk;
    risk = maxRisk;
  }

  const liquidity = [];
  for (const pivot of pivots) {
    if (!Number.isFinite(pivot.price)) continue;
    if (isLong && pivot.type === 'high' && pivot.price > entry + 1.2 * risk) {
      liquidity.push(pivot.price);
    }
    if (!isLong && pivot.type === 'low' && pivot.price < entry - 1.2 * risk) {
      liquidity.push(pivot.price);
    }
  }
  if (isLong && levels.pdh && levels.pdh > entry + 1.2 * risk) liquidity.push(levels.pdh);
  if (!isLong && levels.pdl && levels.pdl < entry - 1.2 * risk) liquidity.push(levels.pdl);
  liquidity.sort((a, b) => (isLong ? a - b : b - a));

  const minRR = Math.max(1, minRROption);
  const atTargetRR = liquidity.filter(
    (level) => Math.abs(level - entry) / risk >= minRR,
  );
  const fallbackRR = Math.max(2, minRR);
  const tp1 =
    atTargetRR[0] ??
    (isLong ? entry + fallbackRR * risk : entry - fallbackRR * risk);
  let tp2 =
    atTargetRR[1] ?? (isLong ? tp1 + 2 * risk : tp1 - 2 * risk);
  if (isLong && tp2 <= tp1) tp2 = tp1 + 2 * risk;
  if (!isLong && tp2 >= tp1) tp2 = tp1 - 2 * risk;
  const rr = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;
  const tp1FromLiquidity = atTargetRR.length > 0;

  return {
    side,
    entryType: plan.entryType,
    entryNote: plan.note,
    tp1FromLiquidity,
    entryZone: plan.zone ? { kind: plan.zone.kind, top: plan.zone.top, bottom: plan.zone.bottom } : null,
    entry,
    sl: stop,
    stop,
    tp1,
    tp2,
    risk,
    riskPct: (risk / entry) * 100,
    rr,
    levels,
  };
}

function evaluateSide(side, context) {
  const {
    price,
    atrValue,
    htf,
    structure,
    poi,
    sweep,
    pd,
    orderflow,
    funding,
    vp,
    levels,
    sr,
    trendline,
    breakout,
    threshold,
    bars,
    rules = {},
    adxValue = 0,
    adxSlope = 0,
  } = context;
  const isLong = side === 'long';
  const dir = isLong ? 'bull' : 'bear';
  const conf = [];
  let score = 0;
  let cvdPass = false;
  let divergenceBlock = false;

  const add = (name, weight, pass, detail, strength) => {
    const factor = strength == null ? (pass ? 1 : 0) : clamp01(strength);
    score += weight * factor;
    conf.push({ name, weight, pass: Boolean(pass), detail });
  };

  const htfAligned = htf.dir === dir;
  const htfPass = rules.strictHtf
    ? htf.trend4h === dir && htf.trend1h === dir
    : htfAligned;
  add(
    'HTF bias (4h/1h)',
    10,
    htfPass,
    `${htf.dir} bias · 4h ${htf.trend4h} · 1h ${htf.trend1h}`,
    htfPass ? 1 : htf.dir === 'mixed' ? 0.35 : 0,
  );

  const recentEvent = structure.event && structure.event.i >= bars - 80;
  const displacementOk = !rules.requireDisplacement || Boolean(structure.event?.displacement);
  const structurePass =
    recentEvent && structure.event.dir === dir && displacementOk;
  add(
    'BOS / CHoCH',
    7,
    structurePass,
    structure.event
      ? `${structure.event.type} ${structure.event.dir} at ${structure.event.level.toFixed(4)}${structure.event.displacement ? ' · displacement' : ' · no displacement'}`
      : 'no recent break',
    structurePass ? 1 : structure.trend === dir ? 0.4 : 0,
  );

  const breakoutPass = isLong ? breakout.long : breakout.short;
  add(
    'Breakout / PDH-PDL',
    4,
    breakoutPass,
    breakout.detail,
    breakoutPass ? 1 : 0,
  );

  const sweepPass = Boolean(sweep[dir]);
  add(
    'Liquidity sweep',
    8,
    sweepPass,
    sweep[dir]?.detail ?? 'no sweep',
  );

  const fakeoutPass =
    sweepPass && (sweep[dir]?.rejection ?? 0) >= 0.35;
  add(
    'Fakeout rejection',
    4,
    fakeoutPass,
    sweepPass
      ? `rejection wick ${((sweep[dir]?.rejection ?? 0) * 100).toFixed(0)}%`
      : 'no sweep',
    fakeoutPass ? 1 : sweepPass ? 0.5 : 0,
  );

  const ob = poi[side].ob;
  add('Order block', 5, Boolean(ob?.near), ob?.detail ?? 'no OB at price');

  const fvg = poi[side].fvg;
  const sdPass = Boolean(ob?.near && ob?.fresh) || Boolean(fvg?.near);
  add(
    'Supply / demand zone',
    4,
    sdPass,
    ob?.near
      ? `${ob.fresh ? 'fresh' : 'tested'} zone ${ob.bottom.toFixed(4)}-${ob.top.toFixed(4)}`
      : fvg?.near
        ? 'fresh FVG zone'
        : 'no fresh zone',
  );

  add('FVG / imbalance', 5, Boolean(fvg?.near), fvg?.detail ?? 'no FVG at price');

  const srPass = isLong
    ? sr.atSupport || sr.abovePdh
    : sr.atResistance || sr.belowPdl;
  add(
    'Support / resistance',
    5,
    srPass,
    `support ${sr.support != null ? sr.support.toFixed(4) : 'n/a'} · resistance ${sr.resistance != null ? sr.resistance.toFixed(4) : 'n/a'}`,
    srPass ? 1 : 0,
  );

  const trend = isLong ? trendline.up : trendline.down;
  const trendPass = Boolean(trend?.valid);
  add(
    'Trendline',
    4,
    trendPass,
    trend
      ? `${isLong ? 'rising' : 'falling'} line ${trend.value.toFixed(4)} · slope ${trend.slopePct.toFixed(2)}%`
      : 'no trendline',
    trendPass ? 1 : 0,
  );

  const pdPass = isLong ? pd.pos <= 0.5 : pd.pos >= 0.5;
  add(
    'Premium / discount',
    4,
    pdPass,
    `${(pd.pos * 100).toFixed(0)}% of range · ${pd.pos <= 0.5 ? 'discount' : 'premium'}`,
  );

  const otePass = isLong
    ? pd.pos >= 0.2 && pd.pos <= 0.4
    : pd.pos >= 0.6 && pd.pos <= 0.8;
  add('OTE zone', 3, otePass, otePass ? 'inside 62-79% retracement' : 'outside OTE');

  const kz = inKillzone();
  add('Killzone', 3, kz, kz ? 'London/NY session' : 'outside killzone');

  cvdPass = isLong
    ? orderflow.recentDelta > 0 && orderflow.cvdSlope > 0
    : orderflow.recentDelta < 0 && orderflow.cvdSlope < 0;
  divergenceBlock = orderflow.divergence === (isLong ? 'bear' : 'bull');
  add(
    'CVD / delta',
    8,
    cvdPass && !divergenceBlock,
    `${orderflow.recentDelta >= 0 ? '+' : ''}${orderflow.recentDelta.toFixed(1)} delta · slope ${orderflow.cvdSlope >= 0 ? '+' : ''}${orderflow.cvdSlope.toFixed(1)}${orderflow.divergence ? ` · ${orderflow.divergence} divergence` : ''}`,
    cvdPass && !divergenceBlock ? 1 : 0,
  );

  const imbalanceStrength = clamp01(
    ((isLong ? orderflow.imbalance : -orderflow.imbalance) + 0.02) / 0.14,
  );
  add(
    'Book imbalance / walls',
    5,
    imbalanceStrength > 0.4,
    `${(orderflow.imbalance * 100).toFixed(1)}% ${orderflow.imbalance >= 0 ? 'bid' : 'ask'} imbalance · spread ${(orderflow.spreadPct * 10000).toFixed(2)} bps`,
    imbalanceStrength,
  );

  const skew = isLong ? orderflow.imbalance : -orderflow.imbalance;
  const skewPass = skew >= 0.02;
  add(
    'Bid / ask skew',
    4,
    skewPass,
    `${(orderflow.imbalance * 100).toFixed(1)}% ${orderflow.imbalance >= 0 ? 'bid-heavy' : 'ask-heavy'} · ${skewPass ? 'with trade' : 'against trade'}`,
    clamp01((skew + 0.01) / 0.06),
  );

  const valueStrength = isLong
    ? price <= vp.poc
      ? 1
      : price <= vp.vah
        ? 0.5
        : 0
    : price >= vp.poc
      ? 1
      : price >= vp.val
        ? 0.5
        : 0;
  add(
    'Volume profile',
    4,
    valueStrength >= 0.5,
    `POC ${vp.poc.toFixed(4)} · VAL ${vp.val.toFixed(4)} · VAH ${vp.vah.toFixed(4)}`,
    valueStrength,
  );

  const fundingStrength = isLong
    ? funding.rate <= 0.0001
      ? 1
      : funding.rate <= 0.0003
        ? 0.6
        : funding.rate <= 0.0006
          ? 0.2
          : 0
    : funding.rate >= -0.0001
      ? 1
      : funding.rate >= -0.0003
        ? 0.6
        : funding.rate >= -0.0006
          ? 0.2
          : 0;
  const oiBonus = funding.oiChange >= 0 ? 0.2 : 0;
  add(
    'Funding / OI',
    3,
    fundingStrength + oiBonus >= 0.5,
    `funding ${(funding.rate * 100).toFixed(4)}% · OI ${pct(funding.oiChange * 100, 1)}`,
    clamp01(fundingStrength * 0.8 + oiBonus),
  );

  const minRR = rules.minRR ?? 2;
  const setup = buildSetup(
    side,
    price,
    atrValue,
    poi,
    sweep,
    structure.pivots,
    levels,
    minRR,
  );
  const rrPass = setup.rr >= minRR;
  add(
    'Risk / reward',
    6,
    rrPass,
    `RR ${setup.rr.toFixed(2)} to liquidity target (min ${minRR.toFixed(1)})`,
    setup.rr >= minRR ? 1 : setup.rr >= minRR * 0.75 ? 0.5 : 0,
  );

  const maxSpread = rules.maxSpreadPct ?? 0.001;
  const minAtr = rules.minAtrPct ?? 0;
  const maxAtr = rules.maxAtrPct ?? 1;
  const spreadOk =
    orderflow.spreadPct < maxSpread &&
    orderflow.atrPct >= minAtr &&
    orderflow.atrPct <= maxAtr;
  add(
    'Spread / volatility',
    4,
    spreadOk,
    `spread ${(orderflow.spreadPct * 10000).toFixed(2)} bps · ATR ${(orderflow.atrPct * 100).toFixed(2)}% · ADX ${adxValue.toFixed(1)} ${adxSlope >= 0 ? 'rising' : 'falling'}`,
    spreadOk ? (orderflow.atrPct >= 0.002 ? 1 : 0.5) : 0,
  );

  const minAdx = rules.minAdx ?? 0;
  const regimePass = minAdx > 0 ? adxValue >= minAdx && adxSlope >= 0 : true;
  const sessionPass = rules.sessionFilter ? kz : true;
  const sweepGate = rules.requireSweep ? sweepPass : true;
  const liquidityTargetPass = !rules.requireLiquidityTarget || setup.tp1FromLiquidity;

  const gates = {
    htf: htfPass,
    structure: structurePass,
    poi: Boolean(ob?.near || fvg?.near),
    orderflow: cvdPass && !divergenceBlock,
    rr: rrPass,
    spread: spreadOk,
    regime: regimePass,
    session: sessionPass,
    sweep: sweepGate,
    liquidityTarget: liquidityTargetPass,
  };
  const allGates = Object.values(gates).every(Boolean);
  const aPlus = allGates && score >= threshold;

  return {
    side,
    score: Math.round(score),
    confluences: conf,
    setup,
    gates,
    aPlus,
    divergence: orderflow.divergence,
  };
}

export function analyzeSymbol(data, options = {}) {
  const threshold = options.threshold ?? 85;
  const rules = options.rules ?? {};
  const price = last(data.k5)?.c;
  const k5 = data.k5.slice(0, -1);
  const k15 = data.k15.slice(0, -1);
  const atrValue = lastNumber(atr(k5, 14)) ?? 0;
  const atr15 = lastNumber(atr(k15, 14)) ?? atrValue;
  if (!price || k5.length < 60 || k15.length < 60) {
    throw new Error('insufficient market data');
  }

  const adxSeries = adx(k15, 14);
  const adxValue = lastNumber(adxSeries) ?? 0;
  const adxPrev = adxSeries.length >= 6 ? adxSeries[adxSeries.length - 6] : null;
  const adxSlope = adxPrev == null ? 0 : adxValue - adxPrev;

  const htf = analyzeHTF(data.k4h, data.k1h);
  const structure = analyzeStructure(k15, atr15);
  const poi = analyzePOI(k15, structure, price, atrValue);
  const sweep = analyzeSweep(k5, atrValue);
  const pd = premiumDiscount(k15, price);
  const orderflow = analyzeOrderflow(k5, data.depth, price, atrValue);
  const funding = analyzeFunding(data.premium, data.oiHist);
  const vp = volumeProfile(k5, 50) ?? { poc: price, val: price, vah: price };
  const levels = previousDayLevels(data.k1h);
  const sr = analyzeSR(structure, price, atrValue, levels);
  const trendline = analyzeTrendline(k15, structure, price, atrValue);
  const breakout = analyzeBreakout(structure, price, atrValue, levels, k15.length);

  const context = {
    price,
    atrValue,
    htf,
    structure,
    poi,
    sweep,
    pd,
    orderflow,
    funding,
    vp,
    levels,
    sr,
    trendline,
    breakout,
    threshold,
    bars: k15.length,
    rules,
    adxValue,
    adxSlope,
  };
  const long = evaluateSide('long', context);
  const short = evaluateSide('short', context);
  const aligned = htf.dir === 'bull' ? long : htf.dir === 'bear' ? short : null;
  const winner = aligned ?? (long.score >= short.score ? long : short);
  const aPlusSide = long.aPlus ? long : short.aPlus ? short : null;
  const active = aPlusSide ?? winner;

  const change24h =
    data.k1h.length > 25
      ? ((price - data.k1h[data.k1h.length - 25].c) / data.k1h[data.k1h.length - 25].c) * 100
      : 0;

  const passedCount = active.confluences.filter((item) => item.pass).length;
  const confidenceLabel =
    active.score >= 92
      ? 'very high'
      : active.score >= 87
        ? 'high'
        : active.score >= 82
          ? 'moderate'
          : 'low';
  const confidence = {
    percent: active.score,
    label: confidenceLabel,
    passed: passedCount,
    total: active.confluences.length,
    gatesPassed: Object.values(active.gates).filter(Boolean).length,
    gatesTotal: Object.keys(active.gates).length,
  };

  return {
    symbol: data.symbol,
    price,
    change24h,
    atrValue,
    atrPct: orderflow.atrPct,
    htf,
    structure: {
      trend: structure.trend,
      event: structure.event,
      lastSwingHigh: structure.lastSwingHigh,
      lastSwingLow: structure.lastSwingLow,
    },
    premiumDiscount: pd,
    sweep: {
      bull: Boolean(sweep.bull),
      bear: Boolean(sweep.bear),
      bullDetail: sweep.bull?.detail ?? null,
      bearDetail: sweep.bear?.detail ?? null,
      bullRejection: sweep.bull?.rejection ?? 0,
      bearRejection: sweep.bear?.rejection ?? 0,
    },
    orderflow,
    funding,
    volumeProfile: { poc: vp.poc, val: vp.val, vah: vp.vah },
    levels,
    sr,
    trendline,
    breakout,
    killzone: inKillzone(),
    sides: { long, short },
    side: active.side,
    score: active.score,
    confidence,
    aPlus: Boolean(aPlusSide),
    setup: active.setup,
    confluences: active.confluences,
    gates: active.gates,
    adx: { value: adxValue, slope: adxSlope },
    updatedAt: Date.now(),
  };
}
