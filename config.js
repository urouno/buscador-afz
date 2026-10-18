/*
 * config.js — ÚNICO archivo que hay que editar para conectar la herramienta.
 */
window.APP_CONFIG = {
  // URL de la fuente de datos. Opciones:
  //  1) (Recomendada) URL del Apps Script implementado como aplicación web, termina en /exec
  //     ej. 'https://script.google.com/macros/s/AKfycb.../exec'
  //  2) (Alternativa) URL de la pestaña publicada como CSV (Archivo > Compartir > Publicar en la web)
  //     ej. 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv'
  DATA_URL: 'https://script.google.com/macros/s/AKfycbz9c9znEw-KcfzWZ5AiStJ8U9OQtSN6KGc4edn1fIts2FsZ6-850iq15B2yKBmTMPzI/exec',

  // Si la página queda abierta, al volver a ella se descargan datos nuevos
  // cuando pasaron más de estos minutos desde la última descarga.
  REFRESH_MINUTES: 30,

  // Tiempo máximo de espera de la descarga (segundos).
  TIMEOUT_SECONDS: 25,

  // Publicaciones que se muestran por bloque (botón "Mostrar más").
  PAGE_SIZE: 30,
};
