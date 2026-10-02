/* ============================================================
   Product Options - page logic.
   A tree per product and factory: section > component > the values
   seen on the datasheets run in Datasheet Notes (Api.poTree), plus
   special options and notes added by editors.
   Only rows the Datasheet Notes row mapping shows are in the tree;
   the database decides that (po_get_tree), the page only draws it.
   Editors (admins, and users with "Can edit" for product-options)
   get the Edit switch: add / change / delete special options and
   notes, take a value or a row out of the tree and bring it back.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el, Api = window.Api;
  var TOOL = 'product-options', FEW = 8, STORE = 'dame_po_choice';

  var productSel = $('po-product'), factorySel = $('po-factory'), search = $('po-search');
  var hint = $('po-hint'), result = $('po-result'), host = $('po-tree-host');
  var products = [], tree = null, canEdit = false, closed = {}, expanded = {}, loadNo = 0;

  function option(v, t) { return el('option', { value: v, text: t }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function low(s) { return String(s || '').toLowerCase(); }
  function remember() { try { localStorage.setItem(STORE, JSON.stringify({ p: productSel.value, f: factorySel.value })); } catch (e) { /* ignore */ } }
  function recall() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }

  /* ---------- selection ---------- */
  function fillFactories(wanted) {
    var p = product();
    factorySel.textContent = '';
    if (!p) { factorySel.appendChild(option('', 'Choose a product first')); factorySel.disabled = true; return; }
    factorySel.appendChild(option('', 'Choose a factory'));
    p.factories.forEach(function (f) { factorySel.appendChild(option(f.id, f.name)); });
    factorySel.disabled = false;
    if (p.factories.length === 1) factorySel.value = p.factories[0].id;
    else if (wanted && p.factories.some(function (f) { return f.id === wanted; })) factorySel.value = wanted;
  }
  productSel.addEventListener('change', function () { fillFactories(); load(); });
  factorySel.addEventListener('change', load);

  function load(keep) {
    var id = factorySel.value, no = ++loadNo;
    remember();
    if (!id) {
      tree = null; result.hidden = true; search.disabled = true;
      hint.className = 'hint'; hint.textContent = product() ? 'Choose a factory.' : 'Choose a product and a factory.';
      return Promise.resolve();
    }
    if (!keep) { hint.className = 'hint'; hint.textContent = 'Loading…'; closed = {}; expanded = {}; }
    return Api.poTree(window.Hub.token(), id).then(function (res) {
      if (no !== loadNo) return;
      tree = res; canEdit = !!res.can_edit;
      hint.className = 'hint'; hint.textContent = res.factory.product + ', ' + res.factory.name + ' factory.';
      $('po-edit-wrap').hidden = !canEdit;
      if (!canEdit) $('po-edit').checked = false;
      search.disabled = false; result.hidden = false; $('po-error').hidden = true;
      render();
    }, function (err) {
      if (no !== loadNo) return;
      hint.className = 'notice error';
      hint.textContent = 'Could not load the options: ' + ((err && err.message) || err) + ' Choose the factory again to retry.';
      if (!keep) result.hidden = true;
    });
  }

  /* ---------- flat lists from the database -> sections ---------- */
  function build() {
    var secs = [], by = {};
    function sec(name) {
      var k = low(name);
      if (!by[k]) { by[k] = { name: name, rows: [], extras: [] }; secs.push(by[k]); }
      return by[k];
    }
    var rowBy = {};
    tree.rows.forEach(function (r) {
      var opt = /\|options\|option$/.test(r.key);      // the Options List lines of the section
      var row = { key: r.key, sub: r.sub || '', name: opt ? 'From the options list' : r.component, off: !!r.hidden, values: r.values || [], extras: [] };
      rowBy[r.key] = row; sec(r.section || 'General').rows.push(row);
    });
    tree.extras.forEach(function (x) {
      if (x.key && rowBy[x.key]) rowBy[x.key].extras.push(x); else sec(x.section).extras.push(x);
    });
    return secs;
  }

  /* 2,500 m3/h ... 45,000 m3/h -> a range, when every value is a number with the same unit */
  function range(values) {
    var unit = null, min = null, max = null, ok = values.every(function (v) {
      var m = /^(-?\d[\d.,]*)\s*(.*)$/.exec(v.v);
      if (!m) return false;
      var n = parseFloat(m[1].replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      if (isNaN(n) || (unit !== null && unit !== m[2])) return false;
      unit = m[2];
      if (min === null || n < min.n) min = { n: n, s: m[1] };
      if (max === null || n > max.n) max = { n: n, s: m[1] };
      return true;
    });
    return ok && min && min.n !== max.n ? min.s + ' to ' + max.s + (unit ? ' ' + unit : '') : '';
  }

  function matches(q, s, r) {
    if (!q) return true;
    var text = [s.name, r ? r.sub : '', r ? r.name : ''].concat(
      r ? r.values.map(function (v) { return v.v; }) : [],
      (r ? r.extras : s.extras).map(function (x) { return x.body; })).join(' \n ');
    return q.split(/\s+/).every(function (w) { return low(text).indexOf(w) >= 0; });
  }

  /* ---------- drawing ---------- */
  function editing() { return canEdit && $('po-edit').checked; }
  function when(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

  function busy(btn, promise, done) {
    btn.disabled = true;
    return promise.then(function () { window.Hub.toast(done); return load(true); },
      function (err) { btn.disabled = false; window.Hub.toast((err && err.message) || String(err), true); });
  }

  function xbtn(text, fn, danger) { return el('button', { type: 'button', 'class': 'po-x' + (danger ? ' danger' : ''), text: text, onclick: fn }); }

  /* one form at a time: add or change a special option / note */
  function openForm(anchor, d) {
    var old = host.querySelector('.po-form'); if (old) old.remove();
    var isNote = d.kind === 'note';
    var box = isNote ? el('textarea', { 'class': 'input', maxlength: 1000, 'aria-label': 'Note' })
                     : el('input', { 'class': 'input', type: 'text', maxlength: 1000, 'aria-label': 'Special option' });
    box.value = d.body || '';
    var msg = el('p', { 'class': 'hint', role: 'alert' });
    var save = el('button', { type: 'button', 'class': 'btn sm', text: d.id ? 'Save' : (isNote ? 'Add note' : 'Add special option') });
    var form = el('div', { 'class': 'po-form' }, [
      el('strong', { 'class': 'small', text: (d.id ? 'Change ' : 'New ') + (isNote ? 'note' : 'special option') + ' for ' + d.where }),
      box, msg,
      el('div', { 'class': 'row' }, [save, el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Cancel', onclick: function () { form.remove(); } })])
    ]);
    function submit() {
      var body = box.value.trim();
      if (!body) { msg.textContent = 'Type the text first.'; box.focus(); return; }
      msg.textContent = '';
      busy(save, Api.poAdminSaveExtra(window.Hub.token(), { factoryId: tree.factory.id, id: d.id, section: d.section, key: d.key, kind: d.kind, body: body }),
           d.id ? 'Saved.' : (isNote ? 'Note added.' : 'Special option added.'));
    }
    save.addEventListener('click', submit);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') form.remove();
      if (e.key === 'Enter' && (!isNote || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    anchor.appendChild(form); box.focus();
  }

  function extraNodes(list, ctx, edit) {
    var out = [];
    function tools(x, node) {
      if (!edit) return;
      node.appendChild(xbtn('Change', function () { openForm(ctx.anchor(), { id: x.id, kind: x.kind, body: x.body, section: x.section, key: x.key, where: ctx.where }); }));
      node.appendChild(xbtn('Delete', function (e) {
        if (!window.confirm('Delete this ' + (x.kind === 'note' ? 'note' : 'special option') + '?\n\n' + x.body)) return;
        busy(e.currentTarget, Api.poAdminDeleteExtra(window.Hub.token(), x.id), 'Deleted.');
      }, true));
    }
    list.filter(function (x) { return x.kind === 'option'; }).forEach(function (x) {
      var c = el('span', { 'class': 'po-chip special', title: 'Added by ' + (x.by || 'an editor') + (when(x.at) ? ', ' + when(x.at) : '') }, [el('b', { text: 'Special' }), el('span', { text: x.body })]);
      tools(x, c); out.push(c);
    });
    list.filter(function (x) { return x.kind === 'note'; }).forEach(function (x) {
      var n = el('p', { 'class': 'po-note' }, [el('span', { text: x.body }), el('span', { 'class': 'by', text: '  ' + [x.by, when(x.at)].filter(Boolean).join(', ') + ' ' })]);
      tools(x, n); out.push(n);
    });
    return out;
  }

  function rowNode(s, r, edit) {
    var vals = el('div', { 'class': 'po-vals' }), node = el('div', { 'class': 'po-row' + (r.off ? ' off' : '') });
    var shown = r.values, all = expanded[r.key] || edit || shown.length <= FEW;
    var rg = shown.length > FEW ? range(shown.filter(function (v) { return !v.hidden; })) : '';
    if (rg) vals.appendChild(el('span', { 'class': 'po-chip range', title: 'Lowest and highest value seen so far', text: rg }));
    (all ? shown : (rg ? [] : shown.slice(0, FEW))).forEach(function (v) {
      var c = el('span', { 'class': 'po-chip' + (v.hidden ? ' off' : '') }, [el('span', { text: v.v }), el('small', { text: '×' + v.n, title: v.n + (v.n === 1 ? ' unit' : ' units') + ' had this value' })]);
      if (edit) c.appendChild(xbtn(v.hidden ? 'Bring back' : 'Take out', function (e) {
        busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, valueKey: v.k, hidden: !v.hidden }), v.hidden ? 'Value is back in the tree.' : 'Value taken out.');
      }));
      vals.appendChild(c);
    });
    if (!edit && shown.length > FEW) vals.appendChild(el('button', { type: 'button', 'class': 'po-more',
      text: all ? 'Show fewer' : (rg ? 'Show all ' + shown.length + ' values' : '+ ' + (shown.length - FEW) + ' more'),
      onclick: function () { expanded[r.key] = !all; render(); } }));
    var ctx = { where: s.name + ' > ' + r.name, anchor: function () { return node; } };
    extraNodes(r.extras, ctx, edit).forEach(function (n) { vals.appendChild(n); });
    node.appendChild(el('div', { 'class': 'po-name', text: r.name + (r.off ? ' (left out)' : '') }));
    node.appendChild(vals);
    if (edit) node.appendChild(el('div', { 'class': 'po-tools' }, [
      xbtn('+ Special option', function () { openForm(node, { kind: 'option', section: s.name, key: r.key, where: ctx.where }); }),
      xbtn('+ Note', function () { openForm(node, { kind: 'note', section: s.name, key: r.key, where: ctx.where }); }),
      xbtn(r.off ? 'Bring row back' : 'Leave out row', function (e) {
        busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, hidden: !r.off }),
             r.off ? 'Row is back in the tree.' : 'Row left out for every ' + tree.factory.product + ' factory.');
      }, !r.off)
    ]));
    return node;
  }

  function render() {
    if (!tree) return;
    var edit = editing(), q = low(search.value).trim(), secs = build();
    var nRows = 0, nVals = 0, nExtra = tree.extras.length;
    host.textContent = '';
    $('po-edit-note').hidden = !edit;

    var wrap = el('div', { 'class': 'po-tree' }), drawn = 0;
    secs.forEach(function (s) {
      var live = s.rows.filter(function (r) { return edit || !r.off; });
      live.forEach(function (r) { if (!r.off) { nRows++; nVals += r.values.filter(function (v) { return !v.hidden; }).length; } });
      var secHit = q && q.split(/\s+/).every(function (w) { return low(s.name).indexOf(w) >= 0; });
      var rows = live.filter(function (r) { return secHit || matches(q, s, r); });
      var extras = s.extras.filter(function (x) { return secHit || !q || matches(q, { name: s.name, extras: [x] }); });
      if (!rows.length && !extras.length && !(edit && !q)) return;
      drawn++;

      var body = el('div', { 'class': 'po-body' });
      var d = el('details', { 'class': 'po-sec', open: q ? true : !closed[low(s.name)] }, [
        el('summary', {}, [el('span', { text: s.name }), el('span', { 'class': 'count',
          text: [rows.length ? rows.length + (rows.length === 1 ? ' component' : ' components') : '',
                 s.extras.length + live.reduce(function (n, r) { return n + r.extras.length; }, 0) ? 'special options and notes' : ''].filter(Boolean).join(' · ') })]),
        body
      ]);
      d.addEventListener('toggle', function () { if (!q) closed[low(s.name)] = !d.open; });

      var ctx = { where: s.name, anchor: function () { return sx; } };
      var sx = el('div', { 'class': 'po-secx' }, extraNodes(extras, ctx, edit));
      if (edit) sx.appendChild(el('div', { 'class': 'po-tools' }, [
        xbtn('+ Special option for the section', function () { openForm(sx, { kind: 'option', section: s.name, key: '', where: s.name }); }),
        xbtn('+ Note for the section', function () { openForm(sx, { kind: 'note', section: s.name, key: '', where: s.name }); })
      ]));
      if (sx.childNodes.length) body.appendChild(sx);

      var sub = '';
      rows.forEach(function (r) {
        if (r.sub !== sub) { sub = r.sub; if (sub) body.appendChild(el('div', { 'class': 'po-sub', text: sub })); }
        body.appendChild(rowNode(s, r, edit));
      });
      wrap.appendChild(d);
    });

    var facts = $('po-facts'); facts.textContent = '';
    [secs.length + (secs.length === 1 ? ' section' : ' sections'), nRows + ' components', nVals + ' values',
     nExtra ? nExtra + ' special options and notes' : '', tree.updated ? 'Last datasheet ' + when(tree.updated) : '']
      .filter(Boolean).forEach(function (t) { facts.appendChild(el('span', { 'class': 'badge', text: t })); });

    var empty = $('po-empty'), nothing = !tree.rows.length && !tree.extras.length;
    empty.hidden = !!drawn; empty.textContent = '';
    if (!drawn) {
      if (q) empty.textContent = 'Nothing matches "' + search.value.trim() + '".';
      else {
        empty.appendChild(document.createTextNode('No datasheet has been run for this factory yet. Run one in '));
        empty.appendChild(el('a', { href: '../datasheet-notes/', text: 'Datasheet Notes' }));
        empty.appendChild(document.createTextNode(' and its mapped rows appear here.'));
      }
    }
    $('po-download').disabled = nothing;
    $('po-open').disabled = $('po-close').disabled = !drawn;

    if (drawn || edit) {
      host.appendChild(el('div', { 'class': 'po-root' }, [
        el('span', { text: tree.factory.product }), el('span', { 'class': 'badge', text: tree.factory.name + ' factory' })]));
      host.appendChild(wrap);
    }
    if (edit && !q) host.appendChild(addSection(secs));
  }

  /* editors: an entry for a section that has nothing in the tree yet, or a new section */
  function addSection(secs) {
    var have = secs.map(function (s) { return low(s.name); });
    var names = (tree.sections || []).filter(function (n) { return have.indexOf(low(n)) < 0; });
    var input = el('input', { 'class': 'input', type: 'text', maxlength: 120, list: 'po-sections', placeholder: 'Section name, e.g. Humidifier', 'aria-label': 'Section name', style: 'max-width:280px' });
    var box = el('div', { 'class': 'po-add stack' });
    var msg = el('p', { 'class': 'hint', role: 'alert' });
    function go(kind) {
      var name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { msg.textContent = 'Type the section name first.'; input.focus(); return; }
      msg.textContent = '';
      openForm(box, { kind: kind, section: name, key: '', where: name });
    }
    box.appendChild(el('strong', { 'class': 'small', text: 'Add to another section' }));
    box.appendChild(el('div', { 'class': 'row' }, [input,
      el('datalist', { id: 'po-sections' }, names.map(function (n) { return el('option', { value: n }); })),
      el('button', { type: 'button', 'class': 'btn ghost sm', text: '+ Special option', onclick: function () { go('option'); } }),
      el('button', { type: 'button', 'class': 'btn ghost sm', text: '+ Note', onclick: function () { go('note'); } })]));
    box.appendChild(msg);
    return box;
  }

  /* ---------- controls ---------- */
  var timer;
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(render, 150); });
  $('po-edit').addEventListener('change', render);
  function setAll(open) {
    if (!tree) return;
    build().forEach(function (s) { closed[low(s.name)] = !open; });
    render();
  }
  $('po-open').addEventListener('click', function () { setAll(true); });
  $('po-close').addEventListener('click', function () { setAll(false); });

  /* Excel: what a user sees (nothing that was taken out), one row per component */
  $('po-download').addEventListener('click', function () {
    if (!tree) return;
    var rows = [['Section', 'Sub-section', 'Component', 'Options seen on datasheets', 'Special options', 'Notes']];
    function txt(list, kind) { return list.filter(function (x) { return x.kind === kind; }).map(function (x) { return x.body; }).join(' | '); }
    build().forEach(function (s) {
      if (s.extras.length) rows.push([s.name, '', '(whole section)', '', txt(s.extras, 'option'), txt(s.extras, 'note')]);
      s.rows.forEach(function (r) {
        if (r.off) return;
        var vals = r.values.filter(function (v) { return !v.hidden; });
        if (!vals.length && !r.extras.length) return;
        rows.push([s.name, r.sub, r.name, vals.map(function (v) { return v.v; }).join(' | '), txt(r.extras, 'option'), txt(r.extras, 'note')]);
      });
    });
    var name = tree.factory.product + ' ' + tree.factory.name + ' - Product Options.xlsx';
    var blob = window.HubXlsx.build(rows, 'Product Options', [24, 22, 30, 48, 40, 50]);
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    window.Hub.toast('Excel downloaded.');
  });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ tool: TOOL }).then(function () {
    return Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    products = res.products || [];
    var last = recall();
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    if (products.length === 1) productSel.value = products[0].id;
    else if (products.some(function (p) { return p.id === last.p; })) productSel.value = last.p;
    fillFactories(last.f);
    load();
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.className = 'notice error';
    hint.textContent = 'Could not load the product list: ' + ((err && err.message) || err) + ' Refresh the page to try again.';
  });
})();
