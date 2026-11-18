/* Synaps demo bot engine — порт логики прототипа search.py на чистый JS.
   Работает в браузере (window.BotEngine) и в Node (module.exports).
   Без сети, без LLM, без внешних зависимостей. Все факты — только из переданных туров. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BotEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- нормализация ---------- */

  function normalize(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Грубая основа слова: «вена / вены / вене» -> «вен», «гагра / гагре» -> «гагр».
  function stem(word) {
    var w = String(word || '');
    if (w.length <= 3) return w;
    if (/[аеиоуыэюяйь]$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  var STOP_LIST = (
    'какой какие какая какое каких каким какую ' +
    'тур туры тура туре туров турам турах ' +
    'цена цены цене цену ценам стоимость стоить стоит стоят ' +
    'сколько что чем чему где когда кто кого ' +
    'можно есть для мне нам меня нас хочу хотим ' +
    'подходит подойдет подойдёт расскажи расскажите покажи покажите ' +
    'лучше дешевле дороже бюджет до от на за по при про и в во с со у о об из ' +
    'дней дня день ночей ночь неделя недели ' +
    'это эти тот та те так вот очень самый самая самое самые ' +
    'недорогой недорогая бюджетный минимальная минимальный максимальная максимальный ' +
    'ли же бы не нет да или если то ' +
    'вы ваш ваша ваше вас мне пожалуйста подскажите скажите плиз ' +
    'здравствуйте привет спасибо добрый доброе ' +
    'отличается отличаются отличие отличия разница различия сравни сравните сравнить против ' +
    'найди найдите поищи ищет ищу информацию инфо подробнее подробно'
  ).split(/\s+/);

  var STOP = {};
  STOP_LIST.forEach(function (w) {
    if (!w) return;
    STOP[w] = 1;
    STOP[stem(w)] = 1;
  });

  function contentWords(text) {
    var raw = normalize(text).match(/[a-zа-я0-9]{3,}/g) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i];
      if (STOP[w]) continue;
      var st = stem(w);
      if (STOP[st]) continue;
      if (!seen[st]) {
        seen[st] = 1;
        out.push(st);
      }
    }
    return out;
  }

  /* ---------- похожесть строк (замена difflib.SequenceMatcher) ---------- */

  function lcsLen(a, b) {
    var prev = [];
    var cur = [];
    var i, j;
    for (j = 0; j <= b.length; j++) prev[j] = 0;
    for (i = 1; i <= a.length; i++) {
      cur = [0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = a.charAt(i - 1) === b.charAt(j - 1)
          ? prev[j - 1] + 1
          : Math.max(prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function ratio(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    return (2 * lcsLen(a, b)) / (a.length + b.length);
  }

  // Самая длинная общая подстрока: защита от ложных совпадений по буквам
  // («Марс» и «Мирас» дают общее «рас», но это не тот тур).
  function lcSubstr(a, b) {
    var best = 0;
    var prev = [];
    var i, j;
    for (j = 0; j <= b.length; j++) prev[j] = 0;
    for (i = 1; i <= a.length; i++) {
      var cur = [0];
      for (j = 1; j <= b.length; j++) {
        if (a.charAt(i - 1) === b.charAt(j - 1)) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) best = cur[j];
        } else {
          cur[j] = 0;
        }
      }
      prev = cur;
    }
    return best;
  }

  function similarEnough(name, question) {
    return ratio(name, question) > 0.5 && lcSubstr(name, question) >= 4;
  }

  /* ---------- индекс тура ---------- */

  function buildIndex(t) {
    var idx = {};
    function add(text, weight) {
      contentWords(text).forEach(function (w) {
        if (!idx[w] || idx[w] < weight) idx[w] = weight;
      });
    }
    add(t.name, 3);
    add(t.hotel, 3);
    add(t.directionLabel, 2);
    add((t.route || []).join(' '), 2);
    add((t.countries || []).join(' '), 2);
    add(t.type, 1);
    add((t.includes || []).join(' '), 1);
    add((t.extras || []).join(' '), 1);
    add(t.knowledge, 1);
    return idx;
  }

  function matchTours(question, tours) {
    var nq = normalize(question);
    var toks = contentWords(question);
    var res = [];
    tours.forEach(function (t, i) {
      var idx = buildIndex(t);
      var score = 0;
      toks.forEach(function (w) {
        if (idx[w]) score += idx[w];
      });
      var name = normalize(t.name);
      if (similarEnough(name, nq)) score += ratio(name, nq) * 3;
      if (name && nq.indexOf(name) !== -1) score += 10;
      if (score >= 2) res.push({ tour: t, score: score, i: i });
    });
    res.sort(function (a, b) {
      return b.score - a.score || a.i - b.i;
    });
    return res;
  }

  /* ---------- разбор чисел ---------- */

  function parseMaxPrice(qn) {
    var m = /(?:до|дешевле|бюджет|не дороже|максимум|в пределах|уложиться в)\s*([0-9]{2,5})/.exec(qn);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseDays(qn) {
    var m = /([0-9]{1,2})\s*(?:дн|день|дней|ноч)/.exec(qn);
    return m ? parseInt(m[1], 10) : null;
  }

  /* ---------- форматирование ---------- */

  function fmtDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(value);
  }

  function fmtDates(t) {
    var dates = t.dates || [];
    return dates.length ? dates.map(fmtDate).join(', ') : 'уточняются';
  }

  function routeStr(t) {
    var route = t.route || [];
    return route.length ? route.join(' — ') : 'уточняется';
  }

  function plural(n, one, few, many) {
    var n10 = n % 10;
    var n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function daysLabel(n) {
    return n + ' ' + plural(n, 'день', 'дня', 'дней');
  }

  // Родительный падеж для «против»: «6 дней против 4 дней».
  function daysGen(n) {
    return n + ' ' + plural(n, 'дня', 'дней', 'дней');
  }

  var WORD_DAY = [
    ['перв', 1], ['втор', 2], ['трет', 3], ['четверт', 4], ['пят', 5],
    ['шест', 6], ['седьм', 7], ['восьм', 8], ['девят', 9], ['десят', 10]
  ];

  function wordDay(qn) {
    for (var i = 0; i < WORD_DAY.length; i++) {
      var re = new RegExp('(^|\\s)' + WORD_DAY[i][0] + '[а-я]*\\s+день(\\s|$)');
      if (re.test(qn)) return WORD_DAY[i][1];
    }
    return null;
  }

  function toursLabel(n) {
    return n + ' ' + plural(n, 'тур', 'тура', 'туров');
  }

  function detail(t) {
    var cur = t.currency || 'BYN';
    return [
      t.name,
      '• ' + daysLabel(t.duration_days) + ', ' + t.price + ' ' + cur,
      '• Даты: ' + fmtDates(t),
      '• Маршрут: ' + routeStr(t),
      '• Виза: ' + (t.visa || 'уточняется'),
      '• Включено: ' + ((t.includes || []).join('; ') || 'уточняется'),
      '• Доплаты: ' + ((t.extras || []).join('; ') || 'нет'),
      '• Отель: ' + (t.hotel || 'уточняется'),
      '• Тип: ' + (t.type || 'тур'),
      'Заявку примет ' + (t.manager || 'менеджер') + '.'
    ].join('\n');
  }

  function listLine(t) {
    return '• ' + t.name + ' — ' + daysLabel(t.duration_days) + ', ' +
      t.price + ' ' + (t.currency || 'BYN') + ', даты ' + fmtDates(t);
  }

  function priceLine(t) {
    return '• ' + t.name + ' — ' + t.price + ' ' + (t.currency || 'BYN') +
      ' (' + daysLabel(t.duration_days) + ', даты ' + fmtDates(t) + ')';
  }

  function card(t) {
    return [
      t.name,
      '• ' + daysLabel(t.duration_days) + ', ' + t.price + ' ' + (t.currency || 'BYN'),
      '• Даты: ' + fmtDates(t),
      '• Маршрут: ' + routeStr(t),
      '• Включено: ' + ((t.includes || []).join('; ') || 'уточняется'),
      '• Доплаты: ' + ((t.extras || []).join('; ') || 'нет')
    ].join('\n');
  }

  function extractDay(tour, n) {
    var text = String((tour && tour.knowledge) || '');
    var num = parseInt(n, 10);
    if (!isFinite(num) || !text) return null;
    var re = new RegExp('###\\s*День\\s+' + num + '\\.[\\s\\S]*?(?=\\n###\\s*День\\s+|$)');
    var m = re.exec(text);
    if (!m) return null;
    return m[0].replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '').trim();
  }

  /* ---------- сравнение ---------- */

  function nameTokens(t) {
    return contentWords((t.name || '') + ' ' + (t.hotel || ''));
  }

  function pickTourForToken(token, tours, used) {
    var candidates = [];
    tours.forEach(function (t, i) {
      if (used.indexOf(t.id) !== -1) return;
      if (nameTokens(t).indexOf(token) === -1) return;
      var first = stem(normalize(t.name).split(' ')[0]);
      candidates.push({ tour: t, start: first === token ? 1 : 0, len: (t.name || '').length, i: i });
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      return b.start - a.start || a.len - b.len || a.i - b.i;
    });
    return candidates[0].tour;
  }

  function pickCompare(question, tours, matched) {
    var toks = contentWords(question);
    var picks = [];
    var used = [];
    for (var i = 0; i < toks.length && picks.length < 2; i++) {
      var pick = pickTourForToken(toks[i], tours, used);
      if (pick) {
        picks.push(pick);
        used.push(pick.id);
      }
    }
    for (var j = 0; j < matched.length && picks.length < 2; j++) {
      if (used.indexOf(matched[j].tour.id) === -1) {
        picks.push(matched[j].tour);
        used.push(matched[j].tour.id);
      }
    }
    return picks;
  }

  function compare(a, b) {
    var cur = a.currency || 'BYN';
    var cheaper = a.price <= b.price ? a : b;
    var lines = [
      a.name + ' и ' + b.name + ' — это два разных тура.',
      '• Цена: ' + a.price + ' ' + cur + ' против ' + b.price + ' ' + cur +
        ', разница ' + Math.abs(a.price - b.price) + ' ' + cur + '. Дешевле ' + cheaper.name + '.',
      '• Длительность: ' + daysGen(a.duration_days) + ' против ' + daysGen(b.duration_days) + '.',
      '• Даты: ' + fmtDates(a) + ' против ' + fmtDates(b) + '.',
      '• Маршрут: ' + routeStr(a) + ' против ' + routeStr(b) + '.',
      '• Включено: ' + ((a.includes || []).join('; ') || '—') + ' против ' + ((b.includes || []).join('; ') || '—') + '.',
      '• Доплаты: ' + ((a.extras || []).join('; ') || '—') + ' против ' + ((b.extras || []).join('; ') || '—') + '.'
    ];
    if ((a.visa || '') !== (b.visa || '')) {
      lines.push('• Виза: ' + (a.visa || '—') + ' против ' + (b.visa || '—') + '.');
    }
    lines.push('Скажите, какой ближе, — покажу программу по дням и передам заявку менеджеру.');
    return lines.join('\n');
  }

  /* ---------- обзоры без конкретного тура ---------- */

  function aggregate(tours, field) {
    var counts = {};
    var order = [];
    tours.forEach(function (t) {
      (t[field] || []).forEach(function (item) {
        if (!counts[item]) {
          counts[item] = 0;
          order.push(item);
        }
        counts[item] += 1;
      });
    });
    order.sort(function (a, b) {
      return counts[b] - counts[a];
    });
    return order.slice(0, 6).map(function (item) {
      return '• ' + item + ' — в ' + counts[item] + ' ' + plural(counts[item], 'туре', 'турах', 'турах');
    });
  }

  function includesOverview(tours) {
    var lines = aggregate(tours, 'includes');
    if (!lines.length) return null;
    return 'В базе ' + toursLabel(tours.length) + '. Чаще всего в стоимость входит:\n' +
      lines.join('\n') +
      '\nНазовите тур — пришлю точный состав и доплаты.';
  }

  function extrasOverview(tours) {
    var lines = aggregate(tours, 'extras');
    if (!lines.length) return null;
    return 'Доплаты зависят от тура. В базе встречаются:\n' +
      lines.join('\n') +
      '\nНазовите тур — скажу, что именно доплачивать в нём.';
  }

  function visaOverview(tours) {
    var map = {};
    var order = [];
    tours.forEach(function (t) {
      (t.countries || []).forEach(function (country) {
        if (!map[country]) {
          map[country] = { visa: t.visa || 'уточняется', count: 0 };
          order.push(country);
        }
        map[country].count += 1;
        if (t.visa && t.visa !== map[country].visa) map[country].visa = 'зависит от тура';
      });
    });
    if (!order.length) return null;
    order.sort();
    var lines = order.map(function (country) {
      return '• ' + country + ' — ' + map[country].visa + ' (' + toursLabel(map[country].count) + ')';
    });
    return 'Виза зависит от направления:\n' + lines.join('\n') +
      '\nНазовите тур — подтвержу по нему.';
  }

  /* ---------- поиск ---------- */

  function search(question, tours, limit) {
    tours = Array.isArray(tours) ? tours : [];
    limit = typeof limit === 'number' && limit > 0 ? limit : 3;
    var qn = normalize(question);
    var maxp = parseMaxPrice(qn);
    var days = parseDays(qn);
    var toks = contentWords(question);
    var res = [];
    tours.forEach(function (t, i) {
      if (!t || typeof t !== 'object') return;
      if (maxp !== null && Number(t.price) > maxp) return;
      if (days !== null && Number(t.duration_days) > days + 1) return;
      var idx = buildIndex(t);
      var score = 0;
      toks.forEach(function (w) {
        if (idx[w]) score += idx[w];
      });
      var r = ratio(normalize(t.name), qn);
      if (similarEnough(normalize(t.name), qn)) score += r * 3;
      if (score > 0) res.push({ tour: t, score: score, i: i });
    });
    res.sort(function (a, b) {
      return b.score - a.score ||
        Number(a.tour.price) - Number(b.tour.price) ||
        a.i - b.i;
    });
    if (res.length) {
      return res.slice(0, limit).map(function (x) {
        return x.tour;
      });
    }
    // «до 800» без других слов: показываем всё, что укладывается в бюджет.
    if (maxp !== null) {
      return tours.filter(function (t) {
        return Number(t.price) <= maxp;
      }).sort(function (a, b) {
        return Number(a.price) - Number(b.price);
      }).slice(0, limit);
    }
    return [];
  }

  /* Направление, если оно названо в вопросе: «самая дешёвая Европа». */
  function directionScope(question, tours) {
    var toks = contentWords(question);
    var scoped = tours.filter(function (t) {
      var words = contentWords((t.directionLabel || '') + ' ' + (t.countries || []).join(' '));
      for (var i = 0; i < words.length; i++) {
        if (toks.indexOf(words[i]) !== -1) return true;
      }
      return false;
    });
    return scoped.length ? scoped : tours;
  }

  /* ---------- состояние диалога ---------- */  // Бот помнит последние показанные туры: после «Сколько стоит Абхазия?»
  // вопрос «Что входит в 3-й день?» относится к тому же туру.
  var ctxIds = [];

  function ctxTour(tours) {
    for (var i = 0; i < ctxIds.length; i++) {
      for (var j = 0; j < tours.length; j++) {
        if (tours[j] && tours[j].id === ctxIds[i]) return tours[j];
      }
    }
    return null;
  }

  function finish(kind, text, ids) {
    ids = ids || [];
    if (ids.length) ctxIds = ids.slice(0, 5);
    return { kind: kind, text: text, tours: ids };
  }

  function idsOf(list) {
    return list.map(function (t) {
      return t.id;
    });
  }

  /* ---------- текст приветствия и помощи ---------- */

  function greetingText(total) {
    return 'Здравствуйте! Я демо-бот Synaps: ищу по базе из ' + toursLabel(total) +
      ' и отвечаю только тем, что в ней есть.\n' +
      'Спросите, например: «Сколько стоит Абхазия?», «Что входит в тур в Гагру?», «Есть тур на 6 дней?»';
  }

  function helpText(total) {
    return 'Вот что я умею:\n' +
      '• подобрать по бюджету — «до 800 BYN»\n' +
      '• найти по длительности — «на 6 дней»\n' +
      '• показать самый дешёвый или самый дорогой тур\n' +
      '• рассказать, что входит, какие доплаты и нужна ли виза\n' +
      '• показать программу по дням — «что входит в 3-й день»\n' +
      '• сравнить два тура — «чем отличается Вена от Будапешта»\n' +
      'В базе ' + toursLabel(total) + ', все вымышленные. Спросите обычными словами.';
  }

  function notFoundText() {
    return 'По этим параметрам в базе ничего нет — передам менеджеру. ' +
      'Напишите направление, даты, состав и бюджет — вернусь с вариантами.';
  }

  /* ---------- ответ ---------- */

  function answer(question, tours) {
    tours = Array.isArray(tours) ? tours.filter(function (t) {
      return t && typeof t === 'object';
    }) : [];
    var total = tours.length;
    var q = String(question == null ? '' : question);
    var qn = normalize(q);

    if (!total) {
      return finish('notfound', 'База туров пуста — передам запрос менеджеру.', []);
    }
    if (!qn) {
      return finish('help', helpText(total), []);
    }

    var matched = matchTours(q, tours);

    /* приветствие */
    var greetStart = /^(привет|здравствуйте|здравствуй|приветствую|добрый день|добрый вечер|доброе утро|хай|hello|hi)(\s|$)/.test(qn);
    var hasTask = /(сколько|стоит|цена|стоимость|тур|дн|виз|доплат|входит|включ|программ|отел|дат|ребен|сравн|отлич|найд|подбер)/.test(qn);
    if (greetStart && !hasTask) {
      return finish('greeting', greetingText(total), []);
    }

    /* что умеешь */
    if (/(что ты умеешь|что умеешь|что ты можешь|что можешь|чем можешь помочь|как работает|помощь)/.test(qn)) {
      return finish('help', helpText(total), []);
    }

    /* самый дешёвый / самый дорогой */
    if (/сам(ый|ая|ое)\s+(деш|недорог)|дешевле всех|минимальн(ая|ый|ое)\s+цена|самый бюджетн/.test(qn)) {
      var cheapScope = directionScope(q, tours);
      var cheapest = cheapScope.slice().sort(function (a, b) {
        return Number(a.price) - Number(b.price);
      })[0];
      var cheapLabel = cheapScope.length === tours.length ? 'в базе' : 'в направлении';
      return finish('cheapest', 'Самый дешёвый тур ' + cheapLabel + ':\n' + detail(cheapest), [cheapest.id]);
    }
    if (/сам(ый|ая|ое)\s+дорог|дороже всех|максимальн(ая|ый|ое)\s+цена/.test(qn)) {
      var priceScope = directionScope(q, tours);
      var priciest = priceScope.slice().sort(function (a, b) {
        return Number(b.price) - Number(a.price);
      })[0];
      var priceLabel = priceScope.length === tours.length ? 'в базе' : 'в направлении';
      return finish('priciest', 'Самый дорогой тур ' + priceLabel + ':\n' + detail(priciest), [priciest.id]);
    }

    /* тур на N дней */
    var daysMatch = /(?:на|за)\s*(\d{1,2})\s*(?:дн[а-я]*|ноч[а-я]*)/.exec(qn) ||
      /(\d{1,2})\s*дневн/.exec(qn) ||
      /(\d{1,2})\s*(?:дн[а-я]*|день|дней)/.exec(qn);
    if (daysMatch) {
      var nDays = parseInt(daysMatch[1], 10);
      var exact = tours.filter(function (t) {
        return Number(t.duration_days) === nDays;
      }).sort(function (a, b) {
        return Number(a.price) - Number(b.price);
      });
      if (exact.length) {
        return finish('days',
          'Туры на ' + daysLabel(nDays) + ':\n' + exact.map(card).join('\n\n'),
          idsOf(exact));
      }
      var near = tours.slice().sort(function (a, b) {
        return Math.abs(Number(a.duration_days) - nDays) - Math.abs(Number(b.duration_days) - nDays) ||
          Number(a.price) - Number(b.price);
      }).slice(0, 2);
      if (near.length) {
        return finish('days',
          'Туров ровно на ' + daysLabel(nDays) + ' в базе нет. Ближайшее по длительности:\n' +
          near.map(listLine).join('\n') + '\nМогу передать менеджеру запрос под ваши даты.',
          idsOf(near));
      }
    }

    /* с ребёнком */
    if (/ребен|дет(и|ей|ям|ьми|ский|ская|ское|сад|ск)/.test(qn)) {
      var kidTours = tours.filter(function (t) {
        var text = normalize((t.knowledge || '') + ' ' + (t.extras || []).join(' ') + ' ' + (t.includes || []).join(' '));
        return /ребен|дет(и|ей|ям|ьми|ский|ская|ское|сад|ск)/.test(text);
      }).sort(function (a, b) {
        return Number(a.price) - Number(b.price);
      });
      if (kidTours.length) {
        return finish('kids',
          'Туры, где есть условия для детей:\n' + kidTours.slice(0, 4).map(card).join('\n\n') +
          '\nВозраст ребёнка уточните менеджеру — он подтвердит стоимость.',
          idsOf(kidTours.slice(0, 4)));
      }
      return finish('notfound', notFoundText(), []);
    }

    /* сравнение */
    if (/отлич|сравн|разниц|различи/.test(qn)) {
      var pair = pickCompare(q, tours, matched);
      if (pair.length >= 2) {
        return finish('compare', compare(pair[0], pair[1]), [pair[0].id, pair[1].id]);
      }
    }

    /* конкретный день программы */
    var dayMatch = /(\d{1,2})\s*(?:й|ый|ой)?\s*день/.exec(qn) ||
      /день\s*(\d{1,2})/.exec(qn) ||
      /(\d{1,2})\s*дн[а-я]*\s*программ/.exec(qn);
    if (dayMatch || wordDay(qn)) {
      var dayNum = dayMatch ? parseInt(dayMatch[1], 10) : wordDay(qn);
      var dayTour = matched.length ? matched[0].tour : ctxTour(tours);
      if (!dayTour) {
        return finish('day',
          'Понял про день программы, но не понял, о каком туре речь. ' +
          'Назовите направление или отель — например, «3-й день в Гагре».', []);
      }
      var dayRaw = extractDay(dayTour, dayNum);
      if (!dayRaw) {
        return finish('day',
          'В программе тура «' + dayTour.name + '» всего ' + daysLabel(dayTour.duration_days) +
          ' — дня ' + dayNum + ' там нет.', [dayTour.id]);
      }
      var clean = dayRaw.replace(/^###\s*/, '');
      var lines = clean.split('\n').map(function (line) {
        return line.trim();
      }).filter(Boolean);
      var body = lines.map(function (line) {
        return '• ' + line;
      }).join('\n');
      return finish('day', dayTour.name + '\n' + body, [dayTour.id]);
    }

    /* что входит / доплаты / виза / даты / сколько стоит / расскажи */
    var detailish = /(что входит|что включено|входит в|включено|программ|доплат|виз|дат[аы]|какие даты|сколько|стоит|цена|стоимость|отел|гостиниц|где жив|ночуем|питани|завтрак|длительн|расскажи|подробн)/.test(qn);
    if (detailish) {
      if (matched.length) {
        var topScore = matched[0].score;
        var top = matched.filter(function (x) {
          return x.score === topScore;
        }).map(function (x) {
          return x.tour;
        });
        if (top.length === 1) {
          return finish('detail', detail(top[0]), [top[0].id]);
        }
        var wantsPrice = /сколько|стоит|цена|стоимость/.test(qn);
        var topSorted = top.slice().sort(function (a, b) {
          return Number(a.price) - Number(b.price);
        });
        if (wantsPrice) {
          return finish('detail',
            'Нашёл ' + toursLabel(top.length) + ' — цены такие:\n' +
            topSorted.slice(0, 6).map(priceLine).join('\n') +
            '\nСкажите, какой смотреть подробно.',
            idsOf(topSorted.slice(0, 6)));
        }
        return finish('detail',
          'Подходящие варианты (' + toursLabel(top.length) + '):\n' +
          topSorted.slice(0, 3).map(card).join('\n\n') +
          (top.length > 3 ? '\nЕщё ' + toursLabel(top.length - 3) + ' — уточните даты, покажу.' : ''),
          idsOf(topSorted.slice(0, 3)));
      }
      if (/виз/.test(qn)) {
        var visa = visaOverview(tours);
        if (visa) return finish('detail', visa, []);
      }
      if (/доплат/.test(qn)) {
        var extras = extrasOverview(tours);
        if (extras) return finish('detail', extras, []);
      }
      if (/что входит|что включено|включено|входит в/.test(qn)) {
        var inc = includesOverview(tours);
        if (inc) return finish('detail', inc, []);
      }
      var remembered = ctxTour(tours);
      if (remembered && parseMaxPrice(qn) === null) {
        return finish('detail',
          'По последнему туру, который мы смотрели:\n' + detail(remembered), [remembered.id]);
      }
    }

    /* поиск по названию, маршруту, странам, тексту программы */
    var found = search(q, tours, 6);
    if (found.length) {
      return finish('search',
        'Нашёл варианты:\n' + found.map(listLine).join('\n') +
        '\nУточните тур — покажу программу по дням, доплаты и визу.',
        idsOf(found));
    }

    return finish('notfound', notFoundText(), []);
  }

  return {
    answer: answer,
    search: search,
    detail: detail,
    extractDay: extractDay,
    normalize: normalize,
    compare: compare,
    _matchTours: function (question, tours) {
      return matchTours(question, tours).map(function (x) {
        return x.tour;
      });
    }
  };
});
