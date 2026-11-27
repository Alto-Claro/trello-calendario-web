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
    prefs: { view: null, source: null, hiddenLists: [], labels: [], members: [], completed: null, weekends: null, colorBy: null, hours: null },
    cards: [], lists: [], board: { labels: [], members: [], customFields: [] },
    listById: {}, cfById: {},
    view: 'month', cursor: startOfDay(new Date()), q: '',
    canWrite: false, canEdit: false, templates: [], templateIds: {}, loaded: false,
    selId: null, lastIdx: {}
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
  function moveToDay(iso, dayKey, mins) {
    var target = fromKey(dayKey);
    if (mins != null) {
      target.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    } else if (iso) {
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
  function detailOn() { return state.prefs.detail !== false; }
  function thumbsOn() { return state.prefs.thumbs !== false; }
  // Miniatura: la portada de la tarjeta o, si no hay, la primera imagen adjunta (vista previa pequeña).
  var IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif|heic)(\?|$)/i;
  function thumbFor(card) {
    var atts = card.attachments || [];
    if (!atts.length) return null;
    var isImg = function (a) { return /^image\//.test(a.mimeType || '') || IMG_RE.test(a.name || a.url || '') || ((a.r2 || a.drive) && a.previews); };
    var cov = card.cover && card.cover.idAttachment && atts.filter(function (a) { return a.id === card.cover.idAttachment; })[0];
    var a = cov || atts.filter(isImg)[0];
    if (!a) return null;
    var prev = (a.previews || []).filter(function (p) { return p.url; }).sort(function (x, y) { return x.width - y.width; });
    var p = prev.filter(function (x) { return x.width >= 240; })[0] || prev[prev.length - 1];
    if (p) return p.url;
    return isImg(a) ? a.url : null;
  }
  function source() { return state.prefs.source || state.cfg.dateSource; }
  function showCompleted() { return state.prefs.completed != null ? state.prefs.completed : state.cfg.showCompleted; }
  function showWeekends() { return state.prefs.weekends != null ? state.prefs.weekends : state.cfg.showWeekends; }
  function colorBy() { return state.prefs.colorBy || state.cfg.colorBy; }
  // ¿La fecha elegida lleva hora? (la de inicio de Trello es solo de día)
  function srcHasTime() { return source() !== 'start'; }
  function isLate(card) { return !card.dueComplete && card.due && new Date(card.due) < new Date(); }
  // Columnas: los fines de semana más estrechos.
  function colsTpl(days) {
    return days.map(function (d) { return isWeekend(d) ? 'minmax(0, .62fr)' : 'minmax(0, 1fr)'; }).join(' ');
  }
  function relDay(d) {
    var n = diffDays(key(new Date()), key(d));
    if (n === 0) return 'hoy';
    if (n === 1) return 'mañana';
    if (n === -1) return 'ayer';
    return n > 0 ? 'en ' + n + ' días' : 'hace ' + (-n) + ' días';
  }

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
    var by = colorBy(), bg = null;
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
    else if (isLate(card)) cls.push('overdue');
    if (state.selId === card.id) cls.push('sel');
    if (ev && dayKey) {
      if (dayKey !== ev.startKey) cls.push('cont-l');
      if (dayKey !== ev.endKey) cls.push('cont-r');
    }
    var col = colorsFor(card);
    var style = col ? ' style="--ev-bg:' + col.bg + ';--ev-fg:' + col.fg + '"' : '';
    var showTime = ev && ev.time && (!dayKey || dayKey === ev.endKey);
    var time = showTime ? '<span class="time">' + (card.dueComplete ? '<b class="ok">✓</b> ' : '') + fmtTime(ev.time) + '</span>'
      : (card.dueComplete ? '<span class="time"><b class="ok">✓</b></span>' : '');
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
    var listObj = state.listById[card.idList];
    var tip = card.name + (listObj ? ' — ' + listObj.name : '');
    var attrs = ' tabindex="0" role="button" data-id="' + esc(card.id) + '"' + (dayKey ? ' data-from="' + dayKey + '"' : '') +
      (state.canEdit ? ' draggable="true"' : '') + ' title="' + esc(tip) + '"';
    var cont = ev && dayKey && dayKey !== ev.startKey;
    if (detailOn() && !cont) {
      cls.push('det');
      var labels = (card.labels || []).map(function (l) {
        var bg = S.labelColor(l.color);
        return '<span class="lb' + (l.name ? '' : ' empty') + '" style="background:' + bg + ';color:' + S.textOn(bg) + '">' + esc(l.name || '') + '</span>';
      }).join('');
      var th = thumbsOn() ? thumbFor(card) : null, coverCol = card.cover && card.cover.color && !th;
      return '<div class="' + cls.join(' ') + '"' + style + attrs + '>' +
        (th ? '<div class="ev-thumb"><img src="' + esc(th) + '" alt="" loading="lazy" decoding="async" draggable="false" onerror="__calImgFail(this)"></div>' : '') +
        (coverCol ? '<div class="ev-covercol" style="background:' + S.labelColor(card.cover.color) + '"></div>' : '') +
        (labels ? '<div class="ev-labels">' + labels + '</div>' : '') +
        '<div class="ev-line">' + time + '<span class="name">' + esc(card.name) + '</span></div>' +
        '<div class="ev-foot">' + (listObj ? '<span class="ev-list" style="--lc:' + S.hashColor(listObj.id) + '">' + esc(listObj.name) + '</span>' : '') + av + '</div>' +
        '</div>';
    }
    var dots = (card.labels || []).slice(0, 3).map(function (l) {
      return '<i class="dot" style="background:' + S.labelColor(l.color) + '" title="' + esc(l.name || '') + '"></i>';
    }).join('');
    return '<div class="' + cls.join(' ') + '"' + style + attrs + '>' +
      time + '<span class="name">' + esc(card.name) + '</span>' + meta + (dots ? '<span class="dots">' + dots + '</span>' : '') + av + '</div>';
  }

  // ───────────────────────── Vistas ─────────────────────────
  var MAX_PER_CELL = 4;
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
    return '<div class="dow" style="--tpl:' + colsTpl(days) + '">' + days.map(function (d) {
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
    var html = '<div style="--cols:' + cols + '" class="month">' + renderDow(days.slice(0, cols)) + '<div class="grid" style="--tpl:' + colsTpl(days.slice(0, cols)) + '">';
    days.forEach(function (d) {
      var k = key(d), items = idx[k] || [];
      var cls = 'day' + (d.getMonth() !== c.getMonth() ? ' other' : '') + (k === today ? ' today' : '');
      html += '<div class="' + cls + (isWeekend(d) ? ' we' : '') + '" data-date="' + k + '"><div class="dhead"><span class="dnum">' + d.getDate() + '</span>' +
        (items.length > MAX_PER_CELL ? '<span class="dcount">' + items.length + ' tarjetas</span>' : '') + addBtn(k) + '</div><div class="events">';
      items.slice(0, MAX_PER_CELL).forEach(function (it) { html += evHtml(it.card, it.ev, k, 'month'); });
      if (items.length > MAX_PER_CELL) {
        html += '<button class="more" data-goto="' + k + '">+ ' + (items.length - MAX_PER_CELL) + ' más</button>';
      }
      html += '</div></div>';
    });
    var cal = $('cal'), mKey = c.getFullYear() + '-' + c.getMonth(), keepTop = state.monthShown === mKey ? cal.scrollTop : null;
    cal.innerHTML = html + '</div></div>';
    cal.firstChild.style.display = 'flex';
    cal.firstChild.style.flexDirection = 'column';
    cal.firstChild.style.flex = '1';
    // Al llegar a un mes, se coloca en la semana actual (si está en ese mes); al refrescar, se queda donde estaba.
    if (keepTop != null) cal.scrollTop = keepTop;
    else {
      var sel = cal.querySelector('.ev.sel'), td = (sel && sel.closest('.day')) || cal.querySelector('.day.today'), dw = cal.querySelector('.dow');
      cal.scrollTop = 0;
      if (td) cal.scrollTop = Math.max(0, td.getBoundingClientRect().top - cal.getBoundingClientRect().top - (dw ? dw.offsetHeight : 0));
    }
    state.monthShown = mKey;
  }

  // ───── Semana con horas ─────
  var HR = 48; // píxeles por hora
  function hoursRange(days, idx) {
    var p = String(state.prefs.hours || '8-20').split('-'), h0 = +p[0] || 0, h1 = +p[1] || 24;
    days.forEach(function (d) {
      (idx[key(d)] || []).forEach(function (it) {
        if (!timed(it)) return;
        var h = it.ev.time.getHours();
        if (h < h0) h0 = h;
        if (h + 1 > h1) h1 = Math.min(24, h + 1);
      });
    });
    // Si hoy está en la semana, que se vea la hora actual.
    var now = new Date();
    if (days.some(function (d) { return key(d) === key(now); })) {
      h0 = Math.min(h0, now.getHours()); h1 = Math.max(h1, Math.min(24, now.getHours() + 1));
    }
    return [h0, Math.max(h0 + 1, h1)];
  }
  function timed(it) { return !!(it.ev.time && it.ev.startKey === it.ev.endKey); }
  function minsOf(d) { return d.getHours() * 60 + d.getMinutes(); }
  var minsOfDate = minsOf;
  function hhmm(m) { return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }

  // Coloca las tarjetas que coinciden en hora lado a lado.
  function layoutDay(items) {
    var evs = items.map(function (it) { var s = minsOf(it.ev.time); return { it: it, s: s, e: s + 60 }; })
      .sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    var cluster = [], lanes = [], end = -1;
    function flush() { cluster.forEach(function (x) { x.n = lanes.length; }); cluster = []; lanes = []; }
    evs.forEach(function (x) {
      if (x.s >= end && cluster.length) flush();
      var lane = 0; while (lane < lanes.length && lanes[lane] > x.s) lane++;
      lanes[lane] = x.e; x.lane = lane; cluster.push(x); end = Math.max(end, x.e);
    });
    flush();
    return evs;
  }

  function blkHtml(x, k, h0) {
    var card = x.it.card, ev = x.it.ev;
    var cls = ['ev', 'blk'];
    if (card.dueComplete) cls.push('done'); else if (isLate(card)) cls.push('overdue');
    if (state.selId === card.id) cls.push('sel');
    var col = colorsFor(card);
    var top = (x.s - h0 * 60) / 60 * HR + 1, ht = Math.max(22, (x.e - x.s) / 60 * HR - 3);
    var w = 100 / x.n, left = x.lane * w;
    var style = 'top:' + top + 'px;height:' + ht + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 4px)' +
      (col ? ';--ev-bg:' + col.bg : '');
    var labels = detailOn() ? (card.labels || []).slice(0, 3).map(function (l) {
      var bg = S.labelColor(l.color);
      return '<span class="lb" style="background:' + bg + ';color:' + S.textOn(bg) + '">' + esc(l.name || '') + '</span>';
    }).join('') : '';
    var m = (card.members || [])[0], av = m ? (m.avatar
      ? '<span class="av" style="background-image:url(' + esc(m.avatar) + '/30.png)" title="' + esc(m.fullName) + '"></span>'
      : '<span class="av" title="' + esc(m.fullName) + '">' + esc(m.initials || '') + '</span>') : '';
    var listObj = state.listById[card.idList];
    return '<div class="' + cls.join(' ') + '" style="' + style + '" tabindex="0" role="button" data-id="' + esc(card.id) + '" data-from="' + k + '"' +
      (state.canEdit ? ' draggable="true"' : '') + ' title="' + esc(card.name + (listObj ? ' — ' + listObj.name : '')) + '">' +
      '<div class="bt">' + (card.dueComplete ? '<b class="ok">✓</b> ' : '') + fmtTime(ev.time) + (x.n === 1 ? ' – ' + hhmm(x.e) : '') + '</div>' +
      '<div class="name">' + esc(card.name) + '</div>' +
      (ht > 58 && (labels || av) ? '<div class="bm">' + labels + av + '</div>' : '') + '</div>';
  }

  function renderWeek(idx) {
    var cal = $('cal'), oldScroll = cal.querySelector('.wk-scroll');
    var keepTop = oldScroll ? oldScroll.scrollTop : null;
    var days = daysRow(weekStartOf(state.cursor), 7), today = key(new Date()), now = new Date();
    var hr = hoursRange(days, idx), h0 = hr[0], h1 = hr[1];
    var tpl = '56px ' + colsTpl(days), wkKey = key(days[0]);
    var dayIdx = {}; days.forEach(function (d, i) { dayIdx[key(d)] = i; });

    // Cabecera con la carga de cada día
    var html = '<div class="wk" style="--tpl:' + tpl + ';--hr:' + HR + 'px">';
    html += '<div class="wk-head"><div></div>' + days.map(function (d) {
      var k = key(d), n = (idx[k] || []).length, bars = '';
      for (var i = 0; i < 6; i++) bars += '<i class="' + (i < n ? (n >= 5 ? 'h' : 'f') : '') + '"></i>';
      return '<div class="wk-dh' + (k === today ? ' today' : '') + '" data-date="' + k + '">' +
        '<div class="wk-dt"><small>' + esc(fmt(d, { weekday: 'short' })) + '</small><b>' + d.getDate() + '</b>' + addBtn(k) + '</div>' +
        '<div class="load">' + bars + '</div><span class="wk-n">' + (n ? n + (n === 1 ? ' tarjeta' : ' tarjetas') + (n >= 5 ? ' · día cargado' : '') : 'Libre') + '</span></div>';
    }).join('') + '</div>';

    // Fila «Todo el día»: rangos (barras) y tarjetas sin hora
    var bars = [], seen = {}, untimed = {};
    days.forEach(function (d) {
      var k = key(d);
      (idx[k] || []).forEach(function (it) {
        if (timed(it)) return;
        if (it.ev.startKey !== it.ev.endKey) {
          if (seen[it.card.id]) return;
          seen[it.card.id] = true;
          var s = Math.max(0, dayIdx[it.ev.startKey] != null ? dayIdx[it.ev.startKey] : 0);
          var e = dayIdx[it.ev.endKey] != null ? dayIdx[it.ev.endKey] : days.length - 1;
          bars.push({ it: it, s: s, e: e, k: k });
        } else (untimed[k] = untimed[k] || []).push(it);
      });
    });
    var lanes = [];
    bars.sort(function (a, b) { return a.s - b.s || b.e - a.e; }).forEach(function (b) {
      var l = 0; while (lanes[l] != null && lanes[l] >= b.s) l++;
      lanes[l] = b.e; b.lane = l;
    });
    var nl = lanes.length;
    html += '<div class="wk-all" style="grid-template-rows:repeat(' + (nl + 1) + ', auto)"><div class="wk-lab" style="grid-row:1/-1">todo<br>el día</div>';
    days.forEach(function (d, i) {
      var k = key(d);
      html += '<div class="wk-acol' + (isWeekend(d) ? ' we' : '') + (k === today ? ' today' : '') + '" style="grid-column:' + (i + 2) + ';grid-row:1/-1" data-date="' + k + '" data-allday="1"></div>';
      html += '<div class="wk-ac" style="grid-column:' + (i + 2) + ';grid-row:' + (nl + 1) + '">' +
        (untimed[k] || []).map(function (it) { return evHtml(it.card, it.ev, null, 'week'); }).join('') + '</div>';
    });
    bars.forEach(function (b) {
      var card = b.it.card, col = colorsFor(card);
      html += '<div class="ev bar' + (card.dueComplete ? ' done' : '') + (state.selId === card.id ? ' sel' : '') + '" style="grid-column:' + (b.s + 2) + '/' + (b.e + 3) +
        ';grid-row:' + (b.lane + 1) + (col ? ';--ev-bg:' + col.bg + ';--ev-fg:' + col.fg : '') + '" tabindex="0" role="button" data-id="' + esc(card.id) +
        '" data-from="' + key(days[b.s]) + '"' + (state.canEdit ? ' draggable="true"' : '') + '>' + esc(card.name) +
        ' <small>(' + esc(fmt(fromKey(b.it.ev.startKey), { day: 'numeric', month: 'short' })) + ' → ' + esc(fmt(fromKey(b.it.ev.endKey), { day: 'numeric', month: 'short' })) + ')</small></div>';
    });
    html += '</div>';

    // Cuerpo con horas
    var H = (h1 - h0) * HR;
    html += '<div class="wk-scroll"><div class="wk-body" style="height:' + H + 'px"><div class="wk-gut">';
    for (var h = h0; h < h1; h++) html += '<div style="top:' + ((h - h0) * HR) + 'px">' + (h === h0 ? '' : pad(h) + ':00') + '</div>';
    html += '</div>';
    days.forEach(function (d) {
      var k = key(d), items = (idx[k] || []).filter(timed);
      html += '<div class="wk-col' + (isWeekend(d) ? ' we' : '') + (k === today ? ' today' : '') + '" data-date="' + k + '" data-slot="1" data-h0="' + h0 + '" data-h1="' + h1 + '">';
      layoutDay(items).forEach(function (x) { html += blkHtml(x, k, h0); });
      if (k === today) {
        var nm = minsOf(now);
        if (nm >= h0 * 60 && nm <= h1 * 60) html += '<div class="now" style="top:' + ((nm - h0 * 60) / 60 * HR) + 'px"><span>' + hhmm(nm) + '</span></div>';
      }
      html += '</div>';
    });
    html += '</div></div></div>';
    cal.innerHTML = html;

    // Desplazamiento: se conserva al refrescar; al cambiar de semana va a la hora actual o a la primera tarjeta.
    var sc = cal.querySelector('.wk-scroll');
    if (keepTop != null && state.weekShown === wkKey) sc.scrollTop = keepTop;
    else {
      var target = null;
      if (dayIdx[today] != null) target = minsOf(now) - 90;
      else {
        days.forEach(function (d) { (idx[key(d)] || []).filter(timed).forEach(function (it) { var m = minsOf(it.ev.time); if (target == null || m < target) target = m - 30; }); });
      }
      sc.scrollTop = target == null ? 0 : Math.max(0, (target - h0 * 60) / 60 * HR);
    }
    state.weekShown = wkKey;
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
      txt = (a.getMonth() === b.getMonth() ? a.getDate() : fmt(a, { day: 'numeric', month: 'short' })) + ' – ' +
        fmt(b, { day: 'numeric', month: 'short', year: 'numeric' }).replace(/ de /g, ' ');
    }
    $('title').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
  }

  // Vencidas sin completar (con los filtros actuales), las más recientes primero.
  function renderOverdue() {
    var list = state.cards.filter(function (c) {
      return !state.templateIds[c.id] && isLate(c) && passesFilters(c);
    }).sort(function (a, b) { return new Date(b.due) - new Date(a.due); }).slice(0, 20);
    $('overdueWrap').hidden = !list.length;
    $('overdueList').innerHTML = list.map(function (c) {
      var d = new Date(c.due);
      return evHtml(c, null, null, 'side').replace(/<\/div>$/, '') +
        '<span class="late-when">' + esc(fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + esc(fmtTime(d)) + ' · ' + esc(relDay(d)) + '</span></div>';
    }).join('');
  }

  // Chips con los filtros activos + leyenda de colores
  function renderChips(visible) {
    var p = state.prefs, chips = [];
    function chip(kind, val, label, strong) {
      chips.push('<span class="chip">' + esc(label) + (strong ? ' <b>' + esc(strong) + '</b>' : '') +
        '<button class="x" data-unf="' + kind + '" data-v="' + esc(val || '') + '" aria-label="Quitar filtro">×</button></span>');
    }
    if (state.q) chip('q', '', 'Búsqueda', '«' + state.q + '»');
    p.hiddenLists.forEach(function (id) { var l = state.listById[id]; if (l) chip('list', id, 'Sin la lista', l.name); });
    p.labels.forEach(function (id) {
      var l = (state.board.labels || []).filter(function (x) { return x.id === id; })[0];
      chip('label', id, 'Etiqueta', id === '__none' ? 'Sin etiqueta' : (l && (l.name || l.color)) || '?');
    });
    p.members.forEach(function (id) {
      var m = (state.board.members || []).filter(function (x) { return x.id === id; })[0];
      chip('member', id, 'Miembro', id === '__none' ? 'Sin asignar' : (m && (m.fullName || m.username)) || '?');
    });
    if (!showCompleted()) chip('completed', '', 'Sin completadas');
    if (!showWeekends()) chip('weekends', '', 'Sin fines de semana');
    var left = chips.length
      ? '<span class="muted">Filtrando:</span>' + chips.join('') + '<button class="link" data-unf="all">Quitar filtros</button>'
      : '<span class="muted">Sin filtros · ' + visible + ' tarjetas con fecha</span>';

    var by = colorBy(), items = [];
    if (by === 'label') {
      var used = {};
      state.cards.forEach(function (c) { if (passesFilters(c)) (c.labels || []).slice(0, 1).forEach(function (l) { used[l.id] = (used[l.id] || 0) + 1; }); });
      items = (state.board.labels || []).filter(function (l) { return used[l.id]; })
        .sort(function (a, b) { return used[b.id] - used[a.id]; })
        .map(function (l) { return [S.labelColor(l.color), l.name || l.color]; });
    } else if (by === 'list') items = state.lists.map(function (l) { return [S.hashColor(l.id), l.name]; });
    else if (by === 'member') items = (state.board.members || []).map(function (m) { return [S.hashColor(m.id), m.fullName || m.username]; });
    else if (by === 'status') items = [['#579dff', 'Pendiente'], ['#f87462', 'Vencida'], ['#4bce97', 'Completada']];
    var more = items.length > 7 ? '<span class="muted">+' + (items.length - 7) + '</span>' : '';
    var opts = [['label', 'Etiqueta'], ['list', 'Lista'], ['member', 'Miembro'], ['status', 'Estado'], ['none', 'Ninguno']];
    $('chips').innerHTML = '<div class="chips-l">' + left + '</div><div class="legend">' +
      items.slice(0, 7).map(function (x) { return '<span><i class="dot" style="background:' + x[0] + '"></i>' + esc(x[1]) + '</span>'; }).join('') + more +
      '<label class="muted">Color por <select id="colorBy">' + opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === by ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label></div>';
  }

  function renderUnscheduled(list) {
    $('ucount').textContent = list.length;
    $('unschedHint').textContent = state.canWrite
      ? 'Arrástralas a un día (o a una hora en la vista Semana) para programarlas. Suelta aquí una tarjeta del calendario para quitarle la fecha.'
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
    renderOverdue();
    var withDate = 0;
    state.cards.forEach(function (c) { if (!state.templateIds[c.id] && passesFilters(c) && eventOf(c)) withDate++; });
    renderChips(withDate);
    state.lastIdx = r.idx;
    $('hoursWrap').hidden = state.view !== 'week';
    $('hours').value = state.prefs.hours || '8-20';
    $('detailBtn').classList.toggle('on', detailOn());
    $('detailBtn').setAttribute('aria-checked', String(detailOn()));
    document.body.classList.toggle('detail', detailOn());
    var n = state.prefs.hiddenLists.length + state.prefs.labels.length + state.prefs.members.length +
      (showCompleted() ? 0 : 1) + (showWeekends() ? 0 : 1);
    $('fcount').hidden = !n; $('fcount').textContent = n;
  }

  // ───────────────────────── Filtros ─────────────────────────
  function renderFilters() {
    var p = state.prefs;
    $('fCompleted').checked = showCompleted();
    $('fWeekends').checked = showWeekends();
    $('fThumbs').checked = thumbsOn();
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
      .then(function (tok) { return tok || t.get('member', 'private', 'apiTok'); })
      .then(function (tok) { return tok || lsGet(); });
  }
  // Copia local del código: compartida por los 10 Power-Ups (mismo origen) en este navegador.
  function lsGet() { try { return localStorage.getItem('calTok') || null; } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem('calTok', v); } catch (e) { /* almacenamiento bloqueado */ } }
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
      .then(function () { lsSet(tok); return t.set('member', 'private', 'apiTok', tok); })
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
  // Descarga un adjunto de Trello con el token (los subidos a Trello no son públicos) y devuelve una URL local.
  // Si el navegador no puede descargarlo (Trello no lo permite fuera de su web), lo descarga el script de subidas.
  // o: { w: ancho de la miniatura, full: el archivo original (vídeos) }.
  function mediaUrl(url, o) {
    o = o || {};
    if (t.__mockWrite) return Promise.resolve(url);
    return getToken().then(function (tok) {
      if (!tok) throw new Error('No autorizado');
      var u = url.replace(/^https:\/\/trello\.com\/1\//, 'https://api.trello.com/1/');
      var auth = 'OAuth oauth_consumer_key="' + C.APP_KEY + '", oauth_token="' + tok + '"';
      return fetch(u, { headers: { Authorization: auth } }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (b) { return URL.createObjectURL(b); }).catch(function (err) {
        var m = /\/cards\/([0-9a-f]{24})\/attachments\/([0-9a-f]{24})/i.exec(url);
        if (!m || !window.CalDrive || !CalDrive.viaScript()) throw err;
        return CalDrive.trelloMedia({ auth: auth, card: m[1], att: m[2], w: o.w || 400, full: !!o.full });
      });
    });
  }
  // Miniatura que no carga (p. ej. ventana de incógnito o navegador que bloquea las cookies de Trello/Google
  // dentro del calendario): las de Drive se piden al script de subidas; las de Trello, con el token.
  window.__calImgFail = function (img) {
    var src = img.getAttribute('src') || '';
    if (/drive\.google\.com|googleusercontent\.com/.test(src) && window.CalDrive) { window.CalDrive.fixImg(img); return; }
    if (img.getAttribute('data-tok') || !/trello\.com\/1\//.test(src)) { if (img.parentNode) img.parentNode.remove(); return; }
    img.setAttribute('data-tok', '1');
    mediaUrl(src).then(function (u) { img.src = u; }).catch(function () { if (img.parentNode) img.parentNode.remove(); });
  };
  // ───── Diagnóstico de imágenes (menú ⋯): qué funciona en este navegador para ver miniaturas ─────
  function runDiag() {
    var box = document.createElement('div');
    box.className = 'wn-wrap';
    box.innerHTML = '<div class="wn" role="dialog" aria-modal="true" style="max-width:560px"><p class="wn-k">Diagnóstico</p>' +
      '<h2>Imágenes en este navegador</h2><ul class="dg"></ul><div class="wn-f" style="gap:8px"><button class="btn" data-dg-copy>Copiar resultado</button>' +
      '<button class="btn primary" data-dg-ok>Cerrar</button></div></div>';
    document.body.appendChild(box);
    var ul = box.querySelector('.dg'), lines = [];
    ul.style.cssText = 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13px';
    function row(label) {
      var li = document.createElement('li'); li.textContent = '… ' + label; ul.appendChild(li);
      return function (ok, info) {
        var txt = (ok === null ? '– ' : ok ? '✓ ' : '✗ ') + label + (info ? ': ' + info : '');
        li.textContent = txt; li.style.color = ok === false ? 'var(--danger, #c9372c)' : ''; lines.push(txt);
      };
    }
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.closest('[data-dg-ok]')) box.remove();
      if (e.target.closest('[data-dg-copy]')) {
        var txt = lines.join('\n');
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Copiado'); }, function () { prompt('Copia el resultado:', txt); });
      }
    });
    function imgTest(src) {
      return new Promise(function (ok) {
        if (!src) { ok(null); return; }
        var i = new Image(), done = false;
        var end = function (v) { if (!done) { done = true; ok(v); } };
        i.onload = function () { end(i.naturalWidth > 1 ? 'ok' : 'vacía'); }; i.onerror = function () { end('error'); };
        setTimeout(function () { end('sin respuesta'); }, 12000);
        i.src = src;
      });
    }
    var ver = (document.querySelector('script[src*="calendar.js"]') || {}).src || '';
    row('Versión')(true, (ver.match(/v=(\d+)/) || [, '?'])[1] + ' · ' + ((navigator.userAgent.match(/(Edg|Chrome|Firefox)\/[\d]+/) || navigator.userAgent.match(/Version\/[\d]+.*Safari/) || ['?'])[0]));
    var all = [];
    state.cards.forEach(function (c) { (c.attachments || []).forEach(function (a) { all.push(a); }); });
    var looksImg = function (a) { return /^image\//.test(a.mimeType || '') || IMG_RE.test(a.name || a.url || ''); };
    var tAtt = all.filter(function (a) { return !a.drive && looksImg(a) && (a.previews || []).length; })[0] ||
      all.filter(function (a) { return !a.drive && looksImg(a); })[0];
    var ex = tAtt || all.filter(function (a) { return !a.drive; })[0];
    row('Adjuntos recibidos')(true, all.length + ' en total · ' + all.filter(function (a) { return a.isUpload; }).length + ' subidos · ' +
      all.filter(function (a) { return (a.previews || []).length; }).length + ' con vista previa · ' + all.filter(looksImg).length + ' imágenes · ' +
      all.filter(function (a) { return a.drive; }).length + ' de Drive' +
      (ex ? ' · ejemplo: ' + JSON.stringify({ name: ex.name, url: String(ex.url || '').slice(0, 90), mimeType: ex.mimeType, isUpload: ex.isUpload,
        previews: (ex.previews || []).length, prev0: ((ex.previews || [])[0] || {}).url ? String(ex.previews[0].url).slice(0, 90) : null }) : ''));
    var dAtt = all.filter(function (a) { return a.drive && a.drive.type === 'file'; }).slice(-1)[0];
    var rTok = row('Autorización del calendario (Trello)'), rCk = row('Imagen de Trello con tu sesión (cookies)'),
      rTk = row('Imagen de Trello con la autorización'), rDd = row('Miniatura de Drive directa'),
      rDs = row('Miniatura de Drive por el servicio de subidas');
    getToken().then(function (tok) {
      if (!tok) { rTok(false, 'no hay; pulsa «Autorizar edición»'); return null; }
      return fetch('https://api.trello.com/1/members/me?fields=username&key=' + encodeURIComponent(C.APP_KEY) + '&token=' + encodeURIComponent(tok))
        .then(function (r) { rTok(r.ok, r.ok ? 'válida' : 'Trello la rechaza (' + r.status + ')'); return r.ok ? tok : null; })
        .catch(function (e) { rTok(false, 'error de red: ' + e.message); return null; });
    }).then(function (tok) {
      if (!tAtt) { rCk(null, 'no hay imágenes de Trello en este tablero'); rTk(null, ''); return; }
      var p = (tAtt.previews || []).filter(function (x) { return x.url; }).sort(function (x, y) { return x.width - y.width; });
      var url = p.length ? (p.filter(function (x) { return x.width >= 240; })[0] || p[p.length - 1]).url : tAtt.url;
      return imgTest(url).then(function (r) {
        rCk(r === 'ok', r + ' · «' + tAtt.name + '»');
        if (!tok) { rTk(false, 'sin autorización'); return; }
        return mediaUrl(url).then(function (u) { return imgTest(u); }).then(function (r2) { rTk(r2 === 'ok', r2); })
          .catch(function (e) { rTk(false, e.message); });
      });
    }).then(function () {
      if (!dAtt) { rDd(null, 'no hay archivos de Drive en este tablero'); rDs(null, ''); return; }
      return imgTest(window.CalDrive ? CalDrive.thumbUrl(dAtt.drive.id, 400) : '').then(function (r) {
        rDd(r === 'ok', r + ' · «' + dAtt.name + '»');
        if (!window.CalDrive || !CalDrive.viaScript()) { rDs(false, 'servicio no configurado'); return; }
        return CalDrive.scriptThumb(dAtt.drive.id, 400).then(function (src) { return imgTest(src); })
          .then(function (r2) { rDs(r2 === 'ok', r2); }).catch(function (e) { rDs(false, e.message); });
      });
    });
  }
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
  // mins (opcional): minutos desde las 00:00 → también cambia la hora (vista Semana).
  function reschedule(card, dayKey, fromDay, mins) {
    var src = source(), body = {}, cfId = null, local = {};
    var ev = eventOf(card);
    if (!srcHasTime()) mins = null;
    if (ev && dayKey && fromDay === dayKey && (mins == null || (ev.time && minsOfDate(ev.time) === mins))) return; // mismo sitio
    if (src === 'due') { local.due = body.due = dayKey ? moveToDay(card.due, dayKey, mins) : null; }
    else if (src === 'start') { local.start = body.start = dayKey ? moveToDay(card.start, dayKey) : null; }
    else if (src === 'range') {
      if (!dayKey) { local.start = body.start = null; local.due = body.due = null; }
      else if (ev && mins != null && card.due) {
        var dd = diffDays(key(new Date(card.due)), dayKey);
        if (card.start) local.start = body.start = shiftIso(card.start, dd);
        local.due = body.due = moveToDay(card.due, dayKey, mins);
      } else if (ev && fromDay) {
        var delta = diffDays(fromDay, dayKey);
        if (card.start) local.start = body.start = shiftIso(card.start, delta);
        if (card.due) local.due = body.due = shiftIso(card.due, delta);
      } else { local.due = body.due = moveToDay(null, dayKey, mins); }
    } else if (src.indexOf('cf:') === 0) {
      cfId = src.slice(3);
      var item = (card.customFieldItems || []).filter(function (i) { return i.idCustomField === cfId; })[0];
      var iso = dayKey ? moveToDay(item && item.value && item.value.date, dayKey, mins) : null;
      local.cf = iso;
    }

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
      toast(dayKey ? '“' + card.name + '” → ' + fmt(fromKey(dayKey), { weekday: 'short', day: 'numeric', month: 'short' }) + (mins != null ? ' · ' + hhmm(mins) : '')
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
    $('today').onclick = function () { state.cursor = startOfDay(new Date()); state.monthShown = null; render(); };
    $('prev').onclick = function () { move(-1); };
    $('next').onclick = function () { move(1); };
    $('refresh').onclick = function () { load().then(function () { toast('Actualizado'); }); };
    $('detailBtn').onclick = function () {
      state.prefs.detail = !detailOn(); savePrefs(); render();
    };
    $('moreBtn').onclick = function (e) { e.stopPropagation(); $('moreMenu').hidden = !$('moreMenu').hidden; };
    $('moreMenu').onclick = function (e) {
      var b = e.target.closest('[data-more]'); if (!b) return;
      $('moreMenu').hidden = true;
      var w = b.getAttribute('data-more');
      if (w === 'refresh') $('refresh').click();
      else if (w === 'ics') exportIcs();
      else if (w === 'news' && window.CalWhatsNew) window.CalWhatsNew.show(t);
      else if (w === 'diag') runDiag();
    };
    document.addEventListener('click', function (e) { if (!e.target.closest('.menu-w')) $('moreMenu').hidden = true; });
    $('hours').onchange = function (e) { state.prefs.hours = e.target.value; state.weekShown = null; savePrefs(); render(); };
    $('chips').addEventListener('change', function (e) {
      if (e.target.id !== 'colorBy') return;
      state.prefs.colorBy = e.target.value === state.cfg.colorBy ? null : e.target.value; savePrefs(); render();
    });
    $('chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-unf]'); if (!b) return;
      var k = b.getAttribute('data-unf'), v = b.getAttribute('data-v'), p = state.prefs;
      var drop = function (arr) { var i = arr.indexOf(v); if (i !== -1) arr.splice(i, 1); };
      if (k === 'all') { p.hiddenLists = []; p.labels = []; p.members = []; p.completed = null; p.weekends = null; state.q = ''; $('q').value = ''; }
      else if (k === 'q') { state.q = ''; $('q').value = ''; }
      else if (k === 'list') drop(p.hiddenLists);
      else if (k === 'label') drop(p.labels);
      else if (k === 'member') drop(p.members);
      else if (k === 'completed') p.completed = true;
      else if (k === 'weekends') p.weekends = true;
      renderFilters(); savePrefs(); render();
    });
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
      else if (el.id === 'fThumbs') p.thumbs = el.checked;
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
      if (e.target.closest('#quick, #peek')) return;
      var add = e.target.closest('[data-add]');
      if (add) { e.stopPropagation(); openNew(add.getAttribute('data-add'), add.closest('[data-date]') || add); return; }
      var ev = e.target.closest('.ev');
      if (ev) { openCard(ev.getAttribute('data-id')); return; }
      if (!e.target.closest('#cal')) return;
      // Clic en una hora libre de la semana → nueva tarjeta a esa hora
      var slot = e.target.closest('[data-slot]');
      if (slot && state.canEdit) { openNew(slot.getAttribute('data-date'), slot, slotMins(slot, e.clientY, 30), e.clientY); return; }
      // Clic en el hueco libre de un día → nueva tarjeta
      var day = e.target.closest('.day, [data-allday]');
      if (day && state.canEdit) openNew(day.getAttribute('data-date'), day);
    });
    document.body.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && e.target.id === 'q') { e.target.blur(); return; }
      if (e.target.matches('input, select, textarea') || !$('dlg').hidden || window.CalCardView.isOpen() || $('quick')) return;
      if (e.key === '/') { e.preventDefault(); $('q').focus(); $('q').select(); return; }
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
      hidePeek();
      ev.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', drag.id);
    });
    document.body.addEventListener('dragend', function (e) {
      if (e.target.classList) e.target.classList.remove('dragging');
      clearDrop(); drag = null;
    });
    function dropTarget(e) { return e.target.closest && (e.target.closest('[data-date]') || e.target.closest('#unsched')); }
    function clearDrop() {
      document.querySelectorAll('.drop').forEach(function (x) { x.classList.remove('drop'); });
      var g = document.getElementById('ghost'); if (g) g.remove();
    }
    document.body.addEventListener('dragover', function (e) {
      if (!drag) return;
      var tg = dropTarget(e);
      if (!tg) return;
      e.preventDefault();
      hidePeek();
      if (tg.hasAttribute('data-slot')) {
        // Hueco con hora: bloque fantasma que dice dónde caerá
        document.querySelectorAll('.drop').forEach(function (x) { x.classList.remove('drop'); });
        var m = slotMins(tg, e.clientY, 15), h0 = +tg.getAttribute('data-h0');
        var g = document.getElementById('ghost');
        if (!g || g.parentNode !== tg) { if (g) g.remove(); g = document.createElement('div'); g.id = 'ghost'; tg.appendChild(g); }
        g.style.top = ((m - h0 * 60) / 60 * HR + 1) + 'px'; g.style.height = (HR - 3) + 'px';
        g.textContent = '↳ ' + fmt(fromKey(tg.getAttribute('data-date')), { weekday: 'short', day: 'numeric' }) + ' · ' + hhmm(m);
        return;
      }
      var gg = document.getElementById('ghost'); if (gg) gg.remove();
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
      else reschedule(card, tg.getAttribute('data-date'), drag.from, tg.hasAttribute('data-slot') ? slotMins(tg, e.clientY, 15) : null);
    });

    $('authBtn').onclick = function () { askAuth('Autoriza una vez el calendario para mover y crear tarjetas.'); };
    bindDialog();
  }

  // Minutos (redondeados a `step`) del punto y de una columna con horas.
  function slotMins(col, clientY, step) {
    var r = col.getBoundingClientRect(), h0 = +col.getAttribute('data-h0'), h1 = +col.getAttribute('data-h1');
    var m = h0 * 60 + (clientY - r.top) / HR * 60;
    m = Math.round(m / step) * step;
    return Math.max(h0 * 60, Math.min(h1 * 60 - step, m));
  }
  function openCard(id) {
    var card = state.cards.filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    hidePeek(); closeQuick();
    state.selId = id;
    document.querySelectorAll('.ev.sel').forEach(function (x) { x.classList.remove('sel'); });
    document.querySelectorAll('.ev[data-id="' + id + '"]').forEach(function (x) { x.classList.add('sel'); });
    window.CalCardView.open(card);
  }
  // Tarjetas del mismo día (en el orden del calendario) para pasar de una a otra desde la tarjeta.
  function siblings(card) {
    var ev = eventOf(card); if (!ev) return null;
    var k = ev.endKey, items = (state.lastIdx[k] || buildIndex().idx[k] || []);
    var ids = items.map(function (it) { return it.card.id; });
    if (ids.indexOf(card.id) === -1) return null;
    return { ids: ids, i: ids.indexOf(card.id), label: fmt(fromKey(k), { weekday: 'short', day: 'numeric' }) };
  }

  // ───── Vista rápida al pasar el ratón ─────
  var peekTimer = null, peekHide = null, peekFor = null;
  function hidePeek() { clearTimeout(peekTimer); clearTimeout(peekHide); var p = $('peek'); if (p) p.remove(); peekFor = null; }
  function plainCopy(card) {
    var txt = card.desc || '';
    if (window.CalSocial) { var nets = CalSocial.detect(card); txt = CalSocial.copyFor(txt, nets[0] ? nets[0].net : null).text; }
    txt = txt.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*(#{1,6}|>|-{3,})\s*/gm, '').replace(/[*_~`]+/g, '').replace(/\s+/g, ' ').trim();
    return txt.length > 170 ? txt.slice(0, 170).replace(/\s+\S*$/, '') + '…' : txt;
  }
  function showPeek(el) {
    var card = state.cards.filter(function (c) { return c.id === el.getAttribute('data-id'); })[0];
    if (!card || window.CalCardView.isOpen() || $('quick') || !document.body.contains(el)) return;
    hidePeek(); peekFor = card.id;
    var th = thumbFor(card), list = state.listById[card.idList], d = card.due ? new Date(card.due) : null;
    var labels = (card.labels || []).map(function (l) {
      var bg = S.labelColor(l.color);
      return '<span class="lb" style="background:' + bg + ';color:' + S.textOn(bg) + '">' + esc(l.name || '') + '</span>';
    }).join('');
    var mem = (card.members || []).map(function (m) { return '<span class="av" title="' + esc(m.fullName) + '"' + (m.avatar ? ' style="background-image:url(' + esc(m.avatar) + '/30.png)">' : '>' + esc(m.initials || '')) + '</span>'; }).join('');
    var copy = plainCopy(card);
    var vid = (card.attachments || []).some(function (a) { return /^video\//.test(a.mimeType || '') || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(a.name || ''); });
    var p = document.createElement('div');
    p.id = 'peek'; p.className = 'peek';
    p.innerHTML = (th ? '<div class="pk-img"><img src="' + esc(th) + '" alt="" onerror="__calImgFail(this)">' + (vid ? '<span>▶</span>' : '') + '</div>' : '') +
      '<div class="pk-b">' + (labels ? '<div class="pk-lb">' + labels + '</div>' : '') +
      '<h4>' + esc(card.name) + '</h4>' +
      '<div class="pk-r">' + (d ? '<span class="' + (isLate(card) ? 'late' : '') + '">📅 ' + esc(fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + esc(fmtTime(d)) + '</span>' : '') +
      (list ? '<span class="status" style="--lc:' + S.hashColor(list.id) + '"><i></i>' + esc(list.name) + '</span>' : '') + mem + '</div>' +
      (copy ? '<div class="pk-copy">' + esc(copy) + '</div>' : '') +
      '<div class="pk-acts"><button class="btn" data-pk="open">Abrir</button>' +
      (state.canEdit && card.due ? '<button class="btn" data-pk="done">' + (card.dueComplete ? '↺ Pendiente' : '✓ Completar') + '</button>' : '') +
      (state.canEdit ? '<label class="btn pk-move">Mover a… <select data-pk="move">' + '<option value="">—</option>' + state.lists.map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === card.idList ? ' disabled' : '') + '>' + esc(l.name) + '</option>';
      }).join('') + '</select></label>' : '') + '</div></div>';
    document.body.appendChild(p);
    var r = el.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var x = r.right + 8 + pw < vw ? r.right + 8 : Math.max(8, r.left - pw - 8);
    var y = Math.max(8, Math.min(vh - ph - 8, r.top - 10));
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.addEventListener('mouseenter', function () { clearTimeout(peekHide); });
    p.addEventListener('mouseleave', function () { peekHide = setTimeout(hidePeek, 250); });
    p.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pk]'); if (!b || b.tagName === 'SELECT') return;
      var w = b.getAttribute('data-pk');
      if (w === 'open') openCard(card.id);
      else if (w === 'done') quickSave(card, { dueComplete: !card.dueComplete }, card.dueComplete ? 'Marcada como pendiente' : 'Completada: “' + card.name + '”');
    });
    p.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-pk') === 'move' && e.target.value) {
        var l = state.listById[e.target.value];
        quickSave(card, { idList: e.target.value }, '“' + card.name + '” → ' + (l ? l.name : ''));
      }
    });
  }
  // Cambio rápido (vista rápida): optimista y con vuelta atrás si falla.
  function quickSave(card, body, msg) {
    if (!state.canWrite) { askAuth('Para cambiar tarjetas desde el calendario, autoriza una vez el calendario.'); return; }
    var backup = JSON.parse(JSON.stringify(card));
    Object.keys(body).forEach(function (k) { card[k] = body[k]; });
    hidePeek(); render();
    apiPut('/cards/' + card.id, body).then(function () { toast(msg); }).catch(function (err) {
      Object.keys(backup).forEach(function (k) { card[k] = backup[k]; }); render();
      toast('No se pudo guardar: ' + (err && err.message ? err.message : err), true);
    });
  }
  function bindPeek() {
    document.body.addEventListener('mouseover', function (e) {
      var ev = e.target.closest && e.target.closest('#cal .ev, #unsched .ev');
      if (!ev) return;
      clearTimeout(peekHide);
      if (peekFor === ev.getAttribute('data-id')) return;
      clearTimeout(peekTimer);
      peekTimer = setTimeout(function () { showPeek(ev); }, 450);
    });
    document.body.addEventListener('mouseout', function (e) {
      var ev = e.target.closest && e.target.closest('#cal .ev, #unsched .ev');
      if (!ev || (e.relatedTarget && ev.contains(e.relatedTarget))) return;
      clearTimeout(peekTimer);
      peekHide = setTimeout(hidePeek, 250);
    });
    $('cal').addEventListener('scroll', hidePeek, true);
  }
  function openInTrello(card) {
    // Abre la tarjeta nativa de Trello (cierra el calendario).
    Promise.resolve(t.showCard(card.id)).catch(function () { if (card.url) window.open(card.url, '_blank'); });
  }
  function initCardView() {
    window.CalCardView.init({
      api: apiRequest,
      mediaUrl: mediaUrl,
      // Descargas reales a través del intermediario (worker/). Sin DOWNLOAD_URL o en el demo, no se usa.
      downloadBase: function () { return t.__mockWrite ? '' : String(C.DOWNLOAD_URL || '').replace(/\/+$/, ''); },
      authHeader: function () {
        return getToken().then(function (tok) {
          return tok ? 'OAuth oauth_consumer_key="' + C.APP_KEY + '", oauth_token="' + tok + '"' : null;
        });
      },
      canWrite: function () { return state.canWrite; },
      askAuth: function (msg) { askAuth(msg); },
      board: function () { return state.board; },
      lists: function () { return state.lists; },
      me: function () { return state.me; },
      onChange: function () { render(); },
      siblings: siblings,
      openCard: openCard,
      listColor: S.hashColor,
      boardName: function () { return (state.board && state.board.name) || ''; },
      openInTrello: openInTrello,
      toast: toast,
      labelColor: S.labelColor, textOn: S.textOn,
      locale: state.cfg.locale, defaultHour: state.cfg.defaultHour
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

  // Las @menciones necesitan el nombre de usuario de cada miembro; si Trello no lo da, lo pedimos a la API.
  var userCache = {}, usersFetched = false;
  function applyUserCache(mem) {
    mem.forEach(function (m) {
      var r = userCache[m.id];
      if (r) { m.username = m.username || r.username; m.fullName = m.fullName || r.fullName; m.avatarUrl = m.avatarUrl || r.avatarUrl; }
    });
  }
  function ensureUsernames() {
    var mem = (state.board && state.board.members) || [];
    applyUserCache(mem);
    if (usersFetched || !state.canWrite || !mem.length || mem.every(function (m) { return m.username; })) return;
    usersFetched = true;
    apiRequest('GET', '/boards/' + state.board.id + '/members?fields=fullName,username,initials,avatarUrl').then(function (list) {
      (list || []).forEach(function (m) { userCache[m.id] = m; });
      applyUserCache((state.board && state.board.members) || []);
    }).catch(function () { usersFetched = false; });
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
  function showDialog(which) {
    $('dlg').hidden = false;
    $('dlgAuth').hidden = which !== 'auth';
  }
  function closeDialog() { $('dlg').hidden = true; }

  // ───── Crear en línea: mini formulario junto al día (o la hora) ─────
  var quickCtx = null;
  function closeQuick() { var q = $('quick'); if (q) q.remove(); quickCtx = null; }
  function openNew(dayKey, anchor, mins, clientY) {
    if (!state.canEdit) return;
    if (!state.canWrite) { askAuth('Para crear tarjetas desde el calendario, autoriza una vez el calendario.', dayKey); return; }
    hidePeek(); closeQuick();
    var src = source(), showTime = srcHasTime();
    if (mins == null) mins = state.cfg.defaultHour * 60;
    var lastList = state.prefs.lastList;
    if (!state.listById[lastList]) lastList = state.lists[0] && state.lists[0].id;
    var q = document.createElement('form');
    q.id = 'quick'; q.className = 'quick'; q.autocomplete = 'off';
    q.innerHTML = '<input class="q-name" type="text" placeholder="Nombre de la tarjeta" aria-label="Nombre de la tarjeta">' +
      '<div class="q-row">' +
      '<label class="selectlike"><small>Lista:</small><select class="q-list">' + state.lists.map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === lastList ? ' selected' : '') + '>' + esc(l.name) + '</option>';
      }).join('') + '</select></label>' +
      (showTime ? '<input class="q-time" type="time" value="' + hhmm(mins) + '" aria-label="Hora">' : '') +
      (state.templates.length ? '<label class="selectlike"><small>Plantilla:</small><select class="q-tpl"><option value="">—</option>' + state.templates.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === state.prefs.lastTpl ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' : '') +
      '</div><div class="q-f"><span>' + esc(fmt(fromKey(dayKey), { weekday: 'short', day: 'numeric', month: 'short' })) +
      ' · <kbd>Enter</kbd> crear · <kbd>⇧ Enter</kbd> crear y abrir</span><button type="button" class="btn ghost q-x" aria-label="Cancelar">✕</button></div>';
    document.body.appendChild(q);
    quickCtx = { dayKey: dayKey, src: src };
    // Posición: al lado del día / hueco, dentro de la ventana
    var r = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 150, right: innerWidth / 2 + 150, top: 120, bottom: 120 };
    var w = q.offsetWidth, h = q.offsetHeight;
    var x = r.right + 8 + w < innerWidth ? r.right + 8 : r.left - w - 8;
    if (x < 8) x = Math.max(8, Math.min(innerWidth - w - 8, r.left));
    var y = clientY != null ? clientY - 20 : r.top + 4;
    q.style.left = x + 'px'; q.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
    var name = q.querySelector('.q-name'), tplSel = q.querySelector('.q-tpl'), listSel = q.querySelector('.q-list');
    if (tplSel) tplSel.onchange = function () {
      var tpl = state.templates.filter(function (c) { return c.id === tplSel.value; })[0];
      if (tpl && !name.value) name.placeholder = tpl.name;
      if (tpl && tpl.idList && state.listById[tpl.idList] && !listSel.dataset.touched) listSel.value = tpl.idList;
    };
    listSel.onchange = function () { listSel.dataset.touched = '1'; };
    q.querySelector('.q-x').onclick = closeQuick;
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQuick(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); createCard(e.shiftKey); }
    });
    q.onsubmit = function (e) { e.preventDefault(); createCard(false); };
    setTimeout(function () { name.focus(); }, 20);
  }
  document.addEventListener('mousedown', function (e) {
    if ($('quick') && !e.target.closest('#quick') && !e.target.closest('[data-add]')) closeQuick();
  });

  function createCard(openAfter) {
    var q = $('quick'); if (!q || !quickCtx) return;
    var key = quickCtx.dayKey, src = quickCtx.src;
    var name = q.querySelector('.q-name').value.trim(), idList = q.querySelector('.q-list').value;
    var tplSel = q.querySelector('.q-tpl'), tplId = tplSel ? tplSel.value : '';
    var tpl = state.templates.filter(function (c) { return c.id === tplId; })[0];
    if (!name && tpl) name = tpl.name;
    if (!name) { q.querySelector('.q-name').focus(); return; }
    var tIn = q.querySelector('.q-time');
    var hm = ((tIn && tIn.value) || (pad(state.cfg.defaultHour) + ':00')).split(':');
    var d = fromKey(key); d.setHours(+hm[0] || 0, +hm[1] || 0, 0, 0);
    var iso = d.toISOString();
    var body = { idList: idList, name: name, pos: 'bottom' };
    if (src === 'start') body.start = iso;
    else if (src === 'due' || src === 'range') body.due = iso;
    if (tpl) { body.idCardSource = tpl.id; body.keepFromSource = 'all'; }
    q.classList.add('busy');
    apiRequest('POST', '/cards', body).then(function (card) {
      if (src.indexOf('cf:') === 0 && card && card.id) {
        return apiPut('/cards/' + card.id + '/customField/' + src.slice(3) + '/item', { value: { date: iso } }).then(function () { return card; });
      }
      return card;
    }).then(function (card) {
      state.prefs.lastList = idList; state.prefs.lastTpl = tplId; savePrefs();
      closeQuick();
      toast('Tarjeta creada: “' + name + '”');
      return load().then(function () { if (openAfter && card && card.id) openCard(card.id); });
    }).catch(function (err) {
      if (q) q.classList.remove('busy');
      toast('No se pudo crear la tarjeta: ' + (err && err.message ? err.message : err), true);
    });
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
        .then(function (ok) { return ok || t.get('member', 'private', 'apiTok').then(function (x) { return !!(x || lsGet()); }); });
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
      state.cards.forEach(function (c) { (c.attachments || []).forEach(S.fixAtt); });
      window.CalCardView.sync(state.cards);
      state.lists = r[1] || [];
      state.board = r[2] || {};
      state.board.customFields = state.board.customFields || [];
      state.listById = {};
      state.lists.forEach(function (l) { state.listById[l.id] = l; });
      state.cfg = S.mergeCfg(r[3]);
      var p = r[4] || {};
      ['hiddenLists', 'labels', 'members'].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
      state.prefs = Object.assign(state.prefs, p);
      var first = !state.loaded, want = null;
      if (first) {
        state.view = state.prefs.view || state.cfg.defaultView;
        state.loaded = true;
        // Abierto desde el botón «Abrir en el calendario» de una tarjeta: ir a su fecha y abrirla.
        var wid = (location.search.match(/[?&]card=([\w-]+)/) || [])[1] || (t.arg && t.arg('card'));
        if (wid) want = state.cards.filter(function (c) { return c.id === wid || c.shortLink === wid; })[0] || null;
        var wev = want && eventOf(want);
        if (wev) state.cursor = fromKey(wev.endKey);
        if (want) state.selId = want.id;
        if (wid && !want) setTimeout(function () { toast('No se encuentra esa tarjeta (puede estar archivada)', true); }, 300);
      }
      renderSourceSelect();
      renderFilters();
      render();
      if (want) openCard(want.id);
      ensureUsernames();
    }).catch(function (err) {
      $('cal').innerHTML = '<div class="empty">No se pudieron cargar las tarjetas: ' + esc(err && err.message) + '</div>';
    }).then(function () { loading = null; });
    return loading;
  }

  // ───────────────────────── Arranque ─────────────────────────
  $('cal').innerHTML = '<div class="loading">Cargando tarjetas…</div>';
  bindUi();
  bindPeek();
  initCardView();
  Promise.resolve(t.member && t.member('id', 'fullName', 'initials', 'avatar')).then(function (m) { state.me = m || null; }).catch(function () {});
  // t.render se dispara cuando cambian los datos del tablero → calendario en vivo.
  if (typeof t.render === 'function') {
    var rTimer;
    t.render(function () { clearTimeout(rTimer); rTimer = setTimeout(load, 250); });
  } else {
    load();
  }
  // Línea de «ahora» en la vista Semana: se mueve sola cada minuto.
  setInterval(function () {
    var n = document.querySelector('.wk-col.today .now'), col = n && n.parentNode;
    if (!n) return;
    var m = minsOf(new Date()), h0 = +col.getAttribute('data-h0'), h1 = +col.getAttribute('data-h1');
    if (m > h1 * 60) { render(); return; }
    n.style.top = ((m - h0 * 60) / 60 * HR) + 'px'; n.querySelector('span').textContent = hhmm(m);
  }, 60000);
  // Pantalla de novedades (js/whatsnew.js). Para quitarla, borra esta línea y ese archivo.
  if (window.CalWhatsNew) setTimeout(function () { window.CalWhatsNew.maybeShow(t); }, 700);
})();
