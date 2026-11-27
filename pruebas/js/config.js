/* Configuración del Power-Up.
 *
 * APP_KEY: la "API key" que Trello te da en https://trello.com/power-ups/admin
 *          (tu Power-Up → pestaña "API key" → Generar). Es pública, no es un secreto.
 *          Sin ella el calendario funciona en modo SOLO LECTURA (no se pueden
 *          arrastrar tarjetas para cambiar fechas).
 */
window.CAL_CONFIG = {
  APP_KEY: '2c8facb41c1492bf259d70ee05a7b1ae',          // ← pega aquí tu API key
  APP_NAME: 'Calendario Libre',
  APP_AUTHOR: 'Alto y Claro',
  // Intermediario de descargas (carpeta worker/, Cloudflare). Vacío = los adjuntos solo se abren.
  DOWNLOAD_URL: '',   // desactivado: no se usa Cloudflare (solo Trello + Google Drive)
  // Los archivos de hasta estos MB se suben a Trello; los más grandes, a Cloudflare R2 a través del
  // intermediario (solo si el Worker tiene el bucket R2; si no, el botón «Subir» no aparece).
  TRELLO_MAX_MB: 10,
  // Google Drive (js/drive.js). Con GOOGLE_CLIENT_ID, los archivos grandes se suben a Drive en vez de a R2.
  // ID de cliente OAuth "Aplicación web" de Google Cloud con origen https://alto-claro.github.io (es público).
  // Los enlaces de Drive se previsualizan siempre, haya o no ID de cliente.
  GOOGLE_CLIENT_ID: '256467190711-8t6mnosg4cd0pinibagn9d3u8r21o3k4.apps.googleusercontent.com',
  // Subidas al Drive de la agencia (apps-script/Codigo.gs publicado como aplicación web). Con esta URL,
  // cualquiera del tablero sube los archivos grandes al Drive de la agencia sin cuenta de Google.
  DRIVE_UPLOAD_URL: 'https://script.google.com/macros/s/AKfycbyjcZmSH6xEVa2iqSfk6UT6wHcM28tNUqhhdCg1wZ5MkLk4TBL7jGkUwBmK9tVh_X4GDw/exec',
  DRIVE_PARENT_ID: '',     // carpeta (o unidad compartida) donde crear las carpetas por tablero; vacío = Mi unidad
  DRIVE_SHARE: 'anyone'    // 'anyone' = cualquiera con el enlace (no aparece en búsquedas) · 'domain' = solo vuestro Workspace · 'none'
};
