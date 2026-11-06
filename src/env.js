import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const row = line.trim();
    if (!row || row.startsWith('#')) continue;
    const eq = row.indexOf('=');
    if (eq === -1) continue;
    const key = row.slice(0, eq).trim();
    let value = row.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseContractSizes = (value) => {
  const sizes = {};
  for (const part of String(value || '').split(',')) {
    const [symbol, size] = part.split(':');
    if (!symbol || !size) continue;
    const parsed = Number(size);
    if (Number.isFinite(parsed) && parsed > 0) {
      sizes[symbol.trim().toUpperCase()] = parsed;
    }
  }
  return sizes;
};

export const config = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: String(process.env.TELEGRAM_CHAT_ID || '').trim(),
  symbols: (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,UNIUSDT,XAUTUSDT')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  scanIntervalMs: Math.max(15000, num(process.env.SCAN_INTERVAL_MS, 60000)),
  aPlusThreshold: Math.min(100, Math.max(50, num(process.env.A_PLUS_THRESHOLD, 85))),
  cooldownMs: Math.max(300000, num(process.env.SIGNAL_COOLDOWN_MS, 4 * 60 * 60 * 1000)),
  dryRun: String(process.env.DRY_RUN || 'false').toLowerCase() === 'true',
  adminKey: process.env.ADMIN_KEY || '',
  stateFile: path.join(ROOT, 'state.json'),
  propMode: String(process.env.PROP_MODE || 'true').toLowerCase() !== 'false',
  accountBalance: num(process.env.ACCOUNT_BALANCE, 5000),
  riskPerTradePct: num(process.env.RISK_PER_TRADE_PCT, 0.2),
  maxRiskUsd: num(process.env.MAX_RISK_USD, 25),
  maxTradesPerDay: Math.max(1, num(process.env.MAX_TRADES_PER_DAY, 2)),
  maxOpenTrades: Math.max(1, num(process.env.MAX_OPEN_TRADES, 1)),
  dailyLossLimit: num(process.env.DAILY_LOSS_LIMIT_USD, 250),
  totalLossLimit: num(process.env.TOTAL_LOSS_LIMIT_USD, 500),
  dailyStopUsd: num(process.env.DAILY_STOP_USD, 150),
  totalStopUsd: num(process.env.TOTAL_STOP_USD, 350),
  contractSizes: parseContractSizes(
    process.env.CONTRACT_SIZES ||
      'BTCUSDT:1,ETHUSDT:1,SOLUSDT:1,UNIUSDT:1,XAUTUSDT:1',
  ),
  lotStep: num(process.env.LOT_STEP, 0.01),
  minRR: num(process.env.MIN_RR, 2.5),
  minAdx: num(process.env.MIN_ADX, 20),
  sessionFilter: String(process.env.SESSION_FILTER || 'true').toLowerCase() !== 'false',
  minAtrPct: num(process.env.MIN_ATR_PCT, 0.15) / 100,
  maxAtrPct: num(process.env.MAX_ATR_PCT, 1.5) / 100,
  maxSpreadPct: num(process.env.MAX_SPREAD_PCT, 0.05) / 100,
  requireSweep: String(process.env.REQUIRE_SWEEP || 'true').toLowerCase() !== 'false',
  requireDisplacement: String(process.env.REQUIRE_DISPLACEMENT || 'true').toLowerCase() !== 'false',
  requireLiquidityTarget:
    String(process.env.REQUIRE_LIQUIDITY_TARGET || 'true').toLowerCase() !== 'false',
  strictHtf: String(process.env.STRICT_HTF || 'true').toLowerCase() !== 'false',
};
