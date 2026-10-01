/* ============================================================
   Datasheet Notes - page logic.
   Product and factory must be chosen before the upload appears.
   The PDF is read in the browser (ds-read.js); the datasheet is
   never sent to the database. One PDF can hold several units and
   several PDFs can be chosen at once: every unit gets its own
   column, headed by its unit tag. The power supply is read from
   the datasheet (Fan Supply under Electrical Power Inputs Data).
   Which rows appear and what they say follows the admin's row
   mapping for the chosen factory (Api.dnRules, edited in mapping.html).
   Row names the mapping has not seen are added to it (Api.dnAddRows).
   Products and factories come from the same list the Compliance
   Maker uses (Api.cmOptions).
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el;

  var productSel = $('dn-product'), factorySel = $('dn-factory');
  var hint = $('dn-scope-hint'), upload = $('dn-upload'), result = $('dn-result');
  var drop = $('dn-drop'), fileInput = $('dn-file'), status = $('dn-status'), mapNote = $('dn-map-note');
  var products = [], parsed = null, grid = null, fileName = '', busy = false;   // parsed: [unit, ...]
  var mappings = {}, mapping = null, mapFactory = '';   // mapping per factory, loaded once each

  /* ---------- selection ---------- */
  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function choice() {
    var p = product();
    var f = p && p.factories.filter(function (x) { return x.id === factorySel.value; })[0];
    return p && f ? { productId: p.id, factoryId: f.id, product: p.name, factory: f.name } : null;
  }
  function canRead(p) { return !!(p && window.DSParse.readers[String(p.id).toLowerCase()]); }

  function fillFactories() {
    var p = product();
    factorySel.textContent = '';
    factorySel.appendChild(option('', p ? 'Choose a factory' : 'Choose a product first'));
    (p ? p.factories : []).forEach(function (f) { factorySel.appendChild(option(f.id, f.name)); });
    factorySel.disabled = !p;
  }

  /* The admin's row mapping for the chosen factory. If it cannot be loaded the tool still
     works and shows every datasheet row, with a notice saying so. */
  function loadMapping(factoryId) {
    mapFactory = factoryId; mapping = mappings[factoryId] || null;
    mapNote.hidden = true;
    if (!factoryId || mapping) return;
    window.Api.dnRules(window.Hub.token(), factoryId).then(function (res) {
      var rules = {};
      (res.rules || []).forEach(function (r) { rules[r.key] = r; });
      mappings[factoryId] = { showUnmapped: res.show_unmapped !== false, rules: rules, count: (res.rules || []).length };
    }, function (err) {
      mappings[factoryId] = { showUnmapped: true, rules: {}, count: 0, error: (err && err.message) || String(err) };
    }).then(function () { if (mapFactory === factoryId) { mapping = mappings[factoryId]; applyGate(); } });
  }

  function applyGate() {
    var p = product(), c = choice();
    hint.className = 'hint';
    if (p && !canRead(p)) {
      hint.className = 'notice warn';
      hint.textContent = 'The ' + p.name + ' datasheet reader is not ready yet. Only AHU datasheets can be read for now.';
      upload.hidden = true; result.hidden = true;
      return;
    }
    hint.textContent = c ? c.product + ', ' + c.factory + ' factory. The power supply is read from the datasheet.'
                         : 'Choose product and factory to continue.';
    var ready = !!(c && mapping);
    upload.hidden = !ready;
    mapNote.hidden = !(ready && mapping.error);
    if (ready && mapping.error) mapNote.textContent = 'The row mapping for this factory could not be loaded (' + mapping.error + '). Every datasheet row is shown as printed.';
    if (!ready) result.hidden = true;
    else if (parsed) render();            // choices changed: the table follows, no need to upload again
  }

  productSel.addEventListener('change', function () { fillFactories(); loadMapping(''); applyGate(); });
  factorySel.addEventListener('change', function () { loadMapping(factorySel.value); applyGate(); });

  /* ---------- file ---------- */
  function say(text, kind) {
    status.hidden = !text;
    status.className = 'notice' + (kind ? ' ' + kind : '');
    status.textContent = text || '';
  }

  drop.addEventListener('click', function () { if (!busy) fileInput.click(); });
  fileInput.addEventListener('change', function () { if (fileInput.files.length) read([].slice.call(fileInput.files)); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length && !busy) read([].slice.call(f));
  });
  // a PDF dropped beside the box must not replace the page
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  function read(files) {
    busy = true; drop.disabled = true; parsed = null; result.hidden = true;
    say('Reading ' + (files.length === 1 ? files[0].name : files.length + ' files') + '…');
    window.DSRead.files(files).then(function (units) {
      parsed = units; fileName = files[0].name;
      say('');
      render();
      register();
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, function (err) { say(err.message, 'error'); })
      .then(function () { busy = false; drop.disabled = false; });
  }

  /* Row names this factory's mapping has not seen before are added to the admins' mapping list,
     so new sections and rows turn up there without anyone loading the datasheet again.
     Only names go to the database, never values. The table on screen does not wait for it. */
  function register() {
    var c = choice();
    if (!parsed || !c || !mapping || mapping.error) return;
    var seen = {}, fresh = [], m = mapping;
    parsed.forEach(function (unit) {
      window.DSParse.rows(unit, c).forEach(function (r) {
        if (m.rules[r.key] || seen[r.key]) return; seen[r.key] = 1;
        fresh.push({ key: r.key, section: r.group, sub: /^Filter \d+$/i.test(r.sub) ? '' : r.sub, component: r.component });
      });
    });
    if (!fresh.length) return;
    window.Api.dnAddRows(window.Hub.token(), { factoryId: c.factoryId, rows: fresh }).then(function () {
      // remembered as they were added, so the next datasheet in this visit does not send them again
      fresh.forEach(function (r) { m.rules[r.key] = { key: r.key, show: m.showUnmapped, label: '', response: '' }; });
    }, function () { /* the next run sends them again */ });
  }

  /* ---------- result ---------- */
  function count(g) { return g.rows.filter(function (r) { return r.kind !== 'sub'; }).length; }
  function projects() {
    var seen = [];
    parsed.forEach(function (u) { if (u.hdr.project && seen.indexOf(u.hdr.project) < 0) seen.push(u.hdr.project); });
    return seen;
  }

  function render() {
    var c = choice();
    if (!parsed || !c || !mapping) return;
    grid = window.DSParse.grid(parsed, c, mapping);
    var units = grid.columns.length, shown = count(grid), total = count(window.DSParse.grid(parsed, c, null));

    var h = parsed[0].hdr;
    $('dn-title').textContent = (units === 1
      ? [h.project, grid.columns[0], h.reference ? 'Ref. ' + h.reference : '']
      : [projects().join(', '), units + ' units: ' + grid.columns.join(', ')]).filter(Boolean).join('  ·  ') || fileName;

    var facts = $('dn-facts'); facts.textContent = '';
    var list = [units + (units === 1 ? ' unit' : ' units'), shown + (shown === 1 ? ' row' : ' rows')];
    if (shown < total) list.push((total - shown) + ' datasheet rows left out by the row mapping');
    list.forEach(function (t) { facts.appendChild(el('span', { 'class': 'badge', text: t })); });

    var notes = [];
    parsed.forEach(function (u, i) {
      var tag = units > 1 ? grid.columns[i] + ': ' : '';
      u.warnings.forEach(function (w) { notes.push(tag + w); });
      if (!u.unit.rows.length) notes.push(tag + 'No "Unit Data" block was found on the datasheet.');
      if (!u.sections.length) notes.push(tag + 'No numbered sections were found on the datasheet.');
    });
    var warn = $('dn-warn'); warn.textContent = ''; warn.hidden = !notes.length;
    if (notes.length) {
      warn.appendChild(el('strong', { text: 'Check these points:' }));
      warn.appendChild(el('ul', { 'class': 'dn-list' }, notes.map(function (n) { return el('li', { text: n }); })));
    }

    // Section | Component | one column per unit tag | Remarks
    var table = $('dn-table').querySelector('table'), cols = $('dn-cols'), head = $('dn-head-row');
    var unitW = units === 1 ? 320 : 220;
    cols.textContent = ''; head.textContent = '';
    [170, 210].concat(grid.columns.map(function () { return unitW; }), [130]).forEach(function (w) { cols.appendChild(el('col', { style: 'width:' + w + 'px' })); });
    ['Section', 'Component'].concat(grid.columns, ['Remarks']).forEach(function (t, i) {
      head.appendChild(el('th', { text: t, 'class': i >= 2 && i < 2 + units ? 'unit' : null }));
    });
    table.style.minWidth = (510 + unitW * units) + 'px';

    var body = $('dn-body'), frag = document.createDocumentFragment();
    grid.rows.forEach(function (r) {
      var cls = (r.kind === 'sub' ? 'sub' : '') + (r.section ? ' first' : '');
      frag.appendChild(el('tr', { 'class': cls.trim() || null },
        [el('td', { 'class': 'sec', text: r.section }), el('td', { text: r.component })]
          .concat(r.cells.map(function (v) { return el('td', { text: v }); }), [el('td')])));
    });
    body.textContent = ''; body.appendChild(frag);
    $('dn-table').hidden = !grid.rows.length;
    $('dn-empty').hidden = !!grid.rows.length;
    $('dn-download').disabled = !grid.rows.length;
    result.hidden = false;
  }

  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }

  $('dn-download').addEventListener('click', function () {
    if (!grid || !grid.rows.length) return;
    var name = grid.columns.length === 1 ? grid.columns[0] : (projects()[0] || fileName.replace(/\.pdf$/i, '')) + ' - ' + grid.columns.length + ' units';
    var blob = window.DSXlsx.build(grid, 'Datasheet Notes');
    var a = el('a', { href: URL.createObjectURL(blob), download: (safeName(name) || 'Datasheet') + ' - Datasheet Notes.xlsx' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    window.Hub.toast('Excel downloaded.');
  });

  $('dn-clear').addEventListener('click', function () {
    parsed = null; grid = null; fileName = '';
    result.hidden = true; say('');
    drop.focus();
  });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ tool: 'datasheet-notes' }).then(function (profile) {
    if (window.Hub.canEdit(profile, 'datasheet-notes')) $('dn-manage').hidden = false;
    return window.Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    products = res.products || [];
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    fillFactories(); applyGate();
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.className = 'notice error';
    hint.textContent = 'Could not load the product list: ' + ((err && err.message) || err) + ' Refresh the page to try again.';
  });
})();
