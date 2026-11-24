/* Pantalla de «Novedades»: se muestra UNA vez a cada usuario al abrir el calendario.
 *
 * Para cambiar el contenido: edita ITEMS y sube VERSION (así vuelve a salir a todos).
 * Para quitarla del todo: borra este archivo, su <script> en calendar.html
 * y la línea «CalWhatsNew» al final de js/calendar.js.
 * Para verla otra vez al probar: añade ?novedades=1 a la URL del calendario. */
(function () {
  'use strict';

  var VERSION = '2026-11-rediseno';
  var KEY = 'novedades';

  var ITEMS = [
    { ico: '🗓', t: 'Semana con horas',
      d: 'Cada tarjeta a su hora, línea de «ahora» y fila «Todo el día». Al arrastrar cambias el día y la hora; un clic en un hueco crea una tarjeta a esa hora.' },
    { ico: '👀', t: 'Vista rápida y crear en línea',
      d: 'Pasa el ratón por una tarjeta para ver su copy y completarla o moverla sin abrirla. El «+» de cada día abre un mini formulario ahí mismo.' },
    { ico: '🃏', t: 'Tarjeta nueva',
      d: 'Estado, fecha y responsables arriba; el copy en bloques con contador; checklist con progreso; archivos y conversación a la derecha. J / K para pasar a la siguiente tarjeta del día.' },
    { ico: '📱', t: 'Vista previa lado a lado',
      d: 'Todas las redes a la vez, el copy se edita con la vista previa en directo y hay una revisión antes de publicar.' },
    { ico: '⬆️', t: 'Sube archivos arrastrando o pegando',
      d: 'Suéltalos en la tarjeta o pégalos con ⌘V. También los vídeos grandes.' }
  ];

  var CSS = '' +
    '.wn-wrap{position:fixed;inset:0;z-index:40;background:rgba(9,30,66,.5);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.wn{background:var(--surface);color:var(--text);border-radius:14px;max-width:460px;width:100%;max-height:calc(100% - 32px);overflow:auto;' +
      'box-shadow:0 16px 40px rgba(0,0,0,.4);padding:22px 22px 18px}' +
    '.wn-k{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:0 0 4px}' +
    '.wn h2{font-size:20px;margin:0 0 14px}' +
    '.wn ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}' +
    '.wn li{display:flex;gap:12px;align-items:flex-start}' +
    '.wn-i{flex:none;width:34px;height:34px;border-radius:9px;background:var(--accent-soft);display:grid;place-items:center;font-size:17px}' +
    '.wn li strong{display:block;font-size:14px;margin-bottom:1px}' +
    '.wn li span{font-size:13px;color:var(--muted);line-height:1.4}' +
    '.wn-f{display:flex;justify-content:flex-end;margin-top:18px}';

  function read(t) {
    var force = /[?&]novedades=1/.test(location.search);
    if (force) return Promise.resolve(null);
    var local = null;
    try { local = localStorage.getItem('cal-' + KEY); } catch (e) {}
    if (local === VERSION) return Promise.resolve(VERSION);
    return Promise.resolve(t && t.get ? t.get('member', 'private', KEY) : null).catch(function () { return null; });
  }
  function markSeen(t) {
    try { localStorage.setItem('cal-' + KEY, VERSION); } catch (e) {}
    if (t && t.set) Promise.resolve(t.set('member', 'private', KEY, VERSION)).catch(function () {});
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function show(t) {
    if (document.querySelector('.wn-wrap')) return;
    if (!document.getElementById('wn-css')) {
      var st = document.createElement('style'); st.id = 'wn-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var w = document.createElement('div');
    w.className = 'wn-wrap';
    w.innerHTML = '<div class="wn" role="dialog" aria-modal="true" aria-labelledby="wn-t">' +
      '<p class="wn-k">Novedades</p><h2 id="wn-t">El calendario se ha renovado</h2><ul>' +
      ITEMS.map(function (it) {
        return '<li><span class="wn-i" aria-hidden="true">' + it.ico + '</span><div><strong>' + esc(it.t) + '</strong><span>' + esc(it.d) + '</span></div></li>';
      }).join('') +
      '</ul><div class="wn-f"><button class="btn primary" data-wn-ok>Entendido</button></div></div>';
    function close() { w.remove(); document.removeEventListener('keydown', onKey, true); markSeen(t); }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); close(); } }
    w.addEventListener('click', function (e) { if (e.target === w || e.target.closest('[data-wn-ok]')) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(w);
    var ok = w.querySelector('[data-wn-ok]'); if (ok) ok.focus();
  }

  window.CalWhatsNew = {
    maybeShow: function (t) {
      read(t).then(function (seen) { if (seen !== VERSION) show(t); });
    },
    show: show
  };
})();
