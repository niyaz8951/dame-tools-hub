/* ============================================================
   Datasheet Notes - page logic.
   Product, factory and power supply must be chosen before the
   upload appears. The PDF is read in the browser (ds-read.js);
   the datasheet is never sent to the database.
   Which rows appear and what they say follows the admin's row
   mapping for the chosen factory (Api.dnRules, edited in mapping.html).
   Products and factories come from the same list the Compliance
   Maker uses (Api.cmOptions).
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el;

  var productSel = $('dn-product'), factorySel = $('dn-factory'), powerSel = $('dn-power');
  var hint = $('dn-scope-hint'), upload = $('dn-upload'), result = $('dn-result');
  var drop = $('dn-drop'), fileInput = $('dn-file'), status = $('dn-status'), mapNote = $('dn-map-note');
  var products = [], parsed = null, rows = [], total = 0, fileName = '', busy = false;
  var mappings = {}, mapping = null, mapFactory = '';   // mapping per factory, loaded once each

  /* ---------- selection ---------- */
  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function choice() {
    var p = product();
    var f = p && p.factories.filter(function (x) { return x.id === factorySel.value; })[0];
    return p && f && powerSel.value ? { productId: p.id, factoryId: f.id, product: p.name, factory: f.name, power: powerSel.value } : null;
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
    hint.textContent = c ? c.product + ', ' + c.factory + ' factory, ' + c.power + '.'
                         : 'Choose product, factory and power supply to continue.';
    var ready = !!(c && mapping);
    upload.hidden = !ready;
    mapNote.hidden = !(ready && mapping.error);
    if (ready && mapping.error) mapNote.textContent = 'The row mapping for this factory could not be loaded (' + mapping.error + '). Every datasheet row is shown as printed.';
    if (!ready) result.hidden = true;
    else if (parsed) render();            // choices changed: the table follows, no need to upload again
  }

  productSel.addEventListener('change', function () { fillFactories(); loadMapping(''); applyGate(); });
  factorySel.addEventListener('change', function () { loadMapping(factorySel.value); applyGate(); });
  powerSel.addEventListener('change', applyGate);

  /* ---------- file ---------- */
  function say(text, kind) {
    status.hidden = !text;
    status.className = 'notice' + (kind ? ' ' + kind : '');
    status.textContent = text || '';
  }

  drop.addEventListener('click', function () { if (!busy) fileInput.click(); });
  fileInput.addEventListener('change', function () { if (fileInput.files[0]) read(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && !busy) read(f);
  });
  // a PDF dropped beside the box must not replace the page
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  function read(file) {
    busy = true; drop.disabled = true; parsed = null; result.hidden = true;
    say('Reading ' + file.name + '…');
    window.DSRead.file(file).then(function (data) {
      parsed = data; fileName = file.name;
      say('');
      render();
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, function (err) { say(err.message, 'error'); })
      .then(function () { busy = false; drop.disabled = false; });
  }

  /* ---------- result ---------- */
  function render() {
    var c = choice();
    if (!parsed || !c || !mapping) return;
    var all = window.DSParse.rows(parsed, c);
    rows = window.DSParse.apply(all, mapping);
    total = all.length;
    var shown = rows.filter(function (r) { return r.kind !== 'sub'; }).length;

    var h = parsed.hdr;
    $('dn-title').textContent = [h.project, h.unit, h.reference ? 'Ref. ' + h.reference : ''].filter(Boolean).join('  ·  ') || fileName;

    var facts = $('dn-facts'); facts.textContent = '';
    var list = [shown + (shown === 1 ? ' row' : ' rows')];
    if (shown < total) list.push((total - shown) + ' datasheet rows left out by the row mapping');
    list.forEach(function (t) { facts.appendChild(el('span', { 'class': 'badge', text: t })); });

    var notes = parsed.warnings.slice();
    if (!parsed.unit.rows.length) notes.push('No "Unit Data" block was found on the datasheet.');
    if (!parsed.sections.length) notes.push('No numbered sections were found on the datasheet.');
    var warn = $('dn-warn'); warn.textContent = ''; warn.hidden = !notes.length;
    if (notes.length) {
      warn.appendChild(el('strong', { text: 'Check these points:' }));
      warn.appendChild(el('ul', { 'class': 'dn-list' }, notes.map(function (n) { return el('li', { text: n }); })));
    }

    var body = $('dn-body'), frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var cls = (r.kind === 'sub' ? 'sub' : '') + (r.section ? ' first' : '');
      frag.appendChild(el('tr', { 'class': cls.trim() || null }, [
        el('td', { 'class': 'sec', text: r.section }), el('td', { text: r.component }),
        el('td', { text: r.specs }), el('td')
      ]));
    });
    body.textContent = ''; body.appendChild(frag);
    $('dn-table').hidden = !rows.length;
    $('dn-empty').hidden = !!rows.length;
    $('dn-download').disabled = !rows.length;
    result.hidden = false;
  }

  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }

  $('dn-download').addEventListener('click', function () {
    if (!rows.length) return;
    var base = safeName(parsed.hdr.unit || fileName.replace(/\.pdf$/i, '')) || 'Datasheet';
    var blob = window.DSXlsx.build(rows, 'Datasheet Notes');
    var a = el('a', { href: URL.createObjectURL(blob), download: base + ' - Datasheet Notes.xlsx' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    window.Hub.toast('Excel downloaded.');
  });

  $('dn-clear').addEventListener('click', function () {
    parsed = null; rows = []; fileName = '';
    result.hidden = true; say('');
    drop.focus();
  });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ tool: 'datasheet-notes' }).then(function (profile) {
    if (profile.user.role === 'admin') $('dn-manage').hidden = false;
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
