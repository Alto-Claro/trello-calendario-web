/* Google Drive en el calendario (window.CalDrive).
 *
 * VER: cualquier adjunto que sea un enlace de Drive (lo ponga este calendario, el Power-Up oficial
 *      de Google Drive o alguien a mano) se previsualiza con las miniaturas y el visor de Drive.
 *      No hace falta conectar nada: usa la sesión de Google del navegador. Si el navegador bloquea
 *      esa sesión dentro de Trello (Safari), con Drive conectado se piden las miniaturas a la API.
 * SUBIR: los archivos grandes se suben a una carpeta de Drive del usuario («Calendario Trello · <tablero>»)
 *      y se comparten como "cualquiera con el enlace puede ver" (DRIVE_SHARE en js/config.js).
 *      Necesita GOOGLE_CLIENT_ID en js/config.js (sin él, el botón no sube a Drive).
 *
 * Permiso que se pide a Google: drive.file (solo los archivos que crea este calendario). */
(function () {
  'use strict';

  var C = window.CAL_CONFIG || {};
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var API = 'https://www.googleapis.com/drive/v3';
  var FOLDER = 'application/vnd.google-apps.folder';
  var TOK_KEY = 'calDriveTok';

  // ───── Reconocer enlaces ─────
  var RES = [
    [/^https:\/\/drive\.google\.com\/file\/d\/([\w-]{10,})/, 'file'],
    [/^https:\/\/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]{10,})/, 'file'],
    [/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/, 'folder'],
    [/^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|drawings|forms)\/d\/([\w-]{10,})/, 'gdoc']
  ];
  function parse(url) {
    url = String(url || '');
    for (var i = 0; i < RES.length; i++) {
      var m = url.match(RES[i][0]);
      if (m) return { id: m[1], type: RES[i][1] };
    }
    return null;
  }
  function thumbUrl(id, w) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (w || 640); }
  function viewUrl(id) { return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview'; }
  function openUrl(a) { return a.url; }
  function dlUrl(id) { return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id); }
  // Marca el adjunto (a.drive) y le pone la miniatura de Drive como vista previa.
  function fix(a) {
    if (!a || a.isUpload || a.drive) return a;
    var d = parse(a.url);
    if (!d) return a;
    a.drive = d;
    if (d.type !== 'folder') a.previews = [{ url: thumbUrl(d.id, 640), width: 640, height: 640 }];
    return a;
  }

  // ───── Conexión con Google (Google Identity Services) ─────
  var gisLoad = null, tokenClient = null, tok = null, pending = null;
  function enabled() { return !!(C.GOOGLE_CLIENT_ID || C.DRIVE_UPLOAD_URL); }
  try {
    var saved = JSON.parse(sessionStorage.getItem(TOK_KEY) || 'null');
    if (saved && saved.exp > Date.now() + 60000) tok = saved;
  } catch (e) { /* sin almacenamiento */ }
  function hasToken() { return !!(tok && tok.exp > Date.now() + 60000); }
  function loadGis() {
    if (gisLoad) return gisLoad;
    gisLoad = new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { gisLoad = null; reject(new Error('No se pudo cargar el acceso de Google')); };
      document.head.appendChild(s);
    });
    return gisLoad;
  }
  // Precarga el script para que la ventana de Google se abra al instante dentro del clic.
  function warmUp() { if (enabled()) loadGis().then(client).catch(function () {}); }
  function client() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: C.GOOGLE_CLIENT_ID, scope: SCOPE,
      callback: function (r) {
        var p = pending; pending = null;
        if (!p) return;
        if (r && r.access_token) {
          tok = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
          try { sessionStorage.setItem(TOK_KEY, JSON.stringify(tok)); } catch (e) {}
          p.resolve(tok.t);
        } else p.reject(new Error((r && (r.error_description || r.error)) || 'Google no dio permiso'));
      },
      error_callback: function (err) {
        var p = pending; pending = null;
        if (p) p.reject(new Error(err && err.type === 'popup_closed' ? 'Se cerró la ventana de Google' : 'No se pudo abrir la ventana de Google'));
      }
    });
    return tokenClient;
  }
  // Abre la ventana de Google: llámalo SIEMPRE desde un clic del usuario.
  function connect() {
    if (!enabled()) return Promise.reject(new Error('Falta GOOGLE_CLIENT_ID en js/config.js'));
    if (hasToken()) return Promise.resolve(tok.t);
    var start = function () {
      return new Promise(function (resolve, reject) {
        pending = { resolve: resolve, reject: reject };
        client().requestAccessToken({ prompt: '' });
      });
    };
    // Si el script ya está cargado, la ventana se abre sin salir del clic (si no, el navegador podría bloquearla).
    if (tokenClient) return start();
    return loadGis().then(start);
  }
  function token() {
    return hasToken() ? Promise.resolve(tok.t) : Promise.reject(new Error('Falta dar permiso para subir'));
  }
  function gapi(method, path, body, extraHeaders) {
    return token().then(function (t) {
      var h = Object.assign({ Authorization: 'Bearer ' + t }, extraHeaders || {});
      if (body && !(body instanceof Blob)) h['Content-Type'] = 'application/json';
      return fetch(path.indexOf('https://') === 0 ? path : API + path, {
        method: method, headers: h, body: body ? (body instanceof Blob ? body : JSON.stringify(body)) : undefined
      });
    }).then(function (r) {
      if (r.status === 401) { tok = null; try { sessionStorage.removeItem(TOK_KEY); } catch (e) {} }
      if (!r.ok) return r.text().then(function (x) { throw new Error(googleError(x) || ('Google respondió ' + r.status)); });
      return r;
    });
  }
  function googleError(x) {
    try { var j = JSON.parse(x); return j.error && (j.error.message || j.error); } catch (e) { return (x || '').slice(0, 200); }
  }

  // Miniatura pedida a la API (para cuando el navegador no manda la sesión de Google dentro de Trello).
  // Solo funciona con archivos que ve esta app (los subidos desde el calendario).
  var apiThumbs = {};
  function apiThumb(id) {
    if (!hasToken()) return Promise.reject(new Error('Falta dar permiso para subir'));
    if (!apiThumbs[id]) {
      apiThumbs[id] = gapi('GET', '/files/' + encodeURIComponent(id) + '?fields=thumbnailLink&supportsAllDrives=true')
        .then(function (r) { return r.json(); })
        .then(function (f) {
          if (!f.thumbnailLink) throw new Error('Sin miniatura');
          return f.thumbnailLink.replace(/=s\d+$/, '=s640');
        });
      apiThumbs[id].catch(function () { delete apiThumbs[id]; });
    }
    return apiThumbs[id];
  }

  // ───── Subir ─────
  var folders = {};
  function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  // Carpeta «Calendario Trello · <tablero>» (una por tablero; se reconoce por appProperties).
  function folderFor(board) {
    var key = board.id;
    if (folders[key]) return folders[key];
    var query = 'mimeType=' + q(FOLDER) + ' and trashed=false and appProperties has { key=' + q('calBoard') + ' and value=' + q(board.id) + ' }';
    folders[key] = gapi('GET', '/files?q=' + encodeURIComponent(query) + '&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.files && res.files[0]) return res.files[0].id;
        var meta = { name: 'Calendario Trello · ' + (board.name || board.id), mimeType: FOLDER, appProperties: { calBoard: board.id } };
        if (C.DRIVE_PARENT_ID) meta.parents = [C.DRIVE_PARENT_ID];
        return gapi('POST', '/files?fields=id&supportsAllDrives=true', meta).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
      });
    folders[key].catch(function () { delete folders[key]; });
    return folders[key];
  }
  var domainP = null;
  function myDomain() {
    if (!domainP) {
      domainP = gapi('GET', '/about?fields=user(emailAddress)').then(function (r) { return r.json(); }).then(function (a) {
        var d = ((a.user && a.user.emailAddress) || '').split('@')[1] || '';
        return /^(gmail|googlemail)\.com$/i.test(d) ? '' : d;
      });
      domainP.catch(function () { domainP = null; });
    }
    return domainP;
  }
  // Compartir: 'anyone' (por defecto) = cualquiera con el enlace; 'domain' = cualquiera de tu Workspace con el enlace; 'none'.
  function share(id) {
    var mode = C.DRIVE_SHARE || 'anyone';
    if (mode === 'none') return Promise.resolve('none');
    var perm = mode === 'anyone' ? Promise.resolve({ type: 'anyone', role: 'reader', allowFileDiscovery: false })
      : myDomain().then(function (d) { return d ? { type: 'domain', domain: d, role: 'reader', allowFileDiscovery: false } : null; });
    return perm.then(function (p) {
      if (!p) return 'none';
      return gapi('POST', '/files/' + encodeURIComponent(id) + '/permissions?supportsAllDrives=true&sendNotificationEmail=false', p).then(function () { return p.type; });
    });
  }
  // Subida "resumable" de Google, de una vez y con progreso. → { id, name, mimeType, url, shared }
  function upload(file, o) {
    var type = o.type || file.type || 'application/octet-stream';
    return folderFor(o.board).then(function (folderId) {
      return gapi('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink',
        { name: file.name, parents: [folderId], mimeType: type },
        { 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(file.size) });
    }).then(function (r) {
      var loc = r.headers.get('Location');
      if (!loc) throw new Error('Google no devolvió la dirección de subida');
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('PUT', loc);
        x.setRequestHeader('Content-Type', type);
        if (x.upload && o.onProgress) x.upload.onprogress = function (e) { o.onProgress(e.loaded); };
        x.onload = function () {
          if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } }
          else reject(new Error(googleError(x.responseText) || ('Google respondió ' + x.status)));
        };
        x.onerror = function () { reject(new Error('Fallo de red al subir')); };
        x.send(file);
      });
    }).then(function (f) {
      return share(f.id).catch(function () { return 'none'; }).then(function (shared) {
        return { id: f.id, name: f.name, mimeType: f.mimeType || type, url: f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view'), shared: shared };
      });
    });
  }

  // ───── Subida al Drive de la agencia a través del script (apps-script/Codigo.gs) ─────
  // No necesita cuenta de Google: el script comprueba con Trello (auth = cabecera OAuth de Trello)
  // que quien sube ve la tarjeta, abre la subida en su Drive y el navegador envía el archivo a Google.
  function viaScript() { return !!C.DRIVE_UPLOAD_URL; }
  function script(body) {
    return fetch(C.DRIVE_UPLOAD_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('El servicio de subidas respondió ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'Error del servicio de subidas'); return j; });
  }
  function uploadShared(file, o) {
    var type = o.type || file.type || 'application/octet-stream';
    return script({ action: 'start', auth: o.auth, card: o.card, boardName: o.board && o.board.name,
      name: file.name, type: type, size: file.size, origin: location.origin
    }).then(function (st) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('PUT', st.uploadUrl);
        x.setRequestHeader('Content-Type', type);
        if (x.upload && o.onProgress) x.upload.onprogress = function (e) { o.onProgress(e.loaded); };
        x.onload = function () {
          if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } }
          else reject(new Error(googleError(x.responseText) || ('Google respondió ' + x.status)));
        };
        x.onerror = function () { reject(new Error('Fallo de red al subir')); };
        x.send(file);
      });
    }).then(function (f) {
      return script({ action: 'finish', auth: o.auth, card: o.card, id: f.id });
    }).then(function (r) {
      return { id: r.id, name: r.name, mimeType: r.mimeType || type, url: r.url, shared: r.shared };
    });
  }

  window.CalDrive = {
    viaScript: viaScript, uploadShared: uploadShared,
    enabled: enabled, parse: parse, fix: fix, thumbUrl: thumbUrl, viewUrl: viewUrl, openUrl: openUrl, dlUrl: dlUrl,
    hasToken: hasToken, connect: connect, warmUp: warmUp, apiThumb: apiThumb, upload: upload
  };
})();
