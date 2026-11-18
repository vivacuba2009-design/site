/* Synaps — визовое демо: диалог + карточка заявки. Ничего не отправляет и не сохраняет. */
(function () {
  'use strict';

  var el = {
    chat: document.getElementById('chat'),
    chips: document.getElementById('chips'),
    form: document.getElementById('composer'),
    input: document.getElementById('composer-input'),
    error: document.getElementById('composer-error'),
    tgBody: document.getElementById('tg-body'),
    tgEmpty: document.getElementById('tg-empty'),
    tgNote: document.getElementById('tg-note')
  };
  if (!el.chat) return;

  var data = null;
  var state = { country: null, visa: null, trip: '', name: '', phoneDigits: '', phase: 'chat', offerTypes: [] };

  el.input.disabled = true;
  el.input.placeholder = 'Загружаю данные демо…';

  /* ---------------- утилиты ---------------- */

  function addMsg(text, kind) {
    if (!text) return null;
    var div = document.createElement('div');
    div.className = 'msg ' + (kind || 'bot');
    div.textContent = text;
    el.chat.appendChild(div);
    el.chat.scrollTop = el.chat.scrollHeight;
    return div;
  }
  function addSys(text) { return addMsg(text, 'sys'); }
  function userSays(text) { addMsg(text, 'me'); el.chips.innerHTML = ''; }

  function renderChips(items) {
    el.chips.innerHTML = '';
    (items || []).forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (it.accent ? ' accent' : '');
      b.textContent = it.label;
      b.addEventListener('click', function () { onChip(it); });
      el.chips.appendChild(b);
    });
  }

  function plural(n, one, few, many) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function shortName(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }

  /* ---------------- чипсы и сценарий ---------------- */

  function onChip(it) {
    if (it.act === 'country') chooseCountry(it.value);
    else if (it.act === 'visa') chooseVisa(it.value);
    else if (it.act === 'ask') { userSays(it.text); ask(it.text); }
    else if (it.act === 'lead') startLead();
    else if (it.act === 'trip') setTrip(it.value);
    else if (it.act === 'restart') reset();
  }

  function countriesChips() {
    return (data.countries || []).map(function (c) {
      return { label: c.name, act: 'country', value: c.name };
    });
  }

  function typesChipsFor(country, limit) {
    var types = (country.visas || []).map(function (v) { return v.name; });
    state.offerTypes = types;
    var items = types.slice(0, limit || 6).map(function (n) {
      return { label: shortName(n, 28), act: 'visa', value: n };
    });
    if (types.length > (limit || 6)) {
      items.push({ label: 'Все типы виз', act: 'ask', text: 'какие визы в ' + country.name });
    }
    items.push({ label: 'Оставить заявку', act: 'lead', accent: true });
    return items;
  }

  function visaActionChips() {
    var items = [
      { label: 'Сборы', act: 'ask', text: 'сколько стоит' },
      { label: 'Документы', act: 'ask', text: 'какие документы' },
      { label: 'Сроки', act: 'ask', text: 'сколько ждать' },
      { label: 'Оставить заявку', act: 'lead', accent: true }
    ];
    return items;
  }

  function contextQuestion(text) {
    var parts = [text];
    if (state.visa) parts.push(state.visa);
    if (state.country) parts.push('в ' + state.country);
    return parts.join(' ');
  }

  function chooseCountry(name) {
    var country = findCountry(name);
    if (!country) return;
    state.country = country;
    state.visa = null;
    userSays(name);
    var res = window.VisaEngine.answer('какие визы в ' + name, data);
    addMsg(res.text, 'bot');
    renderChips(typesChipsFor(country));
  }

  function chooseVisa(name) {
    var country = state.country;
    if (!country) return;
    var visa = (country.visas || []).filter(function (v) { return v.name === name; })[0];
    if (!visa) return;
    state.visa = visa;
    userSays(name);
    var res = window.VisaEngine.answer(name + ' в ' + country.name, data);
    addMsg(res.text, 'bot');
    renderChips(visaActionChips());
  }

  function findCountry(name) {
    return (data.countries || []).filter(function (c) { return c.name === name; })[0] || null;
  }

  function ask(text) {
    var res = window.VisaEngine.answer(contextQuestion(text), data);
    addMsg(res.text, 'bot');

    // обновляем контекст, если движок распознал страну/визу
    if (res.country) {
      var c = findCountry(res.country);
      if (c) state.country = c;
    }
    if (res.country && res.visa && state.country) {
      var v = (state.country.visas || []).filter(function (x) { return x.name === res.visa; })[0];
      if (v) state.visa = v;
    }

    if (res.kind === 'notfound') { showNotFound(); return; }
    if (res.kind === 'types' || res.kind === 'country') {
      if (state.country) renderChips(typesChipsFor(state.country));
      else renderChips(countriesChips());
      return;
    }
    if (res.kind === 'countries' || res.kind === 'help') {
      renderChips(countriesChips());
      return;
    }
    renderChips(visaActionChips());
  }

  function showNotFound() {
    var box = document.createElement('div');
    box.className = 'msg bot notfound';
    var title = document.createElement('b');
    title.textContent = 'Не разобрал запрос';
    var body = document.createElement('span');
    body.textContent = 'В демо пять стран и 21 тип визы. Назовите страну и тип визы — покажу сроки, сборы и документы.';
    box.appendChild(title);
    box.appendChild(body);
    el.chat.appendChild(box);
    el.chat.scrollTop = el.chat.scrollHeight;
    renderChips([
      { label: 'Передать менеджеру', act: 'lead', accent: true },
      { label: 'Сначала страны', act: 'ask', text: 'какие страны' }
    ]);
  }

  /* ---------------- заявка ---------------- */

  function startLead() {
    if (!state.country || !state.visa) {
      state.phase = 'chat';
      addMsg('Сначала выберите страну и тип визы — тогда заявка уйдёт с параметрами, а не «перезвоните».', 'bot');
      renderChips(countriesChips());
      return;
    }
    state.phase = 'trip';
    state.trip = '';
    state.name = '';
    state.phoneDigits = '';
    addMsg('Оформляю заявку: ' + state.country.name + ' · ' + state.visa.name + '.', 'bot');
    addMsg('Когда планируете поездку?', 'bot');
    renderChips([
      { label: 'В ближайший месяц', act: 'trip', value: 'в ближайший месяц' },
      { label: 'Через 2–3 месяца', act: 'trip', value: 'через 2–3 месяца' },
      { label: 'Пока не знаю', act: 'trip', value: 'пока не знаю' }
    ]);
    focusInput();
  }

  function setTrip(value) {
    state.trip = value;
    state.phase = 'name';
    userSays(value);
    addMsg('Как вас зовут?', 'bot');
    renderChips([]);
    focusInput();
  }

  function setName(value) {
    state.name = value;
    state.phase = 'phone';
    addMsg('Телефон для связи? Это демо: номер никуда не уходит и не сохраняется — показываю только маску.', 'bot');
    renderChips([]);
    el.input.value = '';
    el.input.placeholder = '+375 (29) 123-45-67';
    el.input.inputMode = 'tel';
    focusInput();
  }

  function formatPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.indexOf('375') === 0) d = d.slice(3);
    d = d.slice(0, 9);
    state.phoneDigits = d;
    if (!d) return '';
    var out = '+375 (' + d.slice(0, 2);
    if (d.length > 2) out += ') ' + d.slice(2, 5);
    if (d.length > 5) out += '-' + d.slice(5, 7);
    if (d.length > 7) out += '-' + d.slice(7, 9);
    return out;
  }

  function finishLead() {
    state.phase = 'done';
    addSys('Заявка сформирована. Демо: никуда не отправлена, телефон не сохранялся.');
    addMsg('Готово, ' + state.name + '. Справа — карточка, которую получит менеджер. В рабочем боте она придёт в Telegram или CRM визового отдела.', 'bot');
    renderChips([{ label: 'Пройти ещё раз', act: 'restart' }]);
    showCard();
  }

  function nowTime() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function showCard() {
    var c = state.country, v = state.visa;
    if (!c || !v) return;
    var f = v.fees || {};

    if (el.tgEmpty) el.tgEmpty.hidden = true;
    el.tgBody.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'tg-card';

    var title = document.createElement('div');
    title.className = 'tg-card-title';
    title.textContent = 'Новая заявка на визу';
    var time = document.createElement('small');
    time.textContent = ' · ' + nowTime();
    title.appendChild(time);
    card.appendChild(title);

    function row(label, value) {
      var r = document.createElement('div');
      r.className = 'row';
      var s = document.createElement('span');
      s.textContent = label;
      var b = document.createElement('b');
      b.textContent = value || '—';
      r.appendChild(s); r.appendChild(b);
      card.appendChild(r);
    }

    row('Страна', c.name);
    row('Виза', v.name);
    row('Поездка', state.trip || '—');
    row('Срок', c.processing_time || '—');
    if (f.consular) row('Консульский сбор', f.consular);
    if (f.service_center) row('Сервисный сбор', f.service_center);
    if (f.our_services) row('Услуги', f.our_services);
    row('Имя', state.name || '—');
    row('Телефон', '+375 (' + state.phoneDigits.slice(0, 2) + ') •••-••-••');
    row('Источник', 'сайт · демо');

    var to = document.createElement('div');
    to.className = 'to';
    to.textContent = '→ менеджер визового отдела';
    card.appendChild(to);

    el.tgBody.appendChild(card);
    el.tgNote.className = 'tg-note';
    el.tgNote.textContent = 'Макет: заявка осталась на странице. В рабочем боте уходит менеджеру с этими же параметрами.';
    el.tgBody.scrollTop = el.tgBody.scrollHeight;
  }

  function reset() {
    el.chat.innerHTML = '';
    el.chips.innerHTML = '';
    el.tgBody.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = 'tg-empty';
    empty.id = 'tg-empty';
    empty.textContent = 'Пройдите сценарий слева — здесь появится карточка заявки такой, какой её получит менеджер.';
    el.tgBody.appendChild(empty);
    el.tgEmpty = empty;
    el.tgNote.className = 'tg-note';
    el.tgNote.textContent = 'Макет: кнопки работают только внутри страницы. В рабочем боте заявка приходит менеджеру в Telegram или CRM.';
    state = { country: null, visa: null, trip: '', name: '', phoneDigits: '', phase: 'chat', offerTypes: [] };
    el.input.value = '';
    el.input.placeholder = 'Например: рабочая виза в Польшу…';
    el.input.inputMode = 'text';
    el.error.textContent = '';
    el.input.classList.remove('err');
    start();
  }

  /* ---------------- ввод ---------------- */

  function focusInput() {
    try { el.input.focus({ preventScroll: true }); } catch (e) { el.input.focus(); }
  }

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    el.error.textContent = '';
    el.input.classList.remove('err');
    if (!data) { addSys('Данные демо ещё загружаются — секунду.'); return; }
    var text = el.input.value.trim();
    if (!text) return;

    if (state.phase === 'name') {
      if (text.length < 2) {
        el.error.textContent = 'Имя нужно, чтобы менеджер знал, как к вам обращаться. Хотя бы 2 буквы.';
        el.input.classList.add('err');
        return;
      }
      userSays(text);
      el.input.value = '';
      setName(text);
      return;
    }

    if (state.phase === 'phone') {
      var digits = text.replace(/\D/g, '');
      if (digits.indexOf('375') === 0) digits = digits.slice(3);
      if (digits.length < 9) {
        el.error.textContent = 'В номере не хватает цифр. Формат: +375 (29) 123-45-67.';
        el.input.classList.add('err');
        return;
      }
      userSays(formatPhone(text));
      el.input.value = '';
      el.input.inputMode = 'text';
      el.input.placeholder = 'Например: рабочая виза в Польшу…';
      finishLead();
      return;
    }

    userSays(text);
    el.input.value = '';
    ask(text);
  });

  el.input.addEventListener('input', function () {
    if (state.phase !== 'phone') return;
    el.input.value = formatPhone(el.input.value);
  });

  /* ---------------- старт ---------------- */

  function start() {
    addMsg('Здравствуйте! Я визовый бот. Помогу со сроками, сборами и документами. Выберите страну — или спросите словами, например «рабочая виза в Польшу».', 'bot');
    addSys('Демо: данные по открытым страницам на 18.11.2026, заявки не отправляются, телефон не сохраняется.');
    renderChips(countriesChips());
  }

  fetch('visa-data.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) {
      data = d;
      el.input.disabled = false;
      el.input.placeholder = 'Например: рабочая виза в Польшу…';
      start();
    })
    .catch(function (err) {
      el.input.disabled = false;
      addSys('Не удалось загрузить данные демо — обновите страницу.');
      if (window.console) console.error(err);
    });
})();
