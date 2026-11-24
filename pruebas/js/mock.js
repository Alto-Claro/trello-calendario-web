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
      { id: 'l5', name: 'Redes', color: 'orange_light' },
      { id: 'l6', name: 'Instagram', color: 'pink' },
      { id: 'l7', name: 'LinkedIn', color: 'blue_dark' },
      { id: 'l8', name: 'TikTok', color: 'black' },
      { id: 'l9', name: 'Reel', color: 'purple_light' },
      { id: 'l10', name: 'Story', color: 'yellow_light' },
      { id: 'l11', name: 'Carrusel', color: 'sky_light' }
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
      card('Renovar dominio', 'L1', null, null, ['l2'], []),
      card('Plantilla: Post para redes', 'L1', null, null, ['l5'], []),
      card('Plantilla: Informe mensual cliente', 'L3', null, null, ['l1'], [])
    ];
    cards[cards.length - 1].isTemplate = true;
    cards[cards.length - 2].isTemplate = true;
    cards[0].cover = { idAttachment: 'a2' };
    lists[2].name = 'Require Edits'; lists[3].name = 'Approval';
    cards[0].desc = '## 🎯 Objetivo\n\nPreparar la **reunión de kickoff** con el cliente, *sin prisas* y ~~con~~ sin powerpoint.\n\n---\n\n### Agenda\n\n- Presentaciones\n- Revisión del **briefing**\n  - Tono de marca\n1. Calendario\n2. Siguientes pasos\n\n> Nota: confirmar sala el lunes.\n\nAgenda: https://ejemplo.com/agenda · \\#noesuntitulo · `código`';
    var extra = {
      c1: {
        checklists: [{ id: 'cl1', name: 'Preparación', checkItems: [
          { id: 'i1', name: 'Enviar convocatoria', state: 'complete', pos: 1 },
          { id: 'i2', name: 'Preparar presentación', state: 'incomplete', pos: 2 },
          { id: 'i3', name: 'Reservar sala', state: 'incomplete', pos: 3 }] }],
        attachments: [
          { id: 'a1', name: 'Briefing.pdf', url: 'https://ejemplo.com/briefing.pdf', mimeType: 'application/pdf', isUpload: true, date: iso(-1, 10) },
          { id: 'a2', name: 'Moodboard.svg', url: './img/demo/foto1.svg', mimeType: 'image/svg+xml', isUpload: true, bytes: 48000, date: iso(-1, 11) },
          { id: 'a3', name: 'Sesión de fotos.svg', url: './img/demo/foto2.svg', mimeType: 'image/svg+xml', isUpload: true, bytes: 52000, date: iso(-1, 12) },
          { id: 'a4', name: 'Producto.svg', url: './img/demo/foto3.svg', mimeType: 'image/svg+xml', isUpload: true, bytes: 51000, date: iso(-1, 12) },
          { id: 'a5', name: 'Spot 15s.mp4', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', mimeType: 'video/mp4', isUpload: false, bytes: 1100000, date: iso(-1, 13) }
        ],
        actions: [{ id: 'x1', date: iso(-1, 16), data: { text: 'Confirmado con el cliente para el martes.' }, memberCreator: members[1] }]
      }
    };
    cards[0].badges = { checkItems: 3, checkItemsChecked: 1, comments: 1 };
    cards[0].attachments = extra.c1.attachments;
    var mk = cards.filter(function (c) { return /Mockups/.test(c.name); })[0];
    if (mk) mk.attachments = [{ id: 'a9', name: 'mockup.svg', url: './img/demo/foto3.svg', mimeType: 'image/svg+xml' }];
    var fp = cards.filter(function (c) { return /Fotos producto/.test(c.name); })[0];
    if (fp) { fp.attachments = [{ id: 'a8', name: 'fotos.svg', url: './img/demo/foto2.svg', mimeType: 'image/svg+xml' }]; fp.cover = { idAttachment: 'a8' }; }
    // Posts de redes con texto y medios para la vista previa.
    function byName(re) { return cards.filter(function (c) { return re.test(c.name); })[0]; }
    var li = byName(/post LinkedIn/);
    li.labels = L(['l5', 'l7']);
    li.desc = '🚀 Hoy cumplimos 10 años ayudando a marcas a contar su historia.\n\nGracias a cada cliente que confió en nosotros, y al equipo que lo hace posible cada día. Esto no ha hecho más que empezar.\n\n#Aniversario #Marketing #Branding';
    li.attachments = [{ id: 'b1', name: 'aniversario.svg', url: './img/demo/foto1.svg', mimeType: 'image/svg+xml' }];
    var st = byName(/Stories Instagram/);
    st.labels = L(['l6', 'l10']);
    st.desc = 'Detrás de las cámaras de la sesión de hoy 📸 #backstage';
    st.attachments = [{ id: 'b2', name: 'story.svg', url: './img/demo/foto2.svg', mimeType: 'image/svg+xml' }];
    var fp2 = byName(/Fotos producto/);
    fp2.labels = L(['l3', 'l6', 'l11']);
    fp2.desc = 'Nueva colección de otoño 🍂 Desliza para ver todos los colores y dinos cuál es tu favorito en comentarios 👇\n\nDisponible desde hoy en tienda y online.\n\n#otoño #nuevacoleccion #diseño @altoyclaro';
    fp2.attachments = [
      { id: 'a8', name: 'fotos.svg', url: './img/demo/foto2.svg', mimeType: 'image/svg+xml' },
      { id: 'b3', name: 'color2.svg', url: './img/demo/foto1.svg', mimeType: 'image/svg+xml' },
      { id: 'b4', name: 'color3.svg', url: './img/demo/foto3.svg', mimeType: 'image/svg+xml' }
    ];
    cards.splice(12, 0, card('Vídeo TikTok receta rápida', 'L2', iso(2, 13), null, ['l6', 'l9', 'l8'], ['m3']));
    var tk = cards[12];
    tk.desc = 'Receta en 30 segundos 🌸 ¿La probáis? #receta #fyp';
    tk.attachments = [{ id: 'b5', name: 'receta.mp4', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', mimeType: 'video/mp4', isUpload: true, bytes: 1100000 }];
    tk.desc = '📅 **Publicación:** 20/11/2026 13:00\n📌 **Estado:** Pendiente\n\n---\n\n## ✍️ Contenido / Copy\n\nReceta en 30 segundos 🌸 ¿La probáis? #receta #fyp\n\n---\n\n## ✍️ Copy · TikTok\n\nPOV: tienes 30 segundos y hambre 🌸 #receta #fyp #parati';

    extra[tk.id] = {
      checklists: [{ id: 'cl9', name: 'Producción', checkItems: [
        { id: 'k1', name: 'Guion', state: 'complete', pos: 1, idMember: 'm3', due: iso(-4, 12) },
        { id: 'k2', name: 'Grabación', state: 'complete', pos: 2, idMember: 'm1', due: iso(-1, 12) },
        { id: 'k3', name: 'Edición y montaje', state: 'incomplete', pos: 3, idMember: 'm3', due: iso(1, 12) },
        { id: 'k4', name: 'Subtítulos', state: 'incomplete', pos: 4 },
        { id: 'k5', name: 'Aprobación del cliente', state: 'incomplete', pos: 5, idMember: 'm2', due: iso(2, 10) }] }],
      attachments: tk.attachments,
      actions: [
        { id: 'y5', type: 'commentCard', date: iso(0, 8), data: { text: 'Perfecta. Se lo paso al cliente para aprobar.' }, memberCreator: members[1] },
        { id: 'y4', type: 'addAttachmentToCard', date: iso(0, 7), data: { attachment: { name: 'receta.mp4' } }, memberCreator: members[2] },
        { id: 'y3', type: 'commentCard', date: iso(-1, 19), data: { text: 'Hecho, subo la versión nueva por la mañana 👍' }, memberCreator: members[2] },
        { id: 'y2', type: 'updateCard', date: iso(-1, 18), data: { listBefore: { name: 'Pendiente' }, listAfter: { name: 'En curso' } }, memberCreator: members[2] },
        { id: 'y1', type: 'commentCard', date: iso(-1, 17), data: { text: '@lucia ¿podemos dejarlo en 30 s? El cliente lo quiere más corto.' }, memberCreator: members[0] }
      ]
    };
    tk.badges = { checkItems: 5, checkItemsChecked: 2, comments: 3 };
    cards[cards.length - 2].isTemplate = true;
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
      member: function () { return Promise.resolve(members[0]); },
      closePopup: function () { return Promise.resolve(); },
      __mockNoAuth: /[?&]noauth=1/.test(location.search),
      getRestApi: function () {
        return { authorize: function () { t.__mockNoAuth = false; return Promise.resolve('demo'); },
                 isAuthorized: function () { return Promise.resolve(!t.__mockNoAuth); } };
      },
      sizeTo: function () { return Promise.resolve(); },
      // Simula la REST API de Trello (PUT /cards/:id y /cards/:id/customField/:id/item)
      __mockWrite: function (path, body, method) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            if (method === 'GET' && /^\/boards\/[^/]+\/cards/.test(path)) {
              return resolve(cards.map(function (c) { return { id: c.id, name: c.name, idList: c.idList, isTemplate: !!c.isTemplate }; }));
            }
            if (method === 'POST' && path === '/cards') {
              var src = body.idCardSource && cards.filter(function (x) { return x.id === body.idCardSource; })[0];
              n++;
              var nc = {
                id: 'c' + n, name: body.name, idList: body.idList, due: body.due || null, start: body.start || null,
                dueComplete: false, closed: false, url: 'https://trello.com/c/demo' + n, shortLink: 'demo' + n,
                labels: src ? src.labels : [], members: src ? src.members : [], customFieldItems: []
              };
              cards.push(nc);
              return resolve(nc);
            }
            var g = path.split('?')[0], mm, cc;
            if (method === 'GET' && (mm = g.match(/^\/cards\/([^/]+)$/))) {
              cc = cards.filter(function (x) { return x.id === mm[1]; })[0];
              var ex = extra[mm[1]] || {};
              return resolve(Object.assign({}, cc, { checklists: ex.checklists || [], attachments: ex.attachments || cc.attachments || [], actions: ex.actions || [] }));
            }
            if ((mm = g.match(/^\/cards\/([^/]+)\/checkItem\/([^/]+)$/))) {
              ((extra[mm[1]] || {}).checklists || []).forEach(function (cl) { cl.checkItems.forEach(function (it) { if (it.id === mm[2]) it.state = body.state; }); });
              return resolve({ id: mm[2], state: body.state });
            }
            if (method === 'POST' && (mm = g.match(/^\/checklists\/([^/]+)\/checkItems$/))) {
              var it = { id: 'i' + Date.now(), name: body.name, state: 'incomplete', pos: 1e9 };
              Object.keys(extra).forEach(function (k) { (extra[k].checklists || []).forEach(function (cl) { if (cl.id === mm[1]) cl.checkItems.push(it); }); });
              return resolve(it);
            }
            if (method === 'POST' && (mm = g.match(/^\/cards\/([^/]+)\/actions\/comments$/))) {
              var a = { id: 'x' + Date.now(), date: new Date().toISOString(), data: { text: body.text }, memberCreator: members[0] };
              extra[mm[1]] = extra[mm[1]] || {}; extra[mm[1]].actions = [a].concat(extra[mm[1]].actions || []);
              return resolve(a);
            }
            if ((mm = g.match(/^\/cards\/([^/]+)\/id(Labels|Members)(?:\/([^/]+))?$/))) {
              cc = cards.filter(function (x) { return x.id === mm[1]; })[0];
              var key = mm[2] === 'Labels' ? 'labels' : 'members', pool = mm[2] === 'Labels' ? labels : members;
              if (method === 'POST') cc[key] = cc[key].concat(pool.filter(function (x) { return x.id === body.value; }));
              else cc[key] = cc[key].filter(function (x) { return x.id !== mm[3]; });
              return resolve([]);
            }
            if (method === 'DELETE' && (mm = g.match(/^\/cards\/([^/]+)\/attachments\/([^/]+)$/))) {
              cc = cards.filter(function (x) { return x.id === mm[1]; })[0];
              var dropA = function (l) { return (l || []).filter(function (x) { return x.id !== mm[2]; }); };
              if (cc) cc.attachments = dropA(cc.attachments);
              if (extra[mm[1]]) extra[mm[1]].attachments = dropA(extra[mm[1]].attachments);
              return resolve({});
            }
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
