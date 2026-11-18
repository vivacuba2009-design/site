/* Synaps — анимации страниц без демо: появление секций и слоган по словам. */
(function () {
  'use strict';

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
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  var tagline = document.getElementById('tagline');
  if (tagline) {
    var text = tagline.dataset.text || '';
    tagline.textContent = '';
    var words = text.split(' ');
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
