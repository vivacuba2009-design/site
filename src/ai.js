/* Synaps — один ИИ-слой для сайта и Telegram-бота.
   Модель только формулирует: факты из tours.json, все числа проверяются по базе.
   Ключ — только из env.SYNAPS_DEEPSEEK_KEY (секрет воркера). */

const MODEL = 'deepseek-flash';
const MAX_ANSWER = 700;

export async function aiAnswer(env, question, tours) {
  if (!env.SYNAPS_DEEPSEEK_KEY) return { ok: false, reason: 'no_key' };
  const list = Array.isArray(tours) ? tours : [];
  if (!list.length) return { ok: false, reason: 'no_data' };

  const q = String(question || '').trim().slice(0, 400);
  if (q.length < 2) return { ok: false, reason: 'empty' };

  const digits = allowedNumbers(list);
  const qNums = new Set((q.match(/\d+/g) || []).map(x => String(parseInt(x, 10))));
  const prompt = buildPrompt(list);

  let parsed = null;
  let usage = null;
  try {
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const out = await askModel(env, prompt, q, attempt === 1);
      usage = out.usage || usage;
      parsed = extractJson(out.content);
    }
    if (!parsed) {
      // последняя попытка: простой текстовый протокол вместо JSON
      const out = await askModel(env, prompt, q, 'plain');
      usage = out.usage || usage;
      const plain = String(out.content || '').trim();
      const asJson = extractJson(plain);
      if (asJson) parsed = asJson;
      else if (plain && /^нет\.?$/i.test(plain)) parsed = { found: false, reply: '' };
      else if (plain) parsed = { found: true, reply: plain };
    }
  } catch (e) {
    return { ok: false, reason: 'upstream' };
  }
  if (!parsed) return { ok: false, reason: 'bad_model_json', usage: usage };

  const reply = String(parsed.reply || '').trim().slice(0, MAX_ANSWER);
  const found = parsed.found === true && reply.length > 0;
  if (!found) return { ok: true, found: false, reply: '', reason: 'model_not_found', usage: usage };
  if (!numbersOk(reply, digits, qNums)) return { ok: true, found: false, reply: '', reason: 'numbers', usage: usage };

  return { ok: true, found: true, reply: reply, usage: usage };
}

/* ---------- проверка чисел ---------- */

function allowedNumbers(tours) {
  const set = new Set();
  const add = (v) => {
    (String(v).match(/\d+/g) || []).forEach(x => set.add(String(parseInt(x, 10))));
  };
  tours.forEach(t => {
    add(t.price);
    add(t.duration_days);
    (t.dates || []).forEach(add);
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

/* ---------- промпт ---------- */

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

/* ---------- вызов модели ---------- */

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
