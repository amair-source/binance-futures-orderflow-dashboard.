# Kronos Apex

Kronos Apex is a Telegram-only crypto futures signal bot for Binance USDT-M perpetuals. It combines Smart Money Concepts (SMC), ICT, and orderflow into a 100-point confluence model, sends only A++ setups, and applies FundingPips-style risk guards.

> **Signals only.** This project does not connect to MT5, place orders, or manage a broker account.

## Live

- **Telegram bot:** https://t.me/Opencodenoobbot
- **Health endpoint:** https://kronos-apex.onrender.com/health
- **Repository:** https://github.com/amair-source/binance-futures-orderflow-dashboard.

## Highlights

- Scans `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `UNIUSDT`, and `XAUTUSDT`.
- 20 weighted confluences across HTF bias, market structure, POI, liquidity, orderflow, volume profile, funding/OI, and risk.
- 10 hard gates must all pass before an A++ alert is sent.
- Configurable A++ score threshold; the deployed default is `88/100`.
- London/NY killzone filtering: `07:00-10:00` and `12:00-15:00` UTC.
- FundingPips-style risk model with daily and total hard stops.
- Trade journal with inline Telegram result buttons.
- Optional Upstash Redis persistence for Render/ephemeral hosts.
- Health endpoint for Render and external uptime monitors.

## How it works

1. Fetch 5m, 15m, 1h, and 4h klines, order book depth, funding, and open-interest history from Binance.
2. Analyze HTF bias, BOS/CHoCH, order blocks, FVGs, liquidity sweeps, premium/discount, CVD/delta, book imbalance, volume profile, funding/OI, and support/resistance.
3. Score 20 weighted confluences and require all 10 gates plus the score threshold.
4. Build entry, stop, TP1/TP2, and risk/reward against the nearest liquidity target.
5. Size the position from account equity, risk percent, and remaining loss buffers.
6. Send the alert to Telegram and persist the trade for journaling.
7. Use the inline buttons to record `tp1`, `tp2`, `sl`, `be`, or `cancel`.

## Confluence model

| Confluence | Weight |
| --- | ---: |
| HTF bias (4h/1h) | 10 |
| BOS / CHoCH | 7 |
| Breakout / PDH-PDL | 4 |
| Liquidity sweep | 8 |
| Fakeout rejection | 4 |
| Order block | 5 |
| Supply / demand zone | 4 |
| FVG / imbalance | 5 |
| Support / resistance | 5 |
| Trendline | 4 |
| Premium / discount | 4 |
| OTE zone | 3 |
| Killzone | 3 |
| CVD / delta | 8 |
| Book imbalance / walls | 5 |
| Bid / ask skew | 4 |
| Volume profile | 4 |
| Funding / OI | 3 |
| Risk / reward | 6 |
| Spread / volatility | 4 |
| **Total** | **100** |

### A++ gates

All of these must pass:

`htf`, `structure`, `poi`, `orderflow`, `rr`, `spread`, `regime`, `session`, `sweep`, `liquidityTarget`

An A++ signal requires **all gates** and **score >= threshold**.

## Risk model

| Guard | Value |
| --- | ---: |
| Starting balance | $5,000 |
| Risk per trade | 0.2% of equity |
| Max risk per trade | $25 |
| Max trades per day | 2 in prop mode |
| Max open trades | 1 |
| Daily hard stop | -$150 |
| Total hard stop | -$350 |

Per-trade risk is capped at 50% of the remaining daily/total stop buffer. No new alerts are sent when a hard stop is hit.

Contract sizes default to `1` for every symbol. Verify the exact contract specifications for your broker before relying on lot sizes.

## Telegram commands

| Command | Action |
| --- | --- |
| `/scan [symbol]` | Scan all assets or one symbol |
| `/status` | Settings, account, last scan, recent signals |
| `/signals` | Recent A++ alerts |
| `/open` | Open trades with result buttons |
| `/journal` | Win rate, P&L, balance, and loss buffers |
| `/result <id> <tp1\|tp2\|sl\|be\|cancel\|open>` | Record a trade result |
| `/live on\|off` | Toggle automatic alerts |
| `/prop on\|off` | Toggle strict prop-account filters |
| `/balance <usd>` | Set starting balance for sizing |
| `/risk <pct>` | Set risk percent per trade |
| `/maxday <n>` | Set max trades per day in prop mode |
| `/threshold <n>` | Set minimum A++ score |
| `/interval <min>` | Set auto-scan interval |
| `/cooldown <min>` | Set repeat-signal cooldown |
| `/symbols` | List scanned symbols |
| `/id` | Show the current chat ID |
| `/help` | Show help |

Any non-command text message triggers a manual scan. Mentioning a coin, such as `btc` or `scan sol`, scans only that symbol.

## Quick start

```bash
git clone https://github.com/amair-source/binance-futures-orderflow-dashboard..git
cd binance-futures-orderflow-dashboard.
cp .env.example .env
# Edit .env and set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
npm install
npm start
```

Requirements: Node.js 22+.

Useful scripts:

```bash
node scripts/test-telegram.js
node scripts/scan-once.js BTCUSDT
```

Health check:

```bash
curl http://localhost:3000/health
```

## Configuration

Copy `.env.example` to `.env` and fill in the required values. The most important variables are:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Authorized chat ID; use `/id` to find it |
| `SYMBOLS` | Comma-separated Binance futures symbols |
| `SCAN_INTERVAL_MS` | Automatic scan interval in milliseconds |
| `A_PLUS_THRESHOLD` | Minimum A++ score |
| `SIGNAL_COOLDOWN_MS` | Cooldown between repeated signals |
| `PROP_MODE` | Enable strict prop-account filters |
| `ACCOUNT_BALANCE` | Starting balance used for position sizing |
| `RISK_PER_TRADE_PCT` | Risk percent per trade |
| `MAX_RISK_USD` | Absolute per-trade risk cap |
| `MAX_TRADES_PER_DAY` | Daily alert cap in prop mode |
| `MAX_OPEN_TRADES` | Maximum simultaneous open trades |
| `DAILY_STOP_USD` / `TOTAL_STOP_USD` | Hard stop thresholds |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional remote state persistence |
| `STATE_KEY` | Upstash state key |

See `.env.example` and `render.yaml` for the full list of filters and defaults.

## Deploy on Render

The repository includes `render.yaml` for a free Render web service in Singapore.

One-click Blueprint:

https://render.com/deploy?repo=https://github.com/amair-source/binance-futures-orderflow-dashboard.

Set these secrets in Render:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (optional, recommended)

Render free web services sleep after 15 minutes without inbound traffic. The included GitHub Actions workflow pings `/health` every 10 minutes as a best-effort keep-alive. For reliable 24/7 operation, use an external uptime monitor or a VPS.

Without Upstash, `state.json` is local to the running instance and is lost on restart or redeploy. Configure Upstash if the trade journal needs to survive restarts.

## Project structure

```text
bot.js                 Entry point: state hydration, health server, scheduler, Telegram polling
src/
  binance.js           Binance REST data fetching
  confluence.js        SMC/ICT/orderflow analysis and scoring
  env.js               Environment loading and configuration
  format.js            Telegram message formatting
  health.js            /health endpoint
  indicators.js        EMA, ATR, ADX, CVD, VWAP, pivots, volume profile
  scanner.js           Risk guards, sizing, journal, scheduler, trade results
  state.js             Local state and optional Upstash persistence
  telegram.js          Telegram API client
scripts/
  scan-once.js         One-off scan for a symbol
  test-telegram.js     Telegram connectivity test
.github/workflows/
  keepalive.yml        Render keep-alive ping
render.yaml            Render Blueprint
```

## Disclaimer

This software is for research and educational use. It is not financial advice. Crypto futures trading involves substantial risk, and past performance does not guarantee future results. You are responsible for verifying broker rules, contract specifications, and risk limits. No signal is guaranteed to be profitable.

## License

No license is specified for this repository.
