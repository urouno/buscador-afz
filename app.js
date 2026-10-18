/*
 * app.js — Interfaz del Buscador AFINAZONE.
 * Carga los datos una sola vez (con copia en el navegador) y resuelve todas
 * las búsquedas en memoria con la lógica de core.js (sin cambios en las reglas).
 */
(function () {
  'use strict';

  const CFG = Object.assign({ DATA_URL: '', REFRESH_MINUTES: 30, TIMEOUT_SECONDS: 25, PAGE_SIZE: 30 }, window.APP_CONFIG || {});
  const Core = window.Core;
  const CACHE_KEY = 'afz-buscador:v1:' + (CFG.DATA_URL || 'embebido');
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const intFmt = new Intl.NumberFormat('es-MX');
  const MODES = ['pub', 'veh', 'part'];
  const FACET_LABEL = {};
  Core.FACETS.forEach((f) => { FACET_LABEL[f.key] = f.label; });

  const S = {
    model: null,
    mode: 'pub',
    pubQ: '',
    partQ: '',
    f: Core.emptyFilters(),
    shown: CFG.PAGE_SIZE,
    loadedAt: null,
    lastFetch: 0,
    fetching: false,
    loadError: null,
    lastPartQ: undefined,
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const icon = (id, cls) => '<svg class="' + (cls || 'ico') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ================================================================== */
  /* Carga de datos                                                      */
  /* ================================================================== */

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      return c && c.text ? c : null;
    } catch (e) { return null; }
  }
  function writeCache(text) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), text })); } catch (e) { /* sin espacio o bloqueado */ }
  }

  async function download() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.TIMEOUT_SECONDS * 1000);
    try {
      const url = CFG.DATA_URL + (CFG.DATA_URL.includes('?') ? '&' : '?') + '_t=' + Date.now();
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal, redirect: 'follow' });
      if (!res.ok) throw new Error('La fuente de datos respondió con el código ' + res.status + '.');
      return await res.text();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('La descarga tardó más de ' + CFG.TIMEOUT_SECONDS + ' segundos.');
      if (e instanceof TypeError) throw new Error('No se pudo conectar con la fuente de datos (sin internet, URL incorrecta o el Apps Script no tiene acceso "Cualquier usuario").');
      throw e;
    } finally { clearTimeout(timer); }
  }

  /** Convierte texto/objeto en modelo. Lanza error si la estructura no sirve. */
  function modelFrom(textOrPayload) {
    const table = typeof textOrPayload === 'string' ? Core.tableFromText(textOrPayload) : Core.tableFromApi(textOrPayload);
    const model = Core.buildModel(table);
    model.table = table;
    return model;
  }

  function setModel(model, loadedAt) {
    S.model = model;
    S.loadedAt = loadedAt;
    buildStaticFromModel();
    renderQuality();
    render();
  }

  async function refresh(manual) {
    if (window.EMBEDDED_DATA) { if (manual) toast('Versión de demostración: los datos son fijos'); return; }
    if (!CFG.DATA_URL || S.fetching) return;
    S.fetching = true;
    setStatus();
    try {
      const text = await download();
      const model = modelFrom(text); // valida antes de guardar
      writeCache(text);
      S.lastFetch = Date.now();
      S.loadError = null;
      hideBanner();
      setModel(model, new Date());
      if (manual) toast('Datos actualizados');
    } catch (e) {
      S.loadError = e;
      const hasData = !!S.model;
      const msg = e.code === 'STRUCTURE' ? e.message + ' Revisa los encabezados de la fila de títulos en la hoja.' : e.message;
      showBanner(hasData
        ? 'No se pudieron descargar datos nuevos. ' + msg + ' Se muestran los últimos datos guardados (' + fmtDate(S.loadedAt) + ').'
        : 'No se pudieron cargar los datos. ' + msg, hasData ? 'warn' : 'error', true);
      if (!hasData) $('#results').innerHTML = emptyBox('alert', 'Sin datos para buscar', 'Cuando se resuelva el problema, presiona Reintentar.');
    } finally {
      S.fetching = false;
      setStatus();
    }
  }

  async function init() {
    bindUI();
    readHash();
    applyStateToInputs();

    if (window.EMBEDDED_DATA) {
      try { setModel(modelFrom(window.EMBEDDED_DATA), new Date(window.EMBEDDED_DATA.generatedAt || Date.now())); }
      catch (e) { S.loadError = e; showBanner('Error en los datos de demostración: ' + e.message, 'error'); }
      setStatus();
      return;
    }
    if (!CFG.DATA_URL) {
      S.loadError = new Error('config');
      showBanner('Falta configurar la fuente de datos: escribe la URL del Apps Script en DATA_URL dentro de config.js (ver README).', 'error');
      setStatus();
      return;
    }
    const cached = readCache();
    if (cached) {
      try { setModel(modelFrom(cached.text), new Date(cached.savedAt)); } catch (e) { /* copia dañada: se ignora */ }
    } else {
      $('#results').innerHTML = skeletonHTML();
    }
    await refresh(false);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - S.lastFetch > CFG.REFRESH_MINUTES * 60000) refresh(false);
    });
  }

  /* ================================================================== */
  /* Estado general: barra de datos, avisos, toast                       */
  /* ================================================================== */

  function fmtDate(d) {
    if (!d) return '';
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function setStatus() {
    const el = $('#status');
    const txt = $('#status-text');
    const btn = $('#refresh');
    let cls; let text;
    if (S.fetching) {
      cls = 'is-loading';
      text = S.model ? 'Actualizando datos…' : 'Cargando datos…';
    } else if (!S.model) {
      cls = 'is-error';
      text = 'Sin datos';
    } else if (S.loadError) {
      cls = 'is-stale';
      text = intFmt.format(S.model.records.length) + ' registros · copia guardada del ' + fmtDate(S.loadedAt);
    } else {
      cls = 'is-ok';
      text = intFmt.format(S.model.records.length) + ' registros · actualizado ' + fmtDate(S.loadedAt);
    }
    el.className = 'status ' + cls;
    txt.textContent = text;
    btn.disabled = S.fetching;
    btn.setAttribute('aria-busy', String(S.fetching));
  }

  function showBanner(msg, kind, retry) {
    const b = $('#banner');
    $('#banner-text').textContent = msg;
    b.className = 'banner ' + (kind || 'warn');
    $('#banner-retry').hidden = !retry;
    b.hidden = false;
  }
  function hideBanner() { $('#banner').hidden = true; }

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 1900);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* nada */ }
      ta.remove();
    }
    toast('Copiado: ' + text);
  }

  /* ================================================================== */
  /* Eventos                                                             */
  /* ================================================================== */

  let filtersEl;

  function markPending() { $('#results').classList.add('is-pending'); }

  function bindUI() {
    // Selector de método (pestañas con flechas del teclado)
    $$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('.modes').addEventListener('keydown', (e) => {
      const k = e.key;
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(k)) return;
      e.preventDefault();
      let i = MODES.indexOf(S.mode);
      if (k === 'Home') i = 0; else if (k === 'End') i = 2;
      else i = (i + (k === 'ArrowRight' || k === 'ArrowDown' ? 1 : 2)) % 3;
      setMode(MODES[i]);
      $('#tab-btn-' + MODES[i]).focus();
    });

    // Campos principales
    const onPub = debounce(() => { S.pubQ = $('#q-pub').value; resetPage(); render(); }, 180);
    $('#q-pub').addEventListener('input', () => { syncClear('q-pub'); markPending(); onPub(); });
    const onPart = debounce(() => { S.partQ = $('#q-part').value; resetPage(); render(); }, 180);
    $('#q-part').addEventListener('input', () => { syncClear('q-part'); markPending(); onPart(); });
    $$('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      const inp = $('#' + b.dataset.clear); inp.value = ''; inp.dispatchEvent(new Event('input')); inp.focus();
    }));
    [$('#q-pub'), $('#q-part')].forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && inp.value) { e.preventDefault(); inp.value = ''; inp.dispatchEvent(new Event('input')); }
    }));

    // Filtros: una sola copia que se mueve entre "Por vehículo" y "Limitar por vehículo"
    filtersEl = $('#filters-template').content.firstElementChild.cloneNode(true);
    const extraGrid = $('.fgroup-extra .fgrid', filtersEl);
    for (const fc of Core.FACETS) { // por si core.js agrega un filtro que aún no está en el HTML
      if ($('select[data-field="' + fc.key + '"]', filtersEl)) continue;
      const lab = document.createElement('label');
      lab.className = 'f';
      lab.innerHTML = '<span class="f-label">' + esc(fc.label) + '</span><select data-field="' + fc.key + '"></select>';
      extraGrid.insertBefore(lab, $('.f-wide', extraGrid));
    }
    // Los chips de filtros activos usan las mismas etiquetas que el formulario.
    $$('select[data-field]', filtersEl).forEach((sel) => {
      const lab = sel.closest('.f') && $('.f-label', sel.closest('.f'));
      if (lab) FACET_LABEL[sel.dataset.field] = lab.textContent.trim();
    });
    filtersEl.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('select[data-field]')) { S.f[t.dataset.field] = t.value; resetPage(); render(); }
      if (t.id === 'f-noyear') { S.f.includeNoYear = t.checked; resetPage(); render(); }
    });
    const onYear = debounce(() => {
      const v = $('#f-year', filtersEl).value.trim();
      const y = /^\d{4}$/.test(v) ? Number(v) : null;
      if (y !== S.f.year) { S.f.year = y; resetPage(); render(); } else $('#results').classList.remove('is-pending');
    }, 250);
    $('#f-year', filtersEl).addEventListener('input', () => { markPending(); onYear(); });
    const onText = debounce(() => { S.f.text = $('#f-text', filtersEl).value; resetPage(); render(); }, 220);
    $('#f-text', filtersEl).addEventListener('input', () => { markPending(); onText(); });
    $('#f-clear', filtersEl).addEventListener('click', clearFilters);

    // Acciones dentro de resultados, resumen y catálogo
    document.addEventListener('click', (e) => {
      const part = e.target.closest('[data-part]');
      if (part) { e.preventDefault(); goPart(part.dataset.part); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) { e.preventDefault(); copyText(cp.dataset.copy); return; }
      const set = e.target.closest('[data-set]');
      if (set) {
        e.preventDefault();
        for (const p of set.dataset.set.split('&')) { const [k, v] = p.split('='); S.f[k] = decodeURIComponent(v); }
        applyStateToInputs(); resetPage(); render();
        if (S.mode === 'part') $('#part-refine').open = true;
        return;
      }
      const unset = e.target.closest('[data-unset]');
      if (unset) {
        e.preventDefault();
        const k = unset.dataset.unset;
        if (k === 'year') S.f.year = null; else if (k === 'text') S.f.text = ''; else S.f[k] = '';
        applyStateToInputs(); resetPage(); render();
        return;
      }
      const act = e.target.closest('[data-action]');
      if (act && act.dataset.action === 'clear-filters') { e.preventDefault(); clearFilters(); return; }
      const pq = e.target.closest('[data-pubq]');
      if (pq) {
        e.preventDefault();
        S.mode = 'pub'; S.pubQ = pq.dataset.pubq; applyStateToInputs(); resetPage(); render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    $('#more').addEventListener('click', () => { S.shown += CFG.PAGE_SIZE; render(); });
    $('#refresh').addEventListener('click', () => refresh(true));
    $('#banner-retry').addEventListener('click', () => refresh(true));
    window.addEventListener('hashchange', () => { if (readHash()) { applyStateToInputs(); render(); } });
  }

  function syncClear(id) {
    const btn = $('[data-clear="' + id + '"]');
    if (btn) btn.hidden = !$('#' + id).value;
  }

  function resetPage() { S.shown = CFG.PAGE_SIZE; }

  function clearFilters() {
    const had = Core.activeFilterCount(S.f) || S.f.includeNoYear;
    S.f = Core.emptyFilters();
    applyStateToInputs(); resetPage(); render();
    if (had) toast('Filtros limpiados');
  }

  function setMode(mode) {
    if (S.mode === mode) return;
    S.mode = mode; resetPage(); applyStateToInputs(); render();
    const inp = mode === 'pub' ? $('#q-pub') : mode === 'part' ? $('#q-part') : null;
    if (inp && window.matchMedia('(min-width: 760px)').matches) inp.focus();
  }

  function goPart(code) {
    S.mode = 'part'; S.partQ = code; resetPage(); applyStateToInputs(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Lleva el estado a los controles (método activo, textos y filtros). */
  function applyStateToInputs() {
    $$('.mode').forEach((b) => {
      const on = b.dataset.mode === S.mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('#panel-pub').hidden = S.mode !== 'pub';
    $('#panel-veh').hidden = S.mode !== 'veh';
    $('#panel-part').hidden = S.mode !== 'part';
    if ($('#q-pub').value !== S.pubQ) $('#q-pub').value = S.pubQ;
    if ($('#q-part').value !== S.partQ) $('#q-part').value = S.partQ;
    syncClear('q-pub'); syncClear('q-part');

    const slot = $('[data-slot="' + (S.mode === 'part' ? 'part' : 'veh') + '"]');
    if (filtersEl.parentNode !== slot) slot.appendChild(filtersEl);
    const yv = $('#f-year', filtersEl);
    if (S.f.year && yv.value !== String(S.f.year)) yv.value = S.f.year;
    if (!S.f.year && /^\d{4}$/.test(yv.value)) yv.value = ''; // un año a medio escribir se respeta
    if ($('#f-text', filtersEl).value !== S.f.text) $('#f-text', filtersEl).value = S.f.text;
    $('#f-noyear', filtersEl).checked = !!S.f.includeNoYear;
    if (S.mode === 'part' && Core.activeFilterCount(S.f)) $('#part-refine').open = true;
  }

  /* ================================================================== */
  /* Estado en la URL (para compartir una búsqueda por enlace)           */
  /* ================================================================== */

  const HASH_KEYS = { trans: 'tr', clas: 'cl', marca: 'ma', modelo: 'mo', motor: 'mt', marcaAc: 'mac', espAc: 'esp' };

  function writeHash() {
    const p = new URLSearchParams();
    p.set('m', S.mode);
    if (S.mode === 'pub' && S.pubQ.trim()) p.set('q', S.pubQ.trim());
    if (S.mode === 'part' && S.partQ.trim()) p.set('q', S.partQ.trim());
    if (S.mode !== 'pub') {
      for (const k in HASH_KEYS) if (S.f[k]) p.set(HASH_KEYS[k], S.f[k]);
      if (S.f.year) p.set('y', S.f.year);
      if (S.f.text.trim()) p.set('t', S.f.text.trim());
      if (S.f.includeNoYear) p.set('ny', '1');
    }
    const h = '#' + p.toString();
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    if (!location.hash || location.hash.length < 3) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const m = p.get('m');
    if (!MODES.includes(m)) return false;
    S.mode = m;
    const q = p.get('q') || '';
    if (m === 'pub') S.pubQ = q; else if (m === 'part') S.partQ = q;
    const f = Core.emptyFilters();
    for (const k in HASH_KEYS) f[k] = p.get(HASH_KEYS[k]) || '';
    const y = Number(p.get('y')); f.year = y >= 1900 && y <= 2100 ? y : null;
    f.text = p.get('t') || ''; f.includeNoYear = p.get('ny') === '1';
    S.f = f;
    return true;
  }

  /* ================================================================== */
  /* Elementos que dependen de los datos                                 */
  /* ================================================================== */

  function buildStaticFromModel() {
    const M = S.model;
    $('#part-list').innerHTML = M.partCatalog.map((p) => '<option value="' + esc(p.code) + '">' + esc(p.family) + ' · ' + p.recs.length + ' publ.</option>').join('');
    const byFam = new Map();
    for (const p of M.partCatalog) { if (!byFam.has(p.family)) byFam.set(p.family, []); byFam.get(p.family).push(p); }
    $('#part-catalog-body').innerHTML = [...byFam.entries()].map(([fam, list]) =>
      '<div class="cat-row"><span class="cat-fam">' + esc(fam) + '</span><div class="cat-codes">' +
      list.map((p) => '<button type="button" class="chip" data-part="' + esc(p.code) + '" aria-label="Buscar ' + esc(p.code) + ', ' + p.recs.length + ' publicaciones">' +
        '<span class="chip-code">' + esc(p.code) + '</span><small>' + p.recs.length + '</small></button>').join('') +
      '</div></div>').join('');
    const yb = Core.yearBounds(M);
    const yi = $('#f-year', filtersEl);
    yi.min = yb.min; yi.max = yb.max; yi.placeholder = 'Ej. 2014';
    $('#hint-year', filtersEl).textContent = 'Se compara con el rango de años de cada publicación. Hay datos de ' + yb.min + ' a ' + Core.CURRENT_YEAR + '.';
    const src = M.table && M.table.sheet ? 'Pestaña "' + M.table.sheet + '"' : 'Hoja del recetario';
    $('#foot-note').textContent = src + (M.table && M.table.headerRow ? ', encabezados en la fila ' + M.table.headerRow : '') +
      '. ' + intFmt.format(M.records.length) + ' registros y ' + M.partCatalog.length + ' números de parte distintos.';
  }

  function updateFilterOptions(baseRecs) {
    const M = S.model;
    for (const fc of Core.FACETS) {
      const sel = $('select[data-field="' + fc.key + '"]', filtersEl);
      const opts = Core.facetOptions(M, baseRecs, S.f, fc.key);
      // Si el valor elegido ya no existe en los datos, se conserva (con 0) para no perder el filtro.
      sel.innerHTML = '<option value="">Todos</option>' + opts.map((o) =>
        '<option value="' + esc(o.key) + '"' + (o.key === S.f[fc.key] ? ' selected' : '') + '>' +
        esc(o.label) + ' (' + o.count + ')</option>').join('');
      sel.disabled = opts.length === 0;
      sel.closest('.f').classList.toggle('active', !!S.f[fc.key]);
    }
    $('#f-year', filtersEl).closest('.f').classList.toggle('active', !!S.f.year);
    $('#f-text', filtersEl).closest('.f').classList.toggle('active', !!S.f.text.trim());

    const n = Core.activeFilterCount(S.f);
    $('#f-active', filtersEl).textContent = n ? plural(n, 'filtro activo', 'filtros activos') : 'Sin filtros activos';
    $('#f-clear', filtersEl).disabled = !n && !S.f.includeNoYear;
    const badge = $('#part-refine-count');
    badge.hidden = !n;
    badge.textContent = n ? plural(n, 'filtro activo', 'filtros activos') : '';
  }

  /* ================================================================== */
  /* Render principal                                                    */
  /* ================================================================== */

  function render() {
    writeHash();
    const res = $('#results');
    res.classList.remove('is-pending');
    if (!S.model) return;
    const out = { summary: '', groups: [], hits: new Set(), empty: '' };
    if (S.mode === 'pub') renderPub(out);
    else if (S.mode === 'veh') renderVeh(out);
    else renderPart(out);

    $('#summary').innerHTML = out.summary;
    const visible = out.groups.slice(0, S.shown);
    res.innerHTML = out.empty || visible.map((g) => groupHTML(g, out.hits)).join('');
    const more = $('#more');
    more.hidden = out.groups.length <= S.shown;
    more.textContent = 'Mostrar más (' + intFmt.format(out.groups.length - visible.length) + ' restantes)';
  }

  function plural(n, s, p) { return intFmt.format(n) + ' ' + (n === 1 ? s : p); }

  function countHead(groups, recs, extra) {
    const rows = recs.length;
    return '<div class="sum-head"><span class="sum-count">' + plural(groups.length, 'publicación', 'publicaciones') + '</span>' +
      (rows !== groups.length ? '<span class="sum-sub">' + plural(rows, 'fila', 'filas') + ' de la hoja, incluye variantes</span>' : '') +
      (extra || '') + '</div>';
  }

  function emptyBox(ico, title, body, action) {
    return '<div class="empty"><span class="empty-ico">' + icon(ico) + '</span>' +
      '<div class="empty-title">' + esc(title) + '</div>' + (body ? '<p>' + body + '</p>' : '') + (action || '') + '</div>';
  }
  function noteHTML(html) { return '<div class="note">' + icon('alert') + '<span>' + html + '</span></div>'; }

  function skeletonHTML() {
    const one = '<div class="skeleton" aria-hidden="true"><div class="sk-line"></div><div class="sk-line w40"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div>';
    return '<span class="sr-only">Cargando datos de la hoja…</span>' + one + one + one;
  }

  /** Chips de filtros activos; cada uno quita su filtro. */
  function activeFiltersHTML(label) {
    const items = [];
    for (const fc of Core.FACETS) {
      const k = S.f[fc.key];
      if (!k) continue;
      items.push({ key: fc.key, name: FACET_LABEL[fc.key], value: S.model.labels[fc.key].get(k) || k });
    }
    if (S.f.year) items.push({ key: 'year', name: 'Año', value: S.f.year });
    if (S.f.text.trim()) items.push({ key: 'text', name: 'Palabras', value: '“' + S.f.text.trim() + '”' });
    if (!items.length) return '';
    return '<div class="active-filters"><span class="active-filters-label">' + icon('filter') + esc(label) + '</span>' +
      items.map((it) => '<button type="button" class="fchip" data-unset="' + it.key + '" aria-label="Quitar filtro ' + esc(it.name) + ': ' + esc(it.value) + '">' +
        '<b>' + esc(it.name) + ':</b> ' + esc(it.value) + icon('x', '') + '</button>').join('') +
      (items.length > 1 ? '<button type="button" class="link-btn" data-action="clear-filters">Quitar todos</button>' : '') + '</div>';
  }

  const clearFiltersBtn = '<button type="button" class="btn btn-sm" data-action="clear-filters">' + icon('x') + '<span>Limpiar filtros</span></button>';

  /* --- A. Por publicación --- */
  function renderPub(out) {
    const q = S.pubQ.trim();
    if (!q) {
      out.empty = emptyBox('tag', 'Escribe un ID o pega un enlace', 'Funciona con el número (748972582), el código con prefijo (MLM748972582) o el enlace completo de la publicación.');
      return;
    }
    const r = Core.searchPub(S.model, q);
    if (r.exact.length) {
      out.groups = Core.groupRecords(r.exact, S.model);
      let s = countHead(out.groups, r.exact);
      if (r.exact.length > 1) {
        s += noteHTML('Este número aparece en ' + r.exact.length + ' filas de la hoja (' + r.exact.map((x) => x.row).join(', ') +
          '). Se muestran todas como variantes; si no lo son, conviene corregir la hoja.');
      }
      out.summary = s;
      return;
    }
    if (r.partial.length) {
      out.groups = Core.groupRecords(r.partial, S.model);
      out.summary = '<div class="sum-head"><span class="sum-count">Sin coincidencia exacta</span>' +
        '<span class="sum-sub">' + plural(out.groups.length, 'publicación contiene', 'publicaciones contienen') + ' “' + esc(q) + '”</span></div>';
      return;
    }
    out.empty = emptyBox('search', 'No se encontró “' + q + '”',
      'Revisa el número. Si la publicación es nueva, quizá aún no está capturada en el recetario.');
  }

  /* --- B. Por vehículo --- */
  function renderVeh(out) {
    const all = S.model.records;
    updateFilterOptions(all);
    const recs = Core.applyFilters(all, S.f);
    out.groups = Core.groupRecords(recs, S.model);
    const n = Core.activeFilterCount(S.f);
    let s = countHead(out.groups, recs, n ? '' : '<span class="sum-sub">Sin filtros: se muestra todo el recetario</span>');
    s += activeFiltersHTML('Filtrado por');
    s += noYearNote(all);
    if (recs.length) s += breakdownHTML(recs);
    out.summary = s;
    if (!recs.length) {
      out.empty = emptyBox('car', 'Ninguna publicación cumple todos los filtros', 'Quita uno de los filtros marcados para ampliar la búsqueda.', clearFiltersBtn);
    }
  }

  function noYearNote(base) {
    const ex = Core.countNoYearExcluded(base, S.f);
    if (!ex) return '';
    return noteHTML(plural(ex, 'publicación no tiene', 'publicaciones no tienen') +
      ' años registrados (por ejemplo, aceites) y no aparece' + (ex === 1 ? '' : 'n') + ' al filtrar por año. ' +
      'Marca “Incluir publicaciones sin años registrados” para verlas.');
  }

  /* --- C. Por número de parte --- */
  function renderPart(out) {
    const q = S.partQ.trim();
    const all = S.model.records;
    // El catálogo se abre solo cuando no hay búsqueda y se cierra al elegir un código.
    if (S.lastPartQ === undefined || !!S.lastPartQ !== !!q) $('#part-catalog').open = !q;
    S.lastPartQ = q;
    if (!q) {
      updateFilterOptions(all);
      out.empty = emptyBox('part', 'Escribe o elige un número de parte', 'La búsqueda es exacta: OMF-003 no trae códigos parecidos como OMF-0031.');
      return;
    }
    const r = Core.searchPart(S.model, q);
    if (r.missing.length) {
      updateFilterOptions(all);
      const sug = r.suggestions.length
        ? '<p>¿Buscabas alguno de estos?</p><div class="chips">' +
          r.suggestions.map((c) => '<button type="button" class="chip" data-part="' + esc(c) + '"><span class="chip-code">' + esc(c) + '</span></button>').join('') + '</div>'
        : '';
      out.empty = emptyBox('search', (r.missing.length > 1 ? 'No existen ' : 'No existe ') + r.missing.join(', ') + ' en el recetario',
        r.suggestions.length ? '' : 'Revisa el código o elígelo en el catálogo.', sug);
      return;
    }
    r.codes.forEach((c) => out.hits.add(c));
    updateFilterOptions(r.recs);
    const recs = Core.applyFilters(r.recs, S.f);
    out.groups = Core.groupRecords(recs, S.model);
    const totalGroups = Core.groupRecords(r.recs, S.model).length;
    const nf = Core.activeFilterCount(S.f);

    let s = '<div class="sum-head">' + r.codes.map((c) =>
      '<span class="sum-query">' + esc(c) + '</span><span class="sum-family">' + esc(S.model.partIndex.get(c).family) + '</span>').join('<span class="sum-sub">+</span>') + '</div>';
    s += '<div class="sum-block">' + countHead(out.groups, recs,
      nf ? '<span class="sum-sub">de ' + plural(totalGroups, 'publicación', 'publicaciones') + ' con ' + (r.codes.length > 1 ? 'estas piezas' : 'esta pieza') + '</span>'
        : (r.codes.length > 1 ? '<span class="sum-sub">contienen todas las piezas indicadas</span>' : '')) + '</div>';
    s += activeFiltersHTML('Limitado a');
    s += noYearNote(r.recs);
    if (recs.length) s += breakdownHTML(recs);
    out.summary = s;
    if (!recs.length) {
      out.empty = emptyBox('filter', 'Ninguna publicación con esta pieza cumple los filtros de vehículo',
        'La pieza sí existe en ' + plural(totalGroups, 'publicación', 'publicaciones') + '. Quita algún filtro para verlas.', clearFiltersBtn);
    }
  }

  /** Conteo por clasificación y por vehículo; cada chip aplica ese filtro. */
  function breakdownHTML(recs) {
    const sm = Core.summarize(recs);
    let s = '';
    if (sm.byClas.length > 1 && !S.f.clas) {
      s += '<div class="breakdown"><span class="breakdown-label">Clasificación</span>' +
        sm.byClas.map((c) => '<button type="button" class="chip chip-text" data-set="clas=' + encodeURIComponent(c.key) + '" title="Filtrar por ' + esc(c.label) + '">' +
          esc(c.label) + ' <small>' + c.count + '</small></button>').join('') + '</div>';
    }
    if (sm.byVeh.length > 1 && !S.f.modelo) {
      const top = sm.byVeh.slice(0, 14);
      s += '<div class="breakdown"><span class="breakdown-label">Vehículos</span>' +
        top.map((v) => '<button type="button" class="chip chip-text" data-set="marca=' + encodeURIComponent(v.marca) + '&modelo=' + encodeURIComponent(v.modelo) + '" title="Filtrar por ' + esc(v.label) + '">' +
          esc(v.label) + ' <small>' + v.count + '</small></button>').join('') +
        (sm.byVeh.length > top.length ? '<span class="sum-sub">y ' + (sm.byVeh.length - top.length) + ' más</span>' : '') + '</div>';
    }
    return s;
  }

  /* ================================================================== */
  /* Tarjeta de publicación                                              */
  /* ================================================================== */

  function pubHTML(p) {
    const id = esc(p.display);
    let html = '<span class="pub"><span class="pub-ch">' + esc(p.label) + '</span><span class="pub-id">' + id + '</span>' +
      '<button type="button" class="icon-btn" data-copy="' + id + '" aria-label="Copiar ' + id + '">' + icon('copy', '') + 'Copiar</button>';
    if (p.url) html += '<a class="icon-btn" href="' + esc(p.url) + '" target="_blank" rel="noopener" aria-label="Abrir ' + id + ' en ' + esc(p.label) + '">' + icon('open', '') + 'Abrir</a>';
    if (p.ch === 'ml' && !/^\d{6,}$/.test(p.key)) html += '<span class="pub-tag" title="La columna de Mercado Libre tiene un código interno en lugar del número de publicación">Referencia interna, no es ID de ML</span>';
    if (p.completa === true) html += '<span class="pub-ok">' + icon('check', '') + 'Completa</span>';
    return html + '</span>';
  }

  function spec(label, value) {
    const v = value === null || value === undefined || value === '' ? null : value;
    return '<div><dt>' + esc(label) + '</dt><dd' + (v ? '' : ' class="na"') + '>' + (v ? esc(v) : 'Sin dato') + '</dd></div>';
  }

  function partsHTML(rec, hits) {
    const body = rec.parts.length
      ? '<div class="chips">' + rec.parts.map((p) => {
        const q = p.qty === null ? '<small>sin cant.</small>' : '<small>×' + esc(String(p.qty)) + '</small>';
        const isHit = hits.has(p.code);
        return '<button type="button" class="chip' + (isHit ? ' hit' : '') + (p.qty === null ? ' missing-qty' : '') +
          '" data-part="' + esc(p.code) + '" title="' + esc(p.family) + ', columna ' + esc(p.col) + '. Ver todas las publicaciones con esta pieza"' +
          (isHit ? ' aria-current="true"' : '') + '>' +
          '<span class="chip-code">' + esc(p.code) + '</span>' + q + '</button>';
      }).join('') + '</div>'
      : '<span class="v-meta">Sin números de parte registrados</span>';
    return '<div class="v-parts"><span class="v-parts-label">Números de parte</span>' + body + '</div>';
  }

  /** Una variante = una fila de la hoja. `ids` se muestra aquí cuando la publicación tiene una sola variante. */
  function variantHTML(v, hits, ids) {
    const r = v.rec;
    const aceite = [r.marcaAc, r.espAc].filter(Boolean).join(' ');
    const years = Core.yearsLabel(r);
    const idOm = r.idOmova && !/no listada/i.test(r.idOmova) ? r.idOmova : '';
    const issues = [];
    if (r.parts.some((p) => p.qty === null)) issues.push('pieza sin cantidad en la hoja');
    const recetaIssue = S.model.issues.recetaDiff.find((x) => x.row === r.row);
    if (recetaIssue && recetaIssue.omitted.length) issues.push('la columna RECETA omite ' + recetaIssue.omitted.join(', '));
    const vehName = [r.marca, r.modelo].filter(Boolean).join(' ') || 'Vehículo sin registrar';
    const yearsTxt = years || (r.clas === 'ACEITE' ? 'Años: no aplica o sin registrar' : 'Años sin registrar');

    return '<div class="variant">' +
      '<div class="v-head"><h3 class="v-title">' + esc(r.desc || '(sin descripción)') + '</h3>' +
        (r.precio !== null ? '<div class="v-price">' + money.format(r.precio) + '</div>' : '<div class="v-price v-price-na">Sin precio</div>') + '</div>' +
      '<div class="v-ids">' + (ids || '') + (r.clas ? '<span class="badge" title="Clasificación del producto">' + esc(r.clas) + '</span>' : '') + '</div>' +
      '<div class="v-compat">' +
        '<div class="veh"><span class="veh-name">' + esc(vehName) + '</span><span class="veh-years' + (years ? '' : ' na') + '">' + esc(yearsTxt) + '</span></div>' +
        '<dl class="specs">' +
          spec('Motor', r.motor) + spec('Transmisión', r.trans) + spec('Aceite', aceite) +
          (r.cil ? spec('Cilindros', r.cil) : '') + (r.conf ? spec('Configuración del motor', r.conf) : '') +
          (idOm ? spec('ID Omova', idOm) : '') +
        '</dl>' +
      '</div>' +
      partsHTML(r, hits) +
      '<div class="v-meta">Fila ' + r.row + ' de la hoja' +
        (v.dupRows.length ? '. <span class="warn">Idéntica a la fila ' + v.dupRows.join(', ') + '</span>' : '') +
        (issues.length ? '. <span class="warn">Revisar: ' + esc(issues.join('; ')) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function groupHTML(g, hits) {
    const ids = g.pubs.length ? g.pubs.map(pubHTML).join('') : '<span class="pub-tag">Sin número de publicación</span>';
    let note = '';
    if (g.variants.length > 1) note = g.variants.length + ' variantes de esta publicación';
    if (g.totalRows > g.matchedRows) {
      note = 'Coincide' + (g.matchedRows === 1 ? '' : 'n') + ' ' + g.matchedRows + ' de ' + g.totalRows + ' variantes. ' +
        '<button type="button" class="link-btn" data-pubq="' + esc(g.pubs[0].key) + '">Ver la publicación completa</button>';
    }
    // Una sola variante: el ID va debajo del nombre del producto. Varias: arriba, una vez para todas.
    if (g.variants.length === 1 && !note) {
      return '<article class="card">' + variantHTML(g.variants[0], hits, ids) + '</article>';
    }
    return '<article class="card"><div class="card-strip">' + ids + '<span class="card-strip-note">' + note + '</span></div>' +
      g.variants.map((v) => variantHTML(v, hits, '')).join('') + '</article>';
  }

  /* ================================================================== */
  /* Calidad de datos                                                    */
  /* ================================================================== */

  function renderQuality() {
    const I = S.model.issues;
    const sec = [];
    const list = (items, max) => '<ul>' + items.slice(0, max || 12).map((x) => '<li>' + x + '</li>').join('') +
      (items.length > (max || 12) ? '<li>… y ' + (items.length - (max || 12)) + ' más</li>' : '') + '</ul>';

    if (I.dupPub.length) sec.push('<h4>Números de publicación repetidos (' + I.dupPub.length + ')</h4><p>Pueden ser variantes reales de una misma publicación o errores de captura.</p>' +
      list(I.dupPub.map((d) => '<b>' + esc(d.display) + '</b> en filas ' + d.rows.join(', ') + ': ' + d.descs.map(esc).join(' | '))));
    if (I.recetaDiff.length) sec.push('<h4>La columna RECETA no coincide con las columnas de números de parte (' + I.recetaDiff.length + ')</h4><p>La fórmula de RECETA omite las piezas sin cantidad. El buscador usa las columnas de piezas directamente.</p>' +
      list(I.recetaDiff.map((d) => 'Fila ' + d.row + (d.omitted.length ? ': omite ' + esc(d.omitted.join(', ')) : ''))));
    if (I.noQty.length) sec.push('<h4>Piezas sin cantidad (' + I.noQty.length + ')</h4>' +
      list(I.noQty.map((d) => 'Fila ' + d.row + ', columna ' + d.col + ': ' + esc(d.value))));
    if (I.qtyMismatch.length) sec.push('<h4>Cantidades que no cuadran con los códigos (' + I.qtyMismatch.length + ')</h4>' +
      list(I.qtyMismatch.map((d) => 'Fila ' + d.row + ', columna ' + d.col + ': ' + esc(d.value) + ' / cantidad ' + esc(d.qty))));
    if (I.mlNotId.length) sec.push('<h4>Columna de Mercado Libre con códigos internos en lugar de número de publicación (' + I.mlNotId.length + ')</h4><p>Se pueden buscar por ese código, pero no tienen enlace a Mercado Libre.</p>' +
      list(I.mlNotId.map((d) => 'Fila ' + d.row + ': ' + esc(d.value)), 8));
    if (I.hiddenSpace.length) sec.push('<h4>Números de publicación con espacios ocultos (' + I.hiddenSpace.length + ')</h4><p>El buscador los limpia, pero conviene corregirlos en la hoja.</p>' +
      list(I.hiddenSpace.map((r) => 'Fila ' + r)));
    if (I.facetVariants.length) sec.push('<h4>Mismo valor escrito de varias formas</h4><p>El buscador los agrupa en una sola opción del filtro.</p>' +
      list(I.facetVariants.map((v) => esc(v.field) + ': ' + v.variants.map(([l, n]) => '“' + esc(l) + '” (' + n + ')').join(', '))));
    if (I.noYears.length) sec.push('<h4>Registros sin años (' + I.noYears.length + ')</h4><p>Normal en aceites; no aparecen al filtrar por año salvo que se marque la opción.</p>');
    if (I.blankHeader.length) sec.push('<h4>Columnas de piezas sin encabezado</h4>' + list(I.blankHeader.map((l) => 'Columna ' + l)));
    if (I.noParts.length) sec.push('<h4>Publicaciones sin números de parte (' + I.noParts.length + ')</h4>' + list(I.noParts.map((r) => 'Fila ' + r)));

    $('#quality').hidden = !sec.length;
    $('#quality-count').textContent = plural(sec.length, 'aviso', 'avisos');
    $('#quality-body').innerHTML = sec.join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
