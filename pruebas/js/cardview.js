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
  function paint() {
    if (!card) return;
    var w = ctx.canWrite(), lists = ctx.lists(), board = ctx.board();
    var cover = card.labels && card.labels[0] ? ctx.labelColor(card.labels[0].color) : null;
    var checklists = (full && full.checklists) || card.checklists || [];
    var attachments = (full && full.attachments) || card.attachments || [];
    var comments = (full && full.actions) || [];
    var labelIds = (card.labels || []).map(function (l) { return l.id; });
    var memberIds = (card.members || []).map(function (m) { return m.id; });

    var h = '';
    var coverAtt = card.cover && card.cover.idAttachment && attachments.filter(function (a) { return a.id === card.cover.idAttachment; })[0];
    if (coverAtt && kindOf(coverAtt) === 'image') {
      h += '<div class="cv-cover-img" data-act="lightbox" data-att="' + esc(coverAtt.id) + '"><img data-media="' + esc(coverAtt.id) + '" data-size="cover" alt=""></div>';
    } else {
      h += '<div class="cv-cover"' + (cover ? ' style="background:' + cover + '"' : '') + '></div>';
    }
    h += '<button class="cv-x" data-act="close" aria-label="Cerrar">×</button>';
    h += '<div class="cv-head">';
    h += w ? '<textarea class="cv-title" rows="1" data-f="name">' + esc(card.name) + '</textarea>'
           : '<h2 class="cv-title ro">' + esc(card.name) + '</h2>';
    h += '<div class="cv-sub">en la lista ' + (w
      ? '<select data-f="idList">' + lists.map(function (l) {
          return '<option value="' + esc(l.id) + '"' + (l.id === card.idList ? ' selected' : '') + '>' + esc(l.name) + '</option>';
        }).join('') + '</select>'
      : '<strong>' + esc((lists.filter(function (l) { return l.id === card.idList; })[0] || {}).name || '') + '</strong>') + '</div>';
    h += '<div class="cv-actbar">';
    if (!w) h += '<button class="btn cv-sm primary" data-act="auth">Autorizar edición</button>';
    if (w && card.due) h += '<button class="btn cv-sm" data-act="toggle-done">' + (card.dueComplete ? '↺ Marcar pendiente' : '✓ Marcar completada') + '</button>';
    h += '<button class="btn cv-sm" data-act="trello">Abrir en Trello ↗</button>';
    h += '<button class="btn cv-sm" data-act="copy">Copiar enlace</button>';
    h += '</div>';
    h += '</div>';

    // Pestañas: Detalles / Vista previa en redes (solo si hay etiquetas de red)
    var nets = window.CalSocial ? CalSocial.detect(card) : [];
    if (!nets.length) sp.tab = 'details';
    if (nets.length) {
      h += '<div class="cv-tabs" role="tablist">' +
        '<button role="tab" class="cv-tab' + (sp.tab === 'details' ? ' on' : '') + '" aria-selected="' + (sp.tab === 'details') + '" data-act="cv-tab" data-tab="details">Detalles</button>' +
        '<button role="tab" class="cv-tab' + (sp.tab === 'preview' ? ' on' : '') + '" aria-selected="' + (sp.tab === 'preview') + '" data-act="cv-tab" data-tab="preview">Vista previa en redes' +
        '<span class="cv-tab-n">' + esc(nets.map(function (d) { return d.label; }).join(', ')) + '</span></button></div>';
    }

    h += '<div class="cv-body"><div class="cv-main">';
    if (sp.tab === 'preview') {
      var bname = ((board && board.name) || 'Tu marca').replace(/\s*\(.*?\)\s*/g, ' ').trim();
      h += CalSocial.render({
        card: card, attachments: attachments, key: sp.net, slide: sp.slide, expanded: sp.expanded, editing: sp.editing,
        kindOf: kindOf, bestPreview: bestPreview, esc: esc,
        when: card.due ? fmtDateTime(card.due) : 'Sin fecha',
        whenShort: card.due ? new Date(card.due).toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' }) : '',
        account: {
          name: bname,
          handle: bname.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'tumarca',
          initials: bname.split(/\s+/).map(function (x) { return x.charAt(0); }).join('').slice(0, 2).toUpperCase()
        }
      });
    } else {

    // Miembros / Etiquetas / Fechas
    h += '<div class="cv-meta">';
    h += '<div class="cv-block"><div class="cv-h">Miembros</div><div class="cv-row">' +
      (card.members || []).map(function (m) { return avatar(m); }).join('') +
      (w ? '<button class="cv-add" data-act="pick-members" title="Miembros">+</button>' : '') +
      ((card.members || []).length || w ? '' : '<span class="cv-muted">—</span>') + '</div>';
    if (w) {
      h += '<div class="cv-picker" data-picker="members" hidden>' + (board.members || []).map(function (m) {
        return '<label class="cv-pick"><input type="checkbox" data-member="' + esc(m.id) + '"' +
          (memberIds.indexOf(m.id) !== -1 ? ' checked' : '') + '>' + avatar(m, 22) + esc(m.fullName || m.username) + '</label>';
      }).join('') + '</div>';
    }
    h += '</div>';

    h += '<div class="cv-block"><div class="cv-h">Etiquetas</div><div class="cv-row">' +
      (card.labels || []).map(labelChip).join('') +
      (w ? '<button class="cv-add" data-act="pick-labels" title="Etiquetas">+</button>' : '') +
      ((card.labels || []).length || w ? '' : '<span class="cv-muted">—</span>') + '</div>';
    if (w) {
      h += '<div class="cv-picker" data-picker="labels" hidden>' + (board.labels || []).map(function (l) {
        return '<label class="cv-pick"><input type="checkbox" data-label="' + esc(l.id) + '"' +
          (labelIds.indexOf(l.id) !== -1 ? ' checked' : '') + '>' + labelChip(l) + '</label>';
      }).join('') + '</div>';
    }
    h += '</div>';

    h += '<div class="cv-block"><div class="cv-h">Fechas</div>';
    if (w) {
      h += '<div class="cv-dates">' +
        '<label>Inicio<input type="date" data-f="start" value="' + toDateInput(card.start) + '"></label>' +
        '<label>Vencimiento<input type="datetime-local" data-f="due" value="' + toLocalInput(card.due) + '"></label>' +
        '<label class="cv-done"><input type="checkbox" data-f="dueComplete"' + (card.dueComplete ? ' checked' : '') +
        (card.due ? '' : ' disabled') + '> Completada</label></div>';
    } else {
      h += '<div class="cv-row">' +
        (card.start ? '<span class="cv-pill">Inicio: ' + esc(fmtDateTime(card.start).split(' ').slice(0, 3).join(' ')) + '</span>' : '') +
        (card.due ? '<span class="cv-pill' + (card.dueComplete ? ' ok' : (new Date(card.due) < new Date() ? ' late' : '')) + '">Vence: ' +
          esc(fmtDateTime(card.due)) + (card.dueComplete ? ' ✓' : '') + '</span>' : '') +
        (!card.start && !card.due ? '<span class="cv-muted">Sin fechas</span>' : '') + '</div>';
    }
    h += '</div></div>';

    // Descripción
    h += '<section class="cv-sec"><div class="cv-sec-h"><h3>Descripción</h3>' +
      (w ? '<button class="btn cv-sm" data-act="edit-desc">Editar</button>' : '') + '</div>' +
      '<div class="cv-desc cv-md" data-desc>' + (card.desc ? md(card.desc) : '<span class="cv-muted">' +
        (w ? 'Añade una descripción más detallada…' : 'Sin descripción') + '</span>') + '</div>' +
      (w ? '<div class="cv-desc-edit" hidden><textarea rows="6" data-mention>' + esc(card.desc || '') + '</textarea>' +
        '<div class="cv-actions"><button class="btn primary cv-sm" data-act="save-desc">Guardar</button>' +
        '<button class="btn cv-sm" data-act="cancel-desc">Cancelar</button></div></div>' : '') +
      '</section>';

    // Adjuntos
    if (attachments.length) {
      var media = attachments.filter(function (a) { return kindOf(a) !== 'file'; });
      var files = attachments.filter(function (a) { return kindOf(a) === 'file'; });
      h += '<section class="cv-sec"><div class="cv-sec-h"><h3>Adjuntos</h3><span class="cv-muted">' + attachments.length + '</span></div>';
      if (media.length) {
        h += '<div class="cv-gallery">' + media.map(function (a) {
          var k = kindOf(a);
          if (k === 'image') {
            return '<button class="cv-thumb" data-act="lightbox" data-att="' + esc(a.id) + '" title="' + esc(a.name) + '">' +
              '<img data-media="' + esc(a.id) + '" data-size="thumb" alt="' + esc(a.name) + '"><span class="cv-thumb-n">' + esc(a.name) + '</span></button>';
          }
          return '<div class="cv-vid" data-vid="' + esc(a.id) + '">' +
            '<button class="cv-play" data-act="play" data-att="' + esc(a.id) + '" title="Reproducir ' + esc(a.name) + '">' +
            (bestPreview(a) ? '<img data-media="' + esc(a.id) + '" data-size="thumb" alt="">' : '') +
            '<span class="cv-play-i">▶</span></button><span class="cv-thumb-n">' + esc(a.name) +
            (a.bytes ? ' · ' + fmtBytes(a.bytes) : '') + '</span></div>';
        }).join('') + '</div>';
      }
      if (files.length) {
        h += '<ul class="cv-att">' + files.map(function (a) {
          return '<li><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name || a.url) + '</a>' +
            (a.date ? '<span class="cv-muted"> · ' + esc(fmtDateTime(a.date)) + '</span>' : '') + '</li>';
        }).join('') + '</ul>';
      }
      h += '</section>';
    }

    // Checklists
    checklists.forEach(function (cl) {
      var items = (cl.checkItems || []).slice().sort(function (a, b) { return a.pos - b.pos; });
      var done = items.filter(function (i) { return i.state === 'complete'; }).length;
      var pct = items.length ? Math.round(done * 100 / items.length) : 0;
      h += '<section class="cv-sec"><div class="cv-sec-h"><h3>☑ ' + esc(cl.name) + '</h3></div>' +
        '<div class="cv-prog"><span>' + pct + '%</span><div><i style="width:' + pct + '%"' + (pct === 100 ? ' class="full"' : '') + '></i></div></div>' +
        items.map(function (it) {
          return '<label class="cv-item' + (it.state === 'complete' ? ' done' : '') + '"><input type="checkbox" data-check="' + esc(it.id) +
            '" data-cl="' + esc(cl.id) + '"' + (it.state === 'complete' ? ' checked' : '') + (w ? '' : ' disabled') + '><span>' + mdInline(it.name) + '</span></label>';
        }).join('') +
        (w ? '<form class="cv-additem" data-cl="' + esc(cl.id) + '"><input type="text" placeholder="Añadir un elemento"><button class="btn cv-sm">Añadir</button></form>' : '') +
        '</section>';
    });
    if (!full && card.badges && card.badges.checkItems && !checklists.some(function (c) { return (c.checkItems || []).length; })) {
      h += '<section class="cv-sec"><div class="cv-muted">Checklist: ' + card.badges.checkItemsChecked + '/' + card.badges.checkItems +
        (w ? '' : ' · autoriza el calendario para ver los elementos') + '</div></section>';
    }

    }

    h += '</div><aside class="cv-side">';
    if (attachments.length) {
      h += '<div class="cv-side-att"><div class="cv-side-h"><span class="cv-h">Adjuntos · ' + attachments.length + '</span>' +
        (attachments.length > 1 ? '<button class="btn cv-sm" data-act="dl-all" title="Descargar todos los adjuntos">↓ Descargar todo</button>' : '') + '</div>' +
        attachments.map(function (a) {
          var k = kindOf(a), ext = ((a.name || a.url || '').match(/\.([a-z0-9]{1,5})(\?|$)/i) || [, ''])[1].toUpperCase();
          var ico = k === 'image'
            ? '<span class="cv-sa-ico img"><img data-media="' + esc(a.id) + '" data-size="thumb" alt=""></span>'
            : '<span class="cv-sa-ico">' + (k === 'video' ? '▶' : esc(ext || 'FILE')) + '</span>';
          var open = k === 'image' ? ' data-act="lightbox" data-att="' + esc(a.id) + '"' : (k === 'video' ? ' data-act="play-side" data-att="' + esc(a.id) + '"' : '');
          var nameEl = open
            ? '<button class="cv-sa-name"' + open + ' title="' + esc(a.name) + '">' + esc(a.name || a.url) + '</button>'
            : '<a class="cv-sa-name" href="' + esc(a.url) + '" target="_blank" rel="noopener" title="' + esc(a.name) + '">' + esc(a.name || a.url) + '</a>';
          return '<div class="cv-sa">' + ico + '<div class="cv-sa-txt">' + nameEl +
            '<span class="cv-muted">' + (a.bytes ? fmtBytes(a.bytes) : (a.isUpload === false ? 'Enlace' : '')) + '</span></div>' +
            (viaWorker(a)
              ? '<button class="cv-sa-dl" data-act="dl-one" data-att="' + esc(a.id) + '" title="Descargar ' + esc(a.name) + '" aria-label="Descargar">↓</button>'
              : '<a class="cv-sa-dl" href="' + esc(dlUrl(a)) + '" target="_blank" rel="noopener" download="' + esc(a.name || '') + '" title="Descargar ' + esc(a.name) + ' (si se abre en una pestaña, guárdalo con ⌘S o clic derecho → Guardar como)" aria-label="Descargar">↓</a>') +
            (w ? '<button class="cv-sa-del" data-act="del-att" data-att="' + esc(a.id) + '" title="Eliminar ' + esc(a.name) + '" aria-label="Eliminar">' +
              '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>' : '') + '</div>';
        }).join('') + '</div>';
    }
    // Comentarios
    h += '<section class="cv-side-cmts"><div class="cv-side-h"><span class="cv-h">Comentarios' + (full && comments.length ? ' · ' + comments.length : '') + '</span></div>';
    if (w) {
      h += '<form class="cv-comment"><textarea rows="2" data-mention placeholder="Escribe un comentario… (@ para mencionar)"></textarea>' +
        '<button class="btn primary cv-sm">Enviar</button></form>';
    }
    if (full) {
      h += comments.length ? comments.map(function (a) {
        var m = a.memberCreator || {};
        return '<div class="cv-cmt">' + avatar(m, 26) + '<div><div class="cv-cmt-h"><strong>' + esc(m.fullName || '') + '</strong>' +
          '<span class="cv-muted">' + esc(fmtDateTime(a.date)) + '</span></div><div class="cv-cmt-b cv-md">' + md(a.data && a.data.text) + '</div></div></div>';
      }).join('') : '<div class="cv-muted">Sin comentarios.</div>';
    } else if (!w) {
      h += '<div class="cv-muted">' + ((card.badges && card.badges.comments) ? card.badges.comments + ' comentario(s). ' : '') +
        'Autoriza el calendario para ver y escribir comentarios.</div>';
    } else {
      h += '<div class="cv-muted">Cargando…</div>';
    }
    h += '</section>';

    h += '</aside></div>';

    closeMention();
    root.querySelector('.cv').innerHTML = h;
    hydrateMedia(attachments);
    var ta = $('.cv-title');
    if (ta && ta.tagName === 'TEXTAREA') autosize(ta);
  }

  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  // ───────────────────────── Imágenes y vídeos ─────────────────────────
  var IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)(\?|$)/i, VID_EXT = /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i;
  function kindOf(a) {
    var mt = (a.mimeType || '').toLowerCase(), nm = (a.name || '') + ' ' + (a.url || '');
    if (mt.indexOf('image/') === 0 || (!mt && IMG_EXT.test(nm)) || (mt === 'application/octet-stream' && IMG_EXT.test(nm))) return 'image';
    if (mt.indexOf('video/') === 0 || (!mt && VID_EXT.test(nm)) || (mt === 'application/octet-stream' && VID_EXT.test(nm))) return 'video';
    return 'file';
  }
  // Enlace de descarga: los adjuntos subidos a Trello se descargan con tu sesión de Trello.
  function dlUrl(a) { return a.url; }
  function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function bestPreview(a, minW) {
    var p = (a.previews || []).filter(function (x) { return x.url; }).sort(function (x, y) { return x.width - y.width; });
    if (!p.length) return null;
    var ok = p.filter(function (x) { return x.width >= (minW || 360); })[0];
    return ok || p[p.length - 1];
  }
  function urlFor(a, size) {
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
      if (act === 'close') close();
      else if (act === 'trello') ctx.openInTrello(card);
      else if (act === 'auth') ctx.askAuth('Autoriza una vez el calendario para editar tarjetas.');
      else if (act === 'copy') copyLink();
      else if (act === 'cv-tab') { sp.tab = b.getAttribute('data-tab'); paint(); }
      else if (act === 'dl-all') downloadAll();
      else if (act === 'dl-one') { var oa = attById(b.getAttribute('data-att')); if (oa) workerDownload([oa], false); }
      else if (act === 'del-att') deleteAttachment(b.getAttribute('data-att'));
      else if (act === 'sp-net') { sp.net = b.getAttribute('data-net'); sp.slide = 0; sp.expanded = false; sp.editing = false; paint(); }
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
        if (p) p.hidden = !p.hidden;
      } else if (act === 'edit-desc') {
        $('[data-desc]').hidden = true; $('.cv-desc-edit').hidden = false;
        $('.cv-desc-edit textarea').focus();
      } else if (act === 'cancel-desc') paint();
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
        if (e.target.matches('textarea, input')) e.target.blur(); else close();
      }
    });
    root.addEventListener('input', function (e) {
      if (e.target.classList.contains('cv-title')) autosize(e.target);
      if (e.target.hasAttribute && e.target.hasAttribute('data-sp-copy')) spCount(e.target);
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
    if (!confirm('¿Eliminar «' + (a.name || 'este adjunto') + '» de la tarjeta?\n\nSe borra también en Trello y no se puede deshacer.')) return;
    var cid = card.id;
    setBusy(true);
    ctx.api('DELETE', '/cards/' + cid + '/attachments/' + id).then(function () {
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
    var up = atts.filter(viaWorker), links = atts.filter(function (a) { return !viaWorker(a); });
    if (up.length) {
      workerDownload(up, true);
      if (links.length) ctx.toast(links.length + ' adjunto(s) son enlaces y no se descargan; ábrelos desde la lista.');
      return;
    }
    atts.forEach(function (a, i) {
      setTimeout(function () {
        var el = document.createElement('a');
        el.href = dlUrl(a); el.download = a.name || ''; el.target = '_blank'; el.rel = 'noopener';
        document.body.appendChild(el); el.click(); el.remove();
      }, i * 350);
    });
    ctx.toast('Abriendo ' + atts.length + ' adjuntos… Si se abren en pestañas, guárdalos con ⌘S.');
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
      '&actions=commentCard&actions_limit=50&action_memberCreator_fields=fullName,initials,avatarUrl')
      .then(function (res) {
        if (!card || card.id !== id || !res) return;
        full = { checklists: res.checklists || [], attachments: res.attachments || [], actions: res.actions || [] };
        if (res.desc != null) card.desc = res.desc;
        if (res.shortUrl) card.shortUrl = res.shortUrl;
        var active = document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('textarea, input');
        if (!active) paint();
      })
      .catch(function () { full = { checklists: card.checklists || [], attachments: card.attachments || [], actions: [] }; paint(); });
  }

  // ───────────────────────── API pública ─────────────────────────
  function open(c) {
    card = c; full = null; sp = { tab: 'details', net: null, slide: 0, expanded: false, editing: false };
    root.hidden = false;
    paint();
    loadFull();
    setTimeout(function () { var x = $('.cv-x'); if (x) x.focus(); }, 30);
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
