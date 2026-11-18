/* Synaps — Telegram-бот на том же движке, что демо на сайте.
   Ставится вебхуком: Telegram шлёт апдейты на /api/telegram/<секретный путь>.
   Секретный путь = sha256(токен бота). Токен и чат заявок — только в секретах воркера. */

import '../public/bot-engine.js';
import { aiAnswer } from './ai.js';

const API = 'https://api.telegram.org/bot';
const MAX_TG = 3800;

export async function handleTelegram(request, env, url) {
  if (!env.SYNAPS_TELEGRAM_TOKEN) return new Response('no token', { status: 503 });

  const expected = (await sha256Hex(env.SYNAPS_TELEGRAM_TOKEN)).slice(0, 16);
  const got = url.pathname.replace(/^\/api\/telegram\/?/, '').replace(/\/$/, '');
  if (got !== expected) return new Response('forbidden', { status: 403 });

  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response('bad json', { status: 400 });
  }

  try {
    await route(update, env, url);
  } catch (e) {
    console.error('telegram handler:', e && e.message);
  }
  return new Response('ok');
}

/* ---------------- маршрутизация апдейта ---------------- */

async function route(update, env, url) {
  if (update.callback_query) return onCallback(update.callback_query, env, url);
  if (update.message && update.message.text) return onMessage(update.message, env, url);
}

async function onMessage(msg, env, url) {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const tours = await loadTours(env, url);

  if (/^\/(start|help)(@\w+)?$/i.test(text)) {
    await send(env, chatId, greeting(tours.length), mainKeyboard());
    return;
  }

  const lead = parseLead(text);
  if (lead.phone && isLeadPrompt(msg)) {
    await forwardLead(env, msg, lead, tours);
    return;
  }

  const engine = globalThis.BotEngine;
  const answer = engine
    ? engine.answer(text, tours)
    : { kind: 'notfound', text: 'База демо не загрузилась, попробуйте позже.', tours: [] };

  const ids = (answer.tours || []).slice(0, 3);
  if (answer.kind === 'notfound' && env.SYNAPS_DEEPSEEK_KEY) {
    const ai = await aiAnswer(env, text, tours);
    if (ai && ai.ok && ai.found && ai.reply) {
      await send(env, chatId, trim(ai.reply), mainKeyboard());
      return;
    }
  }
  const keyboard = answer.kind === 'notfound'
    ? managerKeyboard()
    : (ids.length ? tourKeyboard(ids, tours) : mainKeyboard());
  await send(env, chatId, trim(answer.text), keyboard);
}

function managerKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Написать менеджеру', url: 'https://t.me/Bazookie' }],
      [{ text: 'Сначала меню', callback_data: 'start' }]
    ]
  };
}

async function onCallback(cb, env, url) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const data = String(cb.data || '');
  const tours = await loadTours(env, url);
  const engine = globalThis.BotEngine;

  await api(env, 'answerCallbackQuery', { callback_query_id: cb.id });
  if (!chatId) return;

  if (data === 'start') {
    await send(env, chatId, greeting(tours.length), mainKeyboard());
    return;
  }

  if (data.indexOf('q:') === 0) {
    const question = data.slice(2);
    const answer = engine ? engine.answer(question, tours) : { text: 'База не загрузилась.', tours: [] };
    const ids = (answer.tours || []).slice(0, 3);
    await send(env, chatId, trim(answer.text), ids.length ? tourKeyboard(ids, tours) : mainKeyboard());
    return;
  }

  if (data.indexOf('t:') === 0) {
    const tour = tours.find(t => t.id === data.slice(2));
    if (!tour) return send(env, chatId, 'Тур не нашёлся — попробуйте /start', null);
    const text = engine ? engine.detail(tour) : tour.name;
    await send(env, chatId, trim(text), {
      inline_keyboard: [
        [{ text: 'Оставить заявку', callback_data: 'lead:' + tour.id }],
        [{ text: 'Другой тур', callback_data: 'start' }]
      ]
    });
    return;
  }

  if (data.indexOf('lead:') === 0) {
    const tour = tours.find(t => t.id === data.slice(5));
    const name = tour ? '«' + tour.name + '»' : 'тур';
    await send(env, chatId,
      'Оформляем заявку на ' + name + '.\nНапишите одним сообщением имя и телефон — например: Анна, +375 29 123-45-67',
      { force_reply: true, input_field_placeholder: 'Имя и телефон' });
    return;
  }
}

/* ---------------- заявка ---------------- */

function parseLead(text) {
  const digits = String(text).replace(/[^\d]/g, '');
  if (digits.length < 9) return { phone: null, name: '' };
  const name = String(text)
    .replace(/[+\d()\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, '')
    .trim();
  return { phone: '+' + digits, name: name.slice(0, 60) };
}

function isLeadPrompt(msg) {
  const replied = msg.reply_to_message && msg.reply_to_message.text;
  return !!replied && /Оформляем заявку/i.test(String(replied));
}

async function forwardLead(env, msg, lead, tours) {
  const chatId = msg.chat.id;
  const target = env.SYNAPS_TELEGRAM_CHAT_ID || chatId;
  const asked = (msg.reply_to_message && msg.reply_to_message.text) || '';
  const tour = tours.find(t => asked.indexOf('«' + t.name + '»') !== -1);
  const from = msg.from || {};
  const who = from.username ? '@' + from.username : ((from.first_name || '') + ' ' + (from.last_name || '')).trim();

  const lines = [
    '🔔 Новая заявка из бота',
    tour ? 'Тур: ' + tour.name + ' (' + tour.duration_days + ' дн, ' + tour.price + ' ' + (tour.currency || 'BYN') + ')' : 'Тур: не выбран в боте',
    'Имя: ' + (lead.name || '—'),
    'Телефон: ' + lead.phone,
    'От: ' + (who || 'без имени') + ' · chat_id ' + chatId
  ];

  await send(env, target, lines.join('\n'), null);
  await send(env, chatId, 'Спасибо! Передал менеджеру, он свяжется в течение 15 минут. Это тестовый бот — заявка ушла только владельцу бота.', mainKeyboard());
}

/* ---------------- клавиатуры и текст ---------------- */

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Авиа', callback_data: 'q:Авиа' },
        { text: 'Европа', callback_data: 'q:Европа' },
        { text: 'Автобусные', callback_data: 'q:Автобусные туры' }
      ],
      [{ text: 'Что есть на Новый год?', callback_data: 'q:Что есть на Новый год?' }],
      [{ text: 'Что умеет бот?', callback_data: 'q:Что ты умеешь?' }]
    ]
  };
}

function tourKeyboard(ids, tours) {
  const rows = ids.map(id => {
    const t = tours.find(x => x.id === id);
    if (!t) return null;
    return [{ text: shortName(t.name + ' · ' + t.price + ' BYN'), callback_data: 't:' + id }];
  }).filter(Boolean);
  rows.push([{ text: 'Оставить заявку', callback_data: 'lead:' + ids[0] }]);
  rows.push([{ text: 'Сначала меню', callback_data: 'start' }]);
  return { inline_keyboard: rows };
}

function shortName(s) {
  s = String(s);
  return s.length > 60 ? s.slice(0, 59) + '…' : s;
}

function greeting(total) {
  return 'Здравствуйте! Я турбот «Синапс». База — ' + total + ' вымышленных новогодних туров.\n' +
    'Спросите обычными словами: «сколько стоит Дубай», «что входит в Египет», «есть на 6 дней», «что на Новый год».';
}

function trim(text) {
  const s = String(text || '');
  return s.length > MAX_TG ? s.slice(0, MAX_TG - 1) + '…' : s;
}

/* ---------------- Bot API ---------------- */

async function send(env, chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text: String(text || ''), disable_web_page_preview: true };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return api(env, 'sendMessage', payload);
}

async function api(env, method, payload) {
  const res = await fetch(API + env.SYNAPS_TELEGRAM_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('bot api ' + method + ': ' + res.status + ' ' + body.slice(0, 200));
  }
  return res;
}

/* ---------------- данные и утилиты ---------------- */

async function loadTours(env, url) {
  const res = await env.ASSETS.fetch(new URL('/tours.json', url).toString());
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.filter(t => t && t.id) : [];
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
