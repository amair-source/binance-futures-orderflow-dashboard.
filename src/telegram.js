import { config } from './env.js';

const baseUrl = `https://api.telegram.org/bot${config.token}`;

export function telegramConfigured() {
  return Boolean(config.token && config.chatId);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, payload, timeoutMs = 20000, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => null);
      if (!data || !data.ok) {
        const detail = data ? `${data.error_code} ${data.description}` : `${response.status}`;
        const error = new Error(`telegram ${method} failed: ${detail}`);
        error.retryable =
          !data || data.error_code === 429 || data.error_code >= 500;
        error.retryAfterMs = data?.parameters?.retry_after
          ? data.parameters.retry_after * 1000
          : null;
        throw error;
      }
      return data.result;
    } catch (error) {
      lastError = error;
      if (error.retryable === false) break;
      if (attempt < attempts - 1) {
        await sleep(error.retryAfterMs ?? 1000 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function chunkText(text, max = 3800) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > max && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sendMessage(text, options = {}) {
  const targets = String(options.chatId ?? config.chatId)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const parseMode = options.parseMode ?? 'HTML';
  const results = [];
  for (const chatId of targets) {
    for (const part of chunkText(text)) {
      if (config.dryRun) {
        console.log('[dry-run telegram]', part.replace(/<[^>]+>/g, '').slice(0, 400));
        results.push({ dryRun: true });
        continue;
      }
      const payload = {
        chat_id: chatId,
        text: part,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      };
      if (options.replyMarkup) payload.reply_markup = options.replyMarkup;
      results.push(await call('sendMessage', payload));
    }
  }
  return results;
}

export async function sendChatAction(chatId, action = 'typing') {
  if (config.dryRun) return;
  try {
    await call('sendChatAction', { chat_id: chatId, action });
  } catch {
    return;
  }
}

export async function getMe() {
  return call('getMe', {});
}

export async function getUpdates(offset, timeoutSeconds = 30) {
  return call(
    'getUpdates',
    {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    },
    (timeoutSeconds + 15) * 1000,
  );
}

export async function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  return call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export async function deleteWebhook() {
  try {
    return await call('deleteWebhook', { drop_pending_updates: true });
  } catch {
    return null;
  }
}
