/* Configuración del Power-Up.
 *
 * APP_KEY: la "API key" que Trello te da en https://trello.com/power-ups/admin
 *          (tu Power-Up → pestaña "API key" → Generar). Es pública, no es un secreto.
 *          Sin ella el calendario funciona en modo SOLO LECTURA (no se pueden
 *          arrastrar tarjetas para cambiar fechas).
 */
window.CAL_CONFIG = {
  APP_KEY: '',            // ← pega aquí tu API key
  APP_NAME: 'Calendario Libre',
  APP_AUTHOR: 'Alto y Claro'
};
