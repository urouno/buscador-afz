/*
 * core.js — Lógica de datos del Buscador AFINAZONE (sin DOM).
 * Convierte la tabla del RECETARIO en registros, arma índices y resuelve
 * las tres búsquedas (publicación, vehículo y número de parte).
 * Funciona en el navegador (window.Core) y en Node (module.exports) para pruebas.
 */
(function (root) {
  'use strict';

  const CURRENT_YEAR = new Date().getFullYear();
  /** Año que se usa como tope cuando Año_Final está vacío (vehículo aún en producción). */
  const OPEN_END_YEAR = CURRENT_YEAR + 1;

  /* ------------------------------------------------------------------ */
  /* Definición de columnas (por NOMBRE de encabezado, no por letra)     */
  /* ------------------------------------------------------------------ */

  const CHANNELS = [
    { key: 'ml', label: 'Mercado Libre', short: 'ML', headers: ['#_Publicación_ML'],
      display: (id) => (/^\d{6,}$/.test(id) ? 'MLM' + id : id),
      url: (id) => (/^\d{6,}$/.test(id) ? 'https://articulo.mercadolibre.com.mx/MLM-' + id : null) },
    { key: 'amz', label: 'Amazon', short: 'AMZ', headers: ['#_ASIN_AMZ'],
      display: (id) => id,
      url: (id) => (/^[A-Z0-9]{10}$/i.test(id) ? 'https://www.amazon.com.mx/dp/' + id : null) },
    { key: 'afz', label: 'Web AFZ', short: 'AFZ', headers: ['#_UPC_Web_AFZ'],
      display: (id) => id, url: () => null },
    { key: 'ocf', label: 'Web OCF', short: 'OCF', headers: ['URL_Web_OCF'],
      display: (id) => id, url: (id) => (/^https?:\/\//i.test(id) ? id : null) },
    { key: 'dir', label: 'Venta directa', short: 'Directo', headers: ['#_Ref_Directo'],
      display: (id) => id, url: () => null },
  ];

  const FIELDS = {
    idOmova: ['ID_Omova'],
    desc: ['Descripción', 'Descripcion'],
    trans: ['Transmisión', 'Transmision'],
    clas: ['Clasificación_Producto', 'Clasificación'],
    marca: ['Marca_Auto'],
    modelo: ['Modelo_Auto'],
    y0: ['Año_Inicio', 'Anio_Inicio'],
    y1: ['Año_Final', 'Anio_Final'],
    finProd: ['Final_Producción'],
    motor: ['Motor_Litros'],
    cil: ['Cilindros'],
    conf: ['Conf_Motor'],
    marcaAc: ['Marca_Aceite'],
    espAc: ['Especificación_Aceite'],
    precio: ['Precio_lista', 'Precio_Lista'],
    receta: ['RECETA', 'Receta'],
  };

  /** Columnas sin las cuales la herramienta no puede funcionar. */
  const REQUIRED = ['desc', 'clas', 'marca', 'modelo', 'y0', 'y1'];

  /** Campos que se usan como filtros de selección (en el orden de la interfaz). */
  const FACETS = [
    { key: 'trans', label: 'Transmisión' },
    { key: 'clas', label: 'Clasificación' },
    { key: 'marca', label: 'Marca del auto' },
    { key: 'modelo', label: 'Modelo' },
    { key: 'motor', label: 'Motor (litros)' },
    { key: 'marcaAc', label: 'Marca de aceite' },
    { key: 'espAc', label: 'Especificación de aceite' },
  ];

  /* ------------------------------------------------------------------ */
  /* Normalización                                                       */
  /* ------------------------------------------------------------------ */

  function clean(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[   ​]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  /** Llave de encabezado: '#_Publicación_ML' -> 'publicacionml'. */
  function headerKey(h) {
    return stripAccents(clean(h)).toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  /** Llave de filtro: agrupa variantes de escritura ('NS3 CVT' = 'NS-3 CVT', '2.4L' = '2.4 L'). */
  function facetKey(v) {
    return stripAccents(clean(v)).toUpperCase().replace(/[\s\-_.]/g, '');
  }
  /** Llave de número de parte: mayúsculas y sin espacios. La comparación es exacta. */
  function partKey(v) {
    return clean(v).toUpperCase().replace(/\s+/g, '');
  }
  /** Llave de publicación: acepta 748972582, MLM748972582, MLM-748972582 o la liga completa. */
  function pubKey(v) {
    let s = clean(v).toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    const ml = s.match(/MLM-?(\d{5,})/);
    if (ml) return ml[1];
    const amz = s.match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/);
    if (amz) return amz[1];
    s = s.replace(/^HTTPS?:\/\//, '').replace(/^WWW\./, '').replace(/\/+$/, '');
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s;
  }
  function textKey(v) {
    return stripAccents(clean(v)).toLowerCase();
  }

  function parseYear(v) {
    const m = clean(v).match(/(?:19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }
  function parseBool(v) {
    const s = stripAccents(clean(v)).toLowerCase();
    if (!s) return null;
    if (/^(true|verdadero|si|1|x)$/.test(s)) return true;
    if (/^(false|falso|no|0)$/.test(s)) return false;
    return null;
  }
  function parseNum(v) {
    let s = clean(v).replace(/[^\d.,-]/g, '');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  function colLetter(n) { // 1 -> A
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Entrada: JSON del Apps Script o CSV publicado                       */
  /* ------------------------------------------------------------------ */

  /** CSV (RFC 4180) -> matriz de textos. */
  function parseCSV(text) {
    const out = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); out.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out;
  }

  /** Matriz completa de la hoja -> tabla normalizada (busca sola la fila de encabezados). */
  function tableFromMatrix(matrix) {
    const marker = headerKey('#_Publicación_ML');
    let h = -1;
    for (let r = 0; r < Math.min(matrix.length, 15); r++) {
      if ((matrix[r] || []).some((c) => headerKey(c) === marker)) { h = r; break; }
    }
    if (h < 0) throw new Error('No encontré la fila de encabezados (columna "#_Publicación_ML") en las primeras 15 filas.');
    const headers = matrix[h].map(clean);
    const letters = headers.map((_, i) => colLetter(i + 1));
    const rows = [];
    for (let r = h + 1; r < matrix.length; r++) {
      const cells = headers.map((_, i) => (matrix[r][i] === undefined ? '' : matrix[r][i]));
      rows.push({ n: r + 1, cells });
    }
    return { headers, letters, rows, headerRow: h + 1 };
  }

  /** Respuesta del Apps Script -> tabla normalizada. */
  function tableFromApi(payload) {
    if (!payload || payload.ok === false) {
      throw new Error((payload && payload.error) || 'La fuente de datos respondió con un error.');
    }
    if (!Array.isArray(payload.headers) || !Array.isArray(payload.rows)) {
      throw new Error('La respuesta de la fuente de datos no tiene el formato esperado.');
    }
    return {
      headers: payload.headers.map(clean),
      letters: payload.letters || payload.headers.map((_, i) => colLetter(i + 1)),
      rows: payload.rows.map((r) => ({ n: r[0], cells: r.slice(1) })),
      headerRow: payload.headerRow || null,
      sheet: payload.sheet || null,
      generatedAt: payload.generatedAt || null,
    };
  }

  /** Texto recibido (JSON o CSV) -> tabla normalizada. */
  function tableFromText(text) {
    const t = String(text || '').replace(/^﻿/, '').trim();
    if (!t) throw new Error('La fuente de datos respondió vacía.');
    if (t[0] === '{') {
      let json;
      try { json = JSON.parse(t); } catch (e) { throw new Error('La respuesta no es un JSON válido.'); }
      return tableFromApi(json);
    }
    if (t[0] === '<') {
      throw new Error('La URL devolvió una página web en lugar de datos. Revisa que el Apps Script esté implementado con acceso "Cualquier usuario" (o que la hoja esté publicada como CSV).');
    }
    return tableFromMatrix(parseCSV(t));
  }

  /* ------------------------------------------------------------------ */
  /* Construcción del modelo                                             */
  /* ------------------------------------------------------------------ */

  function splitCodes(v) {
    return clean(v).split(/[,;|\s]+/).map((s) => s.trim()).filter(Boolean);
  }

  /** Empareja códigos y cantidades de un par (código, Cant._N). */
  function pairParts(codeRaw, qtyRaw) {
    const codes = splitCodes(codeRaw);
    const q = clean(qtyRaw);
    if (!codes.length) return { items: [], issue: null };
    let qtys;
    if (!q) qtys = codes.map(() => null);
    else if (codes.length === 1) qtys = [parseNum(q)]; // '7,5' con un solo código = 7.5
    else {
      const parts = q.split(/[,;|\s]+/).filter(Boolean).map(parseNum);
      if (parts.length === 1) qtys = codes.map(() => parts[0]);
      else if (parts.length === codes.length) qtys = parts;
      else qtys = codes.map(() => null);
    }
    let issue = null;
    if (!q) issue = 'sin-cantidad';
    else if (qtys.some((x) => x === null)) issue = 'cantidad-no-cuadra';
    return { items: codes.map((c, i) => ({ code: partKey(c), qty: qtys[i] })), issue };
  }

  function familyLabel(header, letter) {
    const h = clean(header);
    if (!h) return 'Sin encabezado (col. ' + letter + ')';
    const i = h.indexOf('_');
    return i > 0 ? h.slice(i + 1).replace(/_/g, ' ') : h;
  }

  function buildModel(table) {
    const H = table.headers.map(headerKey);
    const findCol = (names) => {
      for (const n of names) { const i = H.indexOf(headerKey(n)); if (i >= 0) return i; }
      return -1;
    };

    const col = {};
    for (const f of Object.keys(FIELDS)) col[f] = findCol(FIELDS[f]);
    const channels = CHANNELS.map((ch) => {
      const i = findCol(ch.headers);
      const ok = i >= 0 && H[i + 1] === 'completa' ? i + 1 : -1;
      return Object.assign({}, ch, { col: i, okCol: ok });
    });

    const missing = REQUIRED.filter((f) => col[f] < 0).map((f) => FIELDS[f][0]);
    if (channels[0].col < 0) missing.unshift('#_Publicación_ML');
    if (missing.length) {
      const err = new Error('La hoja cambió: no encuentro ' + (missing.length > 1 ? 'las columnas ' : 'la columna ') + missing.map((m) => '"' + m + '"').join(', ') + '.');
      err.code = 'STRUCTURE';
      throw err;
    }

    // Columnas de número de parte: cualquier encabezado seguido de "Cant._N".
    const partCols = [];
    for (let i = 0; i < H.length - 1; i++) {
      if (/^cant/.test(H[i])) continue;
      if (/^cant/.test(H[i + 1])) {
        partCols.push({ col: i, qtyCol: i + 1, header: table.headers[i], letter: table.letters[i],
          family: familyLabel(table.headers[i], table.letters[i]) });
        i++;
      }
    }

    const issues = {
      dupPub: [], noQty: [], qtyMismatch: [], recetaDiff: [], mlNotId: [], hiddenSpace: [],
      noYears: [], noParts: [], blankHeader: partCols.filter((p) => !clean(p.header)).map((p) => p.letter),
    };

    const records = [];
    for (const r of table.rows) {
      const c = r.cells;
      const get = (f) => (col[f] >= 0 ? clean(c[col[f]]) : '');

      const pubs = [];
      for (const ch of channels) {
        if (ch.col < 0) continue;
        const raw = c[ch.col];
        const v = clean(raw);
        if (!v || parseBool(v) === false) continue;
        if (/[ ​]/.test(String(raw)) || String(raw) !== String(raw).trim()) issues.hiddenSpace.push(r.n);
        const key = pubKey(v);
        const okv = ch.okCol >= 0 ? parseBool(c[ch.okCol]) : null;
        pubs.push({ ch: ch.key, label: ch.label, short: ch.short, raw: key, key, display: ch.display(key), url: ch.url(key), completa: okv });
        if (ch.key === 'ml' && !/^\d{6,}$/.test(key)) issues.mlNotId.push({ row: r.n, value: v });
      }

      const desc = get('desc');
      const parts = [];
      for (const p of partCols) {
        const res = pairParts(c[p.col], c[p.qtyCol]);
        if (res.issue === 'sin-cantidad') issues.noQty.push({ row: r.n, col: p.letter, value: clean(c[p.col]) });
        if (res.issue === 'cantidad-no-cuadra') issues.qtyMismatch.push({ row: r.n, col: p.letter, value: clean(c[p.col]), qty: clean(c[p.qtyCol]) });
        for (const it of res.items) parts.push({ code: it.code, qty: it.qty, family: p.family, col: p.letter });
      }

      if (!pubs.length && !desc && !parts.length) continue; // fila vacía

      let y0 = parseYear(get('y0'));
      let y1 = parseYear(get('y1'));
      if (y0 && y1 && y0 > y1) { const t = y0; y0 = y1; y1 = t; }

      const rec = {
        i: records.length, row: r.n, pubs, desc,
        idOmova: get('idOmova'),
        trans: get('trans'), clas: get('clas'), marca: get('marca'), modelo: get('modelo'),
        y0, y1, openEnd: !!y0 && !y1, finProd: col.finProd >= 0 ? parseBool(c[col.finProd]) : null,
        motor: get('motor'), cil: get('cil'), conf: get('conf'),
        marcaAc: get('marcaAc'), espAc: get('espAc'),
        precio: parseNum(get('precio')),
        receta: col.receta >= 0 ? String(c[col.receta] || '') : '',
        parts,
      };
      rec.fk = {};
      for (const f of FACETS) rec.fk[f.key] = facetKey(rec[f.key]);
      rec.text = textKey([desc, rec.marca, rec.modelo, rec.trans, rec.clas, rec.motor, rec.marcaAc, rec.espAc,
        pubs.map((p) => p.display + ' ' + p.key).join(' '), parts.map((p) => p.code).join(' ')].join(' '));
      rec.group = pubs.length ? pubs[0].ch + ':' + pubs[0].key : 'fila:' + r.n;

      if (!y0 && !y1) issues.noYears.push(r.n);
      if (!parts.length) issues.noParts.push(r.n);

      // Comparación contra la columna RECETA (Z): avisa si la fórmula omite piezas.
      if (rec.receta) {
        const zCodes = rec.receta.split(/\n/).map((l) => partKey(l.split(',')[0])).filter(Boolean).sort();
        const pCodes = parts.map((p) => p.code).sort();
        if (zCodes.join('|') !== pCodes.join('|')) {
          const omitted = pCodes.filter((x) => !zCodes.includes(x));
          issues.recetaDiff.push({ row: r.n, omitted });
        }
      }
      records.push(rec);
    }

    // Índices
    const pubIndex = new Map();
    const partIndex = new Map();
    const facetLabels = {};
    for (const f of FACETS) facetLabels[f.key] = new Map();

    for (const rec of records) {
      for (const p of rec.pubs) {
        if (!pubIndex.has(p.key)) pubIndex.set(p.key, []);
        pubIndex.get(p.key).push(rec.i);
      }
      const seen = new Set();
      for (const p of rec.parts) {
        if (seen.has(p.code)) continue;
        seen.add(p.code);
        if (!partIndex.has(p.code)) partIndex.set(p.code, { code: p.code, family: p.family, recs: [] });
        partIndex.get(p.code).recs.push(rec.i);
      }
      for (const f of FACETS) {
        const k = rec.fk[f.key];
        if (!k) continue;
        const m = facetLabels[f.key];
        if (!m.has(k)) m.set(k, new Map());
        const v = m.get(k);
        v.set(rec[f.key], (v.get(rec[f.key]) || 0) + 1);
      }
    }

    // Etiqueta visible de cada opción = la forma de escribirla más frecuente.
    const facetVariants = [];
    const labels = {};
    for (const f of FACETS) {
      labels[f.key] = new Map();
      for (const [k, variants] of facetLabels[f.key]) {
        const best = [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
        labels[f.key].set(k, best);
        if (variants.size > 1) facetVariants.push({ field: f.label, variants: [...variants.entries()] });
      }
    }

    // Publicaciones repetidas
    for (const [key, idxs] of pubIndex) {
      if (idxs.length > 1) {
        const rs = idxs.map((i) => records[i]);
        issues.dupPub.push({ key, display: rs[0].pubs.find((p) => p.key === key).display, rows: rs.map((x) => x.row), descs: rs.map((x) => x.desc) });
      }
    }
    issues.facetVariants = facetVariants;

    const partCatalog = [...partIndex.values()].sort((a, b) => a.family.localeCompare(b.family) || a.code.localeCompare(b.code));

    return { records, pubIndex, partIndex, partCatalog, labels, channels, partCols, issues, columns: col };
  }

  /* ------------------------------------------------------------------ */
  /* Búsquedas                                                           */
  /* ------------------------------------------------------------------ */

  /** A. Búsqueda por número de publicación (exacta; si no hay, parciales). */
  function searchPub(model, query) {
    const k = pubKey(query);
    if (!k) return { key: '', exact: [], partial: [] };
    const exact = (model.pubIndex.get(k) || []).map((i) => model.records[i]);
    let partial = [];
    if (!exact.length && k.length >= 4) {
      const keys = [...model.pubIndex.keys()].filter((x) => x.includes(k)).slice(0, 60);
      const set = new Set();
      for (const key of keys) for (const i of model.pubIndex.get(key)) set.add(i);
      partial = [...set].map((i) => model.records[i]);
    }
    return { key: k, exact, partial };
  }

  /** C. Búsqueda por número de parte. Varios códigos = publicaciones que contienen TODOS. */
  function searchPart(model, query) {
    const codes = [...new Set(splitCodes(query).map(partKey))];
    if (!codes.length) return { codes: [], found: [], missing: [], recs: [], suggestions: [] };
    const found = codes.filter((c) => model.partIndex.has(c));
    const missing = codes.filter((c) => !model.partIndex.has(c));
    let recs = [];
    if (found.length && !missing.length) {
      let set = new Set(model.partIndex.get(found[0]).recs);
      for (const c of found.slice(1)) {
        const s2 = new Set(model.partIndex.get(c).recs);
        set = new Set([...set].filter((i) => s2.has(i)));
      }
      recs = [...set].map((i) => model.records[i]);
    }
    const suggestions = [];
    for (const m of missing) {
      const near = model.partCatalog.filter((p) => p.code.includes(m) || m.includes(p.code)).map((p) => p.code);
      suggestions.push(...near);
    }
    return { codes, found, missing, recs, suggestions: [...new Set(suggestions)].slice(0, 20) };
  }

  /** ¿El rango de años del registro cubre el año pedido? null = el registro no tiene años. */
  function coversYear(rec, y) {
    if (!rec.y0 && !rec.y1) return null;
    const a = rec.y0 || rec.y1;
    const b = rec.y1 || OPEN_END_YEAR;
    return y >= a && y <= b;
  }

  function emptyFilters() {
    return { trans: '', clas: '', marca: '', modelo: '', motor: '', marcaAc: '', espAc: '', year: null, text: '', includeNoYear: false };
  }
  function activeFilterCount(f) {
    let n = 0;
    for (const x of FACETS) if (f[x.key]) n++;
    if (f.year) n++;
    if (clean(f.text)) n++;
    return n;
  }

  /** B. Filtros combinables. `except` omite un campo (para calcular las opciones de ese filtro). */
  function matches(rec, f, except) {
    for (const x of FACETS) {
      if (x.key === except) continue;
      if (f[x.key] && rec.fk[x.key] !== f[x.key]) return false;
    }
    if (except !== 'year' && f.year) {
      const c = coversYear(rec, f.year);
      if (c === false) return false;
      if (c === null && !f.includeNoYear) return false;
    }
    if (except !== 'text' && clean(f.text)) {
      const words = textKey(f.text).split(' ').filter(Boolean);
      for (const w of words) if (!rec.text.includes(w)) return false;
    }
    return true;
  }
  function applyFilters(recs, f) {
    return recs.filter((r) => matches(r, f));
  }
  /** Registros excluidos solo por no tener años (para avisar al usuario). */
  function countNoYearExcluded(recs, f) {
    if (!f.year || f.includeNoYear) return 0;
    return recs.filter((r) => coversYear(r, f.year) === null && matches(r, f, 'year')).length;
  }

  /** Opciones disponibles para un filtro, considerando los demás filtros activos. */
  function facetOptions(model, recs, f, field) {
    const counts = new Map();
    for (const r of recs) {
      if (!matches(r, f, field)) continue;
      const k = r.fk[field];
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (f[field] && !counts.has(f[field])) counts.set(f[field], 0);
    return [...counts.entries()]
      .map(([k, n]) => ({ key: k, label: model.labels[field].get(k) || k, count: n }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
  }

  /** Rango de años presente en los datos (para validar el campo Año). */
  function yearBounds(model) {
    let lo = Infinity; let hi = -Infinity;
    for (const r of model.records) {
      if (r.y0) lo = Math.min(lo, r.y0);
      if (r.y1) hi = Math.max(hi, r.y1);
      if (r.openEnd) hi = Math.max(hi, OPEN_END_YEAR);
    }
    return { min: lo === Infinity ? 1990 : lo, max: hi === -Infinity ? OPEN_END_YEAR : hi };
  }

  /* ------------------------------------------------------------------ */
  /* Agrupación y orden de resultados                                    */
  /* ------------------------------------------------------------------ */

  function sortRecords(recs) {
    return recs.slice().sort((a, b) =>
      a.marca.localeCompare(b.marca) || a.modelo.localeCompare(b.modelo) ||
      (a.y0 || 0) - (b.y0 || 0) || a.clas.localeCompare(b.clas) ||
      (a.marcaAc || '').localeCompare(b.marcaAc || '') || a.desc.localeCompare(b.desc) || a.row - b.row);
  }

  function variantSignature(r) {
    return [r.desc, r.marca, r.modelo, r.y0, r.y1, r.trans, r.motor, r.marcaAc, r.espAc, r.precio,
      r.parts.map((p) => p.code + 'x' + p.qty).join(',')].join('|');
  }

  /**
   * Agrupa registros por número de publicación. Cada grupo trae sus variantes;
   * las filas idénticas se fusionan (se informa en `dupRows`).
   * `model` permite saber cuántas filas tiene la publicación en total.
   */
  function groupRecords(recs, model) {
    const map = new Map();
    for (const r of sortRecords(recs)) {
      if (!map.has(r.group)) map.set(r.group, { key: r.group, pubs: r.pubs, variants: [], totalRows: 0 });
      const g = map.get(r.group);
      const sig = variantSignature(r);
      const same = g.variants.find((v) => v.sig === sig);
      if (same) same.dupRows.push(r.row);
      else g.variants.push({ sig, rec: r, dupRows: [] });
    }
    for (const g of map.values()) {
      const p = g.pubs[0];
      g.totalRows = p ? (model.pubIndex.get(p.key) || []).length : 1;
      g.matchedRows = g.variants.reduce((n, v) => n + 1 + v.dupRows.length, 0);
    }
    return [...map.values()];
  }

  function yearsLabel(r) {
    if (!r.y0 && !r.y1) return '';
    if (r.y0 && r.openEnd) return r.y0 + ' – actual';
    if (r.y0 === r.y1) return String(r.y0);
    return (r.y0 || '?') + ' – ' + (r.y1 || '?');
  }

  /** Resumen de una lista de registros: conteos por clasificación y por vehículo. */
  function summarize(recs) {
    const byClas = new Map(); const byVeh = new Map();
    for (const r of recs) {
      byClas.set(r.clas || '(sin clasificación)', (byClas.get(r.clas || '(sin clasificación)') || 0) + 1);
      const v = (r.marca + ' ' + r.modelo).trim() || '(sin vehículo)';
      if (!byVeh.has(v)) byVeh.set(v, { label: v, marca: r.fk.marca, modelo: r.fk.modelo, count: 0 });
      byVeh.get(v).count++;
    }
    const sortDesc = (a, b) => b.count - a.count || a.label.localeCompare(b.label);
    return {
      byClas: [...byClas.entries()].map(([label, count]) => ({ label, count, key: facetKey(label) })).sort(sortDesc),
      byVeh: [...byVeh.values()].sort(sortDesc),
    };
  }

  const Core = {
    CHANNELS, FIELDS, FACETS, CURRENT_YEAR, OPEN_END_YEAR,
    clean, headerKey, facetKey, partKey, pubKey, textKey, parseYear, parseNum, parseBool, colLetter,
    parseCSV, tableFromMatrix, tableFromApi, tableFromText, pairParts,
    buildModel, searchPub, searchPart, coversYear, emptyFilters, activeFilterCount,
    matches, applyFilters, countNoYearExcluded, facetOptions, yearBounds,
    sortRecords, groupRecords, yearsLabel, summarize,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
