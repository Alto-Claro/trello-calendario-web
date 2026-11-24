/* Vista de tarjeta dentro del calendario (sin salir del modal).
 * Se usa con CalCardView.init(ctx) y CalCardView.open(card).
 * ctx: { api(method, path, body), canWrite(), askAuth(msg), board(), lists(), onChange(card),
 *        openInTrello(card), locale, defaultHour, labelColor(color), textOn(hex) } */
(function () {
  'use strict';

  var ctx, card, full, root, busy = 0;
  var sp = { tab: 'details', net: null, slide: 0, expanded: false, editing: false }; // pestaña y estado de la vista previa
  var $ = function (sel) { return root.querySelector(sel); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function toDateInput(iso) { return iso ? toLocalInput(iso).slice(0, 10) : ''; }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(ctx.locale, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' });
  }
  // Markdown de Trello: títulos, negrita, cursiva, tachado, listas, citas, separadores,
  // bloques de código, enlaces, menciones y caracteres escapados (\* \#…).
  function mdInline(text) {
    var keep = [];
    function put(html) { keep.push(html); return '\u0000' + (keep.length - 1) + '\u0000'; }
    var s = String(text == null ? '' : text);
    s = s.replace(/`([^`\n]+)`/g, function (m, c) { return put('<code>' + esc(c) + '</code>'); });
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, function (m, c) { return put(esc(c)); });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, t, u) {
      return put('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>');
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (m, pre, u) {
      return pre + put('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + '</a>');
    });
    var h = esc(s);
    h = h.replace(/\*\*(?=\S)([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^\w])__(?=\S)([\s\S]+?)__(?!\w)/g, '$1<strong>$2</strong>');
    h = h.replace(/~~(?=\S)([\s\S]+?)~~/g, '<del>$1</del>');
    h = h.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>');
    h = h.replace(/(^|[^\w])_(?=\S)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
    h = h.replace(/(^|[\s(>])@([a-z0-9_]{2,})/gi, function (all, pre, u) {
      var m = memberByUsername(u);
      return pre + '<span class="cv-mention"' + (m ? ' title="' + esc(m.fullName) + '"' : '') + '>@' + u + '</span>';
    });
    for (var i = 0; i < 3 && h.indexOf('\u0000') !== -1; i++) {
      h = h.replace(/\u0000(\d+)\u0000/g, function (m, n) { return keep[+n]; });
    }
    return h;
  }
  function md(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), out = [], para = [], i = 0;
    function flush() { if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; } }
    var LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    while (i < lines.length) {
      var l = lines[i], m;
      if (/^\s*```/.test(l)) {
        flush(); var code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); i++; continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      if (/^\s*(-\s*){3,}$|^\s*(\*\s*){3,}$|^\s*(_\s*){3,}$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
      if ((m = l.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flush(); out.push('<h' + m[1].length + ' class="cv-md-h">' + mdInline(m[2]) + '</h' + m[1].length + '>'); i++; continue;
      }
      if (/^\s*>/.test(l)) {
        flush(); var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + md(q.join('\n')) + '</blockquote>'); continue;
      }
      if ((m = l.match(LIST))) {
        flush(); var ordered = /\d/.test(m[2]), items = [];
        while (i < lines.length && (m = lines[i].match(LIST)) && /\d/.test(m[2]) === ordered) {
          var lvl = Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
          items.push('<li' + (lvl ? ' style="margin-left:' + (lvl * 18) + 'px"' : '') + '>' + mdInline(m[3]) + '</li>'); i++;
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>')); continue;
      }
      para.push(l); i++;
    }
    flush();
    return out.join('');
  }
  function avatar(m, size) {
    var s = size || 28;
    var url = m.avatarUrl || (m.avatar ? m.avatar : null);
    if (url && !/\.png$/.test(url)) url += '/50.png';
    return '<span class="cv-av" style="width:' + s + 'px;height:' + s + 'px" title="' + esc(m.fullName || m.username) + '">' +
      (url ? '<img src="' + esc(url) + '" alt="">' : esc(m.initials || (m.fullName || '?').charAt(0))) + '</span>';
  }
  function labelChip(l) {
    var bg = ctx.labelColor(l.color);
    return '<span class="cv-label" style="background:' + bg + ';color:' + ctx.textOn(bg) + '">' + esc(l.name || ' ') + '</span>';
  }

  // ───────────────────────── Guardar cambios ─────────────────────────
  function needWrite() {
    if (ctx.canWrite()) return true;
    ctx.askAuth('Para editar tarjetas desde el calendario, autoriza una vez el calendario.');
    return false;
  }
  function setBusy(on) { busy += on ? 1 : -1; root.classList.toggle('cv-busy', busy > 0); }
  function save(method, path, body, apply, okMsg) {
    if (!needWrite()) { paint(); return Promise.resolve(false); }
    var backup = JSON.parse(JSON.stringify(card));
    if (apply) apply(card);
    paint(); ctx.onChange(card);
    setBusy(true);
    return ctx.api(method, path, body).then(function (res) {
      if (okMsg) ctx.toast(okMsg);
      return res || true;
    }).catch(function (err) {
      Object.keys(card).forEach(function (k) { delete card[k]; });
      Object.keys(backup).forEach(function (k) { card[k] = backup[k]; });
      paint(); ctx.onChange(card);
      ctx.toast('No se pudo guardar: ' + (err && err.message ? err.message : err), true);
      return false;
    }).then(function (r) { setBusy(false); return r; });
  }

  // ───────────────────────── Pintado ─────────────────────────
  var ignoreWarn = {};
  function normS(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function listName(id) { return ((ctx.lists() || []).filter(function (l) { return l.id === id; })[0] || {}).name || ''; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function relDay(d) {
    var a = new Date(); a.setHours(0, 0, 0, 0);
    var b = new Date(d); b.setHours(0, 0, 0, 0);
    var n = Math.round((b - a) / 864e5);
    return n === 0 ? 'hoy' : n === 1 ? 'mañana' : n === -1 ? 'ayer' : n > 0 ? 'en ' + n + ' días' : 'hace ' + (-n) + ' días';
  }
  function fmtLong(iso, withTime) {
    var d = new Date(iso), s = d.toLocaleDateString(ctx.locale, { weekday: 'short', day: 'numeric', month: 'short' });
    s = s.replace(',', '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return withTime ? s + ' · ' + d.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' }) : s;
  }
  // Líneas «Estado:» y «Publicación:» de la descripción que no cuadran con la tarjeta.
  var RE_EST = /(Estado[\s*_]*:[\s*_]*)(.*)$/i, RE_PUB = /(Publicaci[oó]n[\s*_]*:[\s*_]*)(.*)$/i;
  function descIssues(c) {
    var out = [], lines = String(c.desc || '').split('\n');
    lines.forEach(function (l, i) {
      var m;
      if ((m = l.match(RE_EST)) && /^\W*\**\s*estado/i.test(l.replace(/\*/g, ''))) {
        var v = m[2].replace(/[*_]/g, '').trim(), ln = listName(c.idList);
        if (v && ln && normS(v) !== normS(ln)) out.push({ kind: 'estado', line: i, from: v, to: ln });
      } else if ((m = l.match(RE_PUB)) && c.due && /^\W*\**\s*(fecha de )?publicaci/i.test(l.replace(/\*/g, ''))) {
        var d = m[2].replace(/[*_]/g, '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
        if (!d) return;
        var y = +d[3] < 100 ? 2000 + +d[3] : +d[3], due = new Date(c.due);
        var pd = new Date(y, +d[2] - 1, +d[1], d[4] != null ? +d[4] : due.getHours(), d[5] != null ? +d[5] : due.getMinutes());
        if (!sameDay(pd, due) || (d[4] != null && (pd.getHours() !== due.getHours() || pd.getMinutes() !== due.getMinutes()))) {
          out.push({ kind: 'pub', line: i, from: d[0], to: pad(due.getDate()) + '/' + pad(due.getMonth() + 1) + '/' + due.getFullYear() + ' ' + pad(due.getHours()) + ':' + pad(due.getMinutes()) });
        }
      }
    });
    return out;
  }
  function fixDesc(c, issues) {
    var lines = String(c.desc || '').split('\n');
    issues.forEach(function (x) {
      lines[x.line] = lines[x.line].replace(x.kind === 'estado' ? RE_EST : RE_PUB, function (all, pre) { return pre + x.to; });
    });
    return lines.join('\n');
  }
  function richText(t) {
    return esc(t).replace(/(^|\s)([#@][\wáéíóúñü.]+)/gi, '$1<span class="cv-tag">$2</span>').replace(/\n/g, '<br>');
  }
  function countEmoji(t) { return (String(t).match(/\p{Extended_Pictographic}/gu) || []).length; }
  function countTags(t) { return (String(t).match(/(^|\s)#[\wáéíóúñü]+/gi) || []).length; }
  function fmtN(n) { return n.toLocaleString('es-ES'); }
  function actionsOf() { return (full && full.actions) || []; }
  function isComment(a) { return !a.type || a.type === 'commentCard'; }
  function actText(a) {
    var d = a.data || {}, who = '<b>' + esc((a.memberCreator || {}).fullName || 'Alguien') + '</b>';
    switch (a.type) {
      case 'updateCard':
        if (d.listAfter) return who + ' movió la tarjeta a <b>' + esc(d.listAfter.name) + '</b>' + (d.listBefore ? ' <span class="cv-muted">(desde ' + esc(d.listBefore.name) + ')</span>' : '');
        if (d.card && 'dueComplete' in d.card) return who + (d.card.dueComplete ? ' marcó la tarjeta como completada' : ' marcó la tarjeta como pendiente');
        if (d.card && 'due' in d.card) return who + (d.card.due ? ' cambió la fecha a <b>' + esc(fmtLong(d.card.due, true)) + '</b>' : ' quitó la fecha');
        return who + ' editó la tarjeta';
      case 'addAttachmentToCard': return who + ' adjuntó <b>' + esc((d.attachment || {}).name || 'un archivo') + '</b>';
      case 'createCard': return who + ' creó la tarjeta';
      case 'updateCheckItemStateOnCard': return who + (d.checkItem && d.checkItem.state === 'complete' ? ' completó ' : ' desmarcó ') + '<b>' + esc((d.checkItem || {}).name || '') + '</b>';
      default: return null;
    }
  }
  function fmtAgo(iso) {
    var d = new Date(iso), mins = Math.round((Date.now() - d) / 6e4);
    if (mins < 1) return 'ahora';
    if (mins < 60) return 'hace ' + mins + ' min';
    if (sameDay(d, new Date())) return 'hoy ' + d.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' });
    return fmtDateTime(iso);
  }

  function paint() {
    if (!card) return;
    var w = ctx.canWrite(), lists = ctx.lists(), board = ctx.board() || {};
    var checklists = (full && full.checklists) || card.checklists || [];
    var attachments = (full && full.attachments) || card.attachments || [];
    var nets = window.CalSocial ? CalSocial.detect(card) : [];
    if (!nets.length && sp.tab === 'preview') sp.tab = 'details';
    // Conservar borradores y desplazamiento al repintar
    var keep = {};
    root.querySelectorAll('[data-keep]').forEach(function (el) { keep[el.getAttribute('data-keep')] = { v: el.value, f: document.activeElement === el, s: el.selectionStart }; });
    var scr = {};
    ['.cv-main', '.cv-side-scroll', '.cv-conv', '.cv-files'].forEach(function (k) { var el = $(k); if (el) scr[k] = el.scrollTop; });

    var lab = card.labels || [];
    var stripBg = lab.length ? 'linear-gradient(90deg,' + lab.slice(0, 3).map(function (l) { return ctx.labelColor(l.color); }).join(',') + (lab.length === 1 ? ',' + ctx.labelColor(lab[0].color) : '') + ')' : 'var(--line)';
    var h = '<div class="cv-strip" style="background:' + stripBg + '"></div>';

    // Barra superior: tablero, navegación entre tarjetas del día y acciones
    var sib = ctx.siblings ? ctx.siblings(card) : null;
    // Cabecera compacta: título, navegación y acciones en una sola fila
    h += '<div class="cv-top">' + (w ? '<textarea class="cv-title" rows="1" data-f="name">' + esc(card.name) + '</textarea>'
           : '<h2 class="cv-title ro">' + esc(card.name) + '</h2>');
    if (sib && sib.ids.length > 1) {
      h += '<span class="cv-navc"><button data-act="nav" data-d="-1" title="Anterior (K)"' + (sib.i === 0 ? ' disabled' : '') + '>‹</button>' +
        '<span>' + (sib.i + 1) + ' de ' + sib.ids.length + ' · ' + esc(sib.label) + '</span>' +
        '<button data-act="nav" data-d="1" title="Siguiente (J)"' + (sib.i === sib.ids.length - 1 ? ' disabled' : '') + '>›</button></span>';
    }
    if (!w) h += '<button class="btn primary cv-sm" data-act="auth">Autorizar edición</button>';
    else if (card.due) h += '<button class="btn cv-sm ' + (card.dueComplete ? '' : 'primary') + '" data-act="toggle-done">' + (card.dueComplete ? '↺ Pendiente' : '✓ Completar') + '</button>';
    h += '<button class="btn cv-sm" data-act="trello" title="Abrir en Trello">Trello ↗</button>' +
      '<button class="btn cv-sm icon" data-act="copy" title="Copiar enlace">🔗</button>' +
      '<button class="cv-x" data-act="close" aria-label="Cerrar" title="Cerrar (Esc)">✕</button></div>';

    // Propiedades
    var lc = ctx.listColor ? ctx.listColor(card.idList) : 'var(--accent)';
    h += '<div class="cv-props">';
    h += '<span class="cv-pp"><span class="cv-k">Estado</span><span class="cv-v">' + (w
      ? '<label class="cv-status" style="--lc:' + lc + '"><i></i><select data-f="idList">' + lists.map(function (l) {
          return '<option value="' + esc(l.id) + '"' + (l.id === card.idList ? ' selected' : '') + '>' + esc(l.name) + '</option>';
        }).join('') + '</select>▾</label>'
      : '<span class="cv-status" style="--lc:' + lc + '"><i></i>' + esc(listName(card.idList)) + '</span>') + '</span></span>';
    var dateLbl = nets.length ? 'Publicación' : 'Vencimiento';
    var rel = '';
    if (card.due) {
      if (card.dueComplete) rel = '<span class="cv-rel ok">✓ Completada</span>';
      else if (new Date(card.due) < new Date()) rel = '<span class="cv-rel late">Vencida · ' + relDay(card.due) + '</span>';
      else rel = '<span class="cv-rel' + ((new Date(card.due) - new Date()) < 3 * 864e5 ? ' soon' : '') + '">' + relDay(card.due) + '</span>';
    }
    h += '<span class="cv-pp"><span class="cv-k">' + dateLbl + '</span><span class="cv-v cv-datev">' +
      (w ? '<button class="cv-chipbtn" data-act="date-pop">' + (card.due ? esc(fmtLong(card.due, true)) : 'Añadir fecha') + ' ▾</button>'
         : '<span class="cv-chipbtn ro">' + (card.due ? esc(fmtLong(card.due, true)) : 'Sin fecha') + '</span>') + rel +
      (card.start ? '<span class="cv-muted">Inicio: ' + esc(fmtLong(card.start, false)) + '</span>' : (w ? '<button class="cv-ghost" data-act="date-pop">+ inicio</button>' : '')) +
      (w ? '<div class="cv-pop cv-datepop" data-pop="date" hidden>' +
        '<label>' + dateLbl + '<span><input type="date" data-d="due-d" value="' + toDateInput(card.due) + '"><input type="time" data-d="due-t" value="' + (card.due ? toLocalInput(card.due).slice(11) : pad(ctx.defaultHour) + ':00') + '"></span></label>' +
        '<label>Inicio<span><input type="date" data-d="start-d" value="' + toDateInput(card.start) + '"></span></label>' +
        '<label class="cv-chk"><input type="checkbox" data-d="done"' + (card.dueComplete ? ' checked' : '') + '> Completada</label>' +
        '<div class="cv-pop-f"><button class="btn cv-sm" data-act="date-clear">Quitar fechas</button><span class="cv-sp"></span>' +
        '<button class="btn cv-sm" data-act="pop-close">Cancelar</button><button class="btn primary cv-sm" data-act="date-save">Guardar</button></div></div>' : '') +
      '</span></span>';
    var mem = card.members || [];
    h += '<span class="cv-pp"><span class="cv-k">Responsable</span><span class="cv-v cv-rel-pos">' +
      mem.map(function (m) { return '<span class="cv-person">' + avatar(m, 24) + (mem.length <= 2 ? esc((m.fullName || m.username || '').split(' ')[0]) : '') + '</span>'; }).join('') +
      (w ? '<button class="cv-add" data-act="pick-members" title="Responsables">+</button>' : (mem.length ? '' : '<span class="cv-muted">—</span>'));
    if (w) {
      var memberIds = mem.map(function (m) { return m.id; });
      h += '<div class="cv-picker cv-pop" data-picker="members" hidden>' + (board.members || []).map(function (m) {
        return '<label class="cv-pick"><input type="checkbox" data-member="' + esc(m.id) + '"' +
          (memberIds.indexOf(m.id) !== -1 ? ' checked' : '') + '>' + avatar(m, 22) + esc(m.fullName || m.username) + '</label>';
      }).join('') + '</div>';
    }
    h += '</span></span>';
    h += '<span class="cv-pp"><span class="cv-k">Etiquetas</span><span class="cv-v cv-rel-pos">' + lab.map(labelChip).join('') +
      (w ? '<button class="cv-add sq" data-act="pick-labels" title="Etiquetas">+</button>' : (lab.length ? '' : '<span class="cv-muted">—</span>'));
    if (w) {
      var labelIds = lab.map(function (l) { return l.id; });
      h += '<div class="cv-picker cv-pop" data-picker="labels" hidden>' + (board.labels || []).map(function (l) {
        return '<label class="cv-pick"><input type="checkbox" data-label="' + esc(l.id) + '"' +
          (labelIds.indexOf(l.id) !== -1 ? ' checked' : '') + '>' + labelChip(l) + '</label>';
      }).join('') + '</div>';
    }
    h += '</span></span>';
    if (nets.length) {
      h += '<span class="cv-pp"><span class="cv-k">Redes</span><span class="cv-v">' + nets.map(function (d) {
        return '<span class="cv-net"><span class="cv-ni n-' + d.net + '"></span>' + esc(d.label) + '</span>';
      }).join('') + '</span></span>';
    }
    var tot = 0, dn = 0;
    checklists.forEach(function (cl) { (cl.checkItems || []).forEach(function (it) { tot++; if (it.state === 'complete') dn++; }); });
    if (!tot && card.badges && card.badges.checkItems) { tot = card.badges.checkItems; dn = card.badges.checkItemsChecked || 0; }
    if (tot) {
      var pend = [];
      checklists.forEach(function (cl) { (cl.checkItems || []).forEach(function (it) { if (it.state !== 'complete') pend.push(it.name); }); });
      h += '<span class="cv-pp" title="' + esc(pend.length ? 'Pendiente: ' + pend.join(', ') : 'Todo hecho') + '"><span class="cv-k">Checklist</span><span class="cv-v"><span class="cv-prog2"><i style="width:' + Math.round(dn * 100 / tot) + '%"></i></span><b>' + dn + '/' + tot + '</b></span></span>';
    }
    h += '</div>';

    // Aviso: la descripción contradice a la tarjeta
    var issues = ignoreWarn[card.id] ? [] : descIssues(card);
    if (issues.length) {
      h += '<div class="cv-warn">⚠️ <span>La descripción dice ' + issues.map(function (x) {
        return '<b>«' + (x.kind === 'estado' ? 'Estado' : 'Publicación') + ': ' + esc(x.from) + '»</b>';
      }).join(' y ') + ', pero la tarjeta ' + issues.map(function (x) {
        return x.kind === 'estado' ? 'está en <b>' + esc(x.to) + '</b>' : 'se publica el <b>' + esc(x.to) + '</b>';
      }).join(' y ') + '.</span><span class="cv-sp"></span>' +
        (w ? '<button class="btn cv-sm" data-act="fix-desc">Actualizar descripción</button>' : '') +
        '<button class="btn cv-sm ghost" data-act="ignore-warn">Ignorar</button></div>';
    }

    // Pestañas
    var acts = actionsOf(), nComments = acts.filter(isComment).length;
    var nAct = acts.filter(function (a) { return isComment(a) || actText(a); }).length;
    h += '<div class="cv-tabs" role="tablist">' +
      '<button role="tab" class="cv-tab' + (sp.tab === 'details' ? ' on' : '') + '" data-act="cv-tab" data-tab="details">Contenido</button>' +
      (nets.length ? '<button role="tab" class="cv-tab' + (sp.tab === 'preview' ? ' on' : '') + '" data-act="cv-tab" data-tab="preview">Vista previa en redes <span class="cv-tab-n">' + nets.length + '</span></button>' : '') +
      '<button role="tab" class="cv-tab' + (sp.tab === 'activity' ? ' on' : '') + '" data-act="cv-tab" data-tab="activity">Actividad' + (full ? ' <span class="cv-tab-n">' + nAct + '</span>' : '') + '</button>' +
      '<span class="cv-kb">' + (sib && sib.ids.length > 1 ? '<kbd>J</kbd><kbd>K</kbd> tarjeta · ' : '') + '<kbd>Esc</kbd> cerrar</span></div>';

    h += '<div class="cv-body' + (sp.tab === 'preview' ? ' is-preview' : '') + '"><div class="cv-main">';
    if (sp.tab === 'preview') h += previewMain(nets, attachments);
    else if (sp.tab === 'activity') h += activityMain(acts);
    else h += contentMain(nets, checklists, w);
    h += '</div><aside class="cv-side">';
    h += sp.tab === 'preview' ? previewSide(nets, attachments, w) : filesAndConversation(attachments, acts, nComments, w);
    h += '</aside></div>';

    closeMention();
    root.querySelector('.cv').innerHTML = h;
    hydrateMedia(attachments);
    var ta = $('.cv-title');
    if (ta && ta.tagName === 'TEXTAREA') autosize(ta);
    Object.keys(keep).forEach(function (k) {
      var el = root.querySelector('[data-keep="' + k + '"]');
      if (!el) return;
      el.value = keep[k].v;
      if (el.tagName === 'TEXTAREA') autosize(el);
      if (keep[k].f) { el.focus(); try { el.setSelectionRange(keep[k].s, keep[k].s); } catch (e) {} }
    });
    Object.keys(scr).forEach(function (k) { var el = $(k); if (el) el.scrollTop = scr[k]; });
    var conv = $('.cv-conv');
    if (conv && sp.scrollConv) { conv.scrollTop = conv.scrollHeight; sp.scrollConv = false; }
  }

  // ───── Pestaña Contenido ─────
  function contentMain(nets, checklists, w) {
    var h = '', desc = card.desc || '';
    var sec = window.CalSocial ? CalSocial.sections(desc) : { list: [] };
    var copySecs = sec.list;
    // Copy
    if (copySecs.length || nets.length) {
      var gen = copySecs.filter(function (x) { return !x.net; })[0];
      var own = copySecs.filter(function (x) { return x.net; });
      var ownNets = own.map(function (x) { return x.net; });
      var usesGen = nets.filter(function (d) { return ownNets.indexOf(d.net) === -1; }).map(function (d) { return CalSocial.NETS[d.net].name; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
      var missing = nets.map(function (d) { return d.net; }).filter(function (n, i, a) { return a.indexOf(n) === i && ownNets.indexOf(n) === -1; });
      h += '<section class="cv-sec"><div class="cv-sec-h"><h3>Copy</h3><span class="cv-muted">Lo que se publica. Un bloque por red solo si cambia.</span><span class="cv-sp"></span>';
      if (w && missing.length && gen) {
        h += '<label class="btn cv-sm cv-selbtn">+ Copy para otra red<select data-act-sel="add-copy"><option value="">—</option>' + missing.map(function (n) {
          return '<option value="' + n + '">' + CalSocial.NETS[n].name + '</option>';
        }).join('') + '</select></label>';
      }
      h += '</div>';
      if (gen || sp.editCopy === 'gen') h += copyBlock(null, gen ? gen.text : '', usesGen, w, nets);
      else if (w) h += '<div class="cv-empty-copy">Esta tarjeta no tiene una sección de copy: la vista previa usa toda la descripción. <button class="btn cv-sm" data-act="copy-edit" data-net="gen">+ Crear copy</button></div>';
      own.forEach(function (x) { h += copyBlock(x.net, x.text, [CalSocial.NETS[x.net].name], w, nets); });
      if (sp.editCopy && sp.editCopy !== 'gen' && ownNets.indexOf(sp.editCopy) === -1) {
        h += copyBlock(sp.editCopy, gen ? gen.text : '', [CalSocial.NETS[sp.editCopy].name], w, nets, true);
      }
      h += '</section>';
    }
    // Checklists
    checklists.forEach(function (cl) {
      var items = (cl.checkItems || []).slice().sort(function (a, b) { return a.pos - b.pos; });
      var done = items.filter(function (i) { return i.state === 'complete'; }).length;
      var pct = items.length ? Math.round(done * 100 / items.length) : 0;
      var members = (ctx.board() || {}).members || [];
      h += '<section class="cv-sec"><div class="cv-sec-h"><h3>' + esc(cl.name) + '</h3><span class="cv-muted">' + done + ' de ' + items.length + '</span>' +
        '<span class="cv-prog2 wide"><i class="' + (pct === 100 ? 'full' : '') + '" style="width:' + pct + '%"></i></span></div>' +
        items.map(function (it) {
          var m = it.idMember && members.filter(function (x) { return x.id === it.idMember; })[0];
          var due = it.due ? new Date(it.due) : null, late = due && it.state !== 'complete' && due < new Date();
          return '<label class="cv-ck' + (it.state === 'complete' ? ' done' : '') + '"><input type="checkbox" data-check="' + esc(it.id) +
            '" data-cl="' + esc(cl.id) + '"' + (it.state === 'complete' ? ' checked' : '') + (w ? '' : ' disabled') + '><span class="cv-ck-l">' + mdInline(it.name) + '</span>' +
            '<span class="cv-ck-m">' + (m ? avatar(m, 18) : '') + (due ? '<span class="' + (late ? 'late' : '') + '">' + esc(relDay(it.due) === 'mañana' ? 'vence mañana' : fmtLong(it.due, false)) + '</span>' : '') + '</span></label>';
        }).join('') +
        (w ? '<form class="cv-additem" data-cl="' + esc(cl.id) + '"><input type="text" placeholder="+ Añadir un elemento" data-keep="add-' + esc(cl.id) + '"></form>' : '') +
        '</section>';
    });
    if (!full && card.badges && card.badges.checkItems && !checklists.some(function (c) { return (c.checkItems || []).length; })) {
      h += '<section class="cv-sec"><div class="cv-muted">Checklist: ' + card.badges.checkItemsChecked + '/' + card.badges.checkItems +
        (ctx.canWrite() ? '' : ' · autoriza el calendario para ver los elementos') + '</div></section>';
    }
    // Notas (la descripción sin las secciones de copy)
    var rest = copySecs.length ? CalSocial.removeSections(sec, copySecs).trim() : desc;
    h += '<section class="cv-sec"><div class="cv-sec-h"><h3>' + (copySecs.length ? 'Notas y briefing' : 'Descripción') + '</h3><span class="cv-sp"></span>' +
      (w ? '<button class="btn cv-sm" data-act="edit-desc">' + (copySecs.length ? 'Editar descripción completa' : 'Editar') + '</button>' : '') + '</div>' +
      '<div class="cv-desc cv-md cv-notes" data-desc>' + (rest ? md(rest) : '<span class="cv-muted">' + (w ? 'Añade notas, briefing o instrucciones…' : 'Sin descripción') + '</span>') + '</div>' +
      (w ? '<div class="cv-desc-edit" hidden><textarea rows="10" data-mention data-keep="desc">' + esc(desc) + '</textarea>' +
        '<div class="cv-actions"><button class="btn primary cv-sm" data-act="save-desc">Guardar</button>' +
        '<button class="btn cv-sm" data-act="cancel-desc">Cancelar</button><span class="cv-muted">El copy está en las secciones «Contenido / Copy» y «Copy · Red».</span></div></div>' : '') +
      '</section>';
    return h;
  }
  function copyBlock(net, text, users, w, nets, isNew) {
    var key = net || 'gen', editing = sp.editCopy === key;
    var limit = Infinity;
    (net ? [net] : nets.map(function (d) { return d.net; })).forEach(function (n) { limit = Math.min(limit, CalSocial.NETS[n].limit); });
    if (!isFinite(limit)) limit = 2200;
    var t = CalSocial.plain(text);
    var h = '<div class="cv-copy' + (editing ? ' editing' : '') + '" data-copy="' + key + '"><div class="cv-copy-h">' +
      (net ? '<span class="cv-ni n-' + net + '"></span>' + esc(CalSocial.NETS[net].name) + ' <span class="cv-tagp">Personalizado</span>'
           : 'General' + (users.length ? ' <span class="cv-muted">· ' + esc(users.join(' y ')) + '</span>' : '')) + '</div>';
    if (editing) {
      h += '<textarea class="cv-copy-ta" rows="4" data-keep="copy-' + key + '" data-copy-ta data-limit="' + limit + '">' + esc(text) + '</textarea>';
    } else {
      h += '<div class="cv-copy-tx">' + (t ? richText(t) : '<span class="cv-muted">Vacío</span>') + '</div>';
    }
    h += '<div class="cv-copy-f"><span data-copy-count>' + fmtN(t.length) + ' / ' + fmtN(limit) + '</span><span>' + countTags(t) + ' hashtags</span>' +
      (countEmoji(t) ? '<span>' + countEmoji(t) + ' emoji</span>' : '') + '<span class="cv-sp"></span>';
    if (editing) {
      h += '<span class="cv-muted"><kbd>⌘</kbd> <kbd>Enter</kbd> guardar</span><button class="btn cv-sm" data-act="copy-cancel">Cancelar</button>' +
        '<button class="btn primary cv-sm" data-act="copy-save" data-net="' + key + '">Guardar</button>';
    } else {
      if (w) h += (net ? '<button class="cv-lnk muted" data-act="copy-reset" data-net="' + net + '">Usar el general</button>' : '') +
        '<button class="cv-lnk" data-act="copy-edit" data-net="' + key + '">Editar</button>';
      h += '<button class="cv-lnk" data-act="copy-clip" data-net="' + key + '">Copiar</button>';
    }
    return h + '</div></div>';
  }

  // ───── Pestaña Actividad ─────
  function activityMain(acts) {
    if (!full) return '<div class="cv-muted">' + (ctx.canWrite() ? 'Cargando…' : 'Autoriza el calendario para ver la actividad.') + '</div>';
    var list = acts.filter(function (a) { return isComment(a) || actText(a); });
    if (!list.length) return '<div class="cv-muted">Sin actividad todavía.</div>';
    return '<div class="cv-log">' + list.map(function (a) {
      var m = a.memberCreator || {};
      if (isComment(a)) {
        return '<div class="cv-log-i">' + avatar(m, 26) + '<div><div class="cv-cmt-h"><strong>' + esc(m.fullName || '') + '</strong> comentó' +
          '<span class="cv-muted">' + esc(fmtAgo(a.date)) + '</span></div><div class="cv-cmt-b cv-md">' + md(a.data && a.data.text) + '</div></div></div>';
      }
      return '<div class="cv-log-i act">' + avatar(m, 26) + '<div>' + actText(a) + ' <span class="cv-muted">· ' + esc(fmtAgo(a.date)) + '</span></div></div>';
    }).join('') + '</div>';
  }

  // ───── Columna derecha: archivos + conversación ─────
  function filesAndConversation(attachments, acts, nComments, w) {
    var h = '<div class="cv-side-scroll cv-side-split">';
    var canUp = w && ((upInfo && upInfo.ok) || bigToDrive()), myUps = uploads.filter(function (u) { return u.card === card.id; });
    h += '<section class="cv-files"><div class="cv-side-h"><h3>Archivos' + (attachments.length ? ' <span class="cv-muted">' + attachments.length + '</span>' : '') + '</h3><span class="cv-side-btns">' +
      (attachments.length > 1 ? '<button class="btn cv-sm" data-act="dl-all" title="Descargar todos los adjuntos">⤓ Todo</button>' : '') +
      (canUp ? '<button class="btn cv-sm" data-act="upload" title="Subir archivos (los de más de ' + TRELLO_MAX_MB + ' MB se guardan en ' + (bigToDrive() ? 'Google Drive' : 'Cloudflare') + ')">+ Subir</button>' : '') + '</span></div>';
    h += myUps.map(function (u) {
      return '<div class="cv-up' + (u.err ? ' err' : '') + '" data-up="' + u.id + '"><div class="cv-up-t"><span title="' + esc(u.name) + '">' + esc(u.name) + '</span>' +
        '<span class="cv-muted" data-up-pct>' + (u.err ? esc(u.err) : upLabel(u)) + '</span></div>' +
        (u.err ? '<button class="cv-sa-del" data-act="up-dismiss" data-up="' + u.id + '" aria-label="Quitar">×</button>'
          : u.wait ? '<button class="btn primary cv-sm" data-act="drive-connect">Conectar Google Drive</button>' +
            '<button class="cv-sa-del" data-act="up-dismiss" data-up="' + u.id + '" aria-label="Cancelar">×</button>'
          : '<div class="cv-up-bar"><i style="width:' + Math.round(u.pct * 100) + '%"></i></div>') + '</div>';
    }).join('');
    if (attachments.length) {
      var cov = card.cover && card.cover.idAttachment;
      h += '<div class="cv-files-g">' + attachments.map(function (a) {
        var k = kindOf(a), df = driveFile(a), ext = ((a.name || a.url || '').match(/\.([a-z0-9]{1,5})(\?|$)/i) || [, ''])[1].toUpperCase();
        var thumb = k === 'image' || df || (k === 'video' && bestPreview(a));
        var open = k === 'image' ? 'lightbox' : df ? 'drive-view' : k === 'video' ? 'play-v' : 'open-url';
        var meta = a.bytes ? fmtBytes(a.bytes) : (a.drive ? 'Google Drive' : a.r2 ? 'Cloudflare' : (a.isUpload === false ? 'Enlace' : ''));
        var dl = a.drive && !driveDl(a)
          ? '<a class="cv-fa" href="' + esc(a.url) + '" target="_blank" rel="noopener" title="Abrir en Google Drive">↗</a>'
          : viaWorker(a) ? '<button class="cv-fa" data-act="dl-one" data-att="' + esc(a.id) + '" title="Descargar">↓</button>'
          : '<a class="cv-fa" href="' + esc(dlUrl(a)) + '" target="_blank" rel="noopener" download="' + esc(a.name || '') + '" title="Descargar">↓</a>';
        return '<div class="cv-file' + (a.id === cov ? ' is-cover' : '') + '">' +
          '<button class="cv-fth k-' + k + '" data-act="' + open + '" data-att="' + esc(a.id) + '" title="' + esc(a.name) + '">' +
          (thumb ? '<img data-media="' + esc(a.id) + '" data-size="thumb" alt="">' : '<span class="cv-fext">' + (a.drive ? 'DRIVE' : esc(ext || 'FILE')) + '</span>') +
          (k === 'video' ? '<span class="cv-fplay">▶</span>' : '') + (a.id === cov ? '<span class="cv-fcov">Portada</span>' : '') + '</button>' +
          '<div class="cv-fn" title="' + esc(a.name) + '">' + esc(a.name || a.url) + '<small>' + esc(meta) + '</small></div>' +
          '<div class="cv-facts">' + dl +
          (w && k === 'image' && a.isUpload !== false && !a.drive && a.id !== cov ? '<button class="cv-fa" data-act="set-cover" data-att="' + esc(a.id) + '" title="Usar como portada">★</button>' : '') +
          (w ? '<button class="cv-fa del" data-act="del-att" data-att="' + esc(a.id) + '" title="Eliminar" aria-label="Eliminar">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>' : '') +
          '</div></div>';
      }).join('') + '</div>';
    }
    if (canUp) h += '<div class="cv-drop" data-act="upload">Suelta archivos aquí o pega con <kbd>⌘V</kbd>' + (bigToDrive() ? ' · más de ' + TRELLO_MAX_MB + ' MB → Google Drive' : '') + '</div>';
    else if (!attachments.length) h += '<div class="cv-muted">Sin archivos.</div>';
    h += '</section>';

    // Conversación: comentarios y movimientos, del más antiguo al más reciente
    h += '<section class="cv-conv"><div class="cv-side-h"><h3>Conversación' + (full ? ' <span class="cv-muted">' + nComments + ' comentario' + (nComments === 1 ? '' : 's') + '</span>' : '') + '</h3></div>';
    if (full) {
      var list = acts.filter(function (a) { return isComment(a) || (a.type === 'updateCard' && a.data && a.data.listAfter) || a.type === 'addAttachmentToCard'; }).slice(0, 40).reverse();
      h += list.length ? list.map(function (a) {
        var m = a.memberCreator || {};
        if (!isComment(a)) return '<div class="cv-act">' + actText(a) + ' <span>· ' + esc(fmtAgo(a.date)) + '</span></div>';
        return '<div class="cv-msg">' + avatar(m, 28) + '<div><div class="cv-msg-h"><strong>' + esc(m.fullName || '') + '</strong><span class="cv-muted">' + esc(fmtAgo(a.date)) + '</span></div>' +
          '<div class="cv-bub cv-md">' + md(a.data && a.data.text) + '</div></div></div>';
      }).join('') : '<div class="cv-muted">Sin comentarios todavía.</div>';
    } else if (!w) {
      h += '<div class="cv-muted">' + ((card.badges && card.badges.comments) ? card.badges.comments + ' comentario(s). ' : '') + 'Autoriza el calendario para ver y escribir comentarios.</div>';
    } else h += '<div class="cv-muted">Cargando…</div>';
    h += '</section></div>';
    if (w) {
      h += '<form class="cv-comment"><textarea rows="2" data-mention data-keep="comment" placeholder="Escribe un comentario… @ para mencionar"></textarea>' +
        '<div class="cv-comment-f"><span class="cv-muted"><kbd>⌘</kbd> <kbd>Enter</kbd> para enviar</span><button class="btn primary cv-sm">Enviar</button></div></form>';
    }
    return h;
  }

  // ───── Pestaña Vista previa en redes ─────
  function spOpts(attachments) {
    var board = ctx.board() || {};
    var bname = ((board && board.name) || 'Tu marca').replace(/\s*\(.*?\)\s*/g, ' ').trim();
    return {
      card: card, attachments: attachments, slide: sp.slide, expanded: sp.expanded,
      kindOf: kindOf, bestPreview: bestPreview, esc: esc,
      when: card.due ? fmtDateTime(card.due) : 'Sin fecha',
      whenShort: card.due ? new Date(card.due).toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' }) : '',
      account: {
        name: bname,
        handle: bname.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'tumarca',
        initials: bname.split(/\s+/).map(function (x) { return x.charAt(0); }).join('').slice(0, 2).toUpperCase()
      }
    };
  }
  function curNet(nets) { return nets.filter(function (d) { return d.key === sp.net; })[0] || nets[0]; }
  function previewMain(nets, attachments) {
    var cur = curNet(nets), o = spOpts(attachments), one = sp.layout === 'one' || nets.length === 1;
    var media = attachments.filter(function (a) { return kindOf(a) !== 'file'; });
    var h = '<div class="pv-bar"><b>Cómo se verá</b><span class="cv-muted">' + (media.length ? esc(media.map(function (a) { return a.name; }).slice(0, 2).join(', ')) + (media.length > 2 ? '…' : '') + ' · ' : 'Sin imagen ni vídeo · ') +
      esc(card.due ? fmtLong(card.due, true) : 'sin fecha') + '</span><span class="cv-sp"></span>' +
      (nets.length > 1 ? '<div class="cv-seg"><button class="' + (one ? '' : 'on') + '" data-act="pv-layout" data-l="side">Lado a lado</button><button class="' + (one ? 'on' : '') + '" data-act="pv-layout" data-l="one">Una a una</button></div>' : '') + '</div>';
    if (one && nets.length > 1) {
      h += '<div class="sp-tabs">' + nets.map(function (d) {
        return '<button class="sp-tab' + (d.key === cur.key ? ' on' : '') + '" data-act="sp-net" data-net="' + d.key + '">' + esc(d.label) + '</button>';
      }).join('') + '</div>';
    }
    var show = one ? [cur] : nets;
    h += '<div class="pv-phones' + (one ? ' one' : '') + '">' + show.map(function (d) {
      var rv = CalSocial.review(Object.assign({}, o, { text: sp.draftNet === d.net ? sp.draft : null }), d.key);
      var bad = rv.filter(function (x) { return x.lvl !== 'ok'; }).length;
      var cp = CalSocial.copyFor(card.desc, d.net);
      return '<div class="pv-ph"><div class="sp-phone' + (d.key === cur.key && !one ? ' sel' : '') + '" data-act="sp-net" data-net="' + d.key + '" data-phone="' + d.key + '">' +
        CalSocial.phone(Object.assign({}, o, { text: sp.draftNet === d.net ? sp.draft : null }), d.key) + '</div>' +
        '<div class="pv-lab"><span class="cv-ni n-' + d.net + '"></span>' + esc(d.label) + '</div>' +
        '<div class="pv-st"><span>' + (cp.own ? 'Copy personalizado' : 'Copy general') + '</span>' +
        (bad ? '<span class="w">⚠ ' + bad + ' aviso' + (bad > 1 ? 's' : '') + '</span>' : '<span class="ok">✓ todo bien</span>') + '</div></div>';
    }).join('') + '</div>';
    return h;
  }
  function previewSide(nets, attachments, w) {
    var cur = curNet(nets), net = cur.net, name = CalSocial.NETS[net].name, o = spOpts(attachments);
    var cp = CalSocial.copyFor(card.desc, net);
    var users = nets.filter(function (d) { return !CalSocial.copyFor(card.desc, d.net).own; }).map(function (d) { return CalSocial.NETS[d.net].name; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var draft = sp.draftNet === net ? sp.draft : cp.text, dirty = sp.draftNet === net && sp.draft !== cp.text;
    var t = CalSocial.plain(draft), fold = CalSocial.NETS[net].fold, limit = CalSocial.NETS[net].limit;
    var h = '<div class="cv-side-scroll pv-side">';
    h += '<section><div class="cv-side-h"><h3>Copy para ' + esc(name) + '</h3>' +
      (w ? '<button class="switch' + (cp.own ? ' on' : '') + '" data-act="pv-own" role="switch" aria-checked="' + cp.own + '"><i></i>Personalizado</button>' : '') + '</div>';
    h += '<p class="cv-muted pv-hint">' + (cp.own ? 'Solo para ' + esc(name) + '. Las demás redes no cambian.' : 'Es el copy general' + (users.length > 1 ? ': lo usan ' + esc(users.join(' y ')) : '') + '. Activa «Personalizado» para cambiarlo solo en ' + esc(name) + '.') + '</p>';
    if (w) h += '<textarea class="pv-ta" rows="6" data-pv-ta data-keep="pv-' + net + '" data-mention>' + esc(draft) + '</textarea>';
    else h += '<div class="cv-copy-tx">' + richText(t) + '</div>';
    h += '<div class="pv-meta"><span data-pv-count>' + fmtN(t.length) + ' / ' + fmtN(limit) + '</span><span>' + countTags(t) + ' hashtags</span><span class="cv-sp"></span>' +
      (dirty ? '<button class="btn cv-sm" data-act="pv-discard">Descartar</button><button class="btn primary cv-sm" data-act="pv-save">Guardar</button>' : '') + '</div>';
    if (t.length > fold && net !== 'x') {
      var cut = t.slice(0, fold).replace(/\s+\S*$/, '');
      h += '<div class="pv-fold"><span>En el feed se corta aquí:</span> «…' + esc(cut.slice(-40)) + '» <b>… más</b></div>';
    }
    h += '</section>';
    var rv = CalSocial.review(Object.assign({}, o, { text: sp.draftNet === net ? sp.draft : null }), cur.key);
    h += '<section><div class="cv-side-h"><h3>Revisión antes de publicar</h3></div><div class="pv-review">' + rv.map(function (x) {
      return '<div class="' + x.lvl + '"><span>' + (x.lvl === 'ok' ? '✓' : x.lvl === 'warn' ? '!' : '✕') + '</span>' + esc(x.text) + '</div>';
    }).join('') + '</div></section>';
    var media = attachments.filter(function (a) { return kindOf(a) !== 'file'; });
    var sched = (ctx.lists() || []).filter(function (l) { return /programad|publicad|scheduled/i.test(l.name) && l.id !== card.idList; })[0];
    h += '<section class="pv-acts"><button class="btn cv-sm" data-act="copy-clip" data-net="' + (cp.own ? net : 'gen') + '">⧉ Copiar copy</button>' +
      (media.length ? '<button class="btn cv-sm" data-act="pv-dl">⤓ Descargar ' + (kindOf(media[0]) === 'video' ? 'vídeo' : media.length > 1 ? 'imágenes' : 'imagen') + '</button>' : '') +
      (w && sched ? '<button class="btn cv-sm" data-act="pv-move" data-list="' + esc(sched.id) + '">→ ' + esc(sched.name) + '</button>' : '') + '</section>';
    return h + '</div>';
  }


  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  // ───────────────────────── Imágenes y vídeos ─────────────────────────
  var IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)(\?|$)/i, VID_EXT = /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i;
  function kindOf(a) {
    var mt = (a.mimeType || '').toLowerCase();
    // El nombre y la URL por separado: la extensión tiene que estar al final de uno de los dos.
    var has = function (re) { return re.test(a.name || '') || re.test(a.url || ''); };
    if (mt.indexOf('image/') === 0 || (!mt && has(IMG_EXT)) || (mt === 'application/octet-stream' && has(IMG_EXT))) return 'image';
    if (mt.indexOf('video/') === 0 || (!mt && has(VID_EXT)) || (mt === 'application/octet-stream' && has(VID_EXT))) return 'video';
    return 'file';
  }
  // Enlace de descarga: los adjuntos subidos a Trello se descargan con tu sesión de Trello.
  function dlUrl(a) { return a.r2 ? a.url + '?dl=1' : driveDl(a) ? window.CalDrive.dlUrl(a.drive.id) : a.url; }
  // Adjuntos de Google Drive (js/drive.js): archivos con miniatura (no carpetas) y si se pueden descargar tal cual.
  function driveFile(a) { return !!(a.drive && a.drive.type !== 'folder'); }
  function driveDl(a) { return !!(a.drive && a.drive.type === 'file'); }
  function bigToDrive() { return !!(window.CalDrive && window.CalDrive.enabled()); }
  function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function bestPreview(a, minW) {
    var p = (a.previews || []).filter(function (x) { return x.url; }).sort(function (x, y) { return x.width - y.width; });
    if (!p.length) return null;
    var ok = p.filter(function (x) { return x.width >= (minW || 360); })[0];
    return ok || p[p.length - 1];
  }
  function urlFor(a, size) {
    if (a.drive && size === 'full' && kindOf(a) === 'image') return window.CalDrive.thumbUrl(a.drive.id, 2000);
    if (size === 'full' || kindOf(a) === 'video') return a.url;
    var p = bestPreview(a, size === 'cover' ? 700 : 360);
    return p ? p.url : a.url;
  }
  // Caché de URLs ya resueltas (los adjuntos subidos a Trello necesitan el token).
  var mediaCache = {};
  function resolveMedia(a, size) {
    var url = urlFor(a, size);
    if (mediaCache[url]) return mediaCache[url];
    var p = a.isUpload === false ? Promise.resolve(url) : ctx.mediaUrl(url);
    mediaCache[url] = p.catch(function (err) { delete mediaCache[url]; throw err; });
    return mediaCache[url];
  }
  function attById(id) {
    var list = (full && full.attachments) || (card && card.attachments) || [];
    return list.filter(function (a) { return a.id === id; })[0];
  }
  // Carga un <img>/<video>: 1) la URL de Trello tal cual (usa tu sesión de Trello, como hace Trello),
  // 2) si falla y es un adjunto subido, descarga con el token. Llama a onFail si nada funciona.
  var directOk = {};
  function loadInto(el, a, size, onOk, onFail) {
    var url = urlFor(a, size), triedToken = false;
    function tryToken() {
      if (a.drive && !triedToken && window.CalDrive.hasToken()) {
        // El navegador no mandó la sesión de Google (p. ej. Safari dentro de Trello): miniatura vía API.
        triedToken = true;
        window.CalDrive.apiThumb(a.drive.id).then(function (src) { el.src = src; }).catch(function () { onFail(); });
        return;
      }
      if (triedToken || a.isUpload === false || !ctx.canWrite()) { onFail(); return; }
      triedToken = true;
      resolveMedia(a, size).then(function (src) { el.src = src; }).catch(function () { onFail(); });
    }
    el.onerror = function () { if (!triedToken) tryToken(); else onFail(); };
    el.onload = el.onloadeddata = function () { directOk[url] = true; onOk && onOk(); };
    el.src = mediaCacheSync[url] || url;
  }
  var mediaCacheSync = {};
  function hydrateMedia(attachments) {
    root.querySelectorAll('img[data-media], video[data-media]').forEach(function (img) {
      var a = attById(img.getAttribute('data-media'));
      if (!a) return;
      var box = img.parentNode;
      box.classList.add('loading');
      firstFrame(img);
      loadInto(img, a, img.getAttribute('data-size'),
        function () { box.classList.remove('loading'); },
        function () { mediaFail(img, a, a.isUpload !== false && !ctx.canWrite()); });
    });
  }
  // Vídeos de la vista previa: enseña el primer fotograma en cuanto hay datos.
  function firstFrame(v) {
    if (v.tagName !== 'VIDEO') return;
    v.addEventListener('loadedmetadata', function () { if (v.paused && v.currentTime === 0) { try { v.currentTime = 0.1; } catch (e) {} } }, { once: true });
  }
  function spCount(ta) {
    var c = $('[data-sp-count]'); if (c) c.textContent = ta.value.trim().length.toLocaleString('es-ES') + ' caracteres';
  }
  function mediaFail(img, a, needAuth) {
    var box = img.parentNode;
    if (!box) return;
    box.classList.remove('loading'); box.classList.add('failed');
    img.remove();
    if (!box.querySelector('.cv-miss')) {
      var s = document.createElement('span');
      s.className = 'cv-miss';
      s.textContent = needAuth ? 'Autoriza para ver' : 'Sin vista previa';
      box.insertBefore(s, box.firstChild);
    }
  }

  // Visor de Google Drive (vídeos, PDF, documentos…) a pantalla completa.
  var dv = null;
  function openDriveViewer(id) {
    var a = attById(id);
    if (!a || !a.drive) return;
    if (!dv) {
      dv = document.createElement('div');
      dv.className = 'cv-lb cv-dv';
      dv.innerHTML = '<div class="cv-dv-box"><div class="cv-dv-h"><span></span><a target="_blank" rel="noopener">Abrir en Drive ↗</a>' +
        '<button class="cv-lb-x" aria-label="Cerrar">×</button></div><iframe allow="autoplay; fullscreen" allowfullscreen></iframe>' +
        '<p class="cv-dv-tip">¿No se ve? Inicia sesión en Google en este navegador o ábrelo en Drive. Los vídeos recién subidos tardan unos minutos en estar listos.</p></div>';
      document.body.appendChild(dv);
      var closeDv = function () { dv.hidden = true; dv.querySelector('iframe').src = 'about:blank'; };
      dv.addEventListener('click', function (e) { if (e.target === dv || e.target.closest('.cv-lb-x')) closeDv(); });
      document.addEventListener('keydown', function (e) { if (dv && !dv.hidden && e.key === 'Escape') { e.stopPropagation(); closeDv(); } }, true);
    }
    dv.querySelector('.cv-dv-h span').textContent = a.name || 'Google Drive';
    dv.querySelector('.cv-dv-h a').href = a.url;
    dv.querySelector('iframe').src = window.CalDrive.viewUrl(a.drive.id);
    dv.hidden = false;
  }

  function playVideo(id) {
    var a = attById(id), box = root.querySelector('[data-vid="' + id + '"]');
    if (!a || !box) return;
    var btn = box.querySelector('.cv-play');
    var v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.playsInline = true; v.preload = 'metadata'; v.className = 'cv-video';
    btn.replaceWith(v);
    loadInto(v, a, 'full', null, function () {
      var p = document.createElement('div');
      p.className = 'cv-miss';
      p.innerHTML = 'No se pudo reproducir aquí. <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Abrir el vídeo</a>';
      v.replaceWith(p);
    });
  }

  // Visor a pantalla completa con navegación entre imágenes.
  var lb = null, lbList = [], lbIdx = 0;
  function openLightbox(id) {
    var list = ((full && full.attachments) || card.attachments || []).filter(function (a) { return kindOf(a) === 'image'; });
    lbList = list; lbIdx = Math.max(0, list.map(function (a) { return a.id; }).indexOf(id));
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'cv-lb';
      lb.innerHTML = '<button class="cv-lb-x" aria-label="Cerrar">×</button><button class="cv-lb-p" aria-label="Anterior">‹</button>' +
        '<figure><img alt=""><figcaption></figcaption></figure><button class="cv-lb-n" aria-label="Siguiente">›</button>';
      document.body.appendChild(lb);
      lb.addEventListener('click', function (e) {
        if (e.target.closest('.cv-lb-p')) showLb(lbIdx - 1);
        else if (e.target.closest('.cv-lb-n')) showLb(lbIdx + 1);
        else if (e.target.closest('.cv-lb-x') || e.target === lb || e.target.tagName === 'FIGURE') closeLightbox();
      });
      document.addEventListener('keydown', function (e) {
        if (!lb || lb.hidden) return;
        if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); }
        else if (e.key === 'ArrowLeft') showLb(lbIdx - 1);
        else if (e.key === 'ArrowRight') showLb(lbIdx + 1);
      }, true);
    }
    lb.hidden = false;
    showLb(lbIdx);
  }
  function showLb(i) {
    if (!lbList.length) return;
    lbIdx = (i + lbList.length) % lbList.length;
    var a = lbList[lbIdx], img = lb.querySelector('img'), cap = lb.querySelector('figcaption');
    lb.querySelector('.cv-lb-p').hidden = lb.querySelector('.cv-lb-n').hidden = lbList.length < 2;
    cap.innerHTML = esc(a.name) + (lbList.length > 1 ? ' · ' + (lbIdx + 1) + '/' + lbList.length : '') +
      ' · <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Abrir original</a>';
    img.removeAttribute('src'); lb.classList.add('loading');
    loadInto(img, a, 'full', function () { lb.classList.remove('loading'); }, function () {
      lb.classList.remove('loading');
      cap.innerHTML = esc(a.name) + ' · No se pudo mostrar · <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Abrir original</a>';
    });
  }
  function closeLightbox() { if (lb) lb.hidden = true; }

  // ───────────────────────── @menciones ─────────────────────────
  // Trello notifica a quien aparezca como @usuario en un comentario: aquí sugerimos los miembros del tablero.
  function normTxt(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function memberByUsername(u) {
    if (!ctx) return null;
    u = String(u).toLowerCase();
    return ((ctx.board() || {}).members || []).filter(function (m) { return (m.username || '').toLowerCase() === u; })[0] || null;
  }
  var mm = { menu: null, ta: null, start: 0, items: [], sel: 0 };
  function mentionCandidates(q) {
    q = normTxt(q);
    var cardIds = (card && card.members || []).map(function (m) { return m.id; });
    var list = ((ctx.board() || {}).members || []).filter(function (m) { return m.username; }).map(function (m) {
      return { username: m.username, fullName: m.fullName || m.username, m: m, onCard: cardIds.indexOf(m.id) !== -1 };
    });
    list.sort(function (a, b) { return (b.onCard - a.onCard) || a.fullName.localeCompare(b.fullName); });
    list = list.concat([
      { username: 'card', fullName: 'Todos los miembros de la tarjeta', special: true },
      { username: 'board', fullName: 'Todos los miembros del tablero', special: true }
    ]);
    if (!q) return list.slice(0, 8);
    return list.filter(function (x) {
      var words = normTxt(x.fullName).split(/\s+/);
      return normTxt(x.username).indexOf(q) === 0 || words.some(function (w) { return w.indexOf(q) === 0; }) ||
        normTxt(x.fullName).indexOf(q) !== -1;
    }).slice(0, 8);
  }
  function closeMention() {
    if (mm.menu) mm.menu.remove();
    mm.menu = null; mm.ta = null; mm.items = [];
  }
  function updateMention(ta) {
    var caret = ta.selectionStart;
    if (caret !== ta.selectionEnd) { closeMention(); return; }
    var m = ta.value.slice(0, caret).match(/(^|[\s(])@([\w.\-\u00C0-\u017F]{0,30})$/);
    if (!m) { closeMention(); return; }
    var items = mentionCandidates(m[2]);
    if (!items.length) { closeMention(); return; }
    if (mm.ta !== ta || !mm.menu) {
      closeMention();
      mm.menu = document.createElement('div');
      mm.menu.className = 'cv-mmenu'; mm.menu.setAttribute('role', 'listbox');
      mm.menu.addEventListener('mousedown', function (e) {
        var it = e.target.closest('[data-i]');
        if (!it) return;
        e.preventDefault(); pickMention(+it.getAttribute('data-i'));
      });
      ta.parentNode.style.position = 'relative';
      ta.parentNode.appendChild(mm.menu);
    }
    mm.ta = ta; mm.start = caret - m[2].length - 1; mm.items = items;
    if (mm.sel >= items.length) mm.sel = 0;
    mm.menu.style.top = (ta.offsetTop + ta.offsetHeight + 2) + 'px';
    mm.menu.style.left = ta.offsetLeft + 'px';
    renderMention();
  }
  function renderMention() {
    mm.menu.innerHTML = '<div class="cv-mmenu-h">Mencionar</div>' + mm.items.map(function (x, i) {
      var av = x.special ? '<span class="cv-av" style="width:24px;height:24px">@</span>' : avatar(x.m, 24);
      return '<div class="cv-mitem' + (i === mm.sel ? ' sel' : '') + '" role="option" data-i="' + i + '">' + av +
        '<span class="cv-mname">' + esc(x.fullName) + '</span><span class="cv-muser">@' + esc(x.username) + '</span></div>';
    }).join('');
  }
  function pickMention(i) {
    var x = mm.items[i], ta = mm.ta;
    if (!x || !ta) return;
    var caret = ta.selectionStart, ins = '@' + x.username + ' ';
    ta.value = ta.value.slice(0, mm.start) + ins + ta.value.slice(caret);
    var pos = mm.start + ins.length;
    ta.setSelectionRange(pos, pos);
    closeMention();
    ta.focus();
  }

  // ───────────────────────── Eventos ─────────────────────────
  function bind() {
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); return; }
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (b.tagName === 'SELECT') return;
      if (act !== 'date-pop' && act !== 'pick-members' && act !== 'pick-labels' && !b.closest('.cv-pop')) closePops();
      if (act === 'close') close();
      else if (act === 'nav') navCard(+b.getAttribute('data-d'));
      else if (act === 'date-pop') { var dp = $('[data-pop="date"]'); if (dp) { var was = dp.hidden; closePops(); dp.hidden = !was; } }
      else if (act === 'pop-close') closePops();
      else if (act === 'date-save' || act === 'date-clear') saveDates(act === 'date-clear');
      else if (act === 'fix-desc') {
        var nd0 = fixDesc(card, descIssues(card));
        save('PUT', '/cards/' + card.id, { desc: nd0 }, function (c) { c.desc = nd0; }, 'Descripción actualizada');
      }
      else if (act === 'ignore-warn') { ignoreWarn[card.id] = true; paint(); }
      else if (act === 'copy-edit') {
        if (!needWrite()) return;
        sp.editCopy = b.getAttribute('data-net'); paint();
        var cta = $('[data-copy-ta]'); if (cta) { cta.focus(); autosize(cta); }
      }
      else if (act === 'copy-cancel') { sp.editCopy = null; paint(); }
      else if (act === 'copy-save') saveCopy(b.getAttribute('data-net'), $('[data-copy-ta]').value);
      else if (act === 'copy-reset') {
        var rn = b.getAttribute('data-net');
        if (!confirm('¿Quitar el copy propio de ' + CalSocial.NETS[rn].name + ' y volver a usar el copy general?')) return;
        saveCopy(rn, '');
      }
      else if (act === 'copy-clip') {
        var cn = b.getAttribute('data-net'), ctext = CalSocial.copyFor(card.desc, cn === 'gen' ? null : cn).text;
        if (sp.tab === 'preview' && sp.draftNet && (cn === 'gen' || cn === sp.draftNet)) ctext = sp.draft;
        clip(CalSocial.plain(ctext), 'Copy copiado');
      }
      else if (act === 'set-cover') {
        var cid0 = b.getAttribute('data-att');
        save('PUT', '/cards/' + card.id, { idAttachmentCover: cid0 }, function (c) { c.cover = Object.assign({}, c.cover || {}, { idAttachment: cid0 }); }, 'Portada cambiada');
      }
      else if (act === 'play-v') openVideo(b.getAttribute('data-att'));
      else if (act === 'open-url') { var ua = attById(b.getAttribute('data-att')); if (ua) window.open(ua.url, '_blank', 'noopener'); }
      else if (act === 'pv-layout') { sp.layout = b.getAttribute('data-l'); try { localStorage.setItem('cal-pv-layout', sp.layout); } catch (e2) {} paint(); }
      else if (act === 'pv-own') togglePvOwn();
      else if (act === 'pv-save') savePv();
      else if (act === 'pv-discard') { sp.draftNet = null; sp.draft = null; paint(); }
      else if (act === 'pv-dl') pvDownload();
      else if (act === 'pv-move') { var lid0 = b.getAttribute('data-list'); save('PUT', '/cards/' + card.id, { idList: lid0 }, function (c) { c.idList = lid0; }, 'Tarjeta movida'); }
      else if (act === 'trello') ctx.openInTrello(card);
      else if (act === 'auth') ctx.askAuth('Autoriza una vez el calendario para editar tarjetas.');
      else if (act === 'copy') copyLink();
      else if (act === 'cv-tab') { sp.tab = b.getAttribute('data-tab'); paint(); }
      else if (act === 'dl-all') downloadAll();
      else if (act === 'upload') pickFiles();
      else if (act === 'drive-view') openDriveViewer(b.getAttribute('data-att'));
      else if (act === 'drive-connect') connectDrive();
      else if (act === 'up-dismiss') { var uid = b.getAttribute('data-up'); uploads = uploads.filter(function (x) { return x.id !== uid; }); paint(); }
      else if (act === 'dl-one') { var oa = attById(b.getAttribute('data-att')); if (oa) workerDownload([oa], false); }
      else if (act === 'del-att') deleteAttachment(b.getAttribute('data-att'));
      else if (act === 'sp-net') {
        if (e.target.closest('[data-act]') !== b) return; // botones dentro del móvil (carrusel, vídeo)
        var nk = b.getAttribute('data-net');
        if (nk !== sp.net) { sp.net = nk; sp.slide = 0; sp.expanded = false; if (sp.draftNet && sp.draft === null) sp.draftNet = null; paint(); }
      }
      else if (act === 'sp-play') { if (b.paused) b.play().catch(function () {}); else b.pause(); b.parentNode.classList.toggle('playing', !b.paused); }
      else if (act === 'sp-edit') {
        if (!needWrite()) return;
        sp.editing = true; paint();
        var sta = $('[data-sp-copy]'); if (sta) { sta.focus(); spCount(sta); }
      }
      else if (act === 'sp-cancel') { sp.editing = false; paint(); }
      else if (act === 'sp-save' || act === 'sp-reset') {
        var cur = CalSocial.current(card, sp.net), nm = CalSocial.NETS[cur.net].name;
        if (act === 'sp-reset' && !confirm('¿Quitar el copy propio de ' + nm + ' y volver a usar el copy general?')) return;
        var val = act === 'sp-save' ? $('[data-sp-copy]').value : '';
        var nd = CalSocial.setCopy(card.desc || '', cur.net, val);
        sp.editing = false;
        save('PUT', '/cards/' + card.id, { desc: nd }, function (c) { c.desc = nd; },
          val.trim() ? 'Copy de ' + nm + ' guardado' : 'Ahora ' + nm + ' usa el copy general');
      }
      else if (act === 'sp-slide') { sp.slide = +b.getAttribute('data-to'); paint(); }
      else if (act === 'sp-more') { sp.expanded = true; paint(); }
      else if (act === 'lightbox') openLightbox(b.getAttribute('data-att'));
      else if (act === 'play') playVideo(b.getAttribute('data-att'));
      else if (act === 'play-side') {
        if (sp.tab !== 'details') { sp.tab = 'details'; paint(); }
        var vid = root.querySelector('[data-vid="' + b.getAttribute('data-att') + '"]');
        if (vid) { vid.scrollIntoView({ behavior: 'smooth', block: 'center' }); playVideo(b.getAttribute('data-att')); }
      }
      else if (act === 'pick-members' || act === 'pick-labels') {
        var p = $('[data-picker="' + act.slice(5) + '"]');
        if (p) { var wasH = p.hidden; closePops(); p.hidden = !wasH; }
      } else if (act === 'edit-desc') {
        $('[data-desc]').hidden = true; $('.cv-desc-edit').hidden = false;
        $('.cv-desc-edit textarea').focus();
      } else if (act === 'cancel-desc') { var kd = $('[data-keep="desc"]'); if (kd) kd.removeAttribute('data-keep'); paint(); }
      else if (act === 'save-desc') {
        var v = $('.cv-desc-edit textarea').value;
        save('PUT', '/cards/' + card.id, { desc: v }, function (c) { c.desc = v; }, 'Descripción guardada');
      } else if (act === 'toggle-done') {
        var nv = !card.dueComplete;
        save('PUT', '/cards/' + card.id, { dueComplete: nv }, function (c) { c.dueComplete = nv; });
      }
    });

    root.addEventListener('change', function (e) {
      var el = e.target, f = el.getAttribute('data-f');
      if (el.getAttribute('data-act-sel') === 'add-copy' && el.value) {
        if (!needWrite()) return;
        sp.editCopy = el.value; paint();
        var nta = $('[data-copy-ta]'); if (nta) { nta.focus(); autosize(nta); }
        return;
      }
      if (f === 'idList') {
        var v = el.value;
        save('PUT', '/cards/' + card.id, { idList: v }, function (c) { c.idList = v; }, 'Tarjeta movida');
      } else if (f === 'due') {
        var due = el.value ? new Date(el.value).toISOString() : null;
        save('PUT', '/cards/' + card.id, { due: due }, function (c) { c.due = due; if (!due) c.dueComplete = false; });
      } else if (f === 'start') {
        var st = null;
        if (el.value) { var p = el.value.split('-'); st = new Date(+p[0], +p[1] - 1, +p[2], ctx.defaultHour).toISOString(); }
        save('PUT', '/cards/' + card.id, { start: st }, function (c) { c.start = st; });
      } else if (f === 'dueComplete') {
        var dc = el.checked;
        save('PUT', '/cards/' + card.id, { dueComplete: dc }, function (c) { c.dueComplete = dc; });
      } else if (el.hasAttribute('data-label')) {
        var lid = el.getAttribute('data-label'), lab = (ctx.board().labels || []).filter(function (l) { return l.id === lid; })[0];
        if (el.checked) {
          save('POST', '/cards/' + card.id + '/idLabels', { value: lid }, function (c) { c.labels = (c.labels || []).concat([lab]); })
            .then(reopenPicker('labels'));
        } else {
          save('DELETE', '/cards/' + card.id + '/idLabels/' + lid, null, function (c) {
            c.labels = (c.labels || []).filter(function (l) { return l.id !== lid; });
          }).then(reopenPicker('labels'));
        }
        reopenPicker('labels')();
      } else if (el.hasAttribute('data-member')) {
        var mid = el.getAttribute('data-member'), mem = (ctx.board().members || []).filter(function (m) { return m.id === mid; })[0];
        if (el.checked) {
          save('POST', '/cards/' + card.id + '/idMembers', { value: mid }, function (c) { c.members = (c.members || []).concat([mem]); });
        } else {
          save('DELETE', '/cards/' + card.id + '/idMembers/' + mid, null, function (c) {
            c.members = (c.members || []).filter(function (m) { return m.id !== mid; });
          });
        }
        reopenPicker('members')();
      } else if (el.hasAttribute('data-check')) {
        var iid = el.getAttribute('data-check'), state = el.checked ? 'complete' : 'incomplete';
        setCheck(iid, state);
        save('PUT', '/cards/' + card.id + '/checkItem/' + iid, { state: state }, null).then(function (ok) {
          if (!ok) setCheck(iid, state === 'complete' ? 'incomplete' : 'complete');
        });
      }
    });

    // Título: guardar al salir o con Enter
    root.addEventListener('keydown', function (e) {
      if (mm.menu && e.target === mm.ta) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          mm.sel = (mm.sel + (e.key === 'ArrowDown' ? 1 : -1) + mm.items.length) % mm.items.length;
          renderMention(); return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mm.sel); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMention(); return; }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.hasAttribute && e.target.hasAttribute('data-copy-ta')) {
        e.preventDefault(); saveCopy(sp.editCopy, e.target.value); return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.hasAttribute && e.target.hasAttribute('data-pv-ta')) {
        e.preventDefault(); savePv(); return;
      }
      if ((e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.matches('input, textarea, select')) {
        e.preventDefault(); navCard(e.key === 'j' ? 1 : -1); return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.closest && e.target.closest('.cv-comment')) {
        e.preventDefault();
        var f = e.target.closest('.cv-comment');
        if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        return;
      }
      if (e.target.classList.contains('cv-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') {
        if (lb && !lb.hidden) return;
        e.stopPropagation();
        if (root.querySelector('.cv-pop:not([hidden])')) { closePops(); return; }
        if (sp.editCopy && e.target.hasAttribute && e.target.hasAttribute('data-copy-ta')) { sp.editCopy = null; paint(); return; }
        if (e.target.matches('textarea, input')) e.target.blur(); else close();
      }
    });
    root.addEventListener('input', function (e) {
      if (e.target.classList.contains('cv-title')) autosize(e.target);
      if (e.target.hasAttribute && e.target.hasAttribute('data-sp-copy')) spCount(e.target);
      if (e.target.hasAttribute && e.target.hasAttribute('data-copy-ta')) {
        autosize(e.target);
        var cc = e.target.closest('.cv-copy').querySelector('[data-copy-count]'), pl = CalSocial.plain(e.target.value);
        if (cc) { cc.textContent = fmtN(pl.length) + ' / ' + fmtN(+e.target.getAttribute('data-limit')); cc.classList.toggle('bad', pl.length > +e.target.getAttribute('data-limit')); }
      }
      if (e.target.hasAttribute && e.target.hasAttribute('data-pv-ta')) {
        var curK = curNet(CalSocial.detect(card));
        var wasClean = sp.draftNet !== curK.net || sp.draft === CalSocial.copyFor(card.desc, curK.net).text;
        sp.draftNet = curK.net; sp.draft = e.target.value;
        clearTimeout(pvTimer); pvTimer = setTimeout(livePreview, wasClean ? 0 : 200);
      }
      if (e.target.hasAttribute && e.target.hasAttribute('data-mention')) { mm.sel = mm.ta === e.target ? mm.sel : 0; updateMention(e.target); }
    });
    root.addEventListener('keyup', function (e) {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') &&
          e.target.hasAttribute && e.target.hasAttribute('data-mention')) updateMention(e.target);
    });
    root.addEventListener('focusout', function (e) {
      if (mm.ta && e.target === mm.ta) setTimeout(function () { if (document.activeElement !== mm.ta) closeMention(); }, 120);
    });
    root.addEventListener('focusout', function (e) {
      if (!e.target.classList.contains('cv-title')) return;
      var v = e.target.value.replace(/\s+/g, ' ').trim();
      if (!v || v === card.name) { e.target.value = card.name; return; }
      save('PUT', '/cards/' + card.id, { name: v }, function (c) { c.name = v; });
    });

    root.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      if (f.classList.contains('cv-comment')) {
        var txt = f.querySelector('textarea').value.trim();
        if (!txt || !needWrite()) return;
        setBusy(true);
        ctx.api('POST', '/cards/' + card.id + '/actions/comments', { text: txt }).then(function (a) {
          full = full || {};
          full.actions = [a && a.id ? a : { id: 'tmp' + Date.now(), date: new Date().toISOString(), data: { text: txt }, memberCreator: ctx.me() || {} }]
            .concat(full.actions || []);
          var kc = root.querySelector('[data-keep="comment"]'); if (kc) kc.value = '';
          sp.scrollConv = true;
          paint();
          var nt = root.querySelector('.cv-comment textarea');
          if (nt) nt.focus();
        }).catch(function (err) { ctx.toast('No se pudo comentar: ' + (err && err.message || err), true); })
          .then(function () { setBusy(false); });
      } else if (f.classList.contains('cv-additem')) {
        var name = f.querySelector('input').value.trim(), clId = f.getAttribute('data-cl');
        if (!name || !needWrite()) return;
        setBusy(true);
        ctx.api('POST', '/checklists/' + clId + '/checkItems', { name: name }).then(function (it) {
          var cl = ((full && full.checklists) || card.checklists || []).filter(function (c) { return c.id === clId; })[0];
          if (cl) { cl.checkItems = (cl.checkItems || []).concat([it && it.id ? it : { id: 'tmp' + Date.now(), name: name, state: 'incomplete', pos: 1e12 }]); }
          paint();
          var inp = root.querySelector('.cv-additem[data-cl="' + clId + '"] input');
          if (inp) inp.focus();
        }).catch(function (err) { ctx.toast('No se pudo añadir: ' + (err && err.message || err), true); })
          .then(function () { setBusy(false); });
      }
    });
  }

  function closePops() { root.querySelectorAll('.cv-pop').forEach(function (p) { p.hidden = true; }); }
  function navCard(d) {
    var sib = ctx.siblings && ctx.siblings(card);
    if (!sib) return;
    var id = sib.ids[sib.i + d];
    if (id) ctx.openCard(id);
  }
  function saveDates(clear) {
    var dd = clear ? '' : $('[data-d="due-d"]').value, dt = clear ? '' : $('[data-d="due-t"]').value;
    var sd = clear ? '' : $('[data-d="start-d"]').value, done = !clear && $('[data-d="done"]').checked;
    var due = null, start = null;
    if (dd) { var a = dd.split('-'), tm = (dt || pad(ctx.defaultHour) + ':00').split(':'); due = new Date(+a[0], +a[1] - 1, +a[2], +tm[0], +tm[1]).toISOString(); }
    if (sd) { var b2 = sd.split('-'); start = new Date(+b2[0], +b2[1] - 1, +b2[2], ctx.defaultHour).toISOString(); }
    var body = { due: due, start: start, dueComplete: due ? done : false };
    save('PUT', '/cards/' + card.id, body, function (c) { c.due = due; c.start = start; c.dueComplete = body.dueComplete; }, clear ? 'Fechas quitadas' : 'Fechas guardadas');
  }
  function saveCopy(key, val) {
    var net = key === 'gen' ? null : key, desc = card.desc || '';
    var hasSecs = CalSocial.sections(desc).list.length;
    var nd = CalSocial.setCopy(desc, net, val);
    sp.editCopy = null;
    var k = $('[data-copy-ta]'); if (k) k.removeAttribute('data-keep');
    save('PUT', '/cards/' + card.id, { desc: nd }, function (c) { c.desc = nd; },
      !val.trim() && net ? 'Ahora ' + CalSocial.NETS[net].name + ' usa el copy general' : (hasSecs || !net ? 'Copy guardado' : 'Copy guardado'));
  }
  function clip(text, msg) {
    var ok = function () { ctx.toast(msg || 'Copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
    function fb() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { ctx.toast('No se pudo copiar', true); }
      ta.remove();
    }
  }
  // Vista previa en vivo mientras se escribe el copy (sin recargar imágenes ni vídeos).
  var pvTimer = null;
  function livePreview() {
    if (!card || sp.tab !== 'preview') return;
    var nets = CalSocial.detect(card), atts = (full && full.attachments) || card.attachments || [];
    var tmp = document.createElement('div');
    tmp.innerHTML = '<div class="m">' + previewMain(nets, atts) + '</div><div class="s">' + previewSide(nets, atts, ctx.canWrite()) + '</div>';
    nets.forEach(function (d) {
      var live = root.querySelector('[data-phone="' + d.key + '"]'), fresh = tmp.querySelector('[data-phone="' + d.key + '"]');
      if (!live || !fresh) return;
      var lc = live.querySelectorAll('.sp-cap'), fc = fresh.querySelectorAll('.sp-cap');
      for (var i = 0; i < lc.length && i < fc.length; i++) lc[i].innerHTML = fc[i].innerHTML;
      var lst = live.parentNode.querySelector('.pv-st'), fst = fresh.parentNode.querySelector('.pv-st');
      if (lst && fst) lst.innerHTML = fst.innerHTML;
    });
    ['.pv-meta', '.pv-review'].forEach(function (sel) { var l = $(sel), f = tmp.querySelector('.s ' + sel); if (l && f) l.innerHTML = f.innerHTML; });
    var lf = $('.pv-fold'), ff = tmp.querySelector('.s .pv-fold');
    if (lf && ff) lf.innerHTML = ff.innerHTML;
    else if (lf && !ff) lf.remove();
    else if (!lf && ff) { var m = $('.pv-meta'); if (m) m.insertAdjacentElement('afterend', ff); }
  }
  function savePv() {
    var nets = CalSocial.detect(card), cur = curNet(nets), cp = CalSocial.copyFor(card.desc, cur.net);
    if (sp.draftNet !== cur.net) return;
    var val = sp.draft, desc = card.desc || '', nd;
    if (cp.own) nd = CalSocial.setCopy(desc, cur.net, val);
    else if (CalSocial.sections(desc).list.some(function (x) { return !x.net; })) nd = CalSocial.setCopy(desc, null, val);
    else nd = val; // sin secciones: el copy es toda la descripción
    sp.draftNet = null; sp.draft = null;
    var k = $('[data-pv-ta]'); if (k) k.removeAttribute('data-keep');
    save('PUT', '/cards/' + card.id, { desc: nd }, function (c) { c.desc = nd; }, 'Copy de ' + CalSocial.NETS[cur.net].name + ' guardado');
  }
  function togglePvOwn() {
    if (!needWrite()) return;
    var nets = CalSocial.detect(card), cur = curNet(nets), name = CalSocial.NETS[cur.net].name;
    var cp = CalSocial.copyFor(card.desc, cur.net), nd;
    if (cp.own) {
      if (!confirm('¿Quitar el copy propio de ' + name + ' y volver a usar el copy general?')) return;
      nd = CalSocial.setCopy(card.desc || '', cur.net, '');
    } else {
      var start = sp.draftNet === cur.net ? sp.draft : cp.text;
      nd = CalSocial.setCopy(card.desc || '', cur.net, start || ' ');
    }
    sp.draftNet = null; sp.draft = null;
    var k = $('[data-pv-ta]'); if (k) k.removeAttribute('data-keep');
    save('PUT', '/cards/' + card.id, { desc: nd }, function (c) { c.desc = nd; }, cp.own ? name + ' usa el copy general' : 'Copy propio de ' + name + ' creado');
  }
  function pvDownload() {
    var atts = ((full && full.attachments) || card.attachments || []).filter(function (a) { return kindOf(a) !== 'file'; });
    if (!atts.length) return;
    var a = atts[0];
    if (a.drive && !driveDl(a)) window.open(a.url, '_blank', 'noopener');
    else if (viaWorker(a)) workerDownload(atts.filter(viaWorker), atts.filter(viaWorker).length > 1);
    else clickDownload(a);
  }
  // Reproductor de vídeo a pantalla completa (adjuntos de Trello y Cloudflare).
  var vv = null;
  function openVideo(id) {
    var a = attById(id);
    if (!a) return;
    if (a.drive) { openDriveViewer(id); return; }
    if (!vv) {
      vv = document.createElement('div');
      vv.className = 'cv-lb cv-vv';
      vv.innerHTML = '<button class="cv-lb-x" aria-label="Cerrar">×</button><figure><video controls autoplay playsinline></video><figcaption></figcaption></figure>';
      document.body.appendChild(vv);
      var closeV = function () { vv.hidden = true; var v = vv.querySelector('video'); v.pause(); v.removeAttribute('src'); v.load(); };
      vv.addEventListener('click', function (e) { if (e.target === vv || e.target.closest('.cv-lb-x') || e.target.tagName === 'FIGURE') closeV(); });
      document.addEventListener('keydown', function (e) { if (vv && !vv.hidden && e.key === 'Escape') { e.stopPropagation(); closeV(); } }, true);
    }
    vv.hidden = false;
    var v = vv.querySelector('video'), cap = vv.querySelector('figcaption');
    cap.innerHTML = esc(a.name) + ' · <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Abrir original</a>';
    loadInto(v, a, 'full', null, function () { cap.innerHTML = esc(a.name) + ' · No se pudo reproducir aquí · <a href="' + esc(a.url) + '" target="_blank" rel="noopener">Abrir el vídeo</a>'; });
  }
  // Subir arrastrando archivos a la tarjeta o pegándolos con ⌘V.
  function bindDropPaste() {
    var depth = 0;
    function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
    function canUp() { return card && ctx.canWrite() && ((upInfo && upInfo.ok) || bigToDrive()); }
    root.addEventListener('dragenter', function (e) { if (!hasFiles(e) || !canUp()) return; depth++; root.classList.add('cv-dropping'); });
    root.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) root.classList.remove('cv-dropping'); });
    root.addEventListener('dragover', function (e) { if (hasFiles(e) && canUp()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    root.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; root.classList.remove('cv-dropping');
      if (!canUp()) { needWrite(); return; }
      [].slice.call(e.dataTransfer.files || []).forEach(function (f) { uploadFile(card, f); });
    });
    document.addEventListener('paste', function (e) {
      if (!isOpen() || !canUp()) return;
      var files = [].slice.call((e.clipboardData && e.clipboardData.files) || []);
      if (!files.length) return;
      e.preventDefault();
      files.forEach(function (f) {
        var named = f.name && f.name !== 'image.png' ? f : new File([f], 'pegado-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type });
        uploadFile(card, named);
      });
    });
  }

  function reopenPicker(which) {
    return function () { var p = $('[data-picker="' + which + '"]'); if (p) p.hidden = false; };
  }
  function setCheck(iid, st) {
    ((full && full.checklists) || card.checklists || []).forEach(function (cl) {
      (cl.checkItems || []).forEach(function (it) { if (it.id === iid) it.state = st; });
    });
    paint();
  }
  function deleteAttachment(id) {
    var a = attById(id);
    if (!a || !needWrite()) return;
    if (!confirm(a.drive
      ? '¿Quitar «' + (a.name || 'este adjunto') + '» de la tarjeta?\n\nEl archivo seguirá en Google Drive.'
      : '¿Eliminar «' + (a.name || 'este adjunto') + '» de la tarjeta?\n\nSe borra también en Trello y no se puede deshacer.')) return;
    var cid = card.id;
    setBusy(true);
    ctx.api('DELETE', '/cards/' + cid + '/attachments/' + id).then(function () {
      if (a.r2) {
        ctx.authHeader().then(function (auth) {
          return fetch(a.url, { method: 'DELETE', headers: { Authorization: auth } });
        }).then(function (r) { if (!r.ok) throw new Error(); })
          .catch(function () { ctx.toast('Quitado de la tarjeta, pero no se pudo borrar el archivo de Cloudflare', true); });
      }
      var drop = function (list) { return (list || []).filter(function (x) { return x.id !== id; }); };
      if (full && full.attachments) full.attachments = drop(full.attachments);
      if (card && card.id === cid) {
        if (card.attachments) card.attachments = drop(card.attachments);
        if (card.cover && card.cover.idAttachment === id) card.cover = null;
        if (card.badges && card.badges.attachments) card.badges.attachments--;
        sp.slide = 0;
        paint(); ctx.onChange(card);
      }
      ctx.toast('Adjunto eliminado');
    }).catch(function (err) {
      ctx.toast('No se pudo eliminar: ' + (err && err.message ? err.message : err), true);
    }).then(function () { setBusy(false); });
  }
  // ───── Descargas ─────
  // Trello no deja descargar los adjuntos subidos desde una página de fuera, solo abrirlos.
  // Con el intermediario (ctx.downloadBase, carpeta worker/) se descargan de verdad.
  function viaWorker(a) { return !!(ctx.downloadBase && ctx.downloadBase()) && a.isUpload !== false; }
  function workerDownload(list, all) {
    var base = ctx.downloadBase();
    if (!ctx.canWrite()) { ctx.askAuth('Para descargar adjuntos desde el calendario, autoriza una vez el calendario.'); return; }
    // La pestaña se abre ya (dentro del clic) para que el navegador no la bloquee; luego se le da la dirección.
    var w = window.open('', '_blank');
    if (w) { try { w.document.write('<meta charset="utf-8"><title>Descargando…</title><p style="font:15px sans-serif;margin:40px">Preparando la descarga…</p>'); } catch (e) {} }
    var files = list.map(function (a) {
      var m = String(a.url || '').match(/\/download\/([^?#]+)/);
      return { card: card.id, att: a.id, name: m ? decodeURIComponent(m[1]) : (a.name || 'archivo') };
    });
    ctx.authHeader().then(function (auth) {
      if (!auth) throw new Error('Falta la autorización');
      return fetch(base + '/ticket', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files }) });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (x) { throw new Error(x || ('HTTP ' + r.status)); });
      return r.json();
    }).then(function (res) {
      var url = base + (all ? '/all?t=' : '/dl?t=') + encodeURIComponent(res.ticket) + (all ? '' : '&i=0');
      if (w) { try { w.opener = null; } catch (e) {} w.location.href = url; } else window.open(url, '_blank', 'noopener');
      if (all) ctx.toast('Descargando ' + files.length + ' adjuntos en una pestaña nueva. Si el navegador pregunta, permite descargar varios archivos.');
    }).catch(function (err) {
      if (w) try { w.close(); } catch (e) {}
      ctx.toast('No se pudo preparar la descarga: ' + (err && err.message ? err.message : err), true);
    });
  }
  // Sin intermediario: abre cada adjunto (el navegador decide si lo descarga o lo muestra).
  function downloadAll() {
    var atts = (full && full.attachments) || card.attachments || [];
    if (!atts.length) return;
    var up = atts.filter(viaWorker), r2 = atts.filter(function (a) { return a.r2 || driveDl(a); });
    var links = atts.filter(function (a) { return !viaWorker(a) && !a.r2 && !driveDl(a); });
    if (up.length) {
      workerDownload(up, true);
      r2.forEach(function (a, i) { setTimeout(function () { clickDownload(a); }, 400 + i * 600); });
      if (links.length) ctx.toast(links.length + ' adjunto(s) son enlaces y no se descargan; ábrelos desde la lista.');
      return;
    }
    atts.forEach(function (a, i) {
      setTimeout(function () {
        clickDownload(a);
      }, i * 350);
    });
    ctx.toast('Abriendo ' + atts.length + ' adjuntos… Si se abren en pestañas, guárdalos con ⌘S.');
  }
  function clickDownload(a) {
    var el = document.createElement('a');
    el.href = dlUrl(a); el.download = a.name || ''; el.target = '_blank'; el.rel = 'noopener';
    document.body.appendChild(el); el.click(); el.remove();
  }

  // ───── Subidas ─────
  // Hasta TRELLO_MAX_MB van a Trello como siempre (con su portada y vista previa). Lo que pasa de ahí
  // se sube por trozos a Cloudflare R2 (worker/) con una miniatura hecha aquí, y la tarjeta recibe un enlace.
  var TRELLO_MAX_MB = (window.CAL_CONFIG && window.CAL_CONFIG.TRELLO_MAX_MB) || 10;
  var upInfo = null, uploads = [], upSeq = 0;
  function loadUpInfo() {
    var base = ctx.downloadBase && ctx.downloadBase();
    if (!base || upInfo) return;
    upInfo = { ok: false };
    fetch(base + '/up/info').then(function (r) { return r.ok ? r.json() : { ok: false }; })
      .then(function (res) { upInfo = res || { ok: false }; if (upInfo.ok && card) paint(); })
      .catch(function () { upInfo = { ok: false }; });
  }
  function upLabel(u) {
    if (u.wait) return fmtBytes(u.size) + ' · se guardará en Google Drive';
    return u.pct >= 1 ? 'Guardando en la tarjeta…' : Math.round(u.pct * 100) + '% de ' + fmtBytes(u.size) +
      (u.dest === 'drive' ? ' · Google Drive' : u.dest === 'r2' ? ' · Cloudflare' : '');
  }
  function upPaint(u) {
    var el = root.querySelector('[data-up="' + u.id + '"]');
    if (!el) return;
    var bar = el.querySelector('.cv-up-bar i'), txt = el.querySelector('[data-up-pct]');
    if (bar) bar.style.width = Math.round(u.pct * 100) + '%';
    if (txt) txt.textContent = upLabel(u);
  }
  function pickFiles() {
    if (!needWrite()) return;
    var inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
    inp.onchange = function () { [].slice.call(inp.files || []).forEach(function (f) { uploadFile(card, f); }); inp.remove(); };
    document.body.appendChild(inp); inp.click();
  }
  // Destino: Trello (pequeños) · Google Drive (grandes, si hay GOOGLE_CLIENT_ID) · Cloudflare R2 (grandes, si no).
  function uploadFile(c, file) {
    var big = file.size > TRELLO_MAX_MB * 1048576;
    var u = { id: 'u' + (++upSeq), card: c.id, c: c, file: file, name: file.name, size: file.size, pct: 0,
      dest: !big ? 'trello' : bigToDrive() ? 'drive' : 'r2' };
    if (u.dest === 'r2' && !(upInfo && upInfo.ok)) { ctx.toast('«' + file.name + '» pasa de ' + TRELLO_MAX_MB + ' MB y no hay dónde guardarlo.', true); return; }
    if (u.dest === 'r2' && file.size > upInfo.maxBytes) {
      ctx.toast('«' + file.name + '» pasa del máximo de ' + Math.round(upInfo.maxBytes / 1048576) + ' MB.', true); return;
    }
    // Drive sin conectar: se queda en espera hasta que se pulse «Conectar Google Drive» (la ventana de Google necesita un clic).
    u.wait = u.dest === 'drive' && !window.CalDrive.hasToken();
    uploads.push(u); paint();
    if (!u.wait) startUpload(u);
  }
  function connectDrive() {
    window.CalDrive.connect().then(function () {
      uploads.filter(function (u) { return u.wait; }).forEach(function (u) { u.wait = false; startUpload(u); });
      paint();
    }).catch(function (err) { ctx.toast('Google Drive: ' + (err && err.message ? err.message : err), true); });
  }
  function startUpload(u) {
    var c = u.c, file = u.file;
    var job = u.dest === 'drive' ? uploadDrive(c, file, u) : u.dest === 'r2' ? uploadR2(c, file, u) : uploadTrello(c, file, u);
    job.then(function (att) {
      uploads = uploads.filter(function (x) { return x !== u; });
      if (window.CalShared) window.CalShared.fixAtt(att);
      var add = function (list) { return list.some(function (x) { return x.id === att.id; }) ? list : list.concat([att]); };
      if (full && full.attachments && card && card.id === c.id) full.attachments = add(full.attachments);
      c.attachments = add(c.attachments || []);
      if (c.badges) c.badges.attachments = (c.badges.attachments || 0) + 1;
      if (card && card.id === c.id) paint();
      ctx.onChange(c);
      ctx.toast('Subido: ' + file.name);
    }).catch(function (err) {
      // El permiso de Google caduca a la hora: se vuelve a pedir con el botón y la subida se reintenta.
      if (u.dest === 'drive' && !window.CalDrive.hasToken()) { u.wait = true; u.pct = 0; if (card && card.id === c.id) paint(); return; }
      u.err = 'Error: ' + (err && err.message ? err.message : err).slice(0, 120);
      if (card && card.id === c.id) paint();
      ctx.toast('No se pudo subir «' + file.name + '»', true);
    });
  }
  // Subida con progreso (fetch no informa del progreso de envío).
  function xhr(method, url, body, headers, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, url);
      Object.keys(headers || {}).forEach(function (k) { x.setRequestHeader(k, headers[k]); });
      if (onProgress && x.upload) x.upload.onprogress = function (e) { onProgress(e.loaded); };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(x.responseText ? JSON.parse(x.responseText) : null); } catch (e) { resolve(null); }
        } else reject(new Error((x.responseText || '').slice(0, 200) || ('HTTP ' + x.status)));
      };
      x.onerror = function () { reject(new Error('Fallo de red')); };
      x.send(body);
    });
  }
  function uploadDrive(c, file, u) {
    var b = ctx.board() || {};
    return window.CalDrive.upload(file, {
      board: { id: b.id || c.idBoard || 'tablero', name: b.name }, type: file.type || guessType(file.name),
      onProgress: function (n) { u.pct = Math.min(0.99, n / Math.max(1, file.size)); upPaint(u); }
    }).then(function (f) {
      u.pct = 1; upPaint(u);
      if (f.shared === 'none') ctx.toast('«' + file.name + '» está en tu Drive pero no se ha compartido: los demás no lo verán hasta que lo compartas.', true);
      return ctx.api('POST', '/cards/' + c.id + '/attachments', { url: f.url, name: file.name, mimeType: f.mimeType });
    });
  }
  function uploadTrello(c, file, u) {
    return ctx.authHeader().then(function (auth) {
      if (!auth) throw new Error('Falta la autorización');
      var fd = new FormData();
      fd.append('file', file, file.name); fd.append('name', file.name);
      return xhr('POST', 'https://api.trello.com/1/cards/' + c.id + '/attachments', fd, { Authorization: auth },
        function (n) { u.pct = Math.min(0.99, n / Math.max(1, file.size)); upPaint(u); });
    });
  }
  function uploadR2(c, file, u) {
    var base = ctx.downloadBase(), auth, tk, done = [];
    var type = file.type || guessType(file.name);
    return Promise.all([ctx.authHeader(), makeThumb(file, type)]).then(function (r) {
      auth = r[0];
      if (!auth) throw new Error('Falta la autorización');
      var thumb = r[1];
      return fetch(base + '/up/start', {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: c.id, name: file.name, type: type, size: file.size, thumb: !!thumb })
      }).then(okJson).then(function (res) {
        tk = res;
        return thumb ? fetch(base + '/up/thumb?t=' + encodeURIComponent(tk.ticket), { method: 'PUT', body: thumb }).catch(function () {}) : null;
      });
    }).then(function () {
      // Trozos de 8 MB, tres a la vez, con hasta 3 reintentos cada uno.
      var sent = {}, next = 1, total = tk.parts;
      function report() {
        var n = 0; Object.keys(sent).forEach(function (k) { n += sent[k]; });
        u.pct = Math.min(0.99, n / file.size); upPaint(u);
      }
      function sendPart(n, tries) {
        var blob = file.slice((n - 1) * tk.partSize, Math.min(file.size, n * tk.partSize));
        return xhr('PUT', base + '/up/part?t=' + encodeURIComponent(tk.ticket) + '&n=' + n, blob,
          { 'Content-Type': 'application/octet-stream' }, function (b) { sent[n] = b; report(); })
          .catch(function (err) {
            sent[n] = 0; report();
            if (tries >= 3) throw err;
            return new Promise(function (ok) { setTimeout(ok, 1000 * tries); }).then(function () { return sendPart(n, tries + 1); });
          });
      }
      function worker() {
        if (next > total) return Promise.resolve();
        var n = next++;
        return sendPart(n, 1).then(function (res) { done.push({ n: res.n, etag: res.etag }); sent[n] = blobLen(n); report(); return worker(); });
      }
      function blobLen(n) { return Math.min(file.size, n * tk.partSize) - (n - 1) * tk.partSize; }
      return Promise.all([worker(), worker(), worker()]);
    }).then(function () {
      return fetch(base + '/up/done?t=' + encodeURIComponent(tk.ticket), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts: done })
      }).then(okJson);
    }).then(function (res) {
      u.pct = 1; upPaint(u);
      return ctx.api('POST', '/cards/' + c.id + '/attachments', { url: res.url, name: file.name, mimeType: type });
    }).catch(function (err) {
      if (tk) fetch(base + '/up/abort?t=' + encodeURIComponent(tk.ticket), { method: 'POST' }).catch(function () {});
      throw err;
    });
  }
  function okJson(r) {
    if (!r.ok) return r.text().then(function (x) { throw new Error(x || ('HTTP ' + r.status)); });
    return r.json();
  }
  function guessType(name) {
    var ext = (String(name).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    return { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', zip: 'application/zip' }[ext] || 'application/octet-stream';
  }
  // Miniatura JPEG (máx. 640 px) de imágenes y vídeos, hecha en el navegador. null si no se puede.
  function makeThumb(file, type) {
    var kind = /^image\//.test(type) ? 'image' : /^video\//.test(type) ? 'video' : null;
    if (!kind) return Promise.resolve(null);
    var src = URL.createObjectURL(file);
    function draw(el, w, h) {
      var k = Math.min(1, 640 / Math.max(w, h)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      cv.getContext('2d').drawImage(el, 0, 0, cv.width, cv.height);
      return new Promise(function (ok) { cv.toBlob(ok, 'image/jpeg', 0.8); });
    }
    var p = new Promise(function (resolve, reject) {
      if (kind === 'image') {
        var img = new Image();
        img.onload = function () { draw(img, img.naturalWidth, img.naturalHeight).then(resolve, reject); };
        img.onerror = reject; img.src = src;
      } else {
        var v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.onloadedmetadata = function () { v.currentTime = Math.min(1, (v.duration || 2) / 10); };
        v.onseeked = function () { draw(v, v.videoWidth, v.videoHeight).then(resolve, reject); };
        v.onerror = reject; v.src = src;
      }
    });
    var timeout = new Promise(function (ok) { setTimeout(function () { ok(null); }, 10000); });
    return Promise.race([p, timeout]).catch(function () { return null; })
      .then(function (b) { URL.revokeObjectURL(src); return b && b.size ? b : null; });
  }

  function copyLink() {
    var url = card.shortUrl || card.url;
    var ok = function () { ctx.toast('Enlace copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { ctx.toast(url); }
      ta.remove();
    }
  }

  function loadFull() {
    if (!ctx.canWrite()) return;
    var id = card.id;
    ctx.api('GET', '/cards/' + id + '?fields=name,desc,due,start,dueComplete,idList,url,shortUrl' +
      '&checklists=all&attachments=true&attachment_fields=name,url,date,mimeType,isUpload,bytes,previews' +
      '&actions=commentCard,updateCard:idList,updateCard:dueComplete,updateCard:due,addAttachmentToCard,createCard,updateCheckItemStateOnCard' +
      '&actions_limit=100&action_fields=type,date,data&action_memberCreator_fields=fullName,initials,avatarUrl')
      .then(function (res) {
        if (!card || card.id !== id || !res) return;
        full = { checklists: res.checklists || [], attachments: res.attachments || [], actions: res.actions || [] };
        if (window.CalShared) full.attachments.forEach(window.CalShared.fixAtt);
        if (res.desc != null) card.desc = res.desc;
        if (res.shortUrl) card.shortUrl = res.shortUrl;
        sp.scrollConv = true;
        paint();
      })
      .catch(function () { full = { checklists: card.checklists || [], attachments: card.attachments || [], actions: [] }; paint(); });
  }

  // ───────────────────────── API pública ─────────────────────────
  function open(c) {
    var lay = 'side'; try { lay = localStorage.getItem('cal-pv-layout') || 'side'; } catch (e) {}
    var keepTab = card && sp.tab && sp.tab !== 'details' && c.id !== card.id ? sp.tab : 'details';
    card = c; full = null;
    sp = { tab: keepTab, net: null, slide: 0, expanded: false, editing: false, editCopy: null, draftNet: null, draft: null, layout: lay, scrollConv: true };
    root.hidden = false;
    loadUpInfo();
    if (window.CalDrive) window.CalDrive.warmUp();
    paint();
    loadFull();
    setTimeout(function () { var x = $('.cv-x'); if (x && !root.contains(document.activeElement)) x.focus(); }, 30);
  }
  function close() {
    closeLightbox();
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('cv-title')) ae.blur();
    root.hidden = true; card = null; full = null;
  }
  function isOpen() { return root && !root.hidden; }
  function refresh() { if (isOpen()) paint(); }

  window.CalCardView = {
    init: function (c) {
      ctx = c;
      root = document.createElement('div');
      root.className = 'cv-wrap'; root.hidden = true;
      root.innerHTML = '<div class="cv" role="dialog" aria-modal="true" aria-label="Tarjeta"></div>';
      document.body.appendChild(root);
      bind();
      bindDropPaste();
    },
    open: open, close: close, isOpen: isOpen, refresh: refresh,
    // Tras recargar datos del tablero, apunta a la versión nueva de la tarjeta abierta.
    sync: function (cards) {
      if (!card) return;
      var nc = cards.filter(function (c) { return c.id === card.id; })[0];
      if (!nc) { close(); return; }
      if (nc.desc == null && card.desc != null) nc.desc = card.desc;
      if (card.shortUrl) nc.shortUrl = card.shortUrl;
      card = nc;
      if (!(document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('textarea, input'))) paint();
    },
    current: function () { return card; }
  };
})();
