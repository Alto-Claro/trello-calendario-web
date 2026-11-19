/* Vista previa por red social dentro de la tarjeta.
 * Las redes y formatos salen de las ETIQUETAS de la tarjeta:
 *   red     → Instagram/IG, Facebook/FB, TikTok/TT, YouTube/YT, LinkedIn, X/Twitter
 *   formato → Reel, Story/Historia, Carrusel (si no hay, es un post normal)
 * Ej.: «Instagram» + «Reel» → Reel de Instagram; «Instagram» + «Story» + «Reel» → dos vistas.
 *
 * CalSocial.detect(card) → [{ key: 'instagram:reel', net, fmt, label }]
 * CalSocial.render(o)    → HTML. o: { card, attachments, account, key, slide, expanded,
 *                                    kindOf(a), bestPreview(a), esc(s), when }
 * Las imágenes usan <img data-media> para que cardview las cargue con su lógica habitual. */
(function () {
  'use strict';

  var NETS = {
    instagram: { name: 'Instagram', limit: 2200, fold: 125, re: /instagram|^ig$/i },
    tiktok:    { name: 'TikTok',    limit: 2200, fold: 80,  re: /tik\s?tok|^tt$|^tk$/i },
    youtube:   { name: 'YouTube',   limit: 5000, fold: 100, re: /you\s?tube|^yt$/i },
    linkedin:  { name: 'LinkedIn',  limit: 3000, fold: 210, re: /linked\s?in|^li$/i },
    facebook:  { name: 'Facebook',  limit: 63206, fold: 250, re: /facebook|^fb$/i },
    x:         { name: 'X',         limit: 280,  fold: 280, re: /twitter|^x$/i }
  };
  var ORDER = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];
  var FMTS = {
    reel:     { name: 'Reel',     re: /\breels?\b/i },
    story:    { name: 'Story',    re: /\bstor(y|ies)\b|\bhistorias?\b/i },
    carousel: { name: 'Carrusel', re: /carrusel|carousel/i }
  };
  // Formatos que admite cada red (el primero es el que se usa si no hay etiqueta de formato).
  var SUPPORTS = {
    instagram: ['post', 'reel', 'story', 'carousel'],
    facebook:  ['post', 'reel', 'story', 'carousel'],
    linkedin:  ['post', 'carousel'],
    tiktok:    ['video'],
    youtube:   ['video', 'reel'],
    x:         ['post']
  };

  function detect(card) {
    var names = (card.labels || []).map(function (l) { return (l.name || '').trim(); });
    var has = function (re) { return names.some(function (n) { return re.test(n); }); };
    var nets = ORDER.filter(function (id) { return has(NETS[id].re); });
    var fmts = Object.keys(FMTS).filter(function (f) { return has(FMTS[f].re); });
    // «Reel» o «Story» sin red: se entiende Instagram.
    if (!nets.length && (fmts.indexOf('reel') !== -1 || fmts.indexOf('story') !== -1)) nets = ['instagram'];
    var out = [];
    nets.forEach(function (net) {
      var ok = fmts.filter(function (f) { return SUPPORTS[net].indexOf(f) !== -1; });
      if (!ok.length) ok = [SUPPORTS[net][0]];
      ok.forEach(function (fmt) {
        var label = NETS[net].name + (FMTS[fmt] ? ' · ' + (net === 'youtube' && fmt === 'reel' ? 'Short' : FMTS[fmt].name) : '');
        out.push({ key: net + ':' + fmt, net: net, fmt: fmt, label: label });
      });
    });
    return out;
  }

  // ───── Copy por red, guardado en la descripción de la tarjeta ─────
  // Sección general:  «## ✍️ Contenido / Copy» (tarjetas de Loomly) → la usan todas las redes.
  // Sección por red:  «## ✍️ Copy · Instagram» → solo esa red. Cada sección acaba en el siguiente
  // separador (---) o el siguiente título. Si no hay ninguna sección, el copy es toda la descripción.
  var NET_WORDS = {
    instagram: /\b(instagram|ig)\b/i, facebook: /\b(facebook|fb)\b/i, tiktok: /\b(tik\s?tok|tt)\b/i,
    youtube: /\b(you\s?tube|yt)\b/i, linkedin: /\blinked\s?in\b/i, x: /\b(twitter|x)\b/i
  };
  var HEADING = /^\s*#{1,6}\s/, SEP = /^\s*(---+|\*\*\*+|___+)\s*$/;
  function sections(md) {
    var lines = String(md || '').split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      if (!HEADING.test(lines[i]) || !/\b(contenido|copy)\b/i.test(lines[i])) continue;
      var net = null;
      ORDER.forEach(function (id) { if (!net && NET_WORDS[id].test(lines[i])) net = id; });
      var j = i + 1;
      while (j < lines.length && !SEP.test(lines[j]) && !HEADING.test(lines[j])) j++;
      out.push({ net: net, head: i, start: i + 1, end: j, text: lines.slice(i + 1, j).join('\n').trim() });
    }
    return { lines: lines, list: out };
  }
  function copyFor(md, net) {
    var sec = sections(md), own = sec.list.filter(function (x) { return x.net === net; })[0];
    if (own) return { text: own.text, own: true };
    var gen = sec.list.filter(function (x) { return !x.net; })[0];
    if (gen) return { text: gen.text, own: false };
    return { text: removeSections(sec, sec.list).trim(), own: false };
  }
  // Quita secciones (y el separador --- que las precede) de la descripción.
  function removeSections(sec, which) {
    var drop = {};
    which.forEach(function (x) {
      var a = x.head, k = a - 1;
      while (k >= 0 && !sec.lines[k].trim()) k--;
      if (k >= 0 && SEP.test(sec.lines[k])) a = k;
      for (var i = a; i < x.end; i++) drop[i] = true;
    });
    return sec.lines.filter(function (_, i) { return !drop[i]; }).join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // Devuelve la descripción con el copy de esa red cambiado (text vacío o null = quitar el copy propio).
  function setCopy(md, net, text) {
    var sec = sections(md), own = sec.list.filter(function (x) { return x.net === net; })[0];
    text = (text || '').trim();
    if (!text) return own ? removeSections(sec, [own]).trim() : String(md || '');
    if (own) {
      return sec.lines.slice(0, own.start).concat(['', text, ''], sec.lines.slice(own.end)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    var block = ['---', '', '## ✍️ Copy · ' + NETS[net].name, '', text];
    if (sec.list.length) { // justo después de las otras secciones de copy
      var last = sec.list[sec.list.length - 1];
      return sec.lines.slice(0, last.end).concat([''], block, [''], sec.lines.slice(last.end)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    return (String(md || '').replace(/\s+$/, '') + '\n\n' + block.join('\n')).replace(/^\s+/, '');
  }

  // Texto plano del pie: quita el markdown que usa Trello y resalta #hashtags, @menciones y enlaces.
  function plain(md) {
    return String(md || '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '').trim();
  }
  function rich(text, esc) {
    return esc(text)
      .replace(/(^|\s)([#@][\wáéíóúñü.]+)/gi, '$1<span class="sp-tag">$2</span>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<span class="sp-tag">$1</span>')
      .replace(/\n/g, '<br>');
  }
  function caption(text, net, expanded, esc) {
    var cut = NETS[net].fold;
    if (!text) return '<span class="sp-empty">Escribe el texto del post en la descripción de la tarjeta.</span>';
    if (expanded || text.length <= cut) return rich(text, esc);
    return rich(text.slice(0, cut).replace(/\s+\S*$/, ''), esc) +
      '… <button class="sp-more" data-act="sp-more">' + (net === 'linkedin' ? 'ver más' : 'más') + '</button>';
  }
  function fmtN(n) { return n.toLocaleString('es-ES'); }

  // Medio del post: imágenes y vídeos adjuntos, por orden (la portada primero).
  function mediaList(card, atts, kindOf) {
    var m = atts.filter(function (a) { return kindOf(a) !== 'file'; });
    var cov = card.cover && card.cover.idAttachment;
    if (cov) m.sort(function (a, b) { return (b.id === cov) - (a.id === cov); });
    return m;
  }
  function mediaEl(a, o) {
    if (!a) return '<div class="sp-media-ph">Sin imagen ni vídeo adjunto</div>';
    if (o.kindOf(a) === 'video') {
      if (a.isUpload === false) {
        return '<video src="' + o.esc(a.url) + '" muted loop playsinline autoplay data-act="sp-play"></video><span class="sp-vbadge">▶</span>';
      }
      // Sin depender de la portada: se carga el propio vídeo y se muestra su primer fotograma.
      return '<video data-media="' + o.esc(a.id) + '" data-size="full" muted loop playsinline preload="metadata" data-act="sp-play"></video>' +
        '<span class="sp-vbadge">▶</span>';
    }
    return '<img data-media="' + o.esc(a.id) + '" data-size="cover" alt="' + o.esc(a.name || '') + '">';
  }
  function carousel(media, o, ratio) {
    var i = Math.min(o.slide || 0, Math.max(0, media.length - 1));
    var h = '<div class="sp-media" style="aspect-ratio:' + ratio + '">' + mediaEl(media[i], o);
    if (media.length > 1) {
      h += '<span class="sp-count">' + (i + 1) + '/' + media.length + '</span>';
      if (i > 0) h += '<button class="sp-nav prev" data-act="sp-slide" data-to="' + (i - 1) + '" aria-label="Anterior">‹</button>';
      if (i < media.length - 1) h += '<button class="sp-nav next" data-act="sp-slide" data-to="' + (i + 1) + '" aria-label="Siguiente">›</button>';
    }
    h += '</div>';
    if (media.length > 1) {
      h += '<div class="sp-dots">' + media.map(function (_, k) { return '<i' + (k === i ? ' class="on"' : '') + '></i>'; }).join('') + '</div>';
    }
    return h;
  }
  function av(acc, size) {
    return '<span class="sp-av" style="width:' + size + 'px;height:' + size + 'px">' + acc.initials + '</span>';
  }

  var I = { // iconos de línea genéricos
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 3.2 6.4L4 20l1.2-3.6A8 8 0 0 1 4 12z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    thumb: '<svg viewBox="0 0 24 24"><path d="M7 10v10H4V10zm0 0 4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7"/></svg>',
    repost: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"/></svg>'
  };

  // ───── Formatos verticales (compartidos) ─────
  function verticalVideo(o, media, text, net, cls) {
    var who = net === 'facebook' ? o.account.name : (net === 'tiktok' ? '@' : '') + o.account.handle;
    return '<div class="' + cls + '"><div class="sp-media" style="aspect-ratio:9/16">' + mediaEl(media[0], o) +
      '<div class="sp-rail">' + (net === 'tiktok' ? av(o.account, 36) : '') +
      '<span>' + I.heart + '</span><span>' + I.chat + '</span><span>' + I.send + '</span><span>' + I.save + '</span></div>' +
      '<div class="sp-overlay bottom"><div class="sp-who">' + (net === 'tiktok' ? '' : av(o.account, 26)) + '<strong>' + o.esc(who) + '</strong></div>' +
      '<div class="sp-cap">' + caption(text, net, o.expanded, o.esc) + '</div>' +
      '<div class="sp-music">' + I.music + ' Audio original · ' + o.esc(o.account.name) + '</div></div></div></div>';
  }
  function story(o, media, net) {
    var n = Math.max(1, Math.min(media.length, 10)), i = Math.min(o.slide || 0, n - 1);
    var who = net === 'facebook' ? o.account.name : o.account.handle;
    var h = '<div class="sp-story"><div class="sp-media" style="aspect-ratio:9/16">' + mediaEl(media[i], o);
    h += '<div class="sp-bars">' + Array.apply(null, Array(n)).map(function (_, k) { return '<i' + (k <= i ? ' class="on"' : '') + '></i>'; }).join('') + '</div>';
    h += '<div class="sp-overlay top">' + av(o.account, 28) + '<strong>' + o.esc(who) + '</strong><span class="sp-ago">' + o.esc(o.whenShort) + '</span></div>';
    if (i > 0) h += '<button class="sp-nav prev" data-act="sp-slide" data-to="' + (i - 1) + '" aria-label="Anterior">‹</button>';
    if (i < n - 1) h += '<button class="sp-nav next" data-act="sp-slide" data-to="' + (i + 1) + '" aria-label="Siguiente">›</button>';
    h += '<div class="sp-reply"><span>Enviar mensaje</span>' + I.heart + I.send + '</div>';
    return h + '</div></div>';
  }

  // ───── Por red ─────
  function instagram(o, media, text) {
    if (o.fmt === 'reel') return verticalVideo(o, media, text, 'instagram', 'sp-reel');
    if (o.fmt === 'story') return story(o, media, 'instagram');
    var h = '<div class="sp-ig">';
    h += '<div class="sp-top">' + av(o.account, 32) + '<div><strong>' + o.esc(o.account.handle) + '</strong></div><span class="sp-dotsmenu">···</span></div>';
    h += carousel(media, o, '4/5');
    h += '<div class="sp-acts">' + I.heart + I.chat + I.send + '<span class="sp-sp"></span>' + I.save + '</div>';
    h += '<div class="sp-cap"><strong>' + o.esc(o.account.handle) + '</strong> ' + caption(text, 'instagram', o.expanded, o.esc) + '</div>';
    h += '<div class="sp-when">' + o.esc(o.when) + '</div>';
    return h + '</div>';
  }
  function tiktok(o, media, text) { return verticalVideo(o, media, text, 'tiktok', 'sp-tt'); }
  function linkedin(o, media, text) {
    var h = '<div class="sp-li"><div class="sp-top">' + av(o.account, 44) + '<div><strong>' + o.esc(o.account.name) +
      '</strong><div class="sp-muted">' + o.esc(o.when) + ' · 🌐</div></div></div>';
    h += '<div class="sp-cap">' + caption(text, 'linkedin', o.expanded, o.esc) + '</div>';
    if (media.length) h += carousel(media, o, o.fmt === 'carousel' || media.length > 1 ? '1/1' : '1.2/1');
    h += '<div class="sp-acts wide"><span>' + I.thumb + 'Recomendar</span><span>' + I.chat + 'Comentar</span><span>' + I.repost + 'Compartir</span><span>' + I.send + 'Enviar</span></div>';
    return h + '</div>';
  }
  function facebook(o, media, text) {
    if (o.fmt === 'reel') return verticalVideo(o, media, text, 'facebook', 'sp-reel');
    if (o.fmt === 'story') return story(o, media, 'facebook');
    var h = '<div class="sp-fb"><div class="sp-top">' + av(o.account, 40) + '<div><strong>' + o.esc(o.account.name) +
      '</strong><div class="sp-muted">' + o.esc(o.when) + ' · 🌐</div></div><span class="sp-dotsmenu">···</span></div>';
    h += '<div class="sp-cap">' + caption(text, 'facebook', o.expanded, o.esc) + '</div>';
    if (media.length) h += carousel(media, o, '1/1');
    h += '<div class="sp-acts wide"><span>' + I.thumb + 'Me gusta</span><span>' + I.chat + 'Comentar</span><span>' + I.send + 'Compartir</span></div>';
    return h + '</div>';
  }
  function x(o, media, text) {
    var h = '<div class="sp-x">' + av(o.account, 40) + '<div class="sp-x-b"><div><strong>' + o.esc(o.account.name) + '</strong> ' +
      '<span class="sp-muted">@' + o.esc(o.account.handle) + ' · ' + o.esc(o.when) + '</span></div>';
    h += '<div class="sp-cap">' + (text ? rich(text, o.esc) : caption('', 'x', true, o.esc)) + '</div>';
    if (media.length) {
      h += '<div class="sp-xgrid n' + Math.min(media.length, 4) + '">' + media.slice(0, 4).map(function (a) {
        return '<div class="sp-media">' + mediaEl(a, o) + '</div>';
      }).join('') + '</div>';
    }
    h += '<div class="sp-acts x"><span>' + I.chat + '</span><span>' + I.repost + '</span><span>' + I.heart + '</span><span>' + I.save + '</span></div>';
    return h + '</div></div>';
  }
  function youtube(o, media, text) {
    if (o.fmt === 'reel') return verticalVideo(o, media, text, 'youtube', 'sp-reel');
    return '<div class="sp-yt"><div class="sp-media" style="aspect-ratio:16/9">' + mediaEl(media[0], o) + '</div>' +
      '<div class="sp-yt-t">' + o.esc(o.card.name) + '</div>' +
      '<div class="sp-top">' + av(o.account, 32) + '<div><strong>' + o.esc(o.account.name) + '</strong></div>' +
      '<span class="sp-yt-sub">Suscribirse</span></div>' +
      '<div class="sp-yt-d"><div class="sp-muted">' + o.esc(o.when) + '</div>' + caption(text, 'youtube', o.expanded, o.esc) + '</div></div>';
  }
  var RENDER = { instagram: instagram, tiktok: tiktok, youtube: youtube, linkedin: linkedin, facebook: facebook, x: x };

  function checks(net, fmt, text, media, o) {
    var out = [], bad = function (s) { out.push('<span class="sp-bad">' + s + '</span>'); };
    var vids = media.filter(function (a) { return o.kindOf(a) === 'video'; }).length;
    if (fmt === 'story') {
      out.push('<span>Las stories no muestran el texto de la descripción: tiene que ir en la imagen o el vídeo</span>');
    } else {
      var lim = NETS[net].limit, n = text.length;
      out.push('<span class="' + (n > lim ? 'sp-bad' : '') + '">' + fmtN(n) + ' / ' + fmtN(lim) + ' caracteres</span>');
      var tags = (text.match(/(^|\s)#[\wáéíóúñü]+/gi) || []).length;
      if (tags) out.push('<span class="' + (net === 'instagram' && tags > 30 ? 'sp-bad' : '') + '">' + tags + ' hashtag' + (tags > 1 ? 's' : '') + '</span>');
    }
    if ((net === 'tiktok' || net === 'youtube' || fmt === 'reel') && !vids) bad((net === 'tiktok' ? 'TikTok' : net === 'youtube' ? 'YouTube' : 'Un reel') + ' necesita un vídeo');
    if (fmt === 'carousel' && media.length < 2) bad('Un carrusel necesita al menos 2 imágenes');
    if (media.length > 20 && (net === 'instagram' || fmt === 'carousel')) bad('Máximo 20 elementos por carrusel');
    if (net === 'x' && media.length > 4) bad('X muestra como máximo 4 imágenes');
    if (!media.length && (net === 'instagram' || fmt === 'story')) bad('Falta imagen o vídeo');
    return out.join('<span class="sp-sep">·</span>');
  }

  function editor(o, net, cp) {
    var name = NETS[net].name;
    var h = '<div class="sp-copy' + (o.editing ? ' editing' : '') + '"><div class="sp-copy-h"><strong>Copy para ' + name + '</strong>' +
      '<span class="sp-badge' + (cp.own ? ' own' : '') + '">' + (cp.own ? 'Propio de ' + name : 'Copy general') + '</span>';
    if (!o.editing) {
      h += '<span class="sp-sp"></span><button class="btn cv-sm" data-act="sp-edit">' + (cp.own ? 'Editar' : 'Personalizar para ' + name) + '</button>';
      if (cp.own) h += '<button class="btn cv-sm" data-act="sp-reset" title="Quita el copy propio y vuelve a usar el general">Usar el general</button>';
    }
    h += '</div>';
    if (o.editing) {
      h += '<textarea class="sp-copy-ta" rows="7" data-sp-copy data-mention>' + o.esc(cp.text) + '</textarea>' +
        '<div class="sp-copy-f"><span class="cv-muted" data-sp-count></span><span class="sp-sp"></span>' +
        '<button class="btn cv-sm" data-act="sp-cancel">Cancelar</button>' +
        '<button class="btn primary cv-sm" data-act="sp-save">Guardar copy de ' + name + '</button></div>';
    }
    h += '<p class="cv-muted sp-copy-hint">' + (cp.own
      ? 'Guardado en la descripción de la tarjeta, en la sección «Copy · ' + name + '».'
      : 'Se usa el copy general de la descripción. Si lo personalizas, se guarda en la descripción en una sección «Copy · ' + name + '» y las demás redes no cambian.') + '</p>';
    return h + '</div>';
  }
  function current(card, key) {
    var list = detect(card);
    return list.filter(function (d) { return d.key === key; })[0] || list[0] || null;
  }

  function render(o) {
    var list = detect(o.card);
    if (!list.length) return '';
    var cur = list.filter(function (d) { return d.key === o.key; })[0] || list[0];
    var media = mediaList(o.card, o.attachments || [], o.kindOf);
    var cp = copyFor(o.card.desc, cur.net);
    var text = plain(cp.text);
    var oo = Object.create(o); oo.fmt = cur.fmt;
    var h = '<div class="sp">';
    if (list.length > 1) {
      h += '<div class="sp-tabs" role="tablist">' + list.map(function (d) {
        var on = d.key === cur.key;
        return '<button role="tab" aria-selected="' + on + '" class="sp-tab' + (on ? ' on' : '') +
          '" data-act="sp-net" data-net="' + d.key + '">' + d.label + '</button>';
      }).join('') + '</div>';
    }
    h += '<div class="sp-stage"><div class="sp-phone">' + RENDER[cur.net](oo, media, text) + '</div></div>';
    h += '<div class="sp-checks">' + checks(cur.net, cur.fmt, text, media, o) + '</div>';
    h += editor(o, cur.net, cp);
    return h + '</div>';
  }

  window.CalSocial = { NETS: NETS, detect: detect, render: render, current: current, copyFor: copyFor, setCopy: setCopy };
})();
