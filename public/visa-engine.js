/* Synaps — визовый движок демо.
   Данные: visa-data.json (открытые страницы, 18.11.2026, цены «от», не оферта).
   Отвечает только фактами из базы; на незнакомый вопрос — «передам менеджеру». */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.VisaEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function stem(w) {
    var x = String(w || '');
    if (x.length <= 3) return x;
    if (/[аеиоуыэюяйь]$/.test(x)) x = x.slice(0, -1);
    return x;
  }

  var COUNTRY_HINTS = {
    'Польша': ['польш', 'польск', 'польшу', 'польше', 'поланд'],
    'Италия': ['итали', 'итальян', 'италию'],
    'Испания': ['испани', 'испанск', 'испанию'],
    'Германия': ['германи', 'германск', 'германию'],
    'Греция': ['греци', 'греческ', 'грецию', 'греции']
  };

  var TYPE_HINTS = {
    'Туристическая виза': ['туристич', 'турист', 'поехать отдых', 'отдых', 'пляж'],
    'Рабочая виза': ['рабоч', 'работа', 'трудоустрой', 'контракт'],
    'Гостевая виза': ['гостев', 'гост', 'родственник', 'к родне', 'приглашен'],
    'Студенческая виза': ['студенческ', 'студент', 'учеб', 'универ', 'колледж'],
    'Ученическая виза': ['ученическ', 'школ', 'лицей', 'сад'],
    'Деловая виза': ['делов', 'бизнес', 'командировк'],
    'Виза для водителей': ['водител', 'водительск'],
    'Виза по Карте Поляка': ['карт поляк', 'карте поляк', 'поляка'],
    'Культурная виза': ['культурн'],
    'Виза для сдачи экзамена на Карту поляка': ['экзамен'],
    'Виза для посещения посольства США': ['посольств сша', 'американск', 'сша'],
    'Подача посредством Курьера': ['курьер']
  };

  function countries(data) {
    return (data && data.countries) || [];
  }

  function findCountry(question, data) {
    var q = norm(question);
    var list = countries(data);
    for (var name in COUNTRY_HINTS) {
      var hints = COUNTRY_HINTS[name];
      for (var i = 0; i < hints.length; i++) {
        if (q.indexOf(hints[i]) !== -1) {
          var found = list.filter(function (c) { return c.name === name; })[0];
          if (found) return found;
        }
      }
    }
    return null;
  }

  function findVisa(question, country) {
    if (!country) return null;
    var q = norm(question);
    var best = null;
    (country.visas || []).forEach(function (v) {
      var name = norm(v.name);
      var score = 0;
      if (q.indexOf(name) !== -1) score = 10;
      for (var key in TYPE_HINTS) {
        if (key === v.name) {
          TYPE_HINTS[key].forEach(function (h) {
            if (q.indexOf(h) !== -1 && score < 8) score = 8;
          });
        }
      }
      // слова из названия визы
      name.split(' ').forEach(function (w) {
        var st = stem(w);
        if (st.length >= 4 && q.indexOf(st) !== -1 && score < 6) score = 6;
      });
      if (score && (!best || score > best.score)) best = { visa: v, score: score };
    });
    return best ? best.visa : null;
  }

  function feesLine(v) {
    var f = v.fees || {};
    var parts = [];
    if (f.consular) parts.push('консульский сбор — ' + f.consular);
    if (f.service_center) parts.push('сервисный сбор — ' + f.service_center);
    if (f.our_services) parts.push('услуги агентства — ' + f.our_services);
    return parts.length ? parts.join('; ') : 'уточняется';
  }

  function docsList(v) {
    return (v.documents || []).slice();
  }

  function countryCard(c) {
    var n = (c.visas || []).length;
    return c.name + '\n• Срок рассмотрения: ' + (c.processing_time || 'уточняется') +
      '\n• Подача: ' + (c.submission || 'уточняется') +
      '\n• Типов виз в базе: ' + n;
  }

  function cleanValidity(s) {
    return String(s || '').replace(/([а-яa-z])([А-ЯA-Z])/g, '; ').replace(/;$/, '');
  }

  function plural(n, one, few, many) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function visaCard(c, v) {
    var lines = [c.name + ' · ' + v.name];
    if (v.validity) lines.push('• Срок действия: ' + cleanValidity(v.validity));
    lines.push('• Срок рассмотрения: ' + (c.processing_time || 'уточняется'));
    lines.push('• Сборы: ' + feesLine(v));
    if (v.submission_type) lines.push('• Подача: ' + v.submission_type);
    var docs = docsList(v);
    if (docs.length) lines.push('• Документов: ' + docs.length);
    return lines.join('\n');
  }

  function docsText(c, v) {
    var docs = docsList(v);
    if (!docs.length) return 'По этой визе список документов уточняется у менеджера.';
    var body = docs.map(function (d, i) { return (i + 1) + '. ' + d; }).join('\n');
    var notes = (v.notes || []).filter(Boolean);
    return 'Документы для «' + c.name + ' · ' + v.name + '»:\n' + body +
      (notes.length ? '\n\n' + notes.join('\n') : '');
  }

  function typesText(c) {
    var names = (c.visas || []).map(function (v) { return '• ' + v.name; });
    return 'Виза ' + c.name + ', что есть в базе (' + names.length + '):\n' + names.join('\n') +
      '\nВыберите тип — расскажу про сроки, сборы и документы.';
  }

  function countriesText(data) {
    var lines = countries(data).map(function (c) {
      var n = (c.visas || []).length;
      return '• ' + c.name + ' — ' + n + ' ' + plural(n, 'тип', 'типа', 'типов') + ' виз, ' + (c.processing_time || 'сроки уточняются');
    });
    return 'Работаю по странам:\n' + lines.join('\n') + '\nСпросите, например: «виза в Италию», «рабочая виза в Польшу».';
  }

  function notFoundText() {
    return 'К сожалению, не смог корректно обработать запрос. В демо пять стран: Польша, Италия, Испания, Германия, Греция. ' +
      'Назовите страну и тип визы — покажу сроки, сборы и документы.';
  }

  function wants(question, re) { return re.test(norm(question)); }

  function answer(question, data) {
    data = data || { countries: [] };
    var q = String(question == null ? '' : question);
    if (!q.trim()) return { kind: 'help', text: helpText(data) };

    if (wants(q, /что ты умеешь|что умеешь|как работает|помощь|help/)) {
      return { kind: 'help', text: helpText(data) };
    }
    if (wants(q, /какие страны|список стран|где можно|какие направления/)) {
      return { kind: 'countries', text: countriesText(data) };
    }

    var country = findCountry(q, data);
    if (!country) {
      return { kind: 'notfound', text: notFoundText() };
    }
    var visa = findVisa(q, country);

    // «какие визы в страну» — без конкретного типа
    if (!visa && wants(q, /какие виз|типы виз|что есть|список виз|какие есть/)) {
      return { kind: 'types', country: country.name, text: typesText(country) };
    }

    if (!visa) {
      return {
        kind: 'country',
        country: country.name,
        text: countryCard(country) + '\n\nВыберите тип визы — расскажу подробнее.',
        types: (country.visas || []).map(function (v) { return v.name; })
      };
    }

    var base = { country: country.name, visa: visa.name };
    if (wants(q, /документ|что нужно|какие бумаги|список/)) {
      base.kind = 'docs';
      base.text = docsText(country, visa);
      return base;
    }
    if (wants(q, /сбор|стоит|цена|стоимость|почем|сколько денег|услуг/)) {
      base.kind = 'fees';
      base.text = country.name + ' · ' + visa.name + '\n• ' + feesLine(visa).replace(/; /g, '\n• ') +
        '\nЦены «от», по прайсу на 18.11.2026 — не оферта.';
      return base;
    }
    if (wants(q, /срок|долго|ждать|рассмотр|когда будет/)) {
      base.kind = 'time';
      base.text = country.name + ' · ' + visa.name + '\n• Срок рассмотрения: ' +
        (country.processing_time || 'уточняется') + '\n• Подача: ' + (country.submission || 'уточняется');
      return base;
    }
    if (wants(q, /подач|куда идти|визовый центр|где подавать|консульств/)) {
      base.kind = 'submission';
      base.text = country.name + '\n• Подача: ' + (country.submission || 'уточняется') +
        '\n• Способ по этой визе: ' + (visa.submission_type || 'уточняется');
      return base;
    }
    if (wants(q, /на сколько|многократ|срок действия|действ/)) {
      base.kind = 'validity';
      base.text = country.name + ' · ' + visa.name + '\n• Срок действия: ' + (visa.validity || 'уточняется');
      return base;
    }
    base.kind = 'visa';
    base.text = visaCard(country, visa);
    return base;
  }

  function helpText(data) {
    return 'Я демо-визового бота. Умею:\n' +
      '• перечислить страны — «какие страны»\n' +
      '• показать типы виз — «какие визы в Польшу»\n' +
      '• рассказать про визу — «рабочая виза в Польшу»\n' +
      '• сборы — «сколько стоит гостевая виза в Испанию»\n' +
      '• сроки — «сколько ждать визу в Италию»\n' +
      '• документы — «какие документы на туристическую визу в Италию»\n' +
      'В базе ' + countries(data).length + ' стран, данные по открытым страницам на 18.11.2026.';
  }

  return {
    answer: answer,
    countries: countries,
    findCountry: findCountry,
    findVisa: findVisa,
    helpText: helpText,
    normalize: norm
  };
});
