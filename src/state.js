import fs from 'node:fs';
import path from 'node:path';

const remoteConfig = () => {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  const key = process.env.STATE_KEY || 'kronos-apex-state';
  return url && token ? { url, token, key } : null;
};

const remoteCommand = async (remote, command) => {
  const response = await fetch(remote.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${remote.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

export async function hydrateState(file) {
  const remote = remoteConfig();
  if (!remote) return false;
  try {
    const data = await remoteCommand(remote, ['GET', remote.key]);
    if (!data || typeof data.result !== 'string' || !data.result) return false;
    const parsed = JSON.parse(data.result);
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
    console.log('[state] hydrated from Upstash');
    return true;
  } catch (error) {
    console.error('[state] remote load failed:', error.message);
    return false;
  }
}

let remoteBusy = false;
let remoteQueued = null;

function mirrorRemote(state) {
  const remote = remoteConfig();
  if (!remote) return;
  if (remoteBusy) {
    remoteQueued = state;
    return;
  }
  remoteBusy = true;
  remoteCommand(remote, ['SET', remote.key, JSON.stringify(state)])
    .catch((error) => console.error('[state] remote save failed:', error.message))
    .finally(() => {
      remoteBusy = false;
      if (remoteQueued) {
        const next = remoteQueued;
        remoteQueued = null;
        mirrorRemote(next);
      }
    });
}

const defaults = {
  lastScanAt: null,
  settings: {
    threshold: null,
    intervalMs: null,
    cooldownMs: null,
    live: true,
  },
  lastSignals: {},
  recentSignals: [],
};

export function loadState(file) {
  try {
    if (!fs.existsSync(file)) return structuredClone(defaults);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...structuredClone(defaults),
      ...parsed,
      settings: { ...defaults.settings, ...(parsed.settings ?? {}) },
      lastSignals: parsed.lastSignals ?? {},
      recentSignals: Array.isArray(parsed.recentSignals) ? parsed.recentSignals : [],
    };
  } catch {
    return structuredClone(defaults);
  }
}

export function saveState(file, state) {
  try {
    const temp = path.join(path.dirname(file), `.state-${process.pid}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, file);
    mirrorRemote(state);
  } catch (error) {
    console.error('[state] save failed:', error.message);
  }
}
