/* ============================================================
   Datasheet Notes - row mapping (admins only).
   Per factory, each datasheet row has: Show, Name in Excel, Response.
   Rows are found by loading a datasheet; every row listed is saved,
   so the list is there next time without loading a datasheet again.
   Database: Api.dnRules / Api.dnAdminSaveRules.
   Row keys and the response rule ($ or * = datasheet value) come
   from ds-parse.js, the same code the tool itself uses.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el, P = window.DSParse;
  var SAMPLE_POWER = '400 V / 3 Ph / 50 Hz';     // only used to show an example in the Result column
  var NO_VALUE = '‹datasheet value›';

  var productSel = $('dm-product'), factorySel = $('dm-factory'), hint = $('dm-scope-hint');
  var panel = $('dm-panel'), body = $('dm-body'), unmappedSel = $('dm-unmapped'), search = $('dm-search');
  var saveBtn = $('dm-save'), changes = $('dm-changes'), status = $('dm-status'), errorBox = $('dm-error');
  var products = [], factoryId = '', list = [], removed = [], savedUnmapped = true, sheet = null, sheetName = '', busy = false;

  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function factory() { var p = product(); return p && p.factories.filter(function (f) { return f.id === factorySel.value; })[0] || null; }
  function fail(msg) { errorBox.hidden = !msg; errorBox.textContent = msg || ''; }

  /* ---------- state ---------- */
  function makeRow(src, rule, onSheet) {
    var r = {
      key: src.key, group: src.group, sub: src.sub, component: src.component,
      sample: onSheet ? src.value : null, onSheet: onSheet, saved: !!rule,
      show: rule ? rule.show !== false : unmappedSel.value === 'show',
      label: rule ? rule.label || '' : '', response: rule ? rule.response || '' : ''
    };
    r.orig = { show: r.show, label: r.label, response: r.response };
    return r;
  }

  /* saved rules + (if loaded) the rows of a datasheet -> the list on screen, grouped by section */
  function build(rules) {
    var byKey = {}, out = [], seen = {}, order = [];
    rules.forEach(function (r) { byKey[r.key] = r; });
    function add(row) { if (order.indexOf(row.group) < 0) order.push(row.group); out.push(row); }
    if (sheet) {
      var f = factory(), p = product();
      P.rows(sheet, { product: p.name, factory: f.name, power: SAMPLE_POWER }).forEach(function (r) {
        if (seen[r.key]) return; seen[r.key] = 1;
        add(makeRow({ key: r.key, group: r.group, sub: /^Filter \d+$/i.test(r.sub) ? '' : r.sub, component: r.component, value: r.value }, byKey[r.key], true));
      });
    }
    rules.forEach(function (r) {
      if (seen[r.key]) return; seen[r.key] = 1;
      add(makeRow({ key: r.key, group: r.section || 'Other', sub: r.sub || '', component: r.component || r.key }, r, false));
    });
    // keep each section's rows together, sections in the order they first appear
    list = [];
    order.forEach(function (g) { out.forEach(function (r) { if (r.group === g) list.push(r); }); });
  }

  function current() {            // what is on screen, as saved rules (keeps edits when a datasheet is loaded)
    return list.map(function (r) { return { key: r.key, section: r.group, sub: r.sub, component: r.component, show: r.show, label: r.label, response: r.response, _row: r }; });
  }

  function changed(r) { return !r.saved || r.show !== r.orig.show || r.label.trim() !== r.orig.label || r.response.trim() !== r.orig.response; }
  function pending() {
    var n = list.filter(changed).length + removed.length;
    if ((unmappedSel.value === 'show') !== savedUnmapped) n++;
    return n;
  }
  function refreshSave() {
    var n = pending();
    saveBtn.disabled = !n || busy;
    changes.textContent = n ? n + (n === 1 ? ' change' : ' changes') + ' not saved yet.' : 'No changes to save.';
  }

  /* ---------- table ---------- */
  function resultText(r) {
    if (!r.show) return 'Left out';
    return P.fill(r.response, r.sample === null ? NO_VALUE : r.sample);
  }

  function groupCount(g) {
    var rows = list.filter(function (r) { return r.group === g; });
    return rows.filter(function (r) { return r.show; }).length + ' of ' + rows.length + ' shown';
  }

  function render() {
    var frag = document.createDocumentFragment(), group = null;
    list.forEach(function (r) {
      if (r.group !== group) {
        group = r.group;
        var g = group;
        r_count[g] = el('span', { 'class': 'small muted', text: groupCount(g) });
        frag.appendChild(el('tr', { 'class': 'group', 'data-group': g }, el('td', { colspan: '5' }, el('div', { 'class': 'dm-group' }, [
          el('span', {}, [g + '  ', r_count[g]]),
          el('span', { 'class': 'row' }, [
            el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Show all', onclick: function () { setGroup(g, true); } }),
            el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Leave all out', onclick: function () { setGroup(g, false); } })
          ])
        ]))));
      }
      frag.appendChild(rowEl(r));
    });
    body.textContent = ''; body.appendChild(frag);
    $('dm-wrap').hidden = !list.length; $('dm-empty').hidden = !!list.length;
    applySearch(); refreshSave();
  }
  var r_count = {};

  function rowEl(r) {
    var name = (r.sub ? r.sub + ' › ' : '') + r.component;
    var check = el('input', { type: 'checkbox', 'aria-label': 'Show ' + name });
    var label = el('input', { 'class': 'input', maxlength: '120', placeholder: r.component, 'aria-label': 'Name in Excel for ' + name });
    var resp = el('input', { 'class': 'input', maxlength: '1000', placeholder: 'Datasheet value', 'aria-label': 'Response for ' + name });
    var result = el('td');
    var tr = el('tr', { 'data-group': r.group });
    check.checked = r.show; label.value = r.label; resp.value = r.response;

    function paint() {
      tr.className = r.show ? '' : 'off';
      result.textContent = resultText(r);
      label.disabled = resp.disabled = !r.show;
    }
    check.addEventListener('change', function () { r.show = check.checked; paint(); r_count[r.group].textContent = groupCount(r.group); refreshSave(); });
    label.addEventListener('input', function () { r.label = label.value; refreshSave(); });
    resp.addEventListener('input', function () { r.response = resp.value; paint(); refreshSave(); });
    r.paint = function () { check.checked = r.show; paint(); };
    r.tr = tr;
    r.text = (r.group + ' ' + name + ' ' + (r.sample || '')).toLowerCase();

    var info = [el('span', { 'class': 'dm-name', text: name })];
    if (r.onSheet) info.push(el('span', { 'class': 'dm-sample', text: r.sample === '' ? 'Printed with no value' : r.sample }));
    else {
      info.push(el('span', { 'class': 'dm-sample', text: sheet ? 'Not on the loaded datasheet' : '' }));
      info.push(el('button', { type: 'button', 'class': 'btn danger sm', text: 'Remove', style: 'margin-top:6px',
        'aria-label': 'Remove ' + name + ' from the mapping', onclick: function () { removeRow(r); } }));
    }
    tr.appendChild(el('td', {}, el('label', { 'class': 'dm-check' }, check)));
    tr.appendChild(el('td', {}, info));
    tr.appendChild(el('td', {}, label));
    tr.appendChild(el('td', {}, resp));
    tr.appendChild(result);
    paint();
    return tr;
  }

  function setGroup(g, show) {
    list.forEach(function (r) { if (r.group === g && !r.tr.hidden) { r.show = show; r.paint(); } });
    r_count[g].textContent = groupCount(g); refreshSave();
  }

  function removeRow(r) {
    if (r.saved) removed.push(r.key);
    list = list.filter(function (x) { return x !== r; });
    render();
  }

  function applySearch() {
    var q = search.value.trim().toLowerCase(), visible = {};
    list.forEach(function (r) { r.tr.hidden = !!q && r.text.indexOf(q) < 0; if (!r.tr.hidden) visible[r.group] = 1; });
    [].forEach.call(body.querySelectorAll('tr.group'), function (tr) { tr.hidden = !visible[tr.getAttribute('data-group')]; });
  }
  search.addEventListener('input', applySearch);
  unmappedSel.addEventListener('change', refreshSave);

  function describe() {
    var n = list.length;
    status.textContent = sheet
      ? n + ' rows: ' + list.filter(function (r) { return r.onSheet; }).length + ' from ' + sheetName +
        (list.some(function (r) { return !r.saved; }) ? ', including ' + list.filter(function (r) { return !r.saved; }).length + ' new rows that are saved when you press Save mapping.' : '.')
      : n ? n + ' saved rows. Load a datasheet to see its values in the Result column and to find rows that are not listed yet.'
          : '';
  }

  /* ---------- load, save ---------- */
  function load() {
    var f = factory();
    factoryId = f ? f.id : ''; sheet = null; sheetName = ''; removed = []; list = []; search.value = ''; fail('');
    panel.hidden = true;
    hint.textContent = f ? 'Loading the mapping…' : 'Choose a product and factory to see its mapping.';
    if (!f) return;
    var id = f.id;
    window.Api.dnRules(window.Hub.token(), id).then(function (res) {
      if (factoryId !== id) return;
      savedUnmapped = res.show_unmapped !== false;
      unmappedSel.value = savedUnmapped ? 'show' : 'hide';
      build(res.rules || []);
      hint.textContent = 'Mapping for ' + product().name + ', ' + f.name + ' factory.';
      panel.hidden = false;
      render(); describe();
    }, function (err) {
      if (factoryId !== id) return;
      hint.textContent = '';
      panel.hidden = false; $('dm-wrap').hidden = true; $('dm-empty').hidden = true;
      fail('The mapping could not be loaded: ' + ((err && err.message) || err));
    });
  }

  $('dm-load').addEventListener('click', function () { if (!busy) $('dm-file').click(); });
  $('dm-file').addEventListener('change', function () {
    var file = this.files[0]; this.value = '';
    if (!file) return;
    busy = true; fail(''); status.textContent = 'Reading ' + file.name + '…';
    window.DSRead.file(file).then(function (data) {
      var keep = current();
      sheet = data; sheetName = file.name;
      build(keep);
      // build() treats what it is given as saved rules: put the unsaved state back
      list.forEach(function (r) {
        var k = keep.filter(function (x) { return x.key === r.key; })[0];
        if (k) { r.saved = k._row.saved; r.orig = k._row.orig; }
      });
      render(); describe();
    }, function (err) { describe(); fail(err.message); })
      .then(function () { busy = false; refreshSave(); });
  });

  saveBtn.addEventListener('click', function () {
    if (busy || !factoryId) return;
    busy = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; fail('');
    var id = factoryId, show = unmappedSel.value === 'show';
    var rules = list.map(function (r) { return { key: r.key, section: r.group, sub: r.sub, component: r.component, show: r.show, label: r.label.trim(), response: r.response.trim() }; });
    window.Api.dnAdminSaveRules(window.Hub.token(), { factoryId: id, showUnmapped: show, rules: rules, remove: removed }).then(function () {
      if (factoryId !== id) return;
      list.forEach(function (r) { r.saved = true; r.label = r.label.trim(); r.response = r.response.trim(); r.orig = { show: r.show, label: r.label, response: r.response }; });
      removed = []; savedUnmapped = show;
      describe();
      window.Hub.toast('Mapping saved.');
    }, function (err) {
      fail('The mapping was not saved: ' + ((err && err.message) || err));
    }).then(function () { busy = false; saveBtn.textContent = 'Save mapping'; refreshSave(); });
  });

  /* ---------- factory choice, leaving with unsaved changes ---------- */
  function fillFactories() {
    var p = product();
    factorySel.textContent = '';
    factorySel.appendChild(option('', p ? 'Choose a factory' : 'Choose a product first'));
    (p ? p.factories : []).forEach(function (f) { factorySel.appendChild(option(f.id, f.name)); });
    factorySel.disabled = !p;
  }
  var lastProduct = '', lastFactory = '';
  function leaveOk() { return !factoryId || !pending() || window.confirm('Changes to this mapping are not saved. Leave them?'); }
  productSel.addEventListener('change', function () {
    if (!leaveOk()) { productSel.value = lastProduct; return; }
    lastProduct = productSel.value; lastFactory = '';
    fillFactories(); load();
  });
  factorySel.addEventListener('change', function () {
    if (!leaveOk()) { factorySel.value = lastFactory; return; }
    lastFactory = factorySel.value;
    load();
  });
  window.addEventListener('beforeunload', function (e) { if (factoryId && pending()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ admin: true }).then(function () {
    return window.Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    // only products whose datasheet can be read have rows to map
    products = (res.products || []).filter(function (p) { return P.readers[String(p.id).toLowerCase()]; });
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    if (products.length === 1) { productSel.value = lastProduct = products[0].id; }
    fillFactories();
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.className = 'notice error';
    hint.textContent = 'Could not load the product list: ' + ((err && err.message) || err) + ' Refresh the page to try again.';
  });
})();
