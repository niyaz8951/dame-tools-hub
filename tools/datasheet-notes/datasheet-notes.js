/* ============================================================
   Datasheet Notes - page logic.
   Product, factory and power supply must be chosen before the
   upload appears. The PDF is read in the browser with pdf.js
   (assets/vendor/pdfjs); nothing is sent to the database.
   Products and factories come from the same list the Compliance
   Maker uses (Api.cmOptions).
   ============================================================ */
(function () {
  'use strict';

  var READERS = { ahu: true };          // products whose datasheet can be read today
  var MAX_MB = 25;
  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el;

  var productSel = $('dn-product'), factorySel = $('dn-factory'), powerSel = $('dn-power');
  var hint = $('dn-scope-hint'), upload = $('dn-upload'), result = $('dn-result');
  var drop = $('dn-drop'), fileInput = $('dn-file'), status = $('dn-status');
  var products = [], parsed = null, rows = [], fileName = '', busy = false;

  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../assets/vendor/pdfjs/pdf.worker.min.js';

  /* ---------- selection ---------- */
  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function choice() {
    var p = product();
    var f = p && p.factories.filter(function (x) { return x.id === factorySel.value; })[0];
    return p && f && powerSel.value ? { productId: p.id, product: p.name, factory: f.name, power: powerSel.value } : null;
  }
  function canRead(p) { return !!(p && READERS[String(p.id).toLowerCase()]); }

  function fillFactories() {
    var p = product();
    factorySel.textContent = '';
    factorySel.appendChild(option('', p ? 'Choose a factory' : 'Choose a product first'));
    (p ? p.factories : []).forEach(function (f) { factorySel.appendChild(option(f.id, f.name)); });
    factorySel.disabled = !p;
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
    hint.textContent = c ? c.product + ', ' + c.factory + ' factory, ' + c.power + '. These go at the top of the table.'
                         : 'Choose product, factory and power supply to continue.';
    upload.hidden = !c;
    if (!c) result.hidden = true;
    else if (parsed) render();            // choices changed: the table follows, no need to upload again
  }

  productSel.addEventListener('change', function () { fillFactories(); applyGate(); });
  factorySel.addEventListener('change', applyGate);
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
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { say('"' + file.name + '" is not a PDF. Choose the datasheet PDF.', 'error'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { say('This file is larger than ' + MAX_MB + ' MB. Choose the datasheet PDF for one unit.', 'error'); return; }
    if (!window.pdfjsLib) { say('The PDF reader did not load. Refresh the page and try again.', 'error'); return; }
    busy = true; drop.disabled = true; parsed = null; result.hidden = true;
    say('Reading ' + file.name + '…');

    file.arrayBuffer().then(function (buf) {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (pdf) {
      var pages = [], chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) (function (n) {
        chain = chain.then(function () { return pdf.getPage(n); })
          .then(function (page) { return page.getTextContent(); })
          .then(function (tc) { pages.push(window.DSParse.lines(tc.items, n)); });
      })(n);
      return chain.then(function () { return pages; });
    }).then(function (pages) {
      var words = pages.reduce(function (s, p) { return s + p.length; }, 0);
      if (!words) throw new Error('This PDF has no text to read. It looks like a scan. Export the datasheet from the selection software as PDF.');
      var data = window.DSParse.parse(pages);
      if (!data.unit.rows.length && !data.sections.length) {
        throw new Error('No "Unit Data" or numbered sections were found. This tool reads the Daikin AHU technical report (ASTRAWEB).');
      }
      parsed = data; fileName = file.name;
      say('');
      render();
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      var msg = err && err.name === 'PasswordException' ? 'This PDF is password protected. Remove the password and try again.'
              : err && err.name === 'InvalidPDFException' ? 'This file could not be opened as a PDF.'
              : (err && err.message) || 'The datasheet could not be read.';
      say(msg, 'error');
    }).then(function () { busy = false; drop.disabled = false; });
  }

  /* ---------- result ---------- */
  function render() {
    var c = choice();
    if (!parsed || !c) return;
    rows = window.DSParse.table(parsed, c);

    var h = parsed.hdr, options = parsed.unit.options.length;
    parsed.sections.forEach(function (s) { options += s.options.length; });
    $('dn-title').textContent = [h.project, h.unit, h.reference ? 'Ref. ' + h.reference : ''].filter(Boolean).join('  ·  ') || fileName;

    var facts = $('dn-facts'); facts.textContent = '';
    [parsed.sections.length + ' sections', rows.filter(function (r) { return r.kind !== 'sub'; }).length + ' rows', options + ' options']
      .forEach(function (t) { facts.appendChild(el('span', { 'class': 'badge', text: t })); });

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
  window.Hub.requireLogin({ tool: 'datasheet-notes' }).then(function () {
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
