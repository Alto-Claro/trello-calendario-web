/* Modo demo: simula el cliente de Trello para probar la vista sin instalar el Power-Up.
 * Se activa abriendo calendar.html directamente (fuera de Trello) o con ?demo=1. */
(function () {
  'use strict';

  function iso(dayOffset, hour) {
    var d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour == null ? 9 : hour, 0, 0, 0);
    return d.toISOString();
  }

  function create() {
    var labels = [
      { id: 'l1', name: 'Cliente', color: 'blue' },
      { id: 'l2', name: 'Urgente', color: 'red' },
      { id: 'l3', name: 'Diseño', color: 'purple' },
      { id: 'l4', name: 'SEO', color: 'green' },
      { id: 'l5', name: 'Redes', color: 'orange_light' }
    ];
    var members = [
      { id: 'm1', fullName: 'Ana López', initials: 'AL', username: 'ana' },
      { id: 'm2', fullName: 'Marc Puig', initials: 'MP', username: 'marc' },
      { id: 'm3', fullName: 'Lucía Gil', initials: 'LG', username: 'lucia' }
    ];
    var lists = [
      { id: 'L1', name: 'Pendiente' }, { id: 'L2', name: 'En curso' },
      { id: 'L3', name: 'Revisión' }, { id: 'L4', name: 'Hecho' }
    ];
    var customFields = [{ id: 'cf1', name: 'Fecha de publicación', type: 'date' }];
    function L(ids) { return labels.filter(function (l) { return ids.indexOf(l.id) !== -1; }); }
    function M(ids) { return members.filter(function (m) { return ids.indexOf(m.id) !== -1; }); }
    var n = 0;
    function card(name, list, due, start, lab, mem, done, cf) {
      n++;
      return {
        id: 'c' + n, name: name, idList: list, due: due, start: start || null,
        dueComplete: !!done, labels: L(lab || []), members: M(mem || []), closed: false,
        url: 'https://trello.com/c/demo' + n, shortLink: 'demo' + n,
        customFieldItems: cf ? [{ idCustomField: 'cf1', value: { date: cf } }] : []
      };
    }
    var cards = [
      card('Reunión de kickoff con cliente', 'L2', iso(0, 10), null, ['l1'], ['m1']),
      card('Entregar propuesta de branding', 'L1', iso(2, 17), iso(-1), ['l1', 'l3'], ['m3']),
      card('Auditoría SEO web corporativa', 'L2', iso(5, 13), iso(1), ['l4'], ['m2']),
      card('Publicar post LinkedIn', 'L1', iso(3, 11), null, ['l5'], ['m1'], false, iso(3, 11)),
      card('Revisar métricas campaña', 'L3', iso(-2, 9), null, ['l2'], ['m2']),
      card('Factura noviembre', 'L4', iso(-4, 12), null, [], ['m1'], true),
      card('Newsletter mensual', 'L1', iso(8, 9), iso(6), ['l5', 'l1'], ['m3'], false, iso(9, 8)),
      card('Mockups landing', 'L2', iso(1, 16), null, ['l3'], ['m3']),
      card('Keyword research Q1', 'L1', iso(12, 10), iso(10), ['l4'], []),
      card('Llamada seguimiento', 'L1', iso(1, 9), null, ['l1'], ['m2']),
      card('Fotos producto', 'L2', iso(1, 12), null, ['l3'], ['m1']),
      card('Stories Instagram', 'L1', iso(1, 18), null, ['l5'], ['m1'], false, iso(1, 18)),
      card('Revisión de contratos', 'L3', iso(1, 15), null, ['l2'], []),
      card('Preparar informe mensual', 'L1', iso(1, 19), null, [], ['m2']),
      card('Optimizar fichas de producto', 'L1', iso(20, 9), iso(15), ['l4'], ['m2']),
      card('Idea: podcast de la agencia', 'L1', null, null, ['l1'], []),
      card('Actualizar portfolio', 'L1', null, null, ['l3'], ['m3']),
      card('Renovar dominio', 'L1', null, null, ['l2'], [])
    ];
    var store = {};
    var renderFn = null;

    function pick(obj, fields) {
      if (fields[0] === 'all') return JSON.parse(JSON.stringify(obj));
      var o = {};
      fields.forEach(function (f) { o[f] = obj[f]; });
      return JSON.parse(JSON.stringify(o));
    }

    var t = {
      cards: function () { return Promise.resolve(JSON.parse(JSON.stringify(cards))); },
      lists: function () { var a = [].slice.call(arguments); return Promise.resolve(lists.map(function (l) { return pick(l, a); })); },
      board: function () {
        var a = [].slice.call(arguments);
        return Promise.resolve(pick({ id: 'B1', name: 'Agencia (demo)', labels: labels, members: members, customFields: customFields }, a));
      },
      get: function (scope, vis, k, def) { var v = store[scope + vis + k]; return Promise.resolve(v === undefined ? def : JSON.parse(v)); },
      set: function (scope, vis, k, v) { store[scope + vis + k] = JSON.stringify(v); return Promise.resolve(); },
      memberCanWriteToModel: function () { return true; },
      showCard: function (id) {
        var c = cards.filter(function (x) { return x.id === id; })[0];
        alert('[demo] Abriría la tarjeta: ' + (c ? c.name : id));
        return Promise.resolve();
      },
      render: function (fn) { renderFn = fn; fn(); },
      closePopup: function () { return Promise.resolve(); },
      sizeTo: function () { return Promise.resolve(); },
      // Simula la REST API de Trello (PUT /cards/:id y /cards/:id/customField/:id/item)
      __mockWrite: function (path, body) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            var m = path.match(/^\/cards\/([^/]+)(?:\/customField\/([^/]+)\/item)?$/);
            var c = m && cards.filter(function (x) { return x.id === m[1]; })[0];
            if (c && m[2]) {
              c.customFieldItems = c.customFieldItems.filter(function (i) { return i.idCustomField !== m[2]; });
              if (body.value && body.value.date) c.customFieldItems.push({ idCustomField: m[2], value: { date: body.value.date } });
            } else if (c) {
              Object.keys(body).forEach(function (k) { c[k] = body[k]; });
            }
            resolve(c);
          }, 250);
        });
      }
    };
    return t;
  }

  window.CalMock = { create: create };
})();
