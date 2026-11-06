import { config } from './env.js';
import { fetchSymbolData, getBinanceBan } from './binance.js';
import { analyzeSymbol } from './confluence.js';
import { loadState, saveState } from './state.js';
import { formatFeedbackPrompt, formatSignal } from './format.js';
import { sendMessage } from './telegram.js';

const state = loadState(config.stateFile);
state.trades = Array.isArray(state.trades) ? state.trades : [];
state.tradeSeq = Number.isFinite(state.tradeSeq) ? state.tradeSeq : state.trades.length;
state.lastSignals = state.lastSignals ?? {};
state.recentSignals = state.recentSignals ?? [];

const runtime = {
  threshold: state.settings.threshold ?? config.aPlusThreshold,
  intervalMs: state.settings.intervalMs ?? config.scanIntervalMs,
  cooldownMs: state.settings.cooldownMs ?? config.cooldownMs,
  live: state.settings.live ?? true,
  propMode: state.settings.propMode ?? config.propMode,
  accountBalance: state.settings.accountBalance ?? config.accountBalance,
  riskPerTradePct: state.settings.riskPerTradePct ?? config.riskPerTradePct,
  maxTradesPerDay: state.settings.maxTradesPerDay ?? config.maxTradesPerDay,
};

const latestResults = new Map();
let lastScanAt = state.lastScanAt ?? null;

const round2 = (value) => Math.round(value * 100) / 100;
const utcDay = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function buildRules() {
  if (!runtime.propMode) {
    return {
      strictHtf: false,
      requireSweep: false,
      requireDisplacement: false,
      requireLiquidityTarget: false,
      sessionFilter: false,
      minAdx: 0,
      minRR: 2,
      minAtrPct: 0,
      maxAtrPct: 1,
      maxSpreadPct: 0.001,
    };
  }
  return {
    strictHtf: config.strictHtf,
    requireSweep: config.requireSweep,
    requireDisplacement: config.requireDisplacement,
    requireLiquidityTarget: config.requireLiquidityTarget,
    sessionFilter: config.sessionFilter,
    minAdx: config.minAdx,
    minRR: config.minRR,
    minAtrPct: config.minAtrPct,
    maxAtrPct: config.maxAtrPct,
    maxSpreadPct: config.maxSpreadPct,
  };
}

function ensureDaily() {
  const today = utcDay();
  if (!state.daily || state.daily.date !== today) {
    state.daily = { date: today, count: 0 };
  }
  return state.daily;
}

function totalPnl() {
  return round2(
    state.trades.reduce((sum, trade) => sum + (Number(trade.pnlUsd) || 0), 0),
  );
}

function dailyPnl() {
  const today = utcDay();
  return round2(
    state.trades
      .filter((trade) => trade.closedAt && utcDay(trade.closedAt) === today)
      .reduce((sum, trade) => sum + (Number(trade.pnlUsd) || 0), 0),
  );
}

function getAccount() {
  const total = totalPnl();
  const daily = dailyPnl();
  const equity = round2(runtime.accountBalance + total);
  return {
    startingBalance: runtime.accountBalance,
    equity,
    totalPnl: total,
    dailyPnl: daily,
    totalRemaining: round2(config.totalLossLimit + total),
    dailyRemaining: round2(config.dailyLossLimit + daily),
    totalStopRemaining: round2(config.totalStopUsd + total),
    dailyStopRemaining: round2(config.dailyStopUsd + daily),
    totalLossLimit: config.totalLossLimit,
    dailyLossLimit: config.dailyLossLimit,
    totalStopUsd: config.totalStopUsd,
    dailyStopUsd: config.dailyStopUsd,
    allowed: total > -config.totalStopUsd && daily > -config.dailyStopUsd,
  };
}

function computeRiskUsd(account = getAccount()) {
  if (!account.allowed) return 0;
  const pctRisk = (account.equity * runtime.riskPerTradePct) / 100;
  const risk = Math.min(
    pctRisk,
    account.totalStopRemaining * 0.5,
    account.dailyStopRemaining * 0.5,
    config.maxRiskUsd,
  );
  return Math.max(0, Math.floor(risk * 100) / 100);
}

function buildSizing(symbol, setup, riskUsd, account = getAccount()) {
  const contractSize = config.contractSizes[symbol] ?? 1;
  const step = config.lotStep > 0 ? config.lotStep : 0.01;
  const rawUnits = setup.risk > 0 ? riskUsd / setup.risk : 0;
  const rawLots = contractSize > 0 ? rawUnits / contractSize : 0;
  let lots = Math.floor((rawLots + 1e-9) / step) * step;
  let adjusted = false;
  if (lots < step && rawLots > 0) {
    const minRisk = step * contractSize * setup.risk;
    if (minRisk <= config.maxRiskUsd && minRisk <= riskUsd * 2 + 1e-9) {
      lots = step;
      adjusted = true;
    } else {
      lots = 0;
    }
  }
  lots = Number(lots.toFixed(6));
  const units = lots * contractSize;
  const riskAmount = round2(units * setup.risk);
  const notional = round2(units * setup.entry);
  return {
    riskAmount,
    requestedRisk: riskUsd,
    riskPerTradePct: account.equity > 0 ? (riskAmount / account.equity) * 100 : 0,
    accountBalance: account.equity,
    units,
    lots,
    contractSize,
    lotStep: step,
    notional,
    belowMin: lots <= 0,
    adjusted,
  };
}

function persist() {
  state.settings.threshold = runtime.threshold;
  state.settings.intervalMs = runtime.intervalMs;
  state.settings.cooldownMs = runtime.cooldownMs;
  state.settings.live = runtime.live;
  state.settings.propMode = runtime.propMode;
  state.settings.accountBalance = runtime.accountBalance;
  state.settings.riskPerTradePct = runtime.riskPerTradePct;
  state.settings.maxTradesPerDay = runtime.maxTradesPerDay;
  state.lastScanAt = lastScanAt;
  saveState(config.stateFile, state);
}

async function scanOne(symbol) {
  try {
    const data = await fetchSymbolData(symbol);
    const result = analyzeSymbol(data, {
      threshold: runtime.threshold,
      rules: buildRules(),
    });
    result.symbol = symbol;
    const account = getAccount();
    result.sizing = buildSizing(
      symbol,
      result.setup,
      computeRiskUsd(account),
      account,
    );
    return result;
  } catch (error) {
    return { symbol, error: error.message };
  }
}

async function runScan(symbols) {
  const ban = getBinanceBan();
  if (ban) {
    const message = `Binance IP ban active${ban.ip ? ` for ${ban.ip}` : ''}; paused until ${ban.iso}`;
    console.warn(`[scan] ${message}`);
    return symbols.map((symbol) => ({ symbol, error: message }));
  }

  const queue = [...symbols];
  const collected = [];
  const workerCount = Math.min(2, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const symbol = queue.shift();
      const result = await scanOne(symbol);
      collected.push(result);
    }
  });
  await Promise.all(workers);
  const ordered = symbols.map(
    (symbol) =>
      collected.find((item) => item.symbol === symbol) ?? {
        symbol,
        error: 'missing result',
      },
  );
  for (const result of ordered) latestResults.set(result.symbol, result);
  lastScanAt = Date.now();
  persist();
  return ordered;
}

let chain = Promise.resolve();

export function scanSymbols(symbols) {
  const next = chain.then(
    () => runScan(symbols),
    () => runScan(symbols),
  );
  chain = next.catch(() => {});
  return next;
}

async function sendFeedbackPrompt(trade) {
  const markup = {
    inline_keyboard: [
      [
        { text: 'TP1 hit', callback_data: `res:${trade.id}:tp1` },
        { text: 'TP2 hit', callback_data: `res:${trade.id}:tp2` },
      ],
      [
        { text: 'SL hit', callback_data: `res:${trade.id}:sl` },
        { text: 'Breakeven', callback_data: `res:${trade.id}:be` },
      ],
      [
        { text: 'Still open', callback_data: `res:${trade.id}:open` },
        { text: 'Not filled', callback_data: `res:${trade.id}:cancel` },
      ],
    ],
  };
  await sendMessage(formatFeedbackPrompt(trade, getAccount()), {
    replyMarkup: markup,
  });
}

async function dispatchAlerts(results) {
  if (!runtime.live) return [];
  const candidates = results.filter(
    (result) => result && !result.error && result.aPlus,
  );
  if (!candidates.length) return [];

  const account = getAccount();
  if (!account.allowed) {
    console.log(
      `[guard] trading paused · daily P&L ${account.dailyPnl} · total P&L ${account.totalPnl}`,
    );
    return [];
  }

  const openTrades = state.trades.filter((trade) => trade.status === 'open');
  if (openTrades.length >= config.maxOpenTrades) {
    const now = Date.now();
    let prompted = false;
    for (const trade of openTrades) {
      if (now - (trade.lastPromptAt || 0) >= 10 * 60 * 1000) {
        await sendFeedbackPrompt(trade);
        trade.lastPromptAt = now;
        prompted = true;
      }
    }
    if (prompted) persist();
    return [];
  }

  const sent = [];
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const daily = ensureDaily();
  const maxPerHour = runtime.propMode ? 1 : 8;
  const maxDaily = runtime.propMode ? runtime.maxTradesPerDay : Infinity;

  for (const result of candidates) {
    if (daily.count >= maxDaily) break;
    const key = `${result.symbol}:${result.side}`;
    const previous = state.lastSignals[key];
    if (previous && now - previous.ts < runtime.cooldownMs) continue;
    const lastHour = state.recentSignals.filter((item) => item.ts > hourAgo);
    if (lastHour.length >= maxPerHour) continue;

    const riskUsd = computeRiskUsd(account);
    if (riskUsd <= 0) break;
    const sizing = buildSizing(result.symbol, result.setup, riskUsd, account);
    if (!sizing || sizing.lots <= 0) {
      console.log(
        `[alert] skipped ${result.symbol}: min lot risk exceeds safety cap`,
      );
      continue;
    }
    result.sizing = sizing;
    const id = ++state.tradeSeq;
    result.tradeId = id;
    const rr2 = result.setup.risk > 0
      ? Math.abs(result.setup.tp2 - result.setup.entry) / result.setup.risk
      : 0;
    const record = {
      id,
      ts: now,
      symbol: result.symbol,
      side: result.side,
      entryType: result.setup.entryType,
      entry: result.setup.entry,
      sl: result.setup.sl,
      tp1: result.setup.tp1,
      tp2: result.setup.tp2,
      rr: result.setup.rr,
      rr2,
      score: result.score,
      confidence: result.confidence.percent,
      riskUsd: sizing.riskAmount,
      lots: sizing.lots,
      units: sizing.units,
      contractSize: sizing.contractSize,
      notional: sizing.notional,
      balanceAtSignal: account.equity,
      status: 'open',
      outcome: null,
      closedAt: null,
      pnlUsd: null,
      lastPromptAt: 0,
      confluences: result.confluences
        .filter((item) => item.pass)
        .map((item) => item.name),
      gates: result.gates,
    };

    try {
      await sendMessage(formatSignal(result));
      state.trades.push(record);
      state.lastSignals[key] = {
        symbol: record.symbol,
        side: record.side,
        score: record.score,
        entry: record.entry,
        ts: now,
      };
      state.recentSignals.push({
        symbol: record.symbol,
        side: record.side,
        score: record.score,
        entry: record.entry,
        ts: now,
        id,
      });
      state.recentSignals = state.recentSignals.slice(-100);
      daily.count += 1;
      persist();
      sent.push(record);
      console.log(
        `[alert] trade #${id} ${record.symbol} ${record.side.toUpperCase()} ` +
          `${record.score}/100 · ${record.lots} lots · risk $${record.riskUsd}`,
      );
    } catch (error) {
      console.error(`[alert] ${result.symbol} failed:`, error.message);
    }
    break;
  }
  return sent;
}

function normalizeOutcome(outcome) {
  const map = {
    tp1: 'tp1',
    tp: 'tp1',
    win: 'tp1',
    tp2: 'tp2',
    sl: 'sl',
    loss: 'sl',
    lose: 'sl',
    be: 'be',
    breakeven: 'be',
    cancel: 'cancel',
    cancelled: 'cancel',
    notfilled: 'cancel',
    open: 'open',
    still: 'open',
  };
  return map[String(outcome || '').toLowerCase()] ?? null;
}

export function recordTradeResult(tradeId, outcome) {
  const trade = state.trades.find((item) => item.id === Number(tradeId));
  if (!trade) return { error: `trade #${tradeId} not found` };
  const normalized = normalizeOutcome(outcome);
  if (!normalized) {
    return { error: 'unknown result; use tp1, tp2, sl, be, cancel or open' };
  }
  if (normalized === 'open') {
    trade.lastPromptAt = Date.now();
    persist();
    return { trade, stillOpen: true, account: getAccount() };
  }
  if (trade.status !== 'open') {
    return { error: `trade #${trade.id} already closed (${trade.status})` };
  }

  let pnl = 0;
  let label = '';
  if (normalized === 'tp1') {
    pnl = 0.5 * trade.riskUsd * trade.rr;
    label = 'TP1 hit: 50% banked, stop to breakeven';
  } else if (normalized === 'tp2') {
    pnl =
      0.5 * trade.riskUsd * trade.rr +
      0.5 * trade.riskUsd * (trade.rr2 || 4);
    label = 'TP2 hit: full target';
  } else if (normalized === 'sl') {
    pnl = -trade.riskUsd;
    label = 'Stop loss hit';
  } else if (normalized === 'be') {
    pnl = 0;
    label = 'Breakeven';
  } else if (normalized === 'cancel') {
    pnl = 0;
    label = 'Not filled / cancelled';
  }

  trade.status =
    normalized === 'be'
      ? 'be'
      : normalized === 'cancel'
        ? 'cancelled'
        : pnl > 0
          ? 'win'
          : pnl < 0
            ? 'loss'
            : 'be';
  trade.outcome = normalized;
  trade.pnlUsd = round2(pnl);
  trade.closedAt = Date.now();
  persist();

  return {
    trade,
    pnlUsd: trade.pnlUsd,
    label,
    account: getAccount(),
  };
}

export function getOpenTrades() {
  return state.trades.filter((trade) => trade.status === 'open');
}

export function getJournalStats() {
  const closed = state.trades.filter((trade) => trade.status !== 'open');
  const wins = closed.filter((trade) => trade.status === 'win').length;
  const losses = closed.filter((trade) => trade.status === 'loss').length;
  const be = closed.filter((trade) => trade.status === 'be').length;
  const cancelled = closed.filter((trade) => trade.status === 'cancelled').length;
  return {
    total: state.trades.length,
    open: state.trades.filter((trade) => trade.status === 'open').length,
    closed: closed.length,
    wins,
    losses,
    be,
    cancelled,
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
    totalPnl: totalPnl(),
    dailyPnl: dailyPnl(),
    account: getAccount(),
  };
}

export function startScheduler() {
  let stopped = false;
  let timer = null;
  const loop = async () => {
    if (stopped) return;
    try {
      const results = await scanSymbols(config.symbols);
      await dispatchAlerts(results);
    } catch (error) {
      console.error('[scan]', error.message);
    }
    if (!stopped) timer = setTimeout(loop, runtime.intervalMs);
  };
  loop();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function getRuntime() {
  return { ...runtime };
}

export function updateRuntime(patch) {
  if (patch.threshold != null) {
    runtime.threshold = clamp(patch.threshold, 50, 100);
  }
  if (patch.intervalMs != null) {
    runtime.intervalMs = Math.max(30000, patch.intervalMs);
  }
  if (patch.cooldownMs != null) {
    runtime.cooldownMs = Math.max(300000, patch.cooldownMs);
  }
  if (patch.live != null) runtime.live = Boolean(patch.live);
  if (patch.propMode != null) runtime.propMode = Boolean(patch.propMode);
  if (patch.accountBalance != null) {
    runtime.accountBalance = Math.max(100, patch.accountBalance);
  }
  if (patch.riskPerTradePct != null) {
    runtime.riskPerTradePct = clamp(patch.riskPerTradePct, 0.05, 1);
  }
  if (patch.maxTradesPerDay != null) {
    runtime.maxTradesPerDay = clamp(Math.round(patch.maxTradesPerDay), 1, 20);
  }
  persist();
  return getRuntime();
}

export function getStatusContext() {
  const account = getAccount();
  return {
    runtime: getRuntime(),
    lastScanAt,
    symbols: config.symbols,
    dryRun: config.dryRun,
    recentSignals: state.recentSignals,
    propMode: runtime.propMode,
    accountBalance: runtime.accountBalance,
    riskPerTradePct: runtime.riskPerTradePct,
    dailyCount: ensureDaily().count,
    maxTradesPerDay: runtime.propMode ? runtime.maxTradesPerDay : null,
    account,
    journal: getJournalStats(),
    openTrades: getOpenTrades(),
    riskUsd: computeRiskUsd(account),
    maxOpenTrades: config.maxOpenTrades,
    contractSizes: config.contractSizes,
  };
}

export function getLastResults() {
  return [...latestResults.values()];
}
