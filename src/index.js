/* Synaps — воркер: статика + /api/chat (переформулировка вопроса через LLM).
   Ключ живёт только в секрете воркера (env.SYNAPS_DEEPSEEK_KEY), в код не попадает.
   Правило: цифры и факты — только из tours.json; модель формулирует, но не придумывает. */

const RATE_IP_HOUR = 40;      // запросов с одного IP в час
const RATE_GLOBAL_DAY = 600;  // всего запросов в сутки (защита баланса)
const MAX_QUESTION = 400;
const MAX_ANSWER = 700;
const MODEL = 'deepseek-flash';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') return handleChat(request, env, url);
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
  const question = String((body && body.q) || '').trim().slice(0, MAX_QUESTION);
  if (question.length < 2) return json({ ok: false, reason: 'empty' }, 400);

  const tours = await loadTours(env, url);
  if (!tours.length) return json({ ok: false, reason: 'no_data' }, 503);

  const digits = allowedNumbers(tours);
  const qNums = new Set((question.match(/\d+/g) || []).map(x => String(parseInt(x, 10))));
  const prompt = buildPrompt(tours);
  let parsed = null;
  let usage = null;
  try {
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const out = await askModel(env, prompt, question, attempt === 1);
      usage = out.usage;
      parsed = extractJson(out.content);
    }
    if (!parsed) {
      // последняя попытка: простой текстовый протокол вместо JSON
      const out = await askModel(env, prompt, question, 'plain');
      usage = out.usage || usage;
      const plain = String(out.content || '').trim();
      const asJson = extractJson(plain);
      if (asJson) parsed = asJson;
      else if (plain && /^нет\.?$/i.test(plain)) parsed = { found: false, reply: '' };
      else if (plain) parsed = { found: true, reply: plain };
    }
  } catch (e) {
    return json({ ok: false, reason: 'upstream' }, 502);
  }
  if (!parsed) return json({ ok: false, reason: 'bad_model_json', usage: usage }, 502);

  const reply = String(parsed.reply || '').trim().slice(0, MAX_ANSWER);
  const found = parsed.found === true && reply.length > 0;
  if (!found) return json({ ok: true, found: false, reply: '', reason: 'model_not_found', usage: usage });
  if (!numbersOk(reply, digits, qNums)) return json({ ok: true, found: false, reply: '', reason: 'numbers', usage: usage });

  return json({ ok: true, found: true, reply: reply, usage: usage });
}

/* ---------- данные: берём тот же tours.json, что видит браузер ---------- */

async function loadTours(env, baseUrl) {
  const res = await env.ASSETS.fetch(new URL('/tours.json', baseUrl).toString());
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.filter(t => t && t.id) : [];
}

function allowedNumbers(tours) {
  const set = new Set();
  const add = (v) => {
    const n = String(v).match(/\d+/g) || [];
    n.forEach(x => set.add(String(parseInt(x, 10))));
  };
  tours.forEach(t => {
    add(t.price);
    add(t.duration_days);
    (t.dates || []).forEach(d => add(d));
  });
  return set;
}

function numbersOk(text, allowed, questionNums) {
  const nums = text.match(/\d+/g) || [];
  for (const n of nums) {
    const v = parseInt(n, 10);
    if (v < 100) continue; // дни, люди, «3 предложения» — не деньги
    if (allowed.has(String(v))) continue;
    if (questionNums && questionNums.has(String(v))) continue; // бюджет из вопроса
    return false;
  }
  return true;
}

/* ---------- промпт: компактный список туров + строгие правила ---------- */

function buildPrompt(tours) {
  const list = tours.map(t => '- ' + t.name + ' | ' + t.directionLabel + ' | ' +
    t.duration_days + ' дн | ' + t.price + ' ' + (t.currency || 'BYN') +
    ' | даты ' + (t.dates || []).join(', ') + ' | отель ' + t.hotel +
    ' | виза ' + t.visa).join('\n');

  return 'Ты — турбот турагентства «Синапс». Клиент задаёт вопрос о турах.\n' +
    'ПРАВИЛА:\n' +
    '1. Отвечай ТОЛЬКО фактами из списка ниже: названия, цены, даты, длительность, виза, что входит.\n' +
    '2. Ничего не выдумывай: никаких новых цен, дат, отелей, скидок, «примерно» и «от».\n' +
    '3. found=false только если по направлению, бюджету и датам нет ни одного подходящего тура.' +
    ' Если вопрос про детали конкретного тура (что входит, виза, доплаты, отель) — отвечай тем, что есть,' +
    ' а условия, которых в данных нет, честно называй «в данных не указано».\n' +
    '4. Ответ короткий: 1–3 предложения, по-русски, на «вы».\n' +
    '5. Если называешь тур — назови цену и дату из списка.\n' +
    '6. Даты пиши в формате ДД.ММ.ГГГГ, не ISO.\n' +
    '7. Если подходящих дат нет, но есть близкие — назови, какие даты есть.\n' +
    '8. Условий для детей, которых нет в списке, не обещай — так и скажи.\n' +
    'Верни строго JSON без пояснений: {"found": true|false, "reply": "текст"}\n\nТУРЫ:\n' + list;
}

async function askModel(env, system, question, strict) {
  const plain = strict === 'plain';
  const systemPrompt = plain
    ? system + '\n\nФОРМАТ ОТВЕТА: обычный текст, без JSON. Если ни один тур не подходит — ответь одним словом: НЕТ'
    : system;
  const payload = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ],
    max_tokens: 900,
    temperature: 0,
    response_format: { type: 'json_object' },
    reasoning_effort: 'low'
  };
  if (plain) delete payload.response_format;

  const send = async (body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      return await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.SYNAPS_DEEPSEEK_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await send(payload);
  if (res.status === 400) {
    // модель может не знать reasoning_effort — повторяем без него
    const mild = { ...payload };
    delete mild.reasoning_effort;
    res = await send(mild);
  }
  if (!res.ok) throw new Error('upstream ' + res.status);

  const data = await res.json();
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('empty');
  return { content: String(content), usage: (data && data.usage) || null };
}

/* Модель иногда оборачивает JSON в текст или в ```json — вытаскиваем объект. */
function extractJson(raw) {
  const text = String(raw).replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) { /* ниже пробуем вырезать объект */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) { /* ниже */ }
  }
  return null;
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
