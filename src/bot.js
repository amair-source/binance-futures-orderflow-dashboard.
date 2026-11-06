import { config } from './env.js';
import {
  answerCallbackQuery,
  deleteWebhook,
  editMessageReplyMarkup,
  getMe,
  getUpdates,
  sendChatAction,
  sendMessage,
} from './telegram.js';
import {
  getJournalStats,
  getOpenTrades,
  getRuntime,
  getStatusContext,
  recordTradeResult,
  scanSymbols,
  updateRuntime,
} from './scanner.js';
import {
  formatFeedbackPrompt,
  formatHelp,
  formatJournal,
  formatOpenTrades,
  formatScanReport,
  formatSignals,
  formatStatus,
  formatTradeResult,
} from './format.js';

const allowedChats = String(config.chatId)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveSymbols(tokens) {
  const found = [];
  for (const token of tokens) {
    const clean = String(token).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 2) continue;
    const match = config.symbols.find(
      (symbol) => symbol === clean || symbol.replace('USDT', '') === clean,
    );
    if (match) found.push(match);
  }
  return [...new Set(found)];
}

async function runManualScan(chatId, tokens) {
  const targets = resolveSymbols(tokens);
  const symbols = targets.length ? targets : config.symbols;
  await sendChatAction(chatId);
  await sendMessage(`Scanning ${symbols.join(', ')} ...`, { chatId });
  try {
    const results = await scanSymbols(symbols);
    const report = formatScanReport(results, { threshold: getRuntime().threshold });
    await sendMessage(report, { chatId });
  } catch (error) {
    await sendMessage(`Scan failed: ${error.message}`, { chatId });
  }
}

function parseNumber(value) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function feedbackMarkup(trade) {
  return {
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
}

async function handleCommand(chatId, raw) {
  const [head, ...args] = raw.split(/\s+/);
  const command = head.toLowerCase().split('@')[0];
  const runtime = getRuntime();

  switch (command) {
    case '/start':
    case '/help':
      await sendMessage(formatHelp(config.symbols), { chatId });
      return;
    case '/scan':
      await runManualScan(chatId, args);
      return;
    case '/status':
      await sendMessage(formatStatus(getStatusContext()), { chatId });
      return;
    case '/signals':
      await sendMessage(formatSignals(getStatusContext().recentSignals), { chatId });
      return;
    case '/open': {
      const trades = getOpenTrades();
      const account = getJournalStats().account;
      await sendMessage(formatOpenTrades(trades, account), { chatId });
      for (const trade of trades) {
        await sendMessage(formatFeedbackPrompt(trade, account), {
          chatId,
          replyMarkup: feedbackMarkup(trade),
        });
      }
      return;
    }
    case '/journal':
      await sendMessage(formatJournal(getJournalStats()), { chatId });
      return;
    case '/result': {
      const id = parseNumber(args[0]);
      const outcome = (args[1] ?? '').toLowerCase();
      if (id == null || !outcome) {
        await sendMessage(
          'Usage: /result &lt;trade id&gt; &lt;tp1|tp2|sl|be|cancel|open&gt;',
          { chatId },
        );
        return;
      }
      const result = recordTradeResult(id, outcome);
      await sendMessage(formatTradeResult(result), { chatId });
      return;
    }
    case '/symbols':
      await sendMessage(`Scanning: ${config.symbols.join(', ')}`, { chatId });
      return;
    case '/id':
      await sendMessage(`chat id: ${chatId}`, { chatId });
      return;
    case '/live': {
      const value = (args[0] ?? '').toLowerCase();
      const live = value === 'on' ? true : value === 'off' ? false : !runtime.live;
      updateRuntime({ live });
      await sendMessage(`Automatic A++ alerts: ${live ? 'on' : 'off'}`, { chatId });
      return;
    }
    case '/prop': {
      const value = (args[0] ?? '').toLowerCase();
      const propMode =
        value === 'on' ? true : value === 'off' ? false : !runtime.propMode;
      updateRuntime({ propMode });
      await sendMessage(
        propMode
          ? 'Prop mode: on. Strict HTF, sweep, displacement, ADX, session, liquidity-target and RR filters applied.'
          : 'Prop mode: off. Relaxed filters, more signals.',
        { chatId },
      );
      return;
    }
    case '/balance': {
      const value = parseNumber(args[0]);
      if (value == null) {
        await sendMessage(
          `Starting balance: $${runtime.accountBalance.toFixed(0)}. Usage: /balance 5000`,
          { chatId },
        );
        return;
      }
      const next = updateRuntime({ accountBalance: value });
      await sendMessage(
        `Starting balance set to $${next.accountBalance.toFixed(0)}. This resets sizing equity, not journal P&L.`,
        { chatId },
      );
      return;
    }
    case '/risk': {
      const value = parseNumber(args[0]);
      if (value == null) {
        await sendMessage(
          `Risk per trade: ${runtime.riskPerTradePct}%. Usage: /risk 0.2 (max 1%)`,
          { chatId },
        );
        return;
      }
      const next = updateRuntime({ riskPerTradePct: value });
      await sendMessage(`Risk per trade set to ${next.riskPerTradePct}%`, { chatId });
      return;
    }
    case '/maxday': {
      const value = parseNumber(args[0]);
      if (value == null) {
        await sendMessage(
          `Max trades/day: ${runtime.maxTradesPerDay}. Usage: /maxday 2`,
          { chatId },
        );
        return;
      }
      const next = updateRuntime({ maxTradesPerDay: value });
      await sendMessage(`Max trades per day set to ${next.maxTradesPerDay}`, { chatId });
      return;
    }
    case '/threshold': {
      const value = parseNumber(args[0]);
      if (value == null) {
        await sendMessage(`Current threshold: ${runtime.threshold}. Usage: /threshold 88`, { chatId });
        return;
      }
      const next = updateRuntime({ threshold: value });
      await sendMessage(`A++ threshold set to ${next.threshold}/100`, { chatId });
      return;
    }
    case '/interval': {
      const minutes = parseNumber(args[0]);
      if (minutes == null) {
        await sendMessage(
          `Current interval: ${Math.round(runtime.intervalMs / 60000)}min. Usage: /interval 2`,
          { chatId },
        );
        return;
      }
      const next = updateRuntime({ intervalMs: minutes * 60000 });
      await sendMessage(`Auto-scan interval set to ${Math.round(next.intervalMs / 60000)}min`, { chatId });
      return;
    }
    case '/cooldown': {
      const minutes = parseNumber(args[0]);
      if (minutes == null) {
        await sendMessage(
          `Current cooldown: ${Math.round(runtime.cooldownMs / 60000)}min. Usage: /cooldown 240`,
          { chatId },
        );
        return;
      }
      const next = updateRuntime({ cooldownMs: minutes * 60000 });
      await sendMessage(`Signal cooldown set to ${Math.round(next.cooldownMs / 60000)}min`, { chatId });
      return;
    }
    default:
      await sendMessage(formatHelp(config.symbols), { chatId });
  }
}

async function handleCallbackQuery(query) {
  const chatId = String(query.message?.chat?.id ?? '');
  if (!allowedChats.includes(chatId)) {
    console.warn(`[bot] ignored callback from unauthorized chat ${chatId}`);
    return;
  }
  const match = /^res:(\d+):([a-z]+)$/.exec(query.data ?? '');
  if (!match) {
    await answerCallbackQuery(query.id, 'Unknown action');
    return;
  }
  const [, tradeId, outcome] = match;
  const result = recordTradeResult(tradeId, outcome);
  await answerCallbackQuery(
    query.id,
    result.error ? 'Failed' : result.stillOpen ? 'Kept open' : 'Recorded',
  );
  if (result.error) {
    await sendMessage(`<b>Trade update</b>\n${result.error}`, { chatId });
    return;
  }
  if (query.message?.message_id) {
    try {
      await editMessageReplyMarkup(chatId, query.message.message_id, {
        inline_keyboard: [],
      });
    } catch (error) {
      console.warn('[bot] could not clear buttons:', error.message);
    }
  }
  await sendMessage(formatTradeResult(result), { chatId });
}

export async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  const message = update.message;
  if (!message) return;
  const chatId = String(message.chat?.id ?? '');
  if (!allowedChats.includes(chatId)) {
    console.warn(`[bot] ignored message from unauthorized chat ${chatId}`);
    return;
  }
  const text = message.text?.trim();
  if (!text) return;
  if (text.startsWith('/')) {
    await handleCommand(chatId, text);
    return;
  }
  await runManualScan(chatId, text.split(/\s+/));
}

async function pollLoop() {
  let offset = 0;
  let failures = 0;
  for (;;) {
    try {
      const updates = await getUpdates(offset, 0);
      failures = 0;
      for (const update of updates) {
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error('[bot] update failed, retrying:', error.message);
          await sleep(1500);
          try {
            await handleUpdate(update);
          } catch (retryError) {
            console.error('[bot] update retry failed:', retryError.message);
          }
        }
        offset = Math.max(offset, update.update_id + 1);
      }
      if (!updates.length) await sleep(1000);
    } catch (error) {
      failures += 1;
      console.error(`[bot] poll failed (${failures}):`, error.message);
      await sleep(Math.min(10000, 1000 * failures));
    }
  }
}

export async function startBot() {
  await deleteWebhook();
  pollLoop();
  let me = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      me = await getMe();
      break;
    } catch (error) {
      console.error(`[bot] connect attempt ${attempt}/10 failed: ${error.message}`);
      if (attempt < 10) await sleep(3000);
    }
  }
  if (me) {
    console.log(`[bot] @${me.username} connected`);
  } else {
    console.warn('[bot] Telegram unreachable, polling will keep retrying');
  }
  if (me) {
    try {
      await sendMessage(
        '<b>KRONOS APEX online.</b>\nSend any message to scan all assets, or /help for commands.',
      );
    } catch (error) {
      console.error('[bot] startup message failed:', error.message);
    }
  }
  return me;
}
