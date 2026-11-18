/* Synaps sandbox — демо турбота: диалог, карточка заявки, мок чата менеджера.
   Всё работает в браузере: ни одна заявка не отправляется, телефон не сохраняется. */
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
    tgActions: document.getElementById('tg-actions'),
    tgTake: document.getElementById('tg-take'),
    tgForward: document.getElementById('tg-forward'),
    tgNote: document.getElementById('tg-note')
  };

  if (!el.chat) return;
  el.input.disabled = true;
  el.input.placeholder = 'Загружаю данные демо…';

  var tours = [];
  var state = {
    phase: 'chat',      // chat | people | dates | name | phone | done
    tour: null,
    people: null,
    date: null,
    name: '',
    phoneDigits: '',
    done: false
  };
  var escalateTimer = null;

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

  function formatDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function shortDate(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '.' + p[1] : String(iso || '');
  }

  function nowTime() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }

  /* ---------------- чипсы ---------------- */

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

  function onChip(it) {
    if (it.act === 'ask') { userSays(it.text); answer(it.text); }
    else if (it.act === 'tour') { startLead(findTour(it.value)); }
    else if (it.act === 'lead') { startLead(state.tour); }
    else if (it.act === 'people') { setPeople(it.value); }
    else if (it.act === 'date') { setDate(it.value); }
    else if (it.act === 'take') { takeDialog(); }
    else if (it.act === 'reset') { reset(); }
  }

  /* ---------------- диалог с движком ---------------- */

  function userSays(text) {
    addMsg(text, 'me');
    el.chips.innerHTML = '';
  }

  function findTour(id) {
    for (var i = 0; i < tours.length; i++) if (tours[i].id === id) return tours[i];
    return null;
  }

  function toursByIds(ids) {
    return (ids || []).map(findTour).filter(Boolean);
  }

  function answer(question) {
    if (!window.BotEngine) {
      addSys('Движок демо не загрузился — обновите страницу.');
      return;
    }
    var res;
    try {
      res = window.BotEngine.answer(question, tours);
    } catch (e) {
      addSys('Не смог разобрать вопрос. Попробуйте иначе.');
      return;
    }

    if (res.kind === 'notfound' && aiAvailable()) {
      askAi(question);
      return;
    }
    addMsg(res.text, 'bot');

    var found = toursByIds(res.tours);
    if (res.kind === 'notfound') {
      showNotFound();
      return;
    }
    if (found.length) {
      var items = found.slice(0, 3).map(function (t) {
        return { label: truncate(t.name, 32), act: 'tour', value: t.id };
      });
      items.push({ label: 'Оставить заявку', act: 'lead', accent: true });
      renderChips(items);
      return;
    }
    renderChips(START_CHIPS);
  }

  function aiAvailable() {
    return typeof fetch === 'function' && /^https?:$/.test(location.protocol);
  }

  function showNotFound() {
    addSys('В демо база из ' + tours.length + ' туров — на такие вопросы есть заявка менеджеру.');
    renderChips([{ label: 'Передать менеджеру', act: 'lead', accent: true }]);
  }

  /* Свободный вопрос, который движок не разобрал, — отдаём ИИ.
     ИИ только формулирует; цифры берёт из той же базы, что и движок. */
  function askAi(question) {
    renderChips([]);
    var typing = addMsg('Смотрю базу…', 'bot typing');

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: question })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        if (data && data.ok && data.found && data.reply) {
          addMsg(data.reply, 'bot');
          addSys('Ответ собран ИИ по базе демо — цифры из tours.json.');
          renderChips([
            { label: 'Оставить заявку', act: 'lead', accent: true },
            { label: 'Пройти ещё раз', act: 'reset' }
          ]);
          return;
        }
        showNotFound();
      })
      .catch(function () {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        showNotFound();
      });
  }

  var START_CHIPS = [
    { label: 'Что есть на Новый год?', act: 'ask', text: 'Что есть на Новый год?' },
    { label: 'Авиа', act: 'ask', text: 'Авиа' },
    { label: 'Европа', act: 'ask', text: 'Европа' },
    { label: 'Автобусные', act: 'ask', text: 'Автобусные туры' },
    { label: 'Сколько стоит Дубай?', act: 'ask', text: 'Сколько стоит Дубай?' },
    { label: 'Что входит в тур?', act: 'ask', text: 'Что входит в тур в Египет?' },
    { label: 'Сравнить два тура', act: 'ask', text: 'Чем отличаются туры в Барселону и Париж?' },
    { label: 'Что умеете?', act: 'ask', text: 'Что ты умеешь?' }
  ];

  /* ---------------- сценарий заявки ---------------- */

  function startLead(tour) {
    if (!tour && !state.tour) {
      state.phase = 'chat';
      addMsg('По какому направлению собираем заявку?', 'bot');
      renderChips([
        { label: 'Авиа', act: 'ask', text: 'Авиа' },
        { label: 'Европа', act: 'ask', text: 'Европа' },
        { label: 'Автобусные', act: 'ask', text: 'Автобусные туры' }
      ]);
      return;
    }
    state.phase = 'people';
    state.tour = tour || state.tour;
    state.people = null;
    state.date = null;
    state.name = '';
    state.phoneDigits = '';

    if (state.tour) {
      addMsg('Оформлю заявку на «' + state.tour.name + '» — ' + state.tour.duration_days +
        ' дней, ' + state.tour.price + ' ' + state.tour.currency + ', даты ' +
        state.tour.dates.map(shortDate).join(', ') + '.', 'bot');
    } else {
      addMsg('Хорошо, передам менеджеру. Сначала уточню параметры — так заявка не превратится в «перезвоните и выясните».', 'bot');
    }
    addMsg('Сколько человек поедет?', 'bot');
    renderChips([
      { label: '1', act: 'people', value: 1 },
      { label: '2', act: 'people', value: 2 },
      { label: '3', act: 'people', value: 3 },
      { label: '4', act: 'people', value: 4 },
      { label: '5 и больше', act: 'people', value: 5 }
    ]);
    focusInput();
  }

  function setPeople(n) {
    if (state.phase !== 'people') return;
    state.people = n;
    userSays(n + (n >= 5 ? '+' : '') + ' чел.');
    addMsg('Записал: ' + n + ' чел. Какие даты?', 'bot');
    state.phase = 'dates';
    if (state.tour && state.tour.dates && state.tour.dates.length) {
      var items = state.tour.dates.slice(0, 4).map(function (d) {
        return { label: shortDate(d), act: 'date', value: d };
      });
      items.push({ label: 'Другие даты', act: 'date', value: 'уточню у менеджера' });
      renderChips(items);
    } else {
      renderChips([{ label: 'Уточню у менеджера', act: 'date', value: 'уточню у менеджера' }]);
    }
  }

  function setDate(value) {
    if (state.phase !== 'dates') return;
    state.date = value;
    userSays(value === 'уточню у менеджера' ? 'Другие даты' : formatDate(value));
    state.phase = 'name';
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
    state.done = true;
    el.input.value = '';
    el.input.placeholder = 'Спросите про другой тур…';
    el.input.inputMode = 'text';
    addSys('Заявка сформирована. Демо: никуда не отправлена, телефон не сохранялся.');
    addMsg('Готово, ' + state.name + '. Справа — карточка, которую получит менеджер. ' +
      'В рабочем боте она придёт ему в Telegram, и он ответит в течение 15 минут.', 'bot');
    renderChips([{ label: 'Пройти ещё раз', act: 'reset' }]);
    showCard();
  }

  function showCard() {
    var t = state.tour;
    var manager = t && t.manager ? t.manager : 'менеджер направления';
    if (!t) manager = 'менеджер';

    el.tgEmpty.hidden = true;
    el.tgBody.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'tg-card';

    var title = document.createElement('div');
    title.className = 'tg-card-title';
    title.textContent = 'Новая заявка';
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

    row('Направление', t ? t.directionLabel : 'не выбрано');
    if (t) row('Тур', t.name);
    row('Даты', state.date === 'уточню у менеджера' ? 'уточнить у менеджера' : formatDate(state.date));
    row('Человек', state.people ? String(state.people) : '—');
    if (t && t.hotel) row('Отель', t.hotel);
    row('Имя', state.name || '—');
    row('Телефон', '+375 (' + state.phoneDigits.slice(0, 2) + ') •••-••-••');
    row('Источник', 'сайт · демо');

    var to = document.createElement('div');
    to.className = 'to';
    to.textContent = '→ ' + manager;
    card.appendChild(to);

    el.tgBody.appendChild(card);

    el.tgActions.hidden = false;
    el.tgTake.disabled = false;
    el.tgForward.disabled = false;
    el.tgNote.className = 'tg-note warn';
    el.tgNote.textContent = 'Отсчёт 15 секунд вместо 15 минут: не взяли диалог — заявка уходит руководителю.';

    clearTimeout(escalateTimer);
    escalateTimer = setTimeout(function () {
      if (state.phase !== 'done' || state.taken) return;
      addTgSys('15 секунд вышло — заявка передана руководителю');
      el.tgTake.disabled = true;
      el.tgForward.disabled = true;
      el.tgNote.className = 'tg-note';
      el.tgNote.textContent = 'Заявка ушла руководителю: менеджер не ответил. В рабочем боте так же, только 15 минут.';
    }, 15000);

    el.tgBody.scrollTop = el.tgBody.scrollHeight;
  }

  function addTgSys(text) {
    var d = document.createElement('div');
    d.className = 'tg-sys';
    d.textContent = text;
    el.tgBody.appendChild(d);
    el.tgBody.scrollTop = el.tgBody.scrollHeight;
  }

  function addTgAgent(text) {
    var d = document.createElement('div');
    d.className = 'tg-msg agent';
    d.textContent = text;
    el.tgBody.appendChild(d);
    el.tgBody.scrollTop = el.tgBody.scrollHeight;
  }

  function takeDialog() {
    if (state.taken) return;
    state.taken = true;
    clearTimeout(escalateTimer);
    var managerName = state.tour && state.tour.manager
      ? String(state.tour.manager).split(',')[0].trim()
      : 'менеджер';
    addTgAgent('Здравствуйте, ' + (state.name || 'друзья') + '! Это ' + managerName +
      ', продолжу с вами. По датам и отелю подскажу варианты.');
    addTgSys('Бот замолчал: диалог у менеджера');
    el.tgActions.hidden = true;
    el.tgNote.className = 'tg-note';
    el.tgNote.textContent = 'Перехват сработал: бот больше не отвечает клиенту, отвечает менеджер.';
    addSys('Демо: «взять диалог» нажато. В рабочем боте менеджер делает это из Telegram.');
  }

  function forwardToBoss() {
    clearTimeout(escalateTimer);
    addTgSys('Передано руководителю вручную');
    el.tgActions.hidden = true;
    el.tgNote.className = 'tg-note';
    el.tgNote.textContent = 'Заявка у руководителя — на случай, если менеджер направления занят.';
  }

  function reset() {
    clearTimeout(escalateTimer);
    el.chat.innerHTML = '';
    el.chips.innerHTML = '';
    el.tgBody.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = 'tg-empty';
    empty.id = 'tg-empty';
    empty.textContent = 'Пройдите сценарий слева — здесь появится карточка заявки такой, какой её получит менеджер.';
    el.tgBody.appendChild(empty);
    el.tgEmpty = empty;
    el.tgActions.hidden = true;
    el.tgNote.className = 'tg-note';
    el.tgNote.textContent = 'Макет: кнопки работают только внутри этой страницы. В рабочем боте заявка приходит в Telegram менеджеру.';
    state = { phase: 'chat', tour: null, people: null, date: null, name: '', phoneDigits: '', done: false, taken: false };
    el.input.value = '';
    el.input.placeholder = 'Спросите про тур: цена, даты, что входит…';
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
    if (!tours.length) {
      addSys('Данные демо ещё загружаются — секунду.');
      return;
    }
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
      el.input.placeholder = 'Спросите про другой тур…';
      finishLead();
      return;
    }

    userSays(text);
    el.input.value = '';

    if (state.phase === 'people') {
      var m = text.match(/\d+/);
      if (m) { setPeople(parseInt(m[0], 10)); return; }
      addSys('Сколько человек — числом, пожалуйста.');
      return;
    }
    if (state.phase === 'dates') {
      if (state.tour && state.tour.dates && /(\d{2})[.\/](\d{2})/.test(text)) {
        var mm = text.match(/(\d{2})[.\/](\d{2})/);
        var iso = state.tour.dates.filter(function (d) { return d.indexOf('-' + mm[2] + '-' + mm[1]) > -1; })[0];
        setDate(iso || 'уточню у менеджера');
        return;
      }
      setDate('уточню у менеджера');
      return;
    }

    if (state.phase === 'done') { answer(text); return; }

    if (/заявк|забронир|остав(ить|лю)\s+(заявку|контакт)/i.test(text)) {
      startLead(state.tour);
      return;
    }
    answer(text);
  });

  el.input.addEventListener('input', function () {
    if (state.phase !== 'phone') return;
    el.input.value = formatPhone(el.input.value);
  });

  el.tgTake.addEventListener('click', takeDialog);
  el.tgForward.addEventListener('click', forwardToBoss);

  /* ---------------- старт ---------------- */

  function start() {
    addMsg('Здравствуйте! Я турбот Синапс. Сезон — новогодние даты. Спросите про тур — цену, даты, что входит, доплаты, визу — или выберите направление.', 'bot');
    addSys('Демо: данные вымышленные, заявки не отправляются, телефон не сохраняется.');
    renderChips(START_CHIPS);
  }

  fetch('tours.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      tours = data || [];
      state.taken = false;
      el.input.disabled = false;
      el.input.placeholder = 'Спросите про тур: цена, даты, что входит…';
      start();
    })
    .catch(function (err) {
      el.input.disabled = false;
      el.input.placeholder = 'Спросите про тур: цена, даты, что входит…';
      addSys('Не удалось загрузить данные демо — обновите страницу.');
      if (window.console) console.error(err);
    });

  /* ---------------- scroll reveal ---------------- */

  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    revealEls.forEach(function (el2) { io.observe(el2); });
  } else {
    revealEls.forEach(function (el2) { el2.classList.add('in'); });
  }

  /* ---------------- tagline: слова по одному ---------------- */

  var tagline = document.getElementById('tagline');
  if (tagline) {
    var text2 = tagline.dataset.text || '';
    tagline.textContent = '';
    var words = text2.split(' ');
    var spans = words.map(function (word, i) {
      var s = document.createElement('span');
      s.className = 'w';
      s.textContent = word;
      tagline.appendChild(s);
      if (i < words.length - 1) tagline.appendChild(document.createTextNode(' '));
      return s;
    });
    if ('IntersectionObserver' in window) {
      var tio = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          spans.forEach(function (s, i) {
            setTimeout(function () { s.classList.add('on'); }, i * 80);
          });
          tio.disconnect();
        });
      }, { threshold: 0.4 });
      tio.observe(tagline);
    } else {
      spans.forEach(function (s) { s.classList.add('on'); });
    }
  }
})();
