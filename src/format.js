const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const px = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 100) return value.toFixed(3);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
};

const sign = (value, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

const usd = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const rounded = Math.round(value);
  const prefix = rounded < 0 ? '-' : '';
  return `${prefix}$${Math.abs(rounded).toLocaleString('en-US')}`;
};

const qty = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(3);
  return value.toFixed(5);
};

const gateLabels = {
  htf: 'HTF bias',
  structure: 'BOS/CHoCH',
  poi: 'OB/FVG',
  orderflow: 'orderflow',
  rr: 'RR >= min',
  spread: 'spread/ATR',
  regime: 'ADX regime',
  session: 'session',
  sweep: 'sweep',
  liquidityTarget: 'liquidity target',
};

export function formatSignal(result) {
  const setup = result.setup;
  const confidence = result.confidence;
  const dir = result.side === 'long' ? 'LONG' : 'SHORT';
  const passing = result.confluences.filter((item) => item.pass);
  const missed = result.confluences.filter((item) => !item.pass);
  const sizing = result.sizing;
  const tradeTag = result.tradeId ? ` · TRADE #${result.tradeId}` : '';
  const lines = [
    `<b>KRONOS APEX — A++ SETUP</b>${tradeTag}`,
    `<b>${esc(result.symbol)}</b> · <b>${dir}</b>`,
    `Confidence: <b>${confidence.percent}%</b> (${esc(confidence.label)}) · ${confidence.passed}/${confidence.total} confluences · gates ${confidence.gatesPassed}/${confidence.gatesTotal}`,
    '',
    `Entry: <b>${esc(setup.entryType)}</b> @ <b>${px(setup.entry)}</b>${setup.entryNote ? ` <i>(${esc(setup.entryNote)})</i>` : ''}`,
    `SL: ${px(setup.sl)} (${setup.riskPct.toFixed(2)}%)`,
    `TP1: ${px(setup.tp1)} (RR ${setup.rr.toFixed(2)})`,
    `TP2: ${px(setup.tp2)}`,
  ];
  if (sizing && sizing.lots > 0) {
    lines.push(
      `Risk: <b>${usd(sizing.riskAmount)}</b> (${sizing.riskPerTradePct.toFixed(2)}% of ${usd(sizing.accountBalance)})`,
      `Lot size: <b>${sizing.lots}</b> lots · ${qty(sizing.units)} units · ~${usd(sizing.notional)} notional`,
      `Contract size: ${sizing.contractSize} (verify with FundingPips specs)`,
    );
    if (sizing.adjusted) {
      lines.push('Note: min lot raised risk slightly to keep the order valid.');
    }
    lines.push(
      'Management: 50% off at TP1, SL to breakeven, trail the rest to TP2.',
    );
  }
  lines.push('', `<b>Confluences (${confidence.passed}/${confidence.total})</b>`);
  for (const item of passing) {
    lines.push(`- ${esc(item.name)}: ${esc(item.detail)}`);
  }
  if (missed.length) {
    lines.push(`- Missed: ${esc(missed.map((item) => item.name).join(', '))}`);
  }
  lines.push(
    '',
    `HTF: ${esc(result.htf.dir)} (4h ${esc(result.htf.trend4h)} / 1h ${esc(result.htf.trend1h)})`,
    `Structure: ${esc(result.structure.trend)}${result.structure.event ? ` · ${esc(result.structure.event.type)} ${esc(result.structure.event.dir)}` : ''}`,
    `S/R: support ${px(result.sr?.support)} · resistance ${px(result.sr?.resistance)}`,
    `Breakout: ${esc(result.breakout?.detail ?? 'n/a')}`,
    `ADX: ${result.adx.value.toFixed(1)} (${result.adx.slope >= 0 ? 'rising' : 'falling'})`,
    `Funding: ${(result.funding.rate * 100).toFixed(4)}% · OI ${sign(result.funding.oiChange * 100, 1)}%`,
    `Time: ${new Date(result.updatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    '',
    'Reply to the result prompt after the trade closes.',
    'Not financial advice.',
  );
  return lines.join('\n');
}

function symbolBlock(result) {
  if (result.error) {
    return `<b>${esc(result.symbol)}</b>\n  error: ${esc(result.error)}`;
  }
  const dir = result.side === 'long' ? 'LONG' : 'SHORT';
  const tag = result.aPlus ? ' · <b>A++</b>' : '';
  const gates = Object.entries(result.gates);
  const passed = gates.filter(([, ok]) => ok).length;
  const failed = gates.filter(([, ok]) => !ok).map(([key]) => gateLabels[key] ?? key);
  const confidence = result.confidence;
  const missedNames = result.confluences
    .filter((item) => !item.pass)
    .map((item) => item.name)
    .slice(0, 4)
    .join(', ');
  const setup = result.setup;
  const lines = [
    `<b>${esc(result.symbol)}</b>  ${dir} · score ${result.score}/100 · confidence ${confidence.percent}% (${esc(confidence.label)})${tag}`,
    `Price: ${px(result.price)} (${sign(result.change24h)}%) · ATR ${(result.atrPct * 100).toFixed(2)}% · ADX ${result.adx.value.toFixed(1)} ${result.adx.slope >= 0 ? 'up' : 'down'}`,
    `HTF: ${esc(result.htf.dir)} (4h ${esc(result.htf.trend4h)} / 1h ${esc(result.htf.trend1h)}) · structure: ${esc(result.structure.trend)}`,
    `S/R: ${px(result.sr?.support)} / ${px(result.sr?.resistance)} · breakout: ${esc(result.breakout?.detail ?? 'n/a')}`,
    `Sweep: ${result.side === 'long' ? (result.sweep.bull ? 'sell-side liquidity swept' : 'none') : result.sweep.bear ? 'buy-side liquidity swept' : 'none'} · ${result.premiumDiscount.pos <= 0.5 ? 'discount' : 'premium'} ${(result.premiumDiscount.pos * 100).toFixed(0)}%`,
    `Delta: ${sign(result.orderflow.recentDelta, 1)} · CVD slope ${sign(result.orderflow.cvdSlope, 1)}${result.orderflow.divergence ? ` · ${esc(result.orderflow.divergence)} divergence` : ''}`,
    `Gates: ${passed}/${gates.length}${failed.length ? ` · missing: ${esc(failed.join(', '))}` : ' · all passed'} · ${confidence.passed}/${confidence.total} confluences${missedNames ? ` · missed: ${esc(missedNames)}` : ''}`,
  ];
  if (result.aPlus || result.score >= 70) {
    lines.push(
      `Entry: ${esc(setup.entryType)} @ ${px(setup.entry)}${setup.entryNote ? ` (${esc(setup.entryNote)})` : ''} · SL ${px(setup.sl)} (${setup.riskPct.toFixed(2)}%)`,
      `TP1: ${px(setup.tp1)} (RR ${setup.rr.toFixed(2)}) · TP2: ${px(setup.tp2)}`,
    );
  }
  if (result.aPlus && result.sizing && result.sizing.lots > 0) {
    lines.push(
      `Size: ${result.sizing.lots} lots (${qty(result.sizing.units)} units) · risk ${usd(result.sizing.riskAmount)} (${result.sizing.riskPerTradePct.toFixed(2)}%) · ~${usd(result.sizing.notional)} notional`,
    );
  }
  return lines.join('\n');
}

export function formatScanReport(results, meta = {}) {
  const header = [
    '<b>KRONOS APEX — manual scan</b>',
    `${results.length} symbol${results.length === 1 ? '' : 's'} · threshold ${meta.threshold ?? 85}/100`,
    `Time: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    '',
  ].join('\n');
  return `${header}${results.map(symbolBlock).join('\n\n')}`;
}

export function formatStatus(context) {
  const {
    runtime,
    lastScanAt,
    symbols,
    dryRun,
    recentSignals,
    propMode,
    riskPerTradePct,
    dailyCount,
    maxTradesPerDay,
    account,
    journal,
    openTrades,
    riskUsd,
    maxOpenTrades,
  } = context;
  const acct = account ?? {
    equity: 0,
    startingBalance: 0,
    totalPnl: 0,
    dailyPnl: 0,
    totalRemaining: 0,
    dailyRemaining: 0,
    totalLossLimit: 0,
    dailyLossLimit: 0,
    totalStopUsd: 0,
    dailyStopUsd: 0,
    allowed: true,
  };
  const stats = journal ?? {};
  const lines = [
    '<b>KRONOS APEX — status</b>',
    `Symbols: ${esc(symbols.join(', '))}`,
    `Balance: <b>${usd(acct.equity)}</b> · today ${usd(acct.dailyPnl)} · total ${usd(acct.totalPnl)}`,
    `Limits: daily ${usd(acct.dailyLossLimit)} (buffer ${usd(acct.dailyRemaining)}) · total ${usd(acct.totalLossLimit)} (buffer ${usd(acct.totalRemaining)})`,
    `Safety stops: daily ${usd(acct.dailyStopUsd)} · total ${usd(acct.totalStopUsd)} · ${acct.allowed ? 'trading allowed' : '<b>TRADING PAUSED</b>'}`,
    `Risk/trade: ${riskPerTradePct}% (~${usd(riskUsd)}) · max ${maxOpenTrades} open · ${dailyCount ?? 0}/${maxTradesPerDay ?? 'n/a'} today`,
    `Prop mode: <b>${propMode ? 'on' : 'off'}</b> · auto alerts: <b>${runtime.live ? 'on' : 'off'}</b>`,
    `Threshold: ${runtime.threshold}/100 · interval ${Math.round(runtime.intervalMs / 1000)}s · cooldown ${Math.round(runtime.cooldownMs / 60000)}min`,
    `Last scan: ${lastScanAt ? new Date(lastScanAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'never'} · mode: ${dryRun ? 'dry-run' : 'live'}`,
    '',
    `<b>Journal</b>: ${stats.closed ?? 0} closed · ${stats.wins ?? 0}W/${stats.losses ?? 0}L/${stats.be ?? 0}BE · win rate ${(stats.winRate ?? 0).toFixed(1)}%`,
  ];
  if (openTrades && openTrades.length) {
    lines.push('', '<b>Open trade</b>');
    for (const trade of openTrades) {
      lines.push(
        `#${trade.id} ${esc(trade.symbol)} ${trade.side.toUpperCase()} @ ${px(trade.entry)} · SL ${px(trade.sl)} · ${trade.lots} lots · risk ${usd(trade.riskUsd)}`,
      );
    }
  }
  lines.push('', '<b>Recent A++ signals</b>');
  if (!recentSignals.length) {
    lines.push('none yet');
  } else {
    for (const item of recentSignals.slice(-8).reverse()) {
      lines.push(
        `${esc(item.symbol)} ${item.side.toUpperCase()} ${item.score}/100 @ ${px(item.entry)} · ${new Date(item.ts).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      );
    }
  }
  return lines.join('\n');
}

export function formatFeedbackPrompt(trade, account) {
  return [
    '<b>Trade result needed</b>',
    `#${trade.id} ${esc(trade.symbol)} ${trade.side.toUpperCase()} ${esc(trade.entryType)} @ ${px(trade.entry)}`,
    `SL ${px(trade.sl)} · TP1 ${px(trade.tp1)} · TP2 ${px(trade.tp2)}`,
    `${trade.lots} lots · risk ${usd(trade.riskUsd)} · balance ${usd(account.equity)}`,
    '',
    'Did this trade hit TP or SL?',
  ].join('\n');
}

export function formatTradeResult(result) {
  if (result.error) {
    return `<b>Trade update</b>\n${esc(result.error)}`;
  }
  const { trade, pnlUsd, label, account, stillOpen } = result;
  if (stillOpen) {
    return `#${trade.id} ${esc(trade.symbol)} marked still open. I will ask again later.`;
  }
  return [
    '<b>Trade closed</b>',
    `#${trade.id} ${esc(trade.symbol)} ${trade.side.toUpperCase()} · ${esc(label)}`,
    `P&L: <b>${usd(pnlUsd)}</b>`,
    `Balance: <b>${usd(account.equity)}</b> · today ${usd(account.dailyPnl)} · total ${usd(account.totalPnl)}`,
    `Buffers: daily ${usd(account.dailyRemaining)} · total ${usd(account.totalRemaining)}`,
    account.allowed
      ? 'Trading still allowed. The next A++ setup will include a fresh lot size.'
      : '<b>Trading paused by the safety guard. No new trades will be sent.</b>',
  ].join('\n');
}

export function formatJournal(stats) {
  const account = stats.account;
  return [
    '<b>KRONOS APEX — journal</b>',
    `Trades: ${stats.total} total · ${stats.open} open · ${stats.closed} closed`,
    `Results: ${stats.wins}W / ${stats.losses}L / ${stats.be}BE / ${stats.cancelled} cancelled`,
    `Win rate: ${stats.winRate.toFixed(1)}% (excludes BE/cancelled)`,
    `Total P&L: <b>${usd(stats.totalPnl)}</b> · today ${usd(stats.dailyPnl)}`,
    `Balance: ${usd(account.equity)} (start ${usd(account.startingBalance)})`,
    `Limits: daily buffer ${usd(account.dailyRemaining)}/${usd(account.dailyLossLimit)} · total buffer ${usd(account.totalRemaining)}/${usd(account.totalLossLimit)}`,
    account.allowed ? 'Status: trading allowed' : 'Status: <b>TRADING PAUSED</b>',
  ].join('\n');
}

export function formatOpenTrades(trades, account) {
  if (!trades.length) return 'No open trades.';
  const lines = ['<b>Open trades</b>'];
  for (const trade of trades) {
    lines.push(
      `#${trade.id} ${esc(trade.symbol)} ${trade.side.toUpperCase()} @ ${px(trade.entry)} · SL ${px(trade.sl)} · ${trade.lots} lots · risk ${usd(trade.riskUsd)}`,
    );
  }
  lines.push('', `Balance ${usd(account.equity)} · use the buttons or /result &lt;id&gt; &lt;tp1|tp2|sl|be&gt;.`);
  return lines.join('\n');
}

export function formatSignals(recentSignals) {
  const lines = ['<b>KRONOS APEX — recent A++ signals</b>'];
  if (!recentSignals.length) {
    lines.push('none yet');
    return lines.join('\n');
  }
  for (const item of recentSignals.slice(-15).reverse()) {
    lines.push(
      `${esc(item.symbol)} ${item.side.toUpperCase()} ${item.score}/100 @ ${px(item.entry)} · ${new Date(item.ts).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    );
  }
  return lines.join('\n');
}

export function formatHelp(symbols) {
  return [
    '<b>KRONOS APEX</b>',
    'SMC + ICT + orderflow scanner with A++ Telegram alerts.',
    '',
    `<b>Any text message</b> triggers a manual scan of all assets (${esc(symbols.join(', '))}).`,
    'Mention a coin to scan only that one, e.g. <code>btc</code> or <code>scan sol</code>.',
    '',
    'Commands:',
    '/scan [symbol] — scan all or one asset',
    '/status — settings, last scan, recent signals',
    '/signals — recent A++ alerts',
    '/live on|off — toggle automatic alerts',
    '/prop on|off — strict prop-account filters',
    '/balance 5000 — starting account size for sizing',
    '/risk 0.2 — risk percent per trade (max 1%)',
    '/maxday 2 — max alerts per day in prop mode',
    '/open — show open trades and result buttons',
    '/result 12 tp1 — record a trade result (tp1, tp2, sl, be)',
    '/journal — win rate, P&L, balance and loss buffers',
    '/threshold 88 — minimum A++ score',
    '/interval 2 — auto-scan every N minutes',
    '/cooldown 240 — minutes between repeats per symbol/side',
    '/symbols — list scanned assets',
    '/id — show this chat id',
    '/help — this message',
    '',
    'Automatic A++ alerts run server-side even while the bot is idle.',
    'Not financial advice.',
  ].join('\n');
}
