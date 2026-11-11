/* Vista de tarjeta dentro del calendario (sin salir del modal).
 * Se usa con CalCardView.init(ctx) y CalCardView.open(card).
 * ctx: { api(method, path, body), canWrite(), askAuth(msg), board(), lists(), onChange(card),
 *        openInTrello(card), locale, defaultHour, labelColor(color), textOn(hex) } */
(function () {
  'use strict';

  var ctx, card, full, root, busy = 0;
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
  // Markdown mínimo: enlaces, negrita, cursiva, código y saltos de línea.
  function md(text) {
    var h = esc(text || '');
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    return h.replace(/\n/g, '<br>');
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
    h += '</div>';

    h += '<div class="cv-body"><div class="cv-main">';

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
      '<div class="cv-desc" data-desc>' + (card.desc ? md(card.desc) : '<span class="cv-muted">' +
        (w ? 'Añade una descripción más detallada…' : 'Sin descripción') + '</span>') + '</div>' +
      (w ? '<div class="cv-desc-edit" hidden><textarea rows="6">' + esc(card.desc || '') + '</textarea>' +
        '<div class="cv-actions"><button class="btn primary cv-sm" data-act="save-desc">Guardar</button>' +
        '<button class="btn cv-sm" data-act="cancel-desc">Cancelar</button></div></div>' : '') +
      '</section>';

    // Checklists
    checklists.forEach(function (cl) {
      var items = (cl.checkItems || []).slice().sort(function (a, b) { return a.pos - b.pos; });
      var done = items.filter(function (i) { return i.state === 'complete'; }).length;
      var pct = items.length ? Math.round(done * 100 / items.length) : 0;
      h += '<section class="cv-sec"><div class="cv-sec-h"><h3>☑ ' + esc(cl.name) + '</h3></div>' +
        '<div class="cv-prog"><span>' + pct + '%</span><div><i style="width:' + pct + '%"' + (pct === 100 ? ' class="full"' : '') + '></i></div></div>' +
        items.map(function (it) {
          return '<label class="cv-item' + (it.state === 'complete' ? ' done' : '') + '"><input type="checkbox" data-check="' + esc(it.id) +
            '" data-cl="' + esc(cl.id) + '"' + (it.state === 'complete' ? ' checked' : '') + (w ? '' : ' disabled') + '><span>' + md(it.name) + '</span></label>';
        }).join('') +
        (w ? '<form class="cv-additem" data-cl="' + esc(cl.id) + '"><input type="text" placeholder="Añadir un elemento"><button class="btn cv-sm">Añadir</button></form>' : '') +
        '</section>';
    });
    if (!full && card.badges && card.badges.checkItems && !checklists.some(function (c) { return (c.checkItems || []).length; })) {
      h += '<section class="cv-sec"><div class="cv-muted">Checklist: ' + card.badges.checkItemsChecked + '/' + card.badges.checkItems +
        (w ? '' : ' · autoriza el calendario para ver los elementos') + '</div></section>';
    }

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

    // Comentarios
    h += '<section class="cv-sec"><div class="cv-sec-h"><h3>Comentarios</h3></div>';
    if (w) {
      h += '<form class="cv-comment"><textarea rows="2" placeholder="Escribe un comentario…"></textarea>' +
        '<button class="btn primary cv-sm">Guardar</button></form>';
    }
    if (full) {
      h += comments.length ? comments.map(function (a) {
        var m = a.memberCreator || {};
        return '<div class="cv-cmt">' + avatar(m, 26) + '<div><div class="cv-cmt-h"><strong>' + esc(m.fullName || '') + '</strong>' +
          '<span class="cv-muted">' + esc(fmtDateTime(a.date)) + '</span></div><div class="cv-cmt-b">' + md(a.data && a.data.text) + '</div></div></div>';
      }).join('') : '<div class="cv-muted">Sin comentarios.</div>';
    } else if (!w) {
      h += '<div class="cv-muted">' + ((card.badges && card.badges.comments) ? card.badges.comments + ' comentario(s). ' : '') +
        'Autoriza el calendario para ver y escribir comentarios.</div>';
    } else {
      h += '<div class="cv-muted">Cargando…</div>';
    }
    h += '</section>';

    h += '</div><aside class="cv-side">';
    if (!w) h += '<button class="btn primary" data-act="auth">Autorizar edición</button>';
    if (w && card.due) h += '<button class="btn" data-act="toggle-done">' + (card.dueComplete ? '↺ Marcar pendiente' : '✓ Marcar completada') + '</button>';
    h += '<button class="btn" data-act="trello">Abrir en Trello ↗</button>';
    h += '<button class="btn" data-act="copy">Copiar enlace</button>';
    h += '</aside></div>';

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
    root.querySelectorAll('img[data-media]').forEach(function (img) {
      var a = attById(img.getAttribute('data-media'));
      if (!a) return;
      var box = img.parentNode;
      box.classList.add('loading');
      loadInto(img, a, img.getAttribute('data-size'),
        function () { box.classList.remove('loading'); },
        function () { mediaFail(img, a, a.isUpload !== false && !ctx.canWrite()); });
    });
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
      else if (act === 'lightbox') openLightbox(b.getAttribute('data-att'));
      else if (act === 'play') playVideo(b.getAttribute('data-att'));
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
      if (e.target.classList.contains('cv-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') {
        if (lb && !lb.hidden) return;
        e.stopPropagation();
        if (e.target.matches('textarea, input')) e.target.blur(); else close();
      }
    });
    root.addEventListener('input', function (e) { if (e.target.classList.contains('cv-title')) autosize(e.target); });
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
    card = c; full = null;
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
