/* Conector del Power-Up: registra las capacidades en Trello. */
(function () {
  'use strict';

  var CFG = window.CAL_CONFIG || {};
  var BASE = window.location.href.replace(/[^/]*(\?.*)?$/, ''); // carpeta del conector
  var ICON_DARK = BASE + 'img/icon-white.svg';  // icono claro para fondos oscuros
  var ICON_LIGHT = BASE + 'img/icon.svg';       // icono oscuro para fondos claros

  function todayIcon() { return BASE + 'img/day/' + new Date().getDate() + '.svg?v=4'; }

  function openCalendar(t) {
    return t.modal({
      url: './calendar.html?t=' + Date.now(),
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
        text: 'Calendario',
        condition: 'always',
        callback: openCalendar
      }];
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
