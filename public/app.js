/* Synaps sandbox — демо турбота (симуляция) + анимации */
(function () {
  'use strict';

  /* ---------- демо-данные: вымышленные туры ---------- */
  const TOURS = {
    abkhazia: {
      label: 'Абхазия',
      manager: 'менеджер направления Абхазия',
      items: [
        { name: 'Гагра, гостевой дом «Ривьера»', nights: '10 ночей', price: 'от 940 BYN', dates: 'выезды 06.07, 16.07, 26.07' },
        { name: 'Новый Афон, гостиница «Мирас»', nights: '10 ночей', price: 'от 1 120 BYN', dates: 'выезды 12.07, 22.07' },
        { name: 'Пицунда, отель «Куга Парадор»', nights: '10 ночей', price: 'от 1 280 BYN', dates: 'выезды 08.07, 18.07' }
      ]
    },
    europe: {
      label: 'Европа',
      manager: 'менеджер направления Европа',
      items: [
        { name: 'Вена и Зальцбург', nights: '6 дней', price: 'от 1 280 BYN', dates: 'выезды 14.07, 28.07' },
        { name: 'Будапешт на выходные', nights: '4 дня', price: 'от 690 BYN', dates: 'каждую пятницу' }
      ]
    },
    bus: {
      label: 'Автобусные',
      manager: 'менеджер направления автобусные туры',
      items: [
        { name: 'Будапешт, Вена, Прага', nights: '5 дней', price: 'от 790 BYN', dates: 'выезды 10.07, 24.07' },
        { name: 'Польша, Краков и Закопане', nights: '5 дней', price: 'от 720 BYN', dates: 'выезды 17.07, 31.07' }
      ]
    }
  };

  const chat = document.getElementById('chat');
  const chips = document.getElementById('chips');
  const form = document.getElementById('lead-form');
  const nameInput = document.getElementById('lead-name');
  const phoneInput = document.getElementById('lead-phone');
  const errNote = document.getElementById('lead-error');

  let current = null;

  function addMsg(text, kind) {
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function addSys(text) {
    return addMsg(text, 'sys');
  }

  function renderTours(key) {
    const t = TOURS[key];
    current = t;
    t.items.forEach(function (item) {
      addMsg(item.name + '. ' + item.nights + ', ' + item.price + '. ' + item.dates, 'bot');
    });
    addSys('Заявка уходит ' + t.manager + '. Это демонстрация, данные вымышленные.');
    form.hidden = false;
    nameInput.focus();
  }

  chips.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    const key = btn.dataset.key;
    chips.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    addMsg(TOURS[key].label, 'me');
    setTimeout(function () { renderTours(key); }, 400);
  });

  /* ---------- валидация заявки ---------- */
  function digits(s) { return (s || '').replace(/\D/g, ''); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errNote.textContent = '';
    nameInput.classList.remove('err');
    phoneInput.classList.remove('err');

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();

    if (name.length < 2) {
      errNote.textContent = 'Укажите имя, чтобы менеджер знал, как к вам обращаться.';
      nameInput.classList.add('err');
      nameInput.focus();
      return;
    }
    if (digits(phone).length < 9) {
      errNote.textContent = 'Телефон должен содержать не меньше 9 цифр.';
      phoneInput.classList.add('err');
      phoneInput.focus();
      return;
    }

    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Отправляем';
    setTimeout(function () {
      form.hidden = true;
      addSys('Заявка передана: ' + (current ? current.manager : 'менеджеру') + '. Ответ в течение 15 минут.');
      addMsg('Спасибо, ' + name + '! Это демо: настоящая заявка не отправлена. В рабочем боте здесь будет подтверждение от менеджера.', 'bot');
      btn.disabled = false;
      btn.textContent = 'Оставить заявку';
    }, 700);
  });

  /* ---------- scroll reveal ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- tagline: слова по одному ---------- */
  const tagline = document.getElementById('tagline');
  if (tagline) {
    const text = tagline.dataset.text || '';
    tagline.textContent = '';
    const words = text.split(' ');
    const spans = words.map(function (word, i) {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = word;
      tagline.appendChild(s);
      if (i < words.length - 1) tagline.appendChild(document.createTextNode(' '));
      return s;
    });
    if ('IntersectionObserver' in window) {
      const tio = new IntersectionObserver(function (entries) {
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
