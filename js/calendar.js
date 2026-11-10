/* Vista de calendario del Power-Up (se abre en un modal a pantalla completa). */
(function () {
  'use strict';

  var S = window.CalShared;
  var C = window.CAL_CONFIG || {};
  var t = S.getT();
  var $ = function (id) { return document.getElementById(id); };

  // ───────────────────────── Estado ─────────────────────────
  var state = {
    cfg: S.mergeCfg(null),
    prefs: { view: null, source: null, hiddenLists: [], labels: [], members: [], completed: null, weekends: null },
    cards: [], lists: [], board: { labels: [], members: [], customFields: [] },
    listById: {}, cfById: {},
    view: 'month', cursor: startOfDay(new Date()), q: '',
    canWrite: false, canEdit: false, templates: [], templateIds: {}, loaded: false
  };

  // ───────────────────────── Fechas ─────────────────────────
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function diffDays(a, b) { return Math.round((fromKey(b) - fromKey(a)) / 864e5); }
  function weekStartOf(d) {
    var diff = (d.getDay() - state.cfg.weekStart + 7) % 7;
    return addDays(d, -diff);
  }
  function fmt(d, o) { return d.toLocaleDateString(state.cfg.locale, o); }
  function fmtTime(d) { return d.toLocaleTimeString(state.cfg.locale, { hour: '2-digit', minute: '2-digit' }); }
  function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }

  // Mueve la fecha `iso` al día `dayKey` conservando la hora (o la hora por defecto).
  function moveToDay(iso, dayKey) {
    var target = fromKey(dayKey);
    if (iso) {
      var old = new Date(iso);
      target.setHours(old.getHours(), old.getMinutes(), 0, 0);
    } else {
      target.setHours(state.cfg.defaultHour, 0, 0, 0);
    }
    return target.toISOString();
  }
  function shiftIso(iso, days) {
    if (!iso) return null;
    var d = new Date(iso), n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days,
      d.getHours(), d.getMinutes(), d.getSeconds());
    return n.toISOString();
  }

  // ───────────────────────── Utilidades ─────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  var toastTimer;
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg; el.className = 'toast' + (isErr ? ' err' : ''); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }
  function source() { return state.prefs.source || state.cfg.dateSource; }
  function showCompleted() { return state.prefs.completed != null ? state.prefs.completed : state.cfg.showCompleted; }
  function showWeekends() { return state.prefs.weekends != null ? state.prefs.weekends : state.cfg.showWeekends; }

  // ───────────────────────── Modelo de eventos ─────────────────────────
  // Devuelve {startKey, endKey, time(Date|null)} según la fuente de fecha, o null si no tiene fecha.
  function eventOf(card) {
    var src = source(), s = null, e = null, time = null;
    if (src === 'due') { s = e = card.due; time = card.due; }
    else if (src === 'start') { s = e = card.start; }
    else if (src === 'range') {
      s = card.start || card.due; e = card.due || card.start; time = card.due;
      if (s && e && new Date(s) > new Date(e)) s = e;
    } else if (src.indexOf('cf:') === 0) {
      var id = src.slice(3);
      var item = (card.customFieldItems || []).filter(function (i) { return i.idCustomField === id; })[0];
      if (item && item.value && item.value.date) { s = e = time = item.value.date; }
    }
    if (!s) return null;
    return { startKey: key(new Date(s)), endKey: key(new Date(e)), time: time ? new Date(time) : null };
  }

  function passesFilters(card) {
    var p = state.prefs;
    if (!showCompleted() && card.dueComplete) return false;
    if (p.hiddenLists.indexOf(card.idList) !== -1) return false;
    if (p.labels.length) {
      var ids = (card.labels || []).map(function (l) { return l.id; });
      if (!ids.length) ids = ['__none'];
      if (!ids.some(function (id) { return p.labels.indexOf(id) !== -1; })) return false;
    }
    if (p.members.length) {
      var mids = (card.members || []).map(function (m) { return m.id; });
      if (!mids.length) mids = ['__none'];
      if (!mids.some(function (id) { return p.members.indexOf(id) !== -1; })) return false;
    }
    if (state.q) {
      var hay = norm(card.name) + ' ' + norm((state.listById[card.idList] || {}).name) + ' ' +
        (card.labels || []).map(function (l) { return norm(l.name); }).join(' ');
      if (hay.indexOf(norm(state.q)) === -1) return false;
    }
    return true;
  }

  // Índice: dayKey → [{card, ev}]
  function buildIndex() {
    var idx = {}, unscheduled = [];
    state.cards.forEach(function (card) {
      if (state.templateIds[card.id] || !passesFilters(card)) return;
      var ev = eventOf(card);
      if (!ev) { unscheduled.push(card); return; }
      var span = Math.min(diffDays(ev.startKey, ev.endKey), 366);
      for (var i = 0; i <= span; i++) {
        var k = key(addDays(fromKey(ev.startKey), i));
        (idx[k] = idx[k] || []).push({ card: card, ev: ev });
      }
    });
    Object.keys(idx).forEach(function (k) {
      idx[k].sort(function (a, b) {
        var ta = a.ev.time ? a.ev.time.getTime() : 0, tb = b.ev.time ? b.ev.time.getTime() : 0;
        if (a.ev.startKey !== b.ev.startKey) return a.ev.startKey < b.ev.startKey ? -1 : 1;
        return ta - tb || String(a.card.name).localeCompare(b.card.name);
      });
    });
    return { idx: idx, unscheduled: unscheduled };
  }

  function colorsFor(card) {
    var by = state.cfg.colorBy, bg = null;
    if (by === 'label' && card.labels && card.labels.length) bg = S.labelColor(card.labels[0].color);
    else if (by === 'list') bg = S.hashColor(card.idList);
    else if (by === 'member' && card.members && card.members.length) bg = S.hashColor(card.members[0].id);
    else if (by === 'status') {
      bg = card.dueComplete ? '#4bce97' : (card.due && new Date(card.due) < new Date() ? '#f87462' : '#579dff');
    }
    return bg ? { bg: bg, fg: S.textOn(bg) } : null;
  }

  // ───────────────────────── Render de un evento ─────────────────────────
  function evHtml(card, ev, dayKey, mode) {
    var cls = ['ev'];
    if (card.dueComplete) cls.push('done');
    else if (card.due && new Date(card.due) < new Date()) cls.push('overdue');
    if (ev && dayKey) {
      if (dayKey !== ev.startKey) cls.push('cont-l');
      if (dayKey !== ev.endKey) cls.push('cont-r');
    }
    var col = colorsFor(card);
    var style = col ? ' style="--ev-bg:' + col.bg + ';--ev-fg:' + col.fg + '"' : '';
    var showTime = ev && ev.time && (!dayKey || dayKey === ev.endKey);
    var time = showTime ? '<span class="time">' + fmtTime(ev.time) + '</span>' : '';
    var m = (card.members || [])[0], av = '';
    if (m && mode !== 'side') {
      av = m.avatar
        ? '<span class="av" style="background-image:url(' + esc(m.avatar) + '/30.png)" title="' + esc(m.fullName) + '"></span>'
        : '<span class="av" title="' + esc(m.fullName) + '">' + esc(m.initials || '') + '</span>';
    }
    var meta = '';
    if (mode === 'agenda') {
      var list = state.listById[card.idList];
      meta = '<span class="meta">' + esc(list ? list.name : '') + '</span>';
    }
    var tip = card.name + (state.listById[card.idList] ? ' — ' + state.listById[card.idList].name : '');
    return '<div class="' + cls.join(' ') + '"' + style + ' tabindex="0" role="button"' +
      ' data-id="' + esc(card.id) + '"' + (dayKey ? ' data-from="' + dayKey + '"' : '') +
      (state.canEdit ? ' draggable="true"' : '') + ' title="' + esc(tip) + '">' +
      time + '<span class="name">' + esc(card.name) + '</span>' + meta + av + '</div>';
  }

  // ───────────────────────── Vistas ─────────────────────────
  var MAX_PER_CELL = 5;
  function addBtn(k) {
    return state.canEdit ? '<button class="add" data-add="' + k + '" title="Añadir tarjeta" aria-label="Añadir tarjeta">+</button>' : '';
  }

  function daysRow(first, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var d = addDays(first, i);
      if (!showWeekends() && isWeekend(d)) continue;
      out.push(d);
    }
    return out;
  }

  function renderDow(days) {
    return '<div class="dow">' + days.map(function (d) {
      return '<div>' + esc(fmt(d, { weekday: 'short' })) + '</div>';
    }).join('') + '</div>';
  }

  function renderMonth(idx) {
    var c = state.cursor, first = new Date(c.getFullYear(), c.getMonth(), 1);
    var gridStart = weekStartOf(first);
    var last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
    var weeks = Math.ceil((diffDays(key(gridStart), key(last)) + 1) / 7);
    var days = daysRow(gridStart, weeks * 7), today = key(new Date());
    var cols = showWeekends() ? 7 : 5;
    var html = '<div style="--cols:' + cols + '" class="month">' + renderDow(days.slice(0, cols)) + '<div class="grid">';
    days.forEach(function (d) {
      var k = key(d), items = idx[k] || [];
      var cls = 'day' + (d.getMonth() !== c.getMonth() ? ' other' : '') + (k === today ? ' today' : '');
      html += '<div class="' + cls + '" data-date="' + k + '"><div class="dhead"><span class="dnum">' + d.getDate() + '</span>' + addBtn(k) + '</div><div class="events">';
      items.slice(0, MAX_PER_CELL).forEach(function (it) { html += evHtml(it.card, it.ev, k, 'month'); });
      if (items.length > MAX_PER_CELL) {
        html += '<button class="more" data-goto="' + k + '">+' + (items.length - MAX_PER_CELL) + ' más</button>';
      }
      html += '</div></div>';
    });
    $('cal').innerHTML = html + '</div></div>';
    $('cal').firstChild.style.display = 'flex';
    $('cal').firstChild.style.flexDirection = 'column';
    $('cal').firstChild.style.flex = '1';
  }

  function renderWeek(idx) {
    var days = daysRow(weekStartOf(state.cursor), 7), today = key(new Date());
    var html = '<div class="week" style="--cols:' + days.length + ';display:flex;flex-direction:column;flex:1">' +
      '<div class="dow">' + days.map(function (d) {
        return '<div>' + esc(fmt(d, { weekday: 'short' })) + ' ' + d.getDate() + '</div>';
      }).join('') + '</div><div class="grid">';
    days.forEach(function (d) {
      var k = key(d), items = idx[k] || [];
      html += '<div class="day' + (k === today ? ' today' : '') + '" data-date="' + k + '"><div class="dhead">' + addBtn(k) + '</div><div class="events">';
      items.forEach(function (it) { html += evHtml(it.card, it.ev, k, 'week'); });
      html += '</div></div>';
    });
    $('cal').innerHTML = html + '</div></div>';
  }

  function renderAgenda(idx) {
    var html = '<div class="agenda">', today = key(new Date()), any = false;
    for (var i = 0; i < state.cfg.agendaDays; i++) {
      var d = addDays(state.cursor, i), k = key(d), items = idx[k] || [];
      if (!items.length) continue;
      any = true;
      html += '<div class="aday' + (k === today ? ' today' : '') + '" data-date="' + k + '">' +
        '<div class="adate">' + addBtn(k) + esc(fmt(d, { weekday: 'long', day: 'numeric' })) +
        '<small>' + esc(fmt(d, { month: 'long', year: 'numeric' })) + '</small></div><div class="events">';
      items.forEach(function (it) { html += evHtml(it.card, it.ev, k, 'agenda'); });
      html += '</div></div>';
    }
    if (!any) html += '<div class="empty">No hay tarjetas con fecha en estos ' + state.cfg.agendaDays + ' días.</div>';
    $('cal').innerHTML = html + '</div>';
  }

  function renderTitle() {
    var c = state.cursor, txt;
    if (state.view === 'month') txt = fmt(c, { month: 'long', year: 'numeric' });
    else {
      var a = state.view === 'week' ? weekStartOf(c) : c;
      var b = addDays(a, state.view === 'week' ? 6 : state.cfg.agendaDays - 1);
      txt = fmt(a, { day: 'numeric', month: 'short' }) + ' – ' + fmt(b, { day: 'numeric', month: 'short', year: 'numeric' });
    }
    $('title').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
  }

  function renderUnscheduled(list) {
    $('ucount').textContent = list.length;
    $('unschedHint').textContent = state.canWrite
      ? 'Arrastra una tarjeta a un día para programarla. Suelta aquí una tarjeta del calendario para quitarle la fecha.'
      : 'Tarjetas sin fecha con los filtros actuales.';
    $('unschedList').innerHTML = list.length
      ? list.map(function (c) { return evHtml(c, null, null, 'side'); }).join('')
      : '<p class="hint">Todas las tarjetas tienen fecha.</p>';
  }

  function render() {
    if (!state.loaded) return;
    var r = buildIndex();
    renderTitle();
    if (state.view === 'month') renderMonth(r.idx);
    else if (state.view === 'week') renderWeek(r.idx);
    else renderAgenda(r.idx);
    renderUnscheduled(r.unscheduled);
    var n = state.prefs.hiddenLists.length + state.prefs.labels.length + state.prefs.members.length;
    $('fcount').hidden = !n; $('fcount').textContent = n;
  }

  // ───────────────────────── Filtros ─────────────────────────
  function renderFilters() {
    var p = state.prefs;
    $('fCompleted').checked = showCompleted();
    $('fWeekends').checked = showWeekends();
    $('fLists').innerHTML = state.lists.map(function (l) {
      return '<label class="chk"><input type="checkbox" data-f="list" value="' + esc(l.id) + '"' +
        (p.hiddenLists.indexOf(l.id) === -1 ? ' checked' : '') + '>' +
        '<span class="swatch" style="background:' + S.hashColor(l.id) + '"></span>' + esc(l.name) + '</label>';
    }).join('');
    var labels = (state.board.labels || []).concat([{ id: '__none', name: 'Sin etiqueta', color: null }]);
    $('fLabels').innerHTML = labels.map(function (l) {
      return '<label class="chk"><input type="checkbox" data-f="label" value="' + esc(l.id) + '"' +
        (p.labels.indexOf(l.id) !== -1 ? ' checked' : '') + '>' +
        '<span class="swatch" style="background:' + S.labelColor(l.color) + '"></span>' +
        esc(l.name || '(' + (l.color || 'sin color') + ')') + '</label>';
    }).join('');
    var members = (state.board.members || []).concat([{ id: '__none', fullName: 'Sin asignar' }]);
    $('fMembers').innerHTML = members.map(function (m) {
      return '<label class="chk"><input type="checkbox" data-f="member" value="' + esc(m.id) + '"' +
        (p.members.indexOf(m.id) !== -1 ? ' checked' : '') + '>' + esc(m.fullName || m.username) + '</label>';
    }).join('');
  }

  function renderSourceSelect() {
    var opts = [['due', 'Vencimiento'], ['start', 'Inicio'], ['range', 'Inicio → vencimiento']];
    (state.board.customFields || []).forEach(function (cf) {
      if (cf.type === 'date') opts.push(['cf:' + cf.id, cf.name]);
    });
    var cur = source();
    if (!opts.some(function (o) { return o[0] === cur; })) { state.prefs.source = null; cur = state.cfg.dateSource; }
    $('source').innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }

  var saveTimer;
  function savePrefs() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      t.set('member', 'private', 'prefs', state.prefs).catch(function () { /* límite de 4096 chars, no es crítico */ });
    }, 400);
  }

  // ───────────────────────── Escritura en Trello ─────────────────────────
  // Token: el de t.getRestApi() (ventana de Trello) o el pegado a mano (guardado en privado por miembro).
  function getToken() {
    return Promise.resolve().then(function () { return t.getRestApi().getToken(); })
      .catch(function () { return null; })
      .then(function (tok) { return tok || t.get('member', 'private', 'apiTok'); });
  }
  function authUrl() {
    return 'https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token' +
      '&name=' + encodeURIComponent(C.APP_NAME || 'Calendario') + '&key=' + encodeURIComponent(C.APP_KEY);
  }
  function saveManualToken() {
    var tok = ($('tokIn').value || '').trim().replace(/^.*token=/, '');
    if (!/^[A-Za-z0-9]{32,}$/.test(tok)) { toast('Ese código no parece válido. Copia el texto completo que muestra Trello.', true); return; }
    $('tokSave').disabled = true;
    fetch('https://api.trello.com/1/members/me?fields=username&key=' + encodeURIComponent(C.APP_KEY) + '&token=' + encodeURIComponent(tok))
      .then(function (r) { if (!r.ok) throw new Error('Trello rechazó el código (HTTP ' + r.status + ')'); return r.json(); })
      .then(function () { return t.set('member', 'private', 'apiTok', tok); })
      .then(function () { return checkAuth(); })
      .then(function () {
        var after = pendingNew; pendingNew = null;
        closeDialog(); render(); toast('Autorizado: ya puedes mover y crear tarjetas');
        if (after) openNew(after);
      })
      .catch(function (err) { toast(err && err.message ? err.message : String(err), true); })
      .then(function () { $('tokSave').disabled = false; });
  }
  function apiPut(path, body) { return apiRequest('PUT', path, body); }
  function apiRequest(method, path, body) {
    if (t.__mockWrite) return t.__mockWrite(path, body, method);
    return getToken().then(function (token) {
      if (!token) throw new Error('No autorizado');
      var url = 'https://api.trello.com/1' + path + (path.indexOf('?') === -1 ? '?' : '&') +
        'key=' + encodeURIComponent(C.APP_KEY) + '&token=' + encodeURIComponent(token);
      return fetch(url, {
        method: method, headers: { 'Content-Type': 'application/json' },
        body: body && method !== 'GET' ? JSON.stringify(body) : undefined
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (txt) { throw new Error(txt || ('HTTP ' + r.status)); });
        return r.json();
      });
    });
  }

  // Aplica el cambio de fecha (dayKey = null → quitar fecha).
  function reschedule(card, dayKey, fromDay) {
    var src = source(), body = {}, cfId = null, local = {};
    var ev = eventOf(card);
    if (src === 'due') { local.due = body.due = dayKey ? moveToDay(card.due, dayKey) : null; }
    else if (src === 'start') { local.start = body.start = dayKey ? moveToDay(card.start, dayKey) : null; }
    else if (src === 'range') {
      if (!dayKey) { local.start = body.start = null; local.due = body.due = null; }
      else if (ev && fromDay) {
        var delta = diffDays(fromDay, dayKey);
        if (card.start) local.start = body.start = shiftIso(card.start, delta);
        if (card.due) local.due = body.due = shiftIso(card.due, delta);
      } else { local.due = body.due = moveToDay(null, dayKey); }
    } else if (src.indexOf('cf:') === 0) {
      cfId = src.slice(3);
      var item = (card.customFieldItems || []).filter(function (i) { return i.idCustomField === cfId; })[0];
      var iso = dayKey ? moveToDay(item && item.value && item.value.date, dayKey) : null;
      local.cf = iso;
    }
    if (ev && dayKey && fromDay === dayKey) return; // soltado en el mismo día

    // Actualización optimista
    var backup = JSON.parse(JSON.stringify(card));
    if ('due' in local) card.due = local.due;
    if ('start' in local) card.start = local.start;
    if (cfId) {
      card.customFieldItems = (card.customFieldItems || []).filter(function (i) { return i.idCustomField !== cfId; });
      if (local.cf) card.customFieldItems.push({ idCustomField: cfId, value: { date: local.cf } });
    }
    render();

    var p = cfId
      ? apiPut('/cards/' + card.id + '/customField/' + cfId + '/item', { value: local.cf ? { date: local.cf } : '' })
      : apiPut('/cards/' + card.id, body);
    p.then(function () {
      toast(dayKey ? '“' + card.name + '” → ' + fmt(fromKey(dayKey), { weekday: 'short', day: 'numeric', month: 'short' })
                   : 'Fecha quitada de “' + card.name + '”');
    }).catch(function (err) {
      Object.keys(backup).forEach(function (k) { card[k] = backup[k]; });
      render();
      toast('No se pudo guardar: ' + (err && err.message ? err.message : err), true);
    });
  }

  // ───────────────────────── Exportar .ics ─────────────────────────
  function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function exportIcs() {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendario Libre//Trello Power-Up//ES', 'CALSCALE:GREGORIAN'];
    var now = icsDate(new Date()), n = 0;
    state.cards.forEach(function (card) {
      if (!passesFilters(card)) return;
      var ev = eventOf(card);
      if (!ev) return;
      n++;
      lines.push('BEGIN:VEVENT', 'UID:' + card.id + '-' + source().replace(':', '') + '@trello', 'DTSTAMP:' + now);
      if (ev.time && ev.startKey === ev.endKey) {
        lines.push('DTSTART:' + icsDate(ev.time), 'DTEND:' + icsDate(new Date(ev.time.getTime() + 30 * 6e4)));
      } else {
        lines.push('DTSTART;VALUE=DATE:' + ev.startKey.replace(/-/g, ''),
          'DTEND;VALUE=DATE:' + key(addDays(fromKey(ev.endKey), 1)).replace(/-/g, ''));
      }
      lines.push('SUMMARY:' + icsEsc(card.name));
      if (card.url) lines.push('URL:' + card.url, 'DESCRIPTION:' + icsEsc(card.url));
      if (card.dueComplete) lines.push('STATUS:COMPLETED');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trello-calendario.ics';
    document.body.appendChild(a); a.click(); a.remove();
    toast(n + ' eventos exportados');
  }

  // ───────────────────────── Navegación ─────────────────────────
  function move(dir) {
    var c = state.cursor;
    if (state.view === 'month') state.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    else if (state.view === 'week') state.cursor = addDays(c, 7 * dir);
    else state.cursor = addDays(c, state.cfg.agendaDays * dir);
    render();
  }
  function setView(v) { state.view = v; state.prefs.view = v; savePrefs(); render(); }

  // ───────────────────────── Eventos de UI ─────────────────────────
  function bindUi() {
    $('today').onclick = function () { state.cursor = startOfDay(new Date()); render(); };
    $('prev').onclick = function () { move(-1); };
    $('next').onclick = function () { move(1); };
    $('refresh').onclick = function () { load().then(function () { toast('Actualizado'); }); };
    $('icsBtn').onclick = exportIcs;
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = function () { setView(b.getAttribute('data-view')); };
    });
    var qTimer;
    $('q').oninput = function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = e.target.value.trim(); render(); }, 150); };
    $('source').onchange = function (e) {
      state.prefs.source = e.target.value === state.cfg.dateSource ? null : e.target.value;
      savePrefs(); render();
    };
    function togglePanel(id, other) {
      $(other).hidden = true;
      $(id).hidden = !$(id).hidden;
      $('filtersBtn').classList.toggle('active', !$('filters').hidden);
      $('unschedBtn').classList.toggle('active', !$('unsched').hidden);
    }
    $('filtersBtn').onclick = function () { togglePanel('filters', 'unsched'); };
    $('unschedBtn').onclick = function () { togglePanel('unsched', 'filters'); };

    $('filters').addEventListener('change', function (e) {
      var el = e.target, p = state.prefs;
      if (el.id === 'fCompleted') p.completed = el.checked;
      else if (el.id === 'fWeekends') p.weekends = el.checked;
      else {
        var f = el.getAttribute('data-f'), v = el.value;
        var arr = f === 'list' ? p.hiddenLists : f === 'label' ? p.labels : p.members;
        var want = f === 'list' ? !el.checked : el.checked;
        var i = arr.indexOf(v);
        if (want && i === -1) arr.push(v);
        if (!want && i !== -1) arr.splice(i, 1);
      }
      savePrefs(); render();
    });
    $('fClear').onclick = function () {
      state.prefs.hiddenLists = []; state.prefs.labels = []; state.prefs.members = [];
      state.prefs.completed = null; state.prefs.weekends = null;
      renderFilters(); savePrefs(); render();
    };

    // Abrir tarjeta / "+N más"
    document.body.addEventListener('click', function (e) {
      var more = e.target.closest('.more');
      if (more) { state.cursor = fromKey(more.getAttribute('data-goto')); setView('week'); return; }
      var add = e.target.closest('[data-add]');
      if (add) { e.stopPropagation(); openNew(add.getAttribute('data-add')); return; }
      var ev = e.target.closest('.ev');
      if (ev) { openCard(ev.getAttribute('data-id')); return; }
      // Clic en el hueco libre de un día → nueva tarjeta
      var day = e.target.closest('.day');
      if (day && state.canEdit && !e.target.closest('.more') && e.target.closest('#cal')) openNew(day.getAttribute('data-date'));
    });
    document.body.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea') || !$('dlg').hidden) return;
      if (e.key === 'Enter' && e.target.classList.contains('ev')) openCard(e.target.getAttribute('data-id'));
      else if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 't' || e.key === 'T') $('today').click();
      else if (e.key === 'm') setView('month');
      else if (e.key === 'w' || e.key === 's') setView('week');
      else if (e.key === 'a') setView('agenda');
    });

    // Arrastrar y soltar
    var drag = null;
    document.body.addEventListener('dragstart', function (e) {
      var ev = e.target.closest && e.target.closest('.ev');
      if (!ev) return;
      if (!state.canWrite) { e.preventDefault(); askAuth('Para mover tarjetas de día, autoriza una vez el calendario.'); return; }
      drag = { id: ev.getAttribute('data-id'), from: ev.getAttribute('data-from') };
      ev.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', drag.id);
    });
    document.body.addEventListener('dragend', function (e) {
      if (e.target.classList) e.target.classList.remove('dragging');
      clearDrop(); drag = null;
    });
    function dropTarget(e) { return e.target.closest && (e.target.closest('[data-date]') || e.target.closest('#unsched')); }
    function clearDrop() { document.querySelectorAll('.drop').forEach(function (x) { x.classList.remove('drop'); }); }
    document.body.addEventListener('dragover', function (e) {
      if (!drag) return;
      var tg = dropTarget(e);
      if (!tg) return;
      e.preventDefault();
      if (!tg.classList.contains('drop')) { clearDrop(); tg.classList.add('drop'); }
    });
    document.body.addEventListener('drop', function (e) {
      if (!drag) return;
      var tg = dropTarget(e);
      clearDrop();
      if (!tg) return;
      e.preventDefault();
      var card = state.cards.filter(function (c) { return c.id === drag.id; })[0];
      if (!card) return;
      if (tg.id === 'unsched') { if (drag.from) reschedule(card, null, drag.from); }
      else reschedule(card, tg.getAttribute('data-date'), drag.from);
    });

    $('authBtn').onclick = function () { askAuth('Autoriza una vez el calendario para mover y crear tarjetas.'); };
    bindDialog();
  }

  function openCard(id) {
    var card = state.cards.filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    Promise.resolve(t.showCard(card.id)).catch(function () {
      if (card.url) window.open(card.url, '_blank');
    });
  }

  // ───────────────────────── Autorización ─────────────────────────
  function doAuthorize() {
    // Debe llamarse desde un clic del usuario (abre una ventana de Trello).
    return t.getRestApi().authorize({ scope: 'read,write', expiration: 'never' })
      .then(function () { return checkAuth(); })
      .then(function () { closeDialog(); render(); toast('Autorizado: ya puedes mover y crear tarjetas'); return true; })
      .catch(function (err) {
        if ($('dlg').hidden) askAuth('No se pudo abrir la ventana de Trello. Usa la opción de abajo.');
        $('manualAuth').open = true;
        toast('No se completó la autorización' + (err && err.message ? ': ' + err.message : '') +
          '. Si no se abrió ninguna ventana, permite las ventanas emergentes para trello.com.', true);
        return false;
      });
  }
  var pendingNew = null;
  function askAuth(msg, after) {
    pendingNew = after || null;
    showDialog('auth');
    $('authMsg').textContent = msg;
    $('tokLink').href = authUrl(); $('tokIn').value = '';
  }

  // ───────────────────────── Plantillas ─────────────────────────
  var templatesLoading = null;
  function loadTemplates() {
    if (templatesLoading) return templatesLoading;
    templatesLoading = Promise.resolve(t.board('id')).then(function (b) {
      return apiRequest('GET', '/boards/' + b.id + '/cards?filter=open&fields=name,isTemplate,idList,labels');
    }).then(function (cards) {
      state.templates = (cards || []).filter(function (c) { return c.isTemplate; });
      state.templateIds = {};
      state.templates.forEach(function (c) { state.templateIds[c.id] = true; });
      render();
    }).catch(function () { state.templates = []; })
      .then(function () { templatesLoading = null; });
    return templatesLoading;
  }

  // ───────────────────────── Nueva tarjeta ─────────────────────────
  var dlgKey = null;
  function showDialog(which) {
    $('dlg').hidden = false;
    $('dlgAuth').hidden = which !== 'auth';
    $('nForm').hidden = which !== 'new';
  }
  function closeDialog() { $('dlg').hidden = true; dlgKey = null; }

  function openNew(dayKey) {
    if (!state.canEdit) return;
    if (!state.canWrite) { askAuth('Para crear tarjetas desde el calendario, autoriza una vez el calendario.', dayKey); return; }
    dlgKey = dayKey;
    $('nTitle').textContent = 'Nueva tarjeta · ' + fmt(fromKey(dayKey), { weekday: 'long', day: 'numeric', month: 'long' });
    var lastList = state.prefs.lastList;
    if (!state.listById[lastList]) lastList = state.lists[0] && state.lists[0].id;
    $('nList').innerHTML = state.lists.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === lastList ? ' selected' : '') + '>' + esc(l.name) + '</option>';
    }).join('');
    $('nTpl').innerHTML = '<option value="">Sin plantilla</option>' + state.templates.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === state.prefs.lastTpl ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    $('nTplRow').hidden = false;
    $('nTplHint').textContent = state.templates.length ? '' :
      'No hay plantillas en este tablero. Crea una tarjeta y márcala como plantilla en Trello para que aparezca aquí.';
    var src = source(), showTime = src === 'due' || src === 'range' || src.indexOf('cf:') === 0;
    $('nTimeRow').hidden = !showTime;
    $('nTime').value = pad(state.cfg.defaultHour) + ':00';
    $('nName').value = ''; $('nName').placeholder = 'Nombre de la tarjeta';
    delete $('nList').dataset.touched;
    showDialog('new');
    setTimeout(function () { $('nName').focus(); }, 30);
  }

  function onTplChange() {
    var tpl = state.templates.filter(function (c) { return c.id === $('nTpl').value; })[0];
    if (tpl && !$('nName').value) $('nName').placeholder = tpl.name;
    if (tpl && tpl.idList && state.listById[tpl.idList] && !$('nList').dataset.touched) $('nList').value = tpl.idList;
  }

  function createCard() {
    var key = dlgKey, name = $('nName').value.trim(), idList = $('nList').value, tplId = $('nTpl').value;
    var tpl = state.templates.filter(function (c) { return c.id === tplId; })[0];
    if (!name && tpl) name = tpl.name;
    if (!name) { $('nName').focus(); return; }
    var hm = ($('nTime').value || (pad(state.cfg.defaultHour) + ':00')).split(':');
    var d = fromKey(key); d.setHours(+hm[0] || 0, +hm[1] || 0, 0, 0);
    var iso = d.toISOString(), src = source();
    var body = { idList: idList, name: name, pos: 'bottom' };
    if (src === 'start') body.start = iso;
    else if (src === 'due' || src === 'range') body.due = iso;
    if (tpl) { body.idCardSource = tpl.id; body.keepFromSource = 'all'; }
    $('nCreate').disabled = true;
    apiRequest('POST', '/cards', body).then(function (card) {
      if (src.indexOf('cf:') === 0 && card && card.id) {
        return apiPut('/cards/' + card.id + '/customField/' + src.slice(3) + '/item', { value: { date: iso } }).then(function () { return card; });
      }
      return card;
    }).then(function (card) {
      state.prefs.lastList = idList; state.prefs.lastTpl = tplId; savePrefs();
      closeDialog();
      toast('Tarjeta creada: “' + name + '”');
      load();
    }).catch(function (err) {
      toast('No se pudo crear la tarjeta: ' + (err && err.message ? err.message : err), true);
    }).then(function () { $('nCreate').disabled = false; });
  }

  function bindDialog() {
    $('dlg').addEventListener('click', function (e) { if (e.target.id === 'dlg') closeDialog(); });
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeDialog; });
    $('tokLink').onclick = function () { $('tokLink').href = authUrl(); };
    $('tokSave').onclick = saveManualToken;
    $('dlgAuthBtn').onclick = function () {
      var after = pendingNew; pendingNew = null;
      doAuthorize().then(function (ok) { if (ok && after) openNew(after); });
    };
    $('nTpl').onchange = onTplChange;
    $('nList').onchange = function () { $('nList').dataset.touched = '1'; };
    $('nForm').onsubmit = function (e) { e.preventDefault(); createCard(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('dlg').hidden) closeDialog(); });
  }

  // ───────────────────────── Carga de datos ─────────────────────────
  function checkAuth() {
    var canEdit = !t.memberCanWriteToModel || t.memberCanWriteToModel('board');
    state.canEdit = canEdit && !!(C.APP_KEY || t.__mockWrite);
    if (t.__mockWrite) { state.canWrite = canEdit && !t.__mockNoAuth; if (state.canWrite) loadTemplates(); $('authBar').hidden = true; return Promise.resolve(); }
    if (!C.APP_KEY) {
      state.canWrite = false;
      $('authBar').hidden = false;
      $('authBar').querySelector('span').textContent =
        'Modo solo lectura: el administrador del Power-Up debe añadir su API key en js/config.js para poder cambiar fechas arrastrando.';
      $('authBtn').hidden = true;
      return Promise.resolve();
    }
    var bar = $('authBar'), msg = bar.querySelector('span');
    if (!canEdit) {
      state.canWrite = false; bar.hidden = false; $('authBtn').hidden = true;
      msg.textContent = 'Modo solo lectura: no tienes permiso de edición en este tablero.';
      return Promise.resolve();
    }
    return Promise.resolve().then(function () {
      return Promise.resolve(t.getRestApi().isAuthorized()).catch(function () { return false; })
        .then(function (ok) { return ok || t.get('member', 'private', 'apiTok').then(function (x) { return !!x; }); });
    }).then(function (ok) {
      state.canWrite = !!ok;
      bar.hidden = !!ok;
      if (ok) loadTemplates();
      $('authBtn').hidden = false;
      msg.textContent = 'Modo solo lectura. Autoriza para cambiar fechas arrastrando tarjetas.';
    }).catch(function (err) {
      state.canWrite = false; bar.hidden = false; $('authBtn').hidden = false;
      msg.textContent = 'Autoriza para cambiar fechas arrastrando tarjetas. (' + (err && err.message || err) + ')';
    });
  }

  var loading = null;
  function load() {
    if (loading) return loading;
    loading = Promise.all([
      t.cards('all'),
      t.lists('id', 'name'),
      t.board('id', 'name', 'labels', 'members', 'customFields').catch(function () {
        return t.board('id', 'name', 'labels', 'members');
      }),
      t.get('board', 'shared', 'cfg'),
      t.get('member', 'private', 'prefs'),
      checkAuth()
    ]).then(function (r) {
      state.cards = (r[0] || []).filter(function (c) { return !c.closed; });
      state.lists = r[1] || [];
      state.board = r[2] || {};
      state.board.customFields = state.board.customFields || [];
      state.listById = {};
      state.lists.forEach(function (l) { state.listById[l.id] = l; });
      state.cfg = S.mergeCfg(r[3]);
      var p = r[4] || {};
      ['hiddenLists', 'labels', 'members'].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
      state.prefs = Object.assign(state.prefs, p);
      if (!state.loaded) {
        state.view = state.prefs.view || state.cfg.defaultView;
        state.loaded = true;
      }
      renderSourceSelect();
      renderFilters();
      render();
    }).catch(function (err) {
      $('cal').innerHTML = '<div class="empty">No se pudieron cargar las tarjetas: ' + esc(err && err.message) + '</div>';
    }).then(function () { loading = null; });
    return loading;
  }

  // ───────────────────────── Arranque ─────────────────────────
  $('cal').innerHTML = '<div class="loading">Cargando tarjetas…</div>';
  bindUi();
  // t.render se dispara cuando cambian los datos del tablero → calendario en vivo.
  if (typeof t.render === 'function') {
    var rTimer;
    t.render(function () { clearTimeout(rTimer); rTimer = setTimeout(load, 250); });
  } else {
    load();
  }
})();
