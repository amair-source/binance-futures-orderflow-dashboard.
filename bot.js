import { config } from './src/env.js';
import { hydrateState } from './src/state.js';

await hydrateState(config.stateFile);

const { telegramConfigured } = await import('./src/telegram.js');
const { startBot } = await import('./src/bot.js');
const { getStatusContext, startScheduler } = await import('./src/scanner.js');
const { startHealthServer } = await import('./src/health.js');

if (!telegramConfigured()) {
  console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
  process.exit(1);
}

const healthPort = Number(process.env.PORT || process.env.HEALTH_PORT || 0);
const health = startHealthServer(healthPort, () => {
  const context = getStatusContext();
  return {
    symbols: context.symbols,
    lastScanAt: context.lastScanAt,
    live: context.runtime.live,
    threshold: context.runtime.threshold,
    propMode: context.propMode,
    dailyCount: context.dailyCount,
    maxTradesPerDay: context.maxTradesPerDay,
    riskPerTradePct: context.riskPerTradePct,
    accountBalance: context.accountBalance,
  };
});

const scheduler = startScheduler();
console.log(
  `[app] scanning ${config.symbols.join(', ')} every ${Math.round(config.scanIntervalMs / 1000)}s` +
    `${config.dryRun ? ' (dry-run)' : ''}`,
);

startBot().catch((error) => {
  console.error('[app] bot startup warning:', error.message);
});

const shutdown = () => {
  scheduler?.stop();
  health?.close();
  console.log('[app] stopped');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
