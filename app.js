/*
 * app.js — Interfaz del Buscador AFINAZONE.
 * Carga los datos una sola vez (con copia en el navegador) y resuelve todas
 * las búsquedas en memoria con la lógica de core.js.
 */
(function () {
  'use strict';

  const CFG = Object.assign({ DATA_URL: '', REFRESH_MINUTES: 30, TIMEOUT_SECONDS: 25, PAGE_SIZE: 30 }, window.APP_CONFIG || {});
  const Core = window.Core;
  const CACHE_KEY = 'afz-buscador:v1:' + (CFG.DATA_URL || 'embebido');
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const intFmt = new Intl.NumberFormat('es-MX');

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
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    if (window.EMBEDDED_DATA) { if (manual) toast('Versión de demostración: datos fijos.'); return; }
    if (!CFG.DATA_URL) return;
    if (S.fetching) return;
    S.fetching = true;
    setStatus();
    try {
      const text = await download();
      const model = modelFrom(text); // valida antes de guardar
      writeCache(text);
      S.lastFetch = Date.now();
      hideBanner();
      setModel(model, new Date());
      if (manual) toast('Datos actualizados');
    } catch (e) {
      const hasData = !!S.model;
      const msg = e.code === 'STRUCTURE'
        ? e.message + ' Revisa los encabezados de la fila de títulos en la hoja.'
        : e.message;
      showBanner(hasData
        ? 'No se pudieron descargar datos nuevos: ' + msg + ' Se muestran los últimos datos guardados (' + fmtDate(S.loadedAt) + ').'
        : 'No se pudieron cargar los datos. ' + msg, hasData ? 'warn' : 'error');
      if (!hasData) $('#results').innerHTML = '';
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
      catch (e) { showBanner('Error en los datos de demostración: ' + e.message, 'error'); }
      setStatus();
      return;
    }
    if (!CFG.DATA_URL) {
      showBanner('Falta configurar la fuente de datos: escribe la URL del Apps Script en DATA_URL dentro de config.js (ver README).', 'error');
      setStatus('Sin fuente de datos');
      return;
    }
    const cached = readCache();
    if (cached) {
      try { setModel(modelFrom(cached.text), new Date(cached.savedAt)); } catch (e) { /* copia dañada: se ignora */ }
    } else {
      $('#results').innerHTML = '<div class="loading">Cargando datos de la hoja…</div>';
    }
    await refresh(false);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - S.lastFetch > CFG.REFRESH_MINUTES * 60000) refresh(false);
    });
  }

  /* ================================================================== */
  /* Interfaz: estado general                                            */
  /* ================================================================== */

  function fmtDate(d) {
    if (!d) return '';
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function setStatus(text) {
    const el = $('#status');
    if (text) { el.textContent = text; return; }
    if (!S.model) { el.textContent = S.fetching ? 'Cargando datos…' : 'Sin datos'; return; }
    el.textContent = intFmt.format(S.model.records.length) + ' registros · ' + fmtDate(S.loadedAt) + (S.fetching ? ' · actualizando…' : '');
  }
  function showBanner(msg, kind) { const b = $('#banner'); b.textContent = msg; b.className = 'banner ' + (kind || 'warn'); b.hidden = false; }
  function hideBanner() { $('#banner').hidden = true; }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 1800);
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

  function bindUI() {
    // Pestañas
    $$('.tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const modes = ['pub', 'veh', 'part'];
      const i = (modes.indexOf(S.mode) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
      setMode(modes[i]); $('#tab-btn-' + modes[i]).focus();
    });

    // Búsquedas de texto
    const onPub = debounce(() => { S.pubQ = $('#q-pub').value; S.shown = CFG.PAGE_SIZE; render(); }, 180);
    $('#q-pub').addEventListener('input', onPub);
    const onPart = debounce(() => { S.partQ = $('#q-part').value; S.shown = CFG.PAGE_SIZE; render(); }, 180);
    $('#q-part').addEventListener('input', onPart);
    $$('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      const inp = $('#' + b.dataset.clear); inp.value = ''; inp.dispatchEvent(new Event('input')); inp.focus();
    }));

    // Filtros (una sola copia que se mueve entre pestañas)
    filtersEl = $('#filters-template').content.firstElementChild.cloneNode(true);
    const selWrap = $('.f-selects', filtersEl);
    for (const fc of Core.FACETS) {
      const lab = document.createElement('label');
      lab.className = 'f'; lab.dataset.field = fc.key;
      lab.innerHTML = '<span>' + esc(fc.label) + '</span><select data-field="' + fc.key + '"><option value="">Todos</option></select>';
      selWrap.appendChild(lab);
    }
    filtersEl.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('select[data-field]')) { S.f[t.dataset.field] = t.value; resetPage(); render(); }
      if (t.id === 'f-noyear') { S.f.includeNoYear = t.checked; resetPage(); render(); }
    });
    const onYear = debounce(() => {
      const v = $('#f-year', filtersEl).value.trim();
      const y = /^\d{4}$/.test(v) ? Number(v) : null;
      if (y !== S.f.year) { S.f.year = y; resetPage(); render(); }
    }, 250);
    $('#f-year', filtersEl).addEventListener('input', onYear);
    const onText = debounce(() => { S.f.text = $('#f-text', filtersEl).value; resetPage(); render(); }, 220);
    $('#f-text', filtersEl).addEventListener('input', onText);
    $('#f-clear', filtersEl).addEventListener('click', () => {
      S.f = Core.emptyFilters(); applyStateToInputs(); resetPage(); render();
    });

    // Acciones dentro de resultados y resumen
    document.addEventListener('click', (e) => {
      const part = e.target.closest('[data-part]');
      if (part) { e.preventDefault(); goPart(part.dataset.part); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) { e.preventDefault(); copyText(cp.dataset.copy); return; }
      const sf = e.target.closest('[data-set]');
      if (sf) {
        e.preventDefault();
        const pairs = sf.dataset.set.split('&');
        for (const p of pairs) { const [k, v] = p.split('='); S.f[k] = decodeURIComponent(v); }
        applyStateToInputs(); resetPage(); render();
        if (S.mode === 'part') $('#part-refine').open = true;
        return;
      }
      const pq = e.target.closest('[data-pubq]');
      if (pq) { e.preventDefault(); S.mode = 'pub'; S.pubQ = pq.dataset.pubq; applyStateToInputs(); resetPage(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    $('#more').addEventListener('click', () => { S.shown += CFG.PAGE_SIZE; render(); });
    $('#refresh').addEventListener('click', () => refresh(true));
    window.addEventListener('hashchange', () => { if (readHash()) { applyStateToInputs(); render(); } });
  }

  function resetPage() { S.shown = CFG.PAGE_SIZE; }

  function setMode(mode) {
    if (S.mode === mode) return;
    S.mode = mode; resetPage(); applyStateToInputs(); render();
    const inp = mode === 'pub' ? $('#q-pub') : mode === 'part' ? $('#q-part') : null;
    if (inp && window.matchMedia('(min-width: 700px)').matches) inp.focus();
  }

  function goPart(code) {
    S.mode = 'part'; S.partQ = code; resetPage(); applyStateToInputs(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Lleva el estado a los controles (pestaña activa, textos, filtros). */
  function applyStateToInputs() {
    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === S.mode)));
    $('#panel-pub').hidden = S.mode !== 'pub';
    $('#panel-veh').hidden = S.mode !== 'veh';
    $('#panel-part').hidden = S.mode !== 'part';
    if ($('#q-pub').value !== S.pubQ) $('#q-pub').value = S.pubQ;
    if ($('#q-part').value !== S.partQ) $('#q-part').value = S.partQ;

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
  /* Estado en la URL (para compartir una búsqueda por liga)            */
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
    if (!['pub', 'veh', 'part'].includes(m)) return false;
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
      '<div class="cat-row"><span class="cat-fam">' + esc(fam) + '</span>' +
      list.map((p) => '<button type="button" class="chip" data-part="' + esc(p.code) + '">' + esc(p.code) + ' <small>' + p.recs.length + '</small></button>').join(' ') +
      '</div>').join('');
    const yb = Core.yearBounds(M);
    const yi = $('#f-year', filtersEl);
    yi.min = yb.min; yi.max = yb.max; yi.placeholder = 'Ej. 2014 (' + yb.min + '–' + Core.CURRENT_YEAR + ')';
    const src = M.table && M.table.sheet ? 'Pestaña "' + M.table.sheet + '"' : 'Hoja del recetario';
    $('#foot-note').textContent = src + (M.table && M.table.headerRow ? ', encabezados en la fila ' + M.table.headerRow : '') +
      ' · ' + intFmt.format(M.records.length) + ' registros · ' + M.partCatalog.length + ' números de parte distintos.';
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
    const pill = $('#part-refine-count'); pill.hidden = !n; pill.textContent = n;
  }

  /* ================================================================== */
  /* Render principal                                                    */
  /* ================================================================== */

  function render() {
    writeHash();
    if (!S.model) return;
    const out = { summary: '', groups: [], hits: new Set(), empty: '' };
    if (S.mode === 'pub') renderPub(out);
    else if (S.mode === 'veh') renderVeh(out);
    else renderPart(out);

    $('#summary').innerHTML = out.summary;
    const groups = out.groups;
    const visible = groups.slice(0, S.shown);
    $('#results').innerHTML = out.empty || visible.map((g) => groupHTML(g, out.hits)).join('');
    const more = $('#more');
    more.hidden = groups.length <= S.shown;
    more.textContent = 'Mostrar más (' + intFmt.format(groups.length - visible.length) + ' restantes)';
  }

  function plural(n, s, p) { return intFmt.format(n) + ' ' + (n === 1 ? s : p); }

  function countLine(groups, recs) {
    const rows = recs.length;
    return '<span class="sum-count">' + plural(groups.length, 'publicación', 'publicaciones') + '</span>' +
      (rows !== groups.length ? '<span class="sum-sub">' + plural(rows, 'fila', 'filas') + ' de la hoja (incluye variantes)</span>' : '');
  }

  function emptyBox(title, body) {
    return '<div class="empty"><strong>' + esc(title) + '</strong>' + (body || '') + '</div>';
  }

  /* --- 1. Publicación --- */
  function renderPub(out) {
    const q = S.pubQ.trim();
    if (!q) {
      out.empty = emptyBox('Escribe un número de publicación', 'Puedes pegar el número, el código MLM o la liga completa de Mercado Libre.');
      return;
    }
    const r = Core.searchPub(S.model, q);
    if (r.exact.length) {
      out.groups = Core.groupRecords(r.exact, S.model);
      let s = '<div class="sum-line">' + countLine(out.groups, r.exact) + '</div>';
      if (r.exact.length > 1) {
        s += '<div class="note">Este número aparece en ' + r.exact.length + ' filas de la hoja (' + r.exact.map((x) => x.row).join(', ') +
          '). Se muestran todas como variantes; si no son variantes reales, conviene corregir la hoja.</div>';
      }
      out.summary = s;
      return;
    }
    if (r.partial.length) {
      out.groups = Core.groupRecords(r.partial, S.model);
      out.summary = '<div class="sum-line"><span class="sum-count">Sin coincidencia exacta para “' + esc(q) + '”</span>' +
        '<span class="sum-sub">' + plural(out.groups.length, 'publicación contiene', 'publicaciones contienen') + ' ese texto:</span></div>';
      return;
    }
    out.empty = emptyBox('No se encontró la publicación “' + q + '”',
      'Revisa el número. Si es una publicación nueva, puede que aún no esté capturada en el recetario.');
  }

  /* --- 2. Vehículo --- */
  function renderVeh(out) {
    const all = S.model.records;
    updateFilterOptions(all);
    const recs = Core.applyFilters(all, S.f);
    out.groups = Core.groupRecords(recs, S.model);
    const n = Core.activeFilterCount(S.f);
    let s = '<div class="sum-line">' + countLine(out.groups, recs) +
      (n ? '' : '<span class="sum-sub">Sin filtros: se muestra todo el recetario. Elige uno o varios filtros para reducir la lista.</span>') + '</div>';
    s += noYearNote(all);
    if (recs.length) s += breakdownHTML(recs);
    out.summary = s;
    if (!recs.length) out.empty = emptyBox('Ninguna publicación cumple todos los filtros', 'Quita alguno de los filtros marcados o usa “Limpiar filtros”.');
  }

  function noYearNote(base) {
    const ex = Core.countNoYearExcluded(base, S.f);
    if (!ex) return '';
    return '<div class="note">' + plural(ex, 'publicación no tiene', 'publicaciones no tienen') +
      ' años registrados (por ejemplo, aceites) y no se muestra' + (ex === 1 ? '' : 'n') + ' al filtrar por año. ' +
      'Marca “Incluir publicaciones sin años registrados” para verlas.</div>';
  }

  /* --- 3. Número de parte --- */
  function renderPart(out) {
    const q = S.partQ.trim();
    const all = S.model.records;
    // La lista de piezas se abre sola cuando no hay búsqueda y se cierra al elegir una.
    if (S.lastPartQ === undefined || !!S.lastPartQ !== !!q) $('#part-catalog').open = !q;
    S.lastPartQ = q;
    if (!q) {
      updateFilterOptions(all);
      out.empty = emptyBox('Escribe o elige un número de parte', 'La búsqueda es exacta: OMF-003 no trae OMF-0031 ni otros códigos parecidos.');
      return;
    }
    const r = Core.searchPart(S.model, q);
    if (r.missing.length) {
      updateFilterOptions(all);
      const sug = r.suggestions.length
        ? '<p>¿Quisiste decir…?</p><div class="breakdown" style="justify-content:center">' +
          r.suggestions.map((c) => '<button type="button" class="chip" data-part="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>'
        : '<p>Revisa el código o elígelo de la lista.</p>';
      out.empty = emptyBox('No existe ' + (r.missing.length > 1 ? 'los números de parte ' : 'el número de parte ') + r.missing.join(', ') + ' en el recetario', sug);
      return;
    }
    r.codes.forEach((c) => out.hits.add(c));
    updateFilterOptions(r.recs);
    const recs = Core.applyFilters(r.recs, S.f);
    out.groups = Core.groupRecords(recs, S.model);
    const totalGroups = Core.groupRecords(r.recs, S.model).length;
    const fams = r.codes.map((c) => S.model.partIndex.get(c).family);
    const nf = Core.activeFilterCount(S.f);
    let s = '<div class="sum-line"><span class="sum-count">' + r.codes.map((c, i) => esc(c) + ' <span class="sum-sub">' + esc(fams[i]) + '</span>').join(' + ') + '</span></div>';
    s += '<div class="sum-line" style="margin-top:4px">' + countLine(out.groups, recs) +
      (nf ? '<span class="sum-sub">de ' + plural(totalGroups, 'publicación', 'publicaciones') + ' con ' + (r.codes.length > 1 ? 'estas piezas' : 'esta pieza') + ' (filtros activos)</span>' : '') +
      (r.codes.length > 1 && !nf ? '<span class="sum-sub">contienen todas las piezas indicadas</span>' : '') + '</div>';
    s += noYearNote(r.recs);
    if (recs.length) s += breakdownHTML(recs);
    out.summary = s;
    if (!recs.length) out.empty = emptyBox('La pieza existe, pero ninguna de sus publicaciones cumple los filtros', 'Quita alguno de los filtros de vehículo.');
  }

  /** Conteo por clasificación y por vehículo; cada chip aplica ese filtro. */
  function breakdownHTML(recs) {
    const sm = Core.summarize(recs);
    let s = '';
    if (sm.byClas.length > 1 && !S.f.clas) {
      s += '<div class="breakdown"><span class="breakdown-label">Clasificación</span>' +
        sm.byClas.map((c) => '<button type="button" class="chip text" data-set="clas=' + encodeURIComponent(c.key) + '">' + esc(c.label) + ' <small>' + c.count + '</small></button>').join('') + '</div>';
    }
    if (sm.byVeh.length > 1 && !S.f.modelo) {
      const top = sm.byVeh.slice(0, 14);
      s += '<div class="breakdown"><span class="breakdown-label">Vehículos</span>' +
        top.map((v) => '<button type="button" class="chip text" data-set="marca=' + encodeURIComponent(v.marca) + '&modelo=' + encodeURIComponent(v.modelo) + '">' + esc(v.label) + ' <small>' + v.count + '</small></button>').join('') +
        (sm.byVeh.length > top.length ? '<span class="sum-sub">+' + (sm.byVeh.length - top.length) + ' más</span>' : '') + '</div>';
    }
    return s;
  }

  /* ================================================================== */
  /* Tarjeta de publicación                                              */
  /* ================================================================== */

  function pubHTML(p) {
    const id = esc(p.display);
    const link = p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" title="Abrir en ' + esc(p.label) + '">' + id + '</a>' : id;
    let tags = '';
    if (p.ch === 'ml' && !/^\d{6,}$/.test(p.key)) tags += '<span class="pub-tag" title="La columna de Mercado Libre tiene un código interno en lugar del número de publicación">referencia interna, no es ID de ML</span>';
    if (p.completa === true) tags += '<span class="pub-ok">✓ completa</span>';
    return '<span class="pub"><span class="pub-ch">' + esc(p.short) + '</span><span class="pub-id">' + link + '</span>' +
      '<button type="button" class="copy" data-copy="' + id + '">copiar</button>' + tags + '</span>';
  }

  function fact(label, value) {
    const v = value === null || value === undefined || value === '' ? null : value;
    return '<div><dt>' + esc(label) + '</dt><dd' + (v ? '' : ' class="na"') + '>' + (v ? esc(v) : '—') + '</dd></div>';
  }

  function partsHTML(rec, hits) {
    if (!rec.parts.length) return '<div class="parts"><span class="parts-label">Números de parte</span><span class="v-meta">Sin números de parte registrados</span></div>';
    return '<div class="parts"><span class="parts-label">Números de parte</span>' + rec.parts.map((p) => {
      const q = p.qty === null ? '<small>sin cant.</small>' : '<small>×' + esc(String(p.qty)) + '</small>';
      return '<button type="button" class="chip' + (hits.has(p.code) ? ' hit' : '') + (p.qty === null ? ' missing-qty' : '') +
        '" data-part="' + esc(p.code) + '" title="' + esc(p.family) + ' · col. ' + esc(p.col) + ' — ver todas las publicaciones con esta pieza">' +
        esc(p.code) + ' ' + q + '</button>';
    }).join('') + '</div>';
  }

  function variantHTML(v, hits) {
    const r = v.rec;
    const aceite = [r.marcaAc, r.espAc].filter(Boolean).join(' · ');
    const years = Core.yearsLabel(r);
    const id = r.idOmova && !/no listada/i.test(r.idOmova) ? r.idOmova : '';
    const issues = [];
    if (r.parts.some((p) => p.qty === null)) issues.push('pieza sin cantidad en la hoja');
    const recetaIssue = S.model.issues.recetaDiff.find((x) => x.row === r.row);
    if (recetaIssue && recetaIssue.omitted.length) issues.push('la columna RECETA omite ' + recetaIssue.omitted.join(', '));
    return '<div class="variant">' +
      '<div class="v-top"><div class="v-desc">' + (r.clas ? '<span class="badge">' + esc(r.clas) + '</span>' : '') + esc(r.desc || '(sin descripción)') + '</div>' +
      (r.precio !== null ? '<div class="v-price">' + money.format(r.precio) + '</div>' : '') + '</div>' +
      '<dl class="facts">' +
        fact('Vehículo', [r.marca, r.modelo].filter(Boolean).join(' ')) +
        fact('Años', years || (r.clas === 'ACEITE' ? 'No aplica / sin registrar' : 'Sin registrar')) +
        fact('Motor', r.motor) +
        fact('Transmisión', r.trans) +
        fact('Aceite', aceite) +
        (r.cil ? fact('Cilindros', r.cil) : '') +
        (r.conf ? fact('Config. motor', r.conf) : '') +
        (id ? fact('ID Omova', id) : '') +
      '</dl>' +
      partsHTML(r, hits) +
      '<div class="v-meta">Fila ' + r.row +
        (v.dupRows.length ? ' · <span class="warn">idéntica a fila ' + v.dupRows.join(', ') + '</span>' : '') +
        (issues.length ? ' · <span class="warn">' + esc(issues.join('; ')) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function groupHTML(g, hits) {
    const pubs = g.pubs.length ? g.pubs.map(pubHTML).join('') : '<span class="pub"><span class="pub-tag">Sin número de publicación</span></span>';
    let right = '';
    if (g.variants.length > 1) right = g.variants.length + ' variantes';
    if (g.totalRows > g.matchedRows) {
      right = 'Coincide' + (g.matchedRows === 1 ? '' : 'n') + ' ' + g.matchedRows + ' de ' + g.totalRows + ' filas · ' +
        '<a href="#" data-pubq="' + esc(g.pubs[0].key) + '">ver todas</a>';
    }
    return '<article class="card"><div class="card-head">' + pubs + (right ? '<span class="head-right">' + right + '</span>' : '') + '</div>' +
      g.variants.map((v) => variantHTML(v, hits)).join('') + '</article>';
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
      list(I.noQty.map((d) => 'Fila ' + d.row + ', col. ' + d.col + ': ' + esc(d.value))));
    if (I.qtyMismatch.length) sec.push('<h4>Cantidades que no cuadran con los códigos (' + I.qtyMismatch.length + ')</h4>' +
      list(I.qtyMismatch.map((d) => 'Fila ' + d.row + ', col. ' + d.col + ': ' + esc(d.value) + ' / cantidad ' + esc(d.qty))));
    if (I.mlNotId.length) sec.push('<h4>Columna de Mercado Libre con códigos internos en lugar de número de publicación (' + I.mlNotId.length + ')</h4><p>Se pueden buscar por ese código, pero no tienen liga a Mercado Libre.</p>' +
      list(I.mlNotId.map((d) => 'Fila ' + d.row + ': ' + esc(d.value)), 8));
    if (I.hiddenSpace.length) sec.push('<h4>Números de publicación con espacios ocultos (' + I.hiddenSpace.length + ')</h4><p>El buscador los limpia, pero conviene corregirlos en la hoja.</p>' +
      list(I.hiddenSpace.map((r) => 'Fila ' + r)));
    if (I.facetVariants.length) sec.push('<h4>Mismo valor escrito de varias formas</h4><p>El buscador los agrupa en una sola opción del filtro.</p>' +
      list(I.facetVariants.map((v) => esc(v.field) + ': ' + v.variants.map(([l, n]) => '“' + esc(l) + '” (' + n + ')').join(', '))));
    if (I.noYears.length) sec.push('<h4>Registros sin años (' + I.noYears.length + ')</h4><p>Normal en aceites; no aparecen al filtrar por año salvo que se marque la opción.</p>');
    if (I.blankHeader.length) sec.push('<h4>Columnas de piezas sin encabezado</h4>' + list(I.blankHeader.map((l) => 'Columna ' + l)));
    if (I.noParts.length) sec.push('<h4>Publicaciones sin números de parte (' + I.noParts.length + ')</h4>' + list(I.noParts.map((r) => 'Fila ' + r)));

    const q = $('#quality');
    q.hidden = !sec.length;
    $('#quality-count').textContent = sec.length;
    $('#quality-body').innerHTML = sec.join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
