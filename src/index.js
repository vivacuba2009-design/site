/* Synaps — воркер: статика + /api/chat (ИИ) + /api/telegram (бот).
   Секреты живут только в секретах воркера, в код не попадают.
   Правило: цифры и факты — только из tours.json; модель формулирует, но не придумывает. */

import { aiAnswer } from './ai.js';
import { handleTelegram } from './telegram.js';

const RATE_IP_HOUR = 40;      // запросов с одного IP в час
const RATE_GLOBAL_DAY = 600;  // всего запросов в сутки (защита баланса)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') return handleChat(request, env, url);
    if (url.pathname.indexOf('/api/telegram') === 0) return handleTelegram(request, env, url);
    return env.ASSETS.fetch(request);
  }
};

async function handleChat(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  if (!env.SYNAPS_DEEPSEEK_KEY) return json({ ok: false, reason: 'no_key' }, 503);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  const day = new Date().toISOString().slice(0, 10);

  const perIp = await bump(env, 'ip:' + ip + ':' + hour, 3600);
  if (perIp > RATE_IP_HOUR) return json({ ok: false, reason: 'rate_ip' }, 429);
  const globalDay = await bump(env, 'day:' + day, 86400);
  if (globalDay > RATE_GLOBAL_DAY) return json({ ok: false, reason: 'rate_day' }, 429);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }

  const tours = await loadTours(env, url);
  const result = await aiAnswer(env, body && body.q, tours);
  if (!result.ok) {
    const status = result.reason === 'upstream' || result.reason === 'bad_model_json' ? 502
      : result.reason === 'no_key' || result.reason === 'no_data' ? 503 : 400;
    return json(result, status);
  }
  return json(result);
}

/* ---------- данные: берём тот же tours.json, что видит браузер ---------- */

async function loadTours(env, baseUrl) {
  const res = await env.ASSETS.fetch(new URL('/tours.json', baseUrl).toString());
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.filter(t => t && t.id) : [];
}

/* ---------- лимиты без KV: счётчик в кэше (по региону, приблизительно) ---------- */

async function bump(env, key, ttl) {
  try {
    const cache = caches.default;
    const url = 'https://rate.synaps.bond/' + encodeURIComponent(key);
    const hit = await cache.match(url);
    let n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
    n += 1;
    await cache.put(url, new Response(String(n), {
      headers: { 'Cache-Control': 'max-age=' + ttl }
    }));
    return n;
  } catch (e) {
    return 0; // кэш недоступен — не блокируем демо
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
