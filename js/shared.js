/* Utilidades compartidas entre el conector, el calendario y los ajustes. */
(function () {
  'use strict';

  var DEFAULT_CFG = {
    dateSource: 'due',      // 'due' | 'start' | 'range' | 'cf:<idCustomField>'
    colorBy: 'label',       // 'label' | 'list' | 'member' | 'status' | 'none'
    weekStart: 1,           // 1 = lunes, 0 = domingo
    showWeekends: true,
    showCompleted: true,
    defaultView: 'month',   // 'month' | 'week' | 'agenda'
    defaultHour: 9,         // hora que se asigna al soltar una tarjeta sin hora previa
    agendaDays: 30,
    locale: 'es-ES'
  };

  // Colores de etiquetas de Trello (incluye variantes _light y _dark).
  var BASE = {
    green: '#4bce97', yellow: '#e2b203', orange: '#faa53d', red: '#f87462',
    purple: '#9f8fef', blue: '#579dff', sky: '#6cc3e0', lime: '#94c748',
    pink: '#e774bb', black: '#8590a2'
  };
  var DARK = {
    green: '#1f845a', yellow: '#946f00', orange: '#c25100', red: '#c9372c',
    purple: '#6e5dc6', blue: '#0c66e4', sky: '#227d9b', lime: '#5b7f24',
    pink: '#ae4787', black: '#626f86'
  };
  var LIGHT = {
    green: '#baf3db', yellow: '#f8e6a0', orange: '#fedec8', red: '#ffd5d2',
    purple: '#dfd8fd', blue: '#cce0ff', sky: '#c6edfb', lime: '#d3f1a7',
    pink: '#fdd0ec', black: '#dcdfe4'
  };

  function labelColor(color) {
    if (!color) return '#8590a2';
    var parts = color.split('_');
    var base = parts[0], variant = parts[1];
    if (variant === 'dark') return DARK[base] || '#626f86';
    if (variant === 'light') return LIGHT[base] || '#dcdfe4';
    return BASE[base] || '#8590a2';
  }

  // Paleta para colorear por lista / miembro (estable por id).
  var PALETTE = ['#579dff', '#4bce97', '#faa53d', '#9f8fef', '#e774bb', '#6cc3e0',
                 '#94c748', '#f87462', '#e2b203', '#8590a2', '#1f845a', '#0c66e4'];
  function hashColor(id) {
    var h = 0;
    for (var i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  // Texto legible (negro/blanco) sobre un color de fondo.
  function textOn(hex) {
    var c = hex.replace('#', '');
    var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#172b4d' : '#ffffff';
  }

  function mergeCfg(saved) {
    var out = {};
    Object.keys(DEFAULT_CFG).forEach(function (k) { out[k] = DEFAULT_CFG[k]; });
    if (saved && typeof saved === 'object') {
      Object.keys(saved).forEach(function (k) { if (k in DEFAULT_CFG) out[k] = saved[k]; });
    }
    return out;
  }

  // Devuelve el "t" del iframe: el real de Trello o el simulado (modo demo).
  function getT() {
    var inTrello = window.top !== window.self && !/[?&]demo=1/.test(location.search);
    if (inTrello && window.TrelloPowerUp) {
      var opts = {};
      if (window.CAL_CONFIG && window.CAL_CONFIG.APP_KEY) {
        opts.appKey = window.CAL_CONFIG.APP_KEY;
        opts.appName = window.CAL_CONFIG.APP_NAME;
        opts.appAuthor = window.CAL_CONFIG.APP_AUTHOR;
      }
      return window.TrelloPowerUp.iframe(opts);
    }
    if (window.CalMock) return window.CalMock.create();
    throw new Error('No se pudo inicializar el cliente de Trello');
  }

  // Adjuntos guardados en Cloudflare R2 (enlaces a <DOWNLOAD_URL>/f/…): se marcan con a.r2 y, si
  // llevan miniatura (carpeta acabada en ".t"), se les pone en previews para que todo el calendario
  // los trate como un adjunto de Trello con vista previa.
  function r2Fix(a) {
    var base = String((window.CAL_CONFIG || {}).DOWNLOAD_URL || '').replace(/\/+$/, '');
    if (!a || !base || a.isUpload || typeof a.url !== 'string' || a.url.indexOf(base + '/f/c/') !== 0) return a;
    a.r2 = true;
    var m = a.url.slice(base.length).match(/^\/f\/c\/[0-9a-f]{24}\/[0-9a-f]{32}\.t\//);
    if (m && !(a.previews || []).some(function (p) { return p.url; })) {
      a.previews = [{ url: base + m[0] + '_thumb.jpg', width: 640, height: 640 }];
    }
    return a;
  }

  // Marca los adjuntos especiales: R2 (a.r2) y Google Drive (a.drive, ver js/drive.js).
  function fixAtt(a) {
    r2Fix(a);
    if (window.CalDrive) window.CalDrive.fix(a);
    return a;
  }

  window.CalShared = {
    r2Fix: r2Fix,
    fixAtt: fixAtt,
    DEFAULT_CFG: DEFAULT_CFG,
    labelColor: labelColor,
    hashColor: hashColor,
    textOn: textOn,
    mergeCfg: mergeCfg,
    getT: getT
  };
})();
