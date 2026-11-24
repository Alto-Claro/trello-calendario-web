/* Conector del Power-Up: registra las capacidades en Trello. */
(function () {
  'use strict';

  var CFG = window.CAL_CONFIG || {};
  var BASE = window.location.href.replace(/[^/]*(\?.*)?$/, ''); // carpeta del conector
  var ICON_DARK = BASE + 'img/icon-white.svg';  // icono claro para fondos oscuros
  var ICON_LIGHT = BASE + 'img/icon.svg';       // icono oscuro para fondos claros

  function todayIcon() { return BASE + 'img/day/' + new Date().getDate() + '.svg?v=4'; }

  var TEST = /\/pruebas\//.test(BASE);
  var OPEN_TXT = 'Abrir en el calendario' + (TEST ? ' (pruebas)' : '');

  // cardId (opcional): el calendario se abre en la fecha de esa tarjeta y con ella abierta.
  function openCalendar(t, cardId) {
    return t.modal({
      url: './calendar.html?t=' + Date.now() + (cardId ? '&card=' + encodeURIComponent(cardId) : ''),
      fullscreen: true,
      title: 'Calendario',
      accentColor: '#0c66e4'
    });
  }

  var capabilities = {
    'board-buttons': function () {
      return [{
        // Icono a color con la fecha de hoy (sirve igual sobre fondo claro u oscuro).
        icon: { dark: todayIcon(), light: todayIcon() },
        text: TEST ? 'Calendario (pruebas)' : 'Calendario',
        condition: 'always',
        callback: openCalendar
      }];
    },

    // En cada tarjeta de Trello: acceso directo a esa tarjeta en el calendario.
    // Insignia roja junto al título (lo más visible)…
    'card-detail-badges': function (t) {
      return [{ title: 'Calendario', text: '📅 ' + OPEN_TXT, color: 'red',
        callback: function (t2) { return openCalendar(t2, t2.getContext().card); } }];
    },
    // …una sección con botón grande en el cuerpo de la tarjeta…
    'card-back-section': function (t) {
      return { title: 'Calendario' + (TEST ? ' (pruebas)' : ''), icon: ICON_LIGHT,
        content: { type: 'iframe', url: t.signUrl('./cardback.html'), height: 56 } };
    },
    // …y un botón en la lista de botones de la tarjeta.
    'card-buttons': function () {
      return [{ icon: ICON_LIGHT, text: OPEN_TXT, condition: 'always',
        callback: function (t) { return openCalendar(t, t.getContext().card); } }];
    },

    'show-settings': function (t) {
      return t.popup({ title: 'Ajustes del calendario', url: './settings.html?t=' + Date.now(), height: 520 });
    }
  };

  // Autorización (solo si hay API key): permite arrastrar tarjetas para cambiar fechas.
  if (CFG.APP_KEY) {
    capabilities['authorization-status'] = function (t) {
      return t.getRestApi().isAuthorized().then(function (ok) { return { authorized: ok }; });
    };
    capabilities['show-authorization'] = function (t) {
      return t.popup({ title: 'Autorizar edición', url: './authorize.html?t=' + Date.now(), height: 160 });
    };
  }

  var initOpts = {};
  if (CFG.APP_KEY) {
    initOpts = { appKey: CFG.APP_KEY, appName: CFG.APP_NAME, appAuthor: CFG.APP_AUTHOR };
  }

  window.TrelloPowerUp.initialize(capabilities, initOpts);
})();
