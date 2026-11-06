import { config } from '../src/env.js';
import { sendMessage } from '../src/telegram.js';

if (!config.token || !config.chatId) {
  console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
  process.exit(1);
}

await sendMessage(
  '<b>KRONOS APEX test</b>\nTelegram connection is working.\nSend any message to this bot to scan.',
);
console.log(config.dryRun ? 'dry-run: message logged, not sent' : 'test message sent');
