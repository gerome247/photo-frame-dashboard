// Phone: a QR code a phone camera can scan to open this dashboard. The code is loaded from
// /api/phone. The address is not written on the page.
(function () {
  'use strict';

  function render(el) {
    el.innerHTML = '<div class="phone">' +
      '<header class="phone-top"><div><div class="label">This screen</div><h1 class="serif">Phone</h1></div></header>' +
      '<div class="phone-body">' +
      '<div class="phone-card"><img class="phone-qr" alt="">' +
      '<p class="phone-miss serif">The code didn\u2019t load.</p></div>' +
      '<div class="phone-copy"><p class="serif">Scan with your phone camera.</p>' +
      '<p>Bookmark the page that opens.</p>' +
      '<p>Anyone who can see this screen can sign in.</p></div>' +
      '</div></div>';
    var img = el.querySelector('.phone-qr');
    img.addEventListener('error', function () { img.parentNode.classList.add('is-broken'); });
    img.addEventListener('load', function () { img.parentNode.classList.remove('is-broken'); });
  }

  App.register('phone', {
    show: function (el) {
      if (!el.querySelector('.phone')) render(el);
      var img = el.querySelector('.phone-qr');
      img.parentNode.classList.remove('is-broken');
      img.src = '/api/phone?t=' + Date.now();
    }
  });
})();
